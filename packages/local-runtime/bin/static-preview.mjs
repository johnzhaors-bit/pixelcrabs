import { spawn } from 'node:child_process'
import { realpathSync, statSync } from 'node:fs'
import path from 'node:path'
import { staticWebPreviewLaunchProfile } from '../src/static-web-preview.ts'

const [directory, portText = '4173', ...extra] = process.argv.slice(2)
const port = Number(portText)
if (!directory || directory === '--help') {
  console.log('Usage: node packages/local-runtime/bin/static-preview.mjs <static-site-directory> [port]')
  console.log('Serve a trusted static HTML project on localhost. Stop with Ctrl+C. Use the framework dev server for React/Vue/etc.')
  process.exit(directory ? 0 : 1)
}
if (extra.length || !/^\d+$/.test(portText) || port > 65535) {
  console.error('Provide a port between 0 and 65535 (0 chooses an available port).')
  process.exit(1)
}
let cwd
try {
  cwd = realpathSync(directory)
  if (!statSync(path.join(cwd, 'index.html')).isFile()) throw new Error('Missing index.html')
} catch {
  console.error('Choose an existing static site directory containing index.html.')
  process.exit(1)
}
const profile = staticWebPreviewLaunchProfile()
const child = spawn(profile.command, [...profile.args, '--', '--host', '127.0.0.1', '--port', String(port)], {
  cwd, stdio: 'inherit', windowsHide: true,
})
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill())
child.once('error', () => { console.error('Unable to start the Node preview process.'); process.exitCode = 1 })
child.once('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0) })
