import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, rm, readdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { acquireManagedPnpm, MANAGED_PNPM } from '../src/managed-web-package.ts'
import { acquireNodeToolchain } from '../src/node-toolchain.ts'
import { createWebRuntimeManager } from '../src/web-runtime.ts'

test('pinned pnpm: download, offline cache, dependency install and real Vite startup', { timeout: 240000 }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pixelcrabs-managed-test-'))
  const cacheDirectory = path.join(root, 'cache')
  let tool, node, manager
  try {
    tool = await acquireManagedPnpm({ cacheDirectory, fetchImpl: fetch })
    assert.equal(tool.cached, false)
    assert.equal(execFileSync(process.execPath, [tool.entrypoint, '--config.manage-package-manager-versions=false', '--version'], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 30000 }).trim(), MANAGED_PNPM.version)
    await tool.release()
    tool = await acquireManagedPnpm({ cacheDirectory, fetchImpl: async () => { throw new Error('Offline cache must not access network') } })
    assert.equal(tool.cached, true)
    node = await acquireNodeToolchain()
    await node.ensureNode()
    const environment = node.environment()
    environment.PATH = tool.binDirectory + path.delimiter + environment.PATH
    environment.Path = environment.PATH
    // Use a fresh project and isolated dependency store; no account or existing project is read.
    const project = path.join(root, 'project')
    await mkdir(project)
    await writeFile(path.join(project, 'package.json'), JSON.stringify({ private: true, type: 'module', packageManager: `pnpm@${MANAGED_PNPM.version}`, scripts: { dev: 'vite --host 127.0.0.1', postinstall: 'node -e "process.exit(71)"' }, devDependencies: { vite: '7.1.4' } }))
    await writeFile(path.join(project, 'index.html'), '<button>Managed environment</button>')
    execFileSync(process.execPath, [tool.entrypoint, 'install', '--ignore-scripts', '--config.manage-package-manager-versions=false', '--store-dir', path.join(root, 'store')], { cwd: project, env: environment, windowsHide: true, timeout: 120000, stdio: 'pipe' })
    manager = createWebRuntimeManager({ environment: () => environment, startupTimeoutMs: 45000 })
    const discovery = await manager.discover(project)
    assert.deepEqual(discovery.candidates[0].missingDependencies, [])
    const started = await manager.start({ conversationId: 'managed', directory: project, adapterId: 'vite' })
    assert.equal(started.status, 'running', started.message + '\n' + started.logs)
    assert.equal((await manager.verify('managed', started.record.runtimeId)).projectIdentityVerified, true)
    await manager.stop('managed', started.record.runtimeId)
    await tool.release()
    tool = undefined
    assert.deepEqual(await readdir(cacheDirectory), [`pnpm-${MANAGED_PNPM.version}.tgz`])
  } finally {
    await manager?.dispose()
    await node?.release()
    await tool?.release()
    assert.equal(path.dirname(root), os.tmpdir())
    assert.ok(path.basename(root).startsWith('pixelcrabs-managed-test-'))
    await rm(root, { recursive: true, force: true })
  }
})
