import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { get } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { createWebRuntimeManager } from '../src/web-runtime.ts'
import { previewPortAvailable } from '../src/preview-port.ts'

function page(url) {
  const target = new URL(url)
  return new Promise((resolve, reject) => {
    const req = get({ host: '127.0.0.1', port: target.port, path: target.pathname, headers: { host: target.host }, timeout: 3000 }, res => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', chunk => { body += chunk })
      res.on('end', () => resolve({ body, status: res.statusCode, runtime: res.headers['x-pixelcrab-runtime-id'] }))
    })
    req.on('timeout', () => req.destroy(new Error('request timeout')))
    req.on('error', reject)
  })
}

test('owned static runtime: identity, reuse, conversation isolation, project switch and cleanup', { timeout: 90000 }, async () => {
  const roots = []
  const manager = createWebRuntimeManager()
  try {
    for (const label of ['first', 'second']) {
      const root = await mkdtemp(path.join(os.tmpdir(), 'pixelcrabs-runtime-test-'))
      roots.push(root)
      await writeFile(path.join(root, 'index.html'), `<button>${label}</button>`)
    }
    const input = { conversationId: 'test-session', directory: roots[0], adapterId: 'web-static' }
    const first = await manager.start(input)
    assert.equal(first.status, 'running', first.message)
    assert.equal(first.projectIdentityVerified, true)
    assert.match(first.message, /not yet been verified/)
    assert.deepEqual(await page(first.record.url), { body: '<button>first</button>', status: 200, runtime: first.record.runtimeId })
    assert.equal((await manager.start(input)).record.runtimeId, first.record.runtimeId)
    assert.deepEqual(manager.list('other-session'), [])
    await assert.rejects(manager.stop('other-session', first.record.runtimeId), /does not belong/)
    const second = await manager.start({ ...input, directory: roots[1] })
    assert.equal(second.status, 'running', second.message)
    assert.notEqual(second.record.projectId, first.record.projectId)
    assert.equal(await previewPortAvailable(first.record.port), true)
    assert.equal((await page(first.record.url)).status, 404)
    assert.equal((await page(second.record.url)).body, '<button>second</button>')
    await manager.stop(input.conversationId, second.record.runtimeId)
    assert.equal(await previewPortAvailable(second.record.port), true)
    assert.deepEqual(manager.list(input.conversationId), [])
  } finally {
    await manager.dispose()
    for (const root of roots) {
      assert.ok(root.startsWith(path.join(os.tmpdir(), 'pixelcrabs-runtime-test-')))
      await rm(root, { recursive: true, force: true })
    }
  }
})

test('unsupported project and cancellation do not create a runtime', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pixelcrabs-runtime-test-'))
  const manager = createWebRuntimeManager()
  try {
    const input = { conversationId: 'empty', directory: root, adapterId: 'web-static' }
    assert.equal((await manager.start(input)).status, 'unsupported')
    await assert.rejects(manager.start({ ...input, signal: AbortSignal.abort() }), /abort/i)
    assert.deepEqual(manager.list(input.conversationId), [])
  } finally {
    await manager.dispose()
    assert.ok(root.startsWith(path.join(os.tmpdir(), 'pixelcrabs-runtime-test-')))
    await rm(root, { recursive: true, force: true })
  }
})
