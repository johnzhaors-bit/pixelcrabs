import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises'
import { request } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const cli = fileURLToPath(new URL('../bin/static-preview.mjs', import.meta.url))
function get(port, pathname = '/', options = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path: pathname, ...options }, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => { body += chunk })
      res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }))
    })
    req.setTimeout(3000, () => req.destroy(new Error('HTTP timeout')))
    req.on('error', reject)
    req.end()
  })
}

test('standalone static preview serves real files, rejects unsafe requests and stops its child', { timeout: 20000 }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pixelcrabs-public-static-'))
  const site = path.join(root, 'site')
  let child, exited
  try {
    await mkdir(site)
    await mkdir(path.join(root, 'outside'))
    await mkdir(path.join(site, '.git'))
    await writeFile(path.join(site, 'index.html'), '<button>Test</button>')
    await writeFile(path.join(site, 'style.css'), 'button { color: red; }')
    await writeFile(path.join(site, '.env'), 'TEST_FIXTURE_ONLY')
    await writeFile(path.join(root, 'outside', 'file.txt'), 'OUTSIDE_FIXTURE')
    await symlink(path.join(root, 'outside'), path.join(site, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
    child = spawn(process.execPath, [cli, site, '0'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    exited = once(child, 'exit')
    let output = ''
    child.stdout.on('data', (data) => { output += data })
    child.stderr.on('data', (data) => { output += data })
    const deadline = Date.now() + 10000
    while (!output.match(/Static preview: http:\/\/127\.0\.0\.1:(\d+)/)) {
      assert.equal(child.exitCode, null, output)
      assert.ok(Date.now() < deadline, output)
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    const port = Number(output.match(/Static preview: http:\/\/127\.0\.0\.1:(\d+)/)[1])
    assert.equal((await get(port)).body, '<button>Test</button>')
    assert.equal((await get(port, '/nested/page')).body, '<button>Test</button>')
    const css = await get(port, '/style.css?version=1')
    assert.equal(css.status, 200)
    assert.match(css.headers['content-type'], /text\/css/)
    assert.equal((await get(port, '/', { method: 'HEAD' })).body, '')
    assert.equal((await get(port, '/missing.js')).status, 404)
    assert.equal((await get(port, '/%ZZ')).status, 400)
    assert.equal((await get(port, '/file%00')).status, 400)
    assert.equal((await get(port, '/.env')).status, 403)
    assert.equal((await get(port, '/%2egit/config')).status, 403)
    assert.equal((await get(port, '/linked/file.txt')).status, 403)
    assert.equal((await get(port, '/', { headers: { host: 'untrusted.example' } })).status, 403)
    assert.equal((await get(port, '/', { method: 'POST' })).status, 405)
    assert.equal((await get(port)).status, 200, 'invalid requests must not crash the server')
    await writeFile(path.join(site, 'index.html'), '<button>Updated</button>')
    assert.equal((await get(port)).body, '<button>Updated</button>')
    // On POSIX this exercises the CLI signal handler. Windows task termination
    // does not deliver SIGTERM handlers; use the owned process tree there.
    if (process.platform === 'win32') {
      const stop = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true })
      await once(stop, 'exit')
    } else child.kill('SIGTERM')
    await exited
    await assert.rejects(get(port))
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      if (process.platform === 'win32') {
        await once(spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true }), 'exit')
      } else child.kill('SIGTERM')
      await exited
    }
    assert.ok(root.startsWith(path.join(os.tmpdir(), 'pixelcrabs-public-static-')))
    await rm(root, { recursive: true, force: true })
  }
})

test('standalone preview rejects missing projects and invalid ports', async () => {
  for (const args of [[], ['--help'], ['missing-static-test-directory'], ['.', 'not-a-port']]) {
    const child = spawn(process.execPath, [cli, ...args], { stdio: 'ignore', windowsHide: true })
    const [code] = await once(child, 'exit')
    assert.equal(code, args[0] === '--help' ? 0 : 1)
  }
})
