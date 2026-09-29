import { test, expect } from "bun:test"
import { createHash } from "node:crypto"
import { mkdtemp, mkdir, writeFile, readdir, rm, symlink } from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { c } from "tar"
import { acquireManagedPnpm, unpackManagedArchive, verifyManagedArchive } from "../src/managed-web-package.ts"

test("integrity rejects corrupted data and download failure leaves no installation", async () => {
  const data = Buffer.from("fixture")
  const integrity = `sha512-${createHash("sha512").update(data).digest("base64")}`
  expect(() => verifyManagedArchive(data, integrity)).not.toThrow()
  expect(() => verifyManagedArchive(Buffer.from("corrupt"), integrity)).toThrow("integrity")
  const root = await mkdtemp(path.join(os.tmpdir(), "pixelcrabs-package-test-"))
  try {
    await expect(acquireManagedPnpm({ cacheDirectory: root, fetchImpl: (async () => new Response("broken")) as typeof fetch })).rejects.toThrow("integrity")
    expect(await readdir(root)).toEqual([])
    await expect(acquireManagedPnpm({ cacheDirectory: root, fetchImpl: fetch, signal: AbortSignal.abort() })).rejects.toThrow()
    expect(await readdir(root)).toEqual([])
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("mature extractor handles ordinary files and rejects unsupported archive roots", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pixelcrabs-package-test-"))
  try {
    await mkdir(path.join(root, "package"))
    await writeFile(path.join(root, "package", "file.txt"), "fixture")
    const chunks: Buffer[] = []
    for await (const chunk of c({ cwd: root, gzip: true }, ["package"])) chunks.push(Buffer.from(chunk))
    const target = path.join(root, "extract")
    await mkdir(target)
    await unpackManagedArchive(Buffer.concat(chunks), target)
    expect(await readdir(target)).toEqual(["file.txt"])
    await writeFile(path.join(root, "outside.txt"), "fixture")
    const invalid: Buffer[] = []
    for await (const chunk of c({ cwd: root, gzip: true }, ["outside.txt"])) invalid.push(Buffer.from(chunk))
    await expect(unpackManagedArchive(Buffer.concat(invalid), target)).rejects.toThrow("unsupported")
    const external = path.join(root, "external")
    await mkdir(external)
    await writeFile(path.join(external, "untouched.txt"), "fixture")
    await symlink(external, path.join(root, "package", "link"), process.platform === "win32" ? "junction" : "dir")
    const linked: Buffer[] = []
    for await (const chunk of c({ cwd: root, gzip: true }, ["package"])) linked.push(Buffer.from(chunk))
    await expect(unpackManagedArchive(Buffer.concat(linked), target)).rejects.toThrow("unsupported")
    expect(await readdir(external)).toEqual(["untouched.txt"])
  } finally { await rm(root, { recursive: true, force: true }) }
})
