import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { discoverWebProject, webPreviewPortArgs } from '../src/web-project.ts'
import { missingProjectDependencies, resolvePackageManager, packageManagerExecutable } from '../src/web-project-support.ts'

const roots = []
test('Windows Node and Electron invoke Bun as an executable, not a cmd shim', () => {
  for (const name of ['node.exe', 'electron.exe']) {
    const runtime = { platform: 'win32', execPath: `C:\\tools\\${name}` }
    assert.equal(packageManagerExecutable('bun', runtime), 'bun.exe')
    assert.equal(packageManagerExecutable('npm', runtime), 'npm.cmd')
  }
  assert.equal(packageManagerExecutable('bun', { platform: 'win32', execPath: 'C:\\tools\\bun.exe' }), 'C:\\tools\\bun.exe')
  assert.equal(packageManagerExecutable('bun', { platform: 'linux', execPath: '/usr/bin/node' }), 'bun')
  assert.equal(packageManagerExecutable('pnpm', { platform: 'linux', execPath: '/usr/bin/node' }), 'pnpm')
})
async function fixture(manifest, html = false) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pixelcrabs-web-project-'))
  roots.push(root)
  if (manifest !== undefined) await writeFile(path.join(root, 'package.json'), JSON.stringify(manifest))
  if (html) await writeFile(path.join(root, 'index.html'), '<button>Preview</button>')
  return root
}
afterEach(async () => {
  for (const root of roots.splice(0)) {
    assert.ok(root.startsWith(path.join(os.tmpdir(), 'pixelcrabs-web-project-')))
    await rm(root, { recursive: true, force: true })
  }
})

test('static discovery requires an actual HTML file and never claims a running server', async () => {
  const root = await fixture(undefined, true)
  const result = await discoverWebProject(root)
  assert.equal(result.status, 'detected')
  assert.equal(result.candidates[0].adapterId, 'web-static')
  assert.equal(result.candidates[0].status, 'requires_check')
  const empty = await fixture()
  await mkdir(path.join(empty, 'index.html'))
  assert.equal((await discoverWebProject(empty)).status, 'unsupported')
})

test('framework projects preserve their stack and report missing dependencies', async () => {
  for (const id of ['next', 'nuxt', 'astro', 'vite']) {
    const root = await fixture({ packageManager: 'npm@10.0.0', dependencies: { [id]: '*' }, scripts: { dev: `${id} dev` } }, true)
    const result = await discoverWebProject(root)
    assert.equal(result.candidates[0].adapterId, id)
    assert.equal(result.candidates[0].status, 'missing')
    assert.deepEqual(result.candidates[0].missingDependencies, [id])
    assert.equal(result.candidates[0].launch.packageManager, 'npm')
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ dependencies: { [id]: '*' } }))
    assert.equal((await discoverWebProject(root)).status, 'unsupported', 'do not downgrade a framework to static HTML')
  }
})

test('workspace dependencies are detected but still require startup verification', async () => {
  const root = await fixture()
  const project = path.join(root, 'app')
  await mkdir(project)
  await mkdir(path.join(root, 'node_modules', 'vite'), { recursive: true })
  await writeFile(path.join(project, 'package.json'), JSON.stringify({ dependencies: { vite: '*' }, scripts: { dev: 'vite' } }))
  const result = await discoverWebProject(project)
  assert.deepEqual(result.candidates[0].missingDependencies, [])
  assert.equal(result.candidates[0].status, 'requires_check')
  assert.deepEqual(missingProjectDependencies(project, ['../../outside']), ['../../outside'])
})

test('generic scripts retain manager selection and unknown port compatibility', async () => {
  const root = await fixture({ scripts: { start: 'custom-web-server' } })
  await writeFile(path.join(root, 'package-lock.json'), '{}')
  const result = await discoverWebProject(root)
  assert.equal(result.candidates[0].adapterId, 'generic-web')
  assert.deepEqual(result.candidates[0].launch.args, ['run', 'start'])
  assert.equal(resolvePackageManager(root, 'yarn@4.0.0'), 'yarn')
  assert.deepEqual(webPreviewPortArgs(result.candidates[0].launch, 4311), ['--', '--host', '127.0.0.1', '--port', '4311'])
  assert.deepEqual(webPreviewPortArgs({ adapterId: 'next' }, 4311), ['--hostname', '127.0.0.1', '--port', '4311'])
  assert.throws(() => webPreviewPortArgs({ adapterId: 'vite' }, 0))
})

test('malformed manifests and non-Web projects do not silently become static previews', async () => {
  for (const value of [null, [], 'text']) {
    const root = await fixture(value, true)
    assert.equal((await discoverWebProject(root)).status, 'invalid')
  }
  for (const name of ['@dcloudio/uni-app', '@tarojs/taro', 'react-native']) {
    const root = await fixture({ dependencies: { [name]: '*', vite: '*' }, scripts: { dev: 'vite' } }, true)
    assert.equal((await discoverWebProject(root)).status, 'unsupported')
  }
  const root = await fixture(undefined, true)
  await writeFile(path.join(root, 'pubspec.yaml'), 'name: fixture')
  assert.equal((await discoverWebProject(root)).status, 'unsupported')
})
