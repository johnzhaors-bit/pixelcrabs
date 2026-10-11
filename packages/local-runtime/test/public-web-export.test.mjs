import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { exportStaticWeb } from '../src/web-export.ts'

async function fixture(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pixelcrabs-export-test-'))
  try {
    const source = path.join(root, 'dist')
    await mkdir(source)
    await writeFile(path.join(source, 'index.html'), '<button>Exported</button>')
    await run({ root, source })
  } finally {
    if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith('pixelcrabs-export-test-')) throw new Error('Invalid fixture')
    await rm(root, { recursive: true, force: true })
  }
}

test('exports real assets, reports exclusions, preserves source and previous exports', () => fixture(async ({ root, source }) => {
  await mkdir(path.join(source, 'assets'))
  await writeFile(path.join(source, 'assets', 'app.js'), 'window.example = true')
  for (const name of ['.env', 'package.json', 'app.js.map', 'private.pem']) await writeFile(path.join(source, name), 'excluded fixture')
  const a = await exportStaticWeb({ sourceDirectory: source, destinationParent: root })
  const b = await exportStaticWeb({ sourceDirectory: source, destinationParent: root })
  assert.equal(a.status, 'exported')
  assert.equal(a.published, false)
  assert.equal(a.files, 2)
  assert.equal(a.skipped.length, 4)
  assert.notEqual(a.directory, b.directory)
  assert.equal(await readFile(a.entrypoint, 'utf8'), '<button>Exported</button>')
  assert.equal(await readFile(path.join(a.directory, 'assets', 'app.js'), 'utf8'), 'window.example = true')
  assert.equal(await readFile(path.join(source, '.env'), 'utf8'), 'excluded fixture')
  assert.deepEqual((await readdir(a.directory)).sort(), ['assets', 'index.html'])
}))

test('rejects nested destinations, missing static entry and cancelled exports without leftovers', () => fixture(async ({ root, source }) => {
  await assert.rejects(exportStaticWeb({ sourceDirectory: source, destinationParent: source }), /outside/)
  await assert.rejects(exportStaticWeb({ sourceDirectory: source, destinationParent: root, signal: AbortSignal.abort() }))
  await rm(path.join(source, 'index.html'))
  await assert.rejects(exportStaticWeb({ sourceDirectory: source, destinationParent: root }))
  assert.deepEqual(await readdir(root), ['dist'])
}))

test('rejects junctions or symlinks instead of copying external files', () => fixture(async ({ root, source }) => {
  const outside = path.join(root, 'outside')
  await mkdir(outside)
  await writeFile(path.join(outside, 'sensitive.json'), '{}')
  await symlink(outside, path.join(source, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(exportStaticWeb({ sourceDirectory: source, destinationParent: root }), /Symbolic links/)
  assert.deepEqual((await readdir(root)).sort(), ['dist', 'outside'])
}))
