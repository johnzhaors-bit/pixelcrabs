import { createHash } from "node:crypto"
import { chmod, lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { pipeline } from "node:stream/promises"
import { Readable } from "node:stream"
import { x } from "tar"

// Reviewed npm registry artifact, not a moving dist-tag. Preserve its bundled license.
export const MANAGED_PNPM = Object.freeze({
  version: "10.34.6",
  url: "https://registry.npmjs.org/pnpm/-/pnpm-10.34.6.tgz",
  integrity: "sha512-fhrmaoOpFDwRjMGUTzfMTyuKzd7aSwAc+niQj25G5F4VKSc5ymydAmQmzHV+kxjMmMVVHWoWwWUJewAouoe05g==",
})
const archiveLimit = 20 * 1024 * 1024

export function verifyManagedArchive(buffer: Uint8Array, integrity: string) {
  if (buffer.byteLength > archiveLimit || !/^sha512-[A-Za-z0-9+/]{86}==$/.test(integrity)
    || `sha512-${createHash("sha512").update(buffer).digest("base64")}` !== integrity) throw new Error("Managed package integrity check failed")
}

/** Extract only into a new directory owned by the caller. Links, special files,
 * traversal, Windows alternate streams and oversized contents are rejected. */
export async function unpackManagedArchive(buffer: Uint8Array, directory: string, signal?: AbortSignal) {
  let bytes = 0
  let count = 0
  let rejected = false
  const seen = new Set<string>()
  const extractor = x({
    cwd: directory, strip: 1, strict: true, preservePaths: false, noChmod: true,
    filter(name, entry) {
      const normalized = name.replace(/\/$/, "")
      const parts = normalized.split("/")
      const key = normalized.toLowerCase()
      bytes += entry.size ?? 0
      const valid = ++count <= 10000 && bytes <= 128 * 1024 * 1024
        && parts[0] === "package" && parts.length <= 64
        && parts.every(part => part && part !== "." && part !== ".." && !/[\\:\x00-\x1f]/.test(part) && !/[. ]$/.test(part)
          && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))
        && "type" in entry && ["File", "Directory"].includes(entry.type) && !seen.has(key)
      seen.add(key)
      if (!valid) rejected = true
      return valid
    },
  })
  await pipeline(Readable.from([buffer]), extractor, { signal })
  if (rejected) throw new Error("Managed package contains unsupported entries or exceeds extraction limits")
}

async function boundedDownload(fetchImpl: typeof fetch, signal?: AbortSignal) {
  const deadline = AbortSignal.timeout(120000)
  signal = signal ? AbortSignal.any([signal, deadline]) : deadline
  const response = await fetchImpl(MANAGED_PNPM.url, { signal, redirect: "error" })
  if (!response.ok || !response.body) throw new Error(`Managed package download failed (${response.status})`)
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      signal?.throwIfAborted()
      const item = await reader.read()
      if (item.done) break
      size += item.value.byteLength
      if (size > archiveLimit) throw new Error("Managed package download exceeds 20 MiB")
      chunks.push(item.value)
    }
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
  const buffer = Buffer.concat(chunks)
  verifyManagedArchive(buffer, MANAGED_PNPM.integrity)
  return buffer
}

/** Downloads only the pinned pnpm archive; no system install, PATH mutation or
 * project scripts. The host injects its network transport and owns the lease. */
export async function acquireManagedPnpm(input: { cacheDirectory: string; fetchImpl: typeof fetch; signal?: AbortSignal }) {
  if (!path.isAbsolute(input.cacheDirectory)) throw new Error("An absolute, application-owned cache directory is required")
  input.signal?.throwIfAborted()
  await mkdir(input.cacheDirectory, { recursive: true, mode: 0o700 })
  if ((await lstat(input.cacheDirectory)).isSymbolicLink()) throw new Error("Managed cache must not be a link")
  const archive = path.join(input.cacheDirectory, `pnpm-${MANAGED_PNPM.version}.tgz`)
  let buffer: Buffer | undefined
  try {
    const stat = await lstat(archive)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > archiveLimit) throw new Error("Invalid managed cache")
    buffer = await readFile(archive)
    verifyManagedArchive(buffer, MANAGED_PNPM.integrity)
  } catch { buffer = undefined }
  const cached = Boolean(buffer)
  buffer ??= await boundedDownload(input.fetchImpl, input.signal)
  input.signal?.throwIfAborted()
  const directory = await mkdtemp(path.join(input.cacheDirectory, "pnpm-lease-"))
  const release = async () => {
    if (path.dirname(directory) !== path.resolve(input.cacheDirectory) || !path.basename(directory).startsWith("pnpm-lease-")) throw new Error("Invalid managed package lease")
    await rm(directory, { recursive: true, force: true })
  }
  try {
    await unpackManagedArchive(buffer, directory, input.signal)
    const entrypoint = path.join(directory, "bin", "pnpm.cjs")
    if (!(await lstat(entrypoint)).isFile()) throw new Error("Managed pnpm entrypoint is missing")
    const binDirectory = path.join(directory, "managed-bin")
    await mkdir(binDirectory)
    if (process.platform === "win32") {
      const executable = process.execPath.replaceAll("%", "%%")
      const entry = entrypoint.replaceAll("%", "%%")
      await writeFile(path.join(binDirectory, "pnpm.cmd"), `@echo off\r\n${process.versions.electron ? '@set "ELECTRON_RUN_AS_NODE=1"\r\n' : ""}@"${executable}" "${entry}" --config.manage-package-manager-versions=false %*\r\n`)
    } else {
      const quote = (text: string) => "'" + text.replaceAll("'", "'\\''") + "'"
      const executable = path.join(binDirectory, "pnpm")
      await writeFile(executable, `#!/bin/sh\n${process.versions.electron ? "export ELECTRON_RUN_AS_NODE=1\n" : ""}exec ${quote(process.execPath)} ${quote(entrypoint)} --config.manage-package-manager-versions=false "$@"\n`)
      await chmod(executable, 0o700)
    }
    if (!cached) {
      const staged = path.join(directory, "archive.tgz")
      await writeFile(staged, buffer, { flag: "wx", mode: 0o600 })
      // Concurrent owners can keep an already published, digest-checked cache.
      await rename(staged, archive).catch(() => {})
    }
    input.signal?.throwIfAborted()
    return { version: MANAGED_PNPM.version, entrypoint, binDirectory, cached, release }
  } catch (error) {
    await release().catch(() => {})
    throw error
  }
}
