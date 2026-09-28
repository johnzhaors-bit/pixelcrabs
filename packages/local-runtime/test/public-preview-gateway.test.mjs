import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer, get } from 'node:http'
import { connect } from 'node:net'
import { once } from 'node:events'
import { registerPreviewGateway, unregisterPreviewGateway } from '../src/preview-gateway.ts'

test('gateway isolates runtime hosts, rejects malformed paths and closes HMR tunnels on removal', { timeout: 10000 }, async () => {
  const server = createServer((req, res) => res.end(req.url))
  const sockets = new Set()
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)) })
  server.on('upgrade', (_req, socket) => socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n'))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const id = 'runtime_public_gateway_test'
  let socket
  try {
    const url = new URL(await registerPreviewGateway(id, `http://127.0.0.1:${server.address().port}/`))
    const request = (host, pathname) => new Promise((resolve, reject) => {
      get({ host: '127.0.0.1', port: url.port, path: pathname, headers: { host } }, res => {
        let body = ''
        res.on('data', chunk => { body += chunk })
        res.on('end', () => resolve({ status: res.statusCode, body }))
      }).on('error', reject)
    })
    assert.deepEqual(await request(url.host, '/asset.js'), { status: 200, body: '/asset.js' })
    assert.equal((await request('untrusted.example', url.pathname)).status, 404)
    assert.equal((await request('localhost', '/preview/%ZZ/')).status, 404)
    socket = connect(Number(url.port), '127.0.0.1')
    await once(socket, 'connect')
    const received = once(socket, 'data')
    socket.write(`GET /hmr HTTP/1.1\r\nHost: ${url.host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n`)
    assert.match(String((await received)[0]), /101 Switching/)
    const closed = once(socket, 'close')
    unregisterPreviewGateway(id)
    await closed
    assert.equal((await request(url.host, '/asset.js')).status, 404)
  } finally {
    unregisterPreviewGateway(id)
    socket?.destroy()
    for (const client of sockets) client.destroy()
    await new Promise(resolve => server.close(resolve))
  }
})
