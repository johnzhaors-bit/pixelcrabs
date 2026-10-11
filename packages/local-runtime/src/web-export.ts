import { constants } from "node:fs"
import { copyFile, lstat, mkdir, mkdtemp, readdir, realpath, rm } from "node:fs/promises"
import path from "node:path"

const assetExtensions = new Set([".html", ".htm", ".css", ".js", ".mjs", ".json", ".txt", ".xml", ".webmanifest", ".wasm", ".svg", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".ico", ".woff", ".woff2", ".ttf", ".otf", ".mp3", ".mp4", ".ogg", ".webm", ".pdf"])
const excluded = /^(?:\..*|node_modules|package(?:-lock)?\.json|(?:pnpm-lock\.yaml|yarn\.lock|bun\.lockb?)|.*\.map)$/i

function inside(parent: string, child: string) {
  const relative = path.relative(parent, child)
  return !path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(".." + path.sep)
}

/** Copies explicitly selected, trusted static output; never builds, edits source,
 * executes code or publishes. Exclusions are not a content/secret scanner. */
export async function exportStaticWeb(input: {
  sourceDirectory: string
  destinationParent: string
  signal?: AbortSignal
}) {
  const source = await realpath(input.sourceDirectory)
  const parent = await realpath(input.destinationParent)
  if (!(await lstat(source)).isDirectory() || !(await lstat(parent)).isDirectory()) throw new Error("Source and destination parent must be directories")
  if (inside(source, parent)) throw new Error("Export destination must be outside the source tree")
  const index = await lstat(path.join(source, "index.html"))
  if (!index.isFile() || index.isSymbolicLink()) throw new Error("A static index.html is required; server-only output cannot be exported as a static site")
  input.signal?.throwIfAborted()
  const files: { relative: string; size: number; mtimeMs: number }[] = []
  const skipped: string[] = []
  let bytes = 0
  let entries = 0
  async function inspect(directory: string, depth: number) {
    if (depth > 64) throw new Error("Static export directory depth exceeds 64")
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      input.signal?.throwIfAborted()
      if (++entries > 20000) throw new Error("Static export exceeds 20000 entries")
      const absolute = path.join(directory, entry.name)
      const relative = path.relative(source, absolute)
      if (excluded.test(entry.name)) { skipped.push(relative); continue }
      const stat = await lstat(absolute)
      if (stat.isSymbolicLink()) throw new Error(`Symbolic links are not exportable: ${relative}`)
      if (stat.isDirectory()) { await inspect(absolute, depth + 1); continue }
      if (!stat.isFile()) throw new Error(`Special files are not exportable: ${relative}`)
      if (!assetExtensions.has(path.extname(entry.name).toLowerCase())) { skipped.push(relative); continue }
      bytes += stat.size
      if (bytes > 512 * 1024 * 1024 || files.length >= 10000) throw new Error("Static export exceeds 10000 files or 512 MiB")
      files.push({ relative, size: stat.size, mtimeMs: stat.mtimeMs })
    }
  }
  await inspect(source, 0)
  input.signal?.throwIfAborted()
  // Exclusive unique directory: a prior export or user-selected directory is never overwritten.
  const output = await mkdtemp(path.join(parent, "pixelcrabs-web-"))
  try {
    for (const file of files) {
      input.signal?.throwIfAborted()
      const from = path.join(source, file.relative)
      const resolved = await realpath(from)
      const stat = await lstat(from)
      if (!inside(source, resolved) || stat.isSymbolicLink() || !stat.isFile() || stat.size !== file.size || stat.mtimeMs !== file.mtimeMs) throw new Error("Build output changed during export; finish the build and retry")
      const target = path.join(output, file.relative)
      await mkdir(path.dirname(target), { recursive: true })
      await copyFile(from, target, constants.COPYFILE_EXCL)
      const after = await lstat(from)
      if (after.size !== file.size || after.mtimeMs !== file.mtimeMs) throw new Error("Build output changed during export; finish the build and retry")
    }
    input.signal?.throwIfAborted()
    return { status: "exported" as const, directory: output, entrypoint: path.join(output, "index.html"), files: files.length, bytes, skipped, published: false }
  } catch (error) {
    // Only the unique directory created by this invocation can be removed.
    if (path.dirname(output) === parent && path.basename(output).startsWith("pixelcrabs-web-")) await rm(output, { recursive: true, force: true }).catch(() => {})
    throw error
  }
}
