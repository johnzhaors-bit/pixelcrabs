import { existsSync } from "node:fs"
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

type SharedDesktopNodeRuntime = {
  directory: string
  users: number
}

export type NodeToolchainLease = {
  directory?: string
  environment(base?: NodeJS.ProcessEnv): NodeJS.ProcessEnv
  ensureNode(): Promise<void>
  release(): Promise<void>
}

let sharedDesktopNodeRuntime: Promise<SharedDesktopNodeRuntime> | undefined
const registeredToolDirectories = new Set<string>()

export function registerNodeToolExecutable(executablePath: string) {
  if (!path.isAbsolute(executablePath) || !existsSync(executablePath)) return false
  registeredToolDirectories.add(path.dirname(executablePath))
  return true
}

function augmentedEnvironment(directory: string | undefined, base: NodeJS.ProcessEnv) {
  const additions = [directory, ...registeredToolDirectories].filter((value): value is string => Boolean(value))
  if (!additions.length) return { ...base }
  const value = `${additions.join(path.delimiter)}${path.delimiter}${base.PATH ?? base.Path ?? ""}`
  return { ...base, PATH: value, Path: value }
}

async function writeProcessNodeWrapper(directory: string) {
  if (!path.isAbsolute(process.execPath) || !existsSync(process.execPath)) {
    throw new Error("PixelCrab managed runtime executable is unavailable")
  }
  await mkdir(directory, { recursive: true })
  const executable = process.platform === "win32" ? process.execPath.replaceAll("%", "%%") : "'" + process.execPath.replaceAll("'", "'\\''") + "'"
  if (process.platform === "win32") {
    await writeFile(
      path.join(directory, "node.cmd"),
      `@echo off\r\n${process.versions.electron ? '@set "ELECTRON_RUN_AS_NODE=1"\r\n' : ""}@"${executable}" %*\r\n`,
      "utf8",
    )
  } else {
    await writeFile(
      path.join(directory, "node"),
      `#!/bin/sh\n${process.versions.electron ? "export ELECTRON_RUN_AS_NODE=1\n" : ""}exec ${executable} "$@"\n`,
      "utf8",
    )
    await chmod(path.join(directory, "node"), 0o755)
  }
}

async function acquireProcessNodeDirectory() {
  if (!path.isAbsolute(process.execPath) || !existsSync(process.execPath)) return
  sharedDesktopNodeRuntime ??= (async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "pixelcrabs-node-"))
    await writeProcessNodeWrapper(directory)
    return { directory, users: 0 }
  })().catch((error) => {
    sharedDesktopNodeRuntime = undefined
    throw error
  })
  const shared = await sharedDesktopNodeRuntime
  shared.users++
  return shared.directory
}

async function releaseElectronNodeDirectory(directory: string) {
  const promise = sharedDesktopNodeRuntime
  if (!promise) return
  const shared = await promise
  if (shared.directory !== directory || --shared.users > 0) return
  sharedDesktopNodeRuntime = undefined
  await rm(directory, { recursive: true, force: true }).catch(() => undefined)
}

export async function acquireNodeToolchain(): Promise<NodeToolchainLease> {
  const directory = await acquireProcessNodeDirectory()
  let released = false
  return {
    directory,
    environment(base = process.env) {
      return augmentedEnvironment(directory, base)
    },
    async ensureNode() {
      if (released || !directory) throw new Error("PixelCrab managed runtime lease is unavailable")
      // Recreate only our process-local shim. Do not install system Node or
      // change global PATH, and do not invalidate other active preview leases.
      await writeProcessNodeWrapper(directory)
    },
    async release() {
      if (released || !directory) return
      released = true
      await releaseElectronNodeDirectory(directory)
    },
  }
}
