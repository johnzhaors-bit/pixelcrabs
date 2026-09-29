import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { WebPreviewPlugin } from '../src/web-preview-plugin.ts'
import { MANAGED_PNPM } from '../src/managed-web-package.ts'

test('native preparation: missing dependencies, injected download transport, install, preview and disposal', { timeout: 240000 }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pixelcrabs-prepare-test-'))
  const project = path.join(root, 'project')
  await mkdir(project)
  const calls = []
  let downloads = 0
  const systemPath = process.platform === 'win32' ? path.join(process.env.SystemRoot, 'System32') : '/usr/bin:/bin'
  const isolatedPath = path.dirname(process.execPath) + path.delimiter + systemPath
  const hooks = await WebPreviewPlugin(undefined, {
    cacheDirectory: path.join(root, 'tools'),
    environment: { ...process.env, PATH: isolatedPath, Path: isolatedPath, npm_config_userconfig: path.join(root, 'empty.npmrc') },
    fetchImpl: async (url, init) => { assert.equal(url, MANAGED_PNPM.url); downloads++; return fetch(url, init) },
  })
  const context = { sessionID: 'prepare', messageID: 'm', agent: 'build', directory: project, worktree: project, abort: new AbortController().signal, metadata() {}, async ask(input) { calls.push(input.permission) } }
  const execute = async (name, args) => {
    const result = await hooks.tool[name].execute(args, context)
    return JSON.parse(typeof result === 'string' ? result : result.output)
  }
  try {
    await writeFile(path.join(root, 'empty.npmrc'), '')
    await writeFile(path.join(project, 'package.json'), JSON.stringify({ private: true, type: 'module', packageManager: `pnpm@${MANAGED_PNPM.version}`, scripts: { dev: 'vite --host 127.0.0.1', postinstall: 'node -e "process.exit(77)"' }, devDependencies: { vite: '7.1.4' } }))
    await writeFile(path.join(project, 'index.html'), '<button>Automatic preparation</button>')
    assert.equal((await execute('pixelcrabs_preview', { action: 'start', adapterId: 'vite' })).status, 'missing')
    const prepared = await execute('pixelcrabs_prepare_web', {})
    assert.equal(prepared.status, 'dependencies_installed', JSON.stringify(prepared))
    assert.equal(prepared.previewVerified, false)
    assert.equal(prepared.lifecycleScripts, 'disabled')
    assert.equal(downloads, 1)
    assert.ok(calls.includes('pixelcrabs_prepare_web'))
    const shell = { env: {} }
    await hooks['shell.env']({ cwd: project }, shell)
    assert.ok(shell.env.PATH.includes('managed-bin'))
    const discovery = await execute('pixelcrabs_preview', { action: 'discover' })
    assert.deepEqual(discovery.candidates[0].missingDependencies, [])
    const started = await execute('pixelcrabs_preview', { action: 'start', adapterId: 'vite' })
    assert.equal(started.status, 'running', JSON.stringify(started))
    assert.equal((await execute('pixelcrabs_preview', { action: 'verify', runtimeId: started.record.runtimeId })).projectIdentityVerified, true)
    await execute('pixelcrabs_preview', { action: 'stop', runtimeId: started.record.runtimeId })
  } finally {
    await hooks.dispose()
    assert.equal(path.dirname(root), os.tmpdir())
    assert.ok(path.basename(root).startsWith('pixelcrabs-prepare-test-'))
    await rm(root, { recursive: true, force: true })
  }
})
