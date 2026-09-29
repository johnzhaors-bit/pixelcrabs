import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { realpath } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { acquireManagedPnpm, MANAGED_PNPM } from "./managed-web-package.ts"
import { acquireNodeToolchain, type NodeToolchainLease } from "./node-toolchain.ts"
import { packageManagerExecutable, readPackageProject, resolvePackageManager, missingProjectDependencies } from "./web-project-support.ts"
import { previewSpawnInvocation, sanitizePreviewLog, stopPreviewProcess } from "./preview-process.ts"

export type WebEnvironmentOptions = { fetchImpl?: typeof fetch; cacheDirectory?: string; environment?: NodeJS.ProcessEnv }

/** Finite dependency preparation only. The Agent owns the decision to prepare,
 * retry or run build scripts. No framework conversion or source editing. */
export function createWebEnvironment(options: WebEnvironmentOptions = {}) {
  let node: NodeToolchainLease | undefined
  let pnpm: Awaited<ReturnType<typeof acquireManagedPnpm>> | undefined
  const prepared = new Map<string, string | undefined>()
  const lifetime = new AbortController()
  let queue: Promise<unknown> = Promise.resolve()
  const base = options.environment ?? process.env
  const environment = (directory: string, overrides: NodeJS.ProcessEnv = {}) => {
    const merged = { ...base, ...overrides }
    if (!prepared.has(directory)) return merged
    const env = node?.environment(merged) ?? merged
    const bin = prepared.get(directory)
    if (bin) env.PATH = env.Path = bin + path.delimiter + (env.PATH ?? env.Path ?? "")
    return env
  }
  async function command(command: string, args: string[], directory: string, signal: AbortSignal, timeout: number) {
    signal.throwIfAborted()
    const invocation = previewSpawnInvocation(command, args)
    const child = spawn(invocation.command, invocation.args, {
      cwd: directory, env: { ...environment(directory), NODE_ENV: "development" }, windowsHide: true, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"],
    })
    let output = ""
    const append = (chunk: Buffer) => { output = (output + chunk.toString()).slice(-32768) }
    child.stdout.on("data", append)
    child.stderr.on("data", append)
    let shutdown: Promise<void> | undefined
    let rejectStop!: (error: unknown) => void
    const failedStop = new Promise<never>((_resolve, reject) => { rejectStop = reject })
    let timedOut = false
    const stop = () => { shutdown ??= stopPreviewProcess(child); void shutdown.catch(rejectStop) }
    const timer = setTimeout(() => { timedOut = true; stop() }, timeout)
    const aborted = () => stop()
    signal.addEventListener("abort", aborted, { once: true })
    try {
      if (signal.aborted) stop()
      const code = await Promise.race([failedStop, new Promise<number | null>((resolve, reject) => {
        child.once("error", reject)
        child.once("close", resolve)
      })])
      await shutdown
      signal.throwIfAborted()
      if (timedOut) throw new Error("Dependency preparation timed out")
      return { code, logs: sanitizePreviewLog(output) }
    } finally {
      clearTimeout(timer)
      signal.removeEventListener("abort", aborted)
      if (child.exitCode === null && child.signalCode === null) await stopPreviewProcess(child)
    }
  }
  async function prepare(directory: string, signal?: AbortSignal) {
    const run = async () => {
      const abort = signal ? AbortSignal.any([signal, lifetime.signal]) : lifetime.signal
      abort.throwIfAborted()
      directory = await realpath(directory)
      const project = await readPackageProject(directory)
      if (!project) return existsSync(path.join(directory, "package.json"))
        ? { status: "failed", message: "The package manifest is invalid; repair it through native editing tools before preparation." }
        : { status: "not_required", message: "No package manifest; static HTML does not need dependency installation." }
      const selected = resolvePackageManager(directory, project.manifest.packageManager)
      if (selected === "yarn") return { status: "needs_setup", manager: selected, message: "Use the project's Yarn version through the native terminal; automatic Yarn preparation is not supported." }
      node ??= await acquireNodeToolchain()
      await node.ensureNode()
      prepared.set(directory, prepared.get(directory))
      const executable = packageManagerExecutable(selected)
      const probeArgs = selected === "pnpm" ? ["--config.manage-package-manager-versions=false", "--version"] : ["--version"]
      const probe = await command(executable, probeArgs, directory, abort, 15000).catch(error => {
        if (abort.aborted) throw error
        return { code: -1, logs: "" }
      })
      let version = probe.code === 0 ? probe.logs.trim().match(/^\d+\.\d+\.\d+$/)?.[0] : undefined
      if (!version && selected === "pnpm") {
        const declared = project.manifest.packageManager
        if (typeof declared === "string" && declared !== `pnpm@${MANAGED_PNPM.version}`) return { status: "needs_setup", manager: selected, message: `Project requires ${declared}; install that version through native tools. Managed pnpm is ${MANAGED_PNPM.version}.` }
        pnpm ??= await acquireManagedPnpm({ cacheDirectory: options.cacheDirectory ?? path.join(os.homedir(), ".cache", "pixelcrabs-open", "tools"), fetchImpl: options.fetchImpl ?? fetch, signal: abort })
        prepared.set(directory, pnpm.binDirectory)
        version = pnpm.version
      }
      if (!version) return { status: "needs_setup", manager: selected, message: `The project's ${selected} executable is unavailable. No alternative package manager was substituted.` }
      const declared = project.manifest.packageManager
      if (typeof declared === "string" && declared !== `${selected}@${version}`) return { status: "needs_setup", manager: selected, message: `Project requires ${declared}, available ${selected} is ${version}. Preserve the project's declared toolchain.` }
      const args = selected === "pnpm"
        ? ["--config.manage-package-manager-versions=false", "--config.confirmModulesPurge=false", "install", "--ignore-scripts", ...(existsSync(path.join(directory, "pnpm-lock.yaml")) ? ["--frozen-lockfile"] : [])]
        : selected === "npm"
          ? [existsSync(path.join(directory, "package-lock.json")) ? "ci" : "install", "--ignore-scripts", "--no-audit", "--no-fund"]
          : ["install", "--ignore-scripts", ...(existsSync(path.join(directory, "bun.lock")) || existsSync(path.join(directory, "bun.lockb")) ? ["--frozen-lockfile"] : [])]
      const result = await command(executable, args, directory, abort, 300000)
      const missingDependencies = missingProjectDependencies(directory, project.dependencies)
      return { status: result.code === 0 ? "dependencies_installed" : "failed", manager: selected, version, exitCode: result.code, logs: result.logs,
        missingDependencies, previewVerified: false, lifecycleScripts: "disabled", message: "Re-run preview discovery and startup to verify readiness. Native build/rebuild tools handle any required lifecycle scripts under their own permissions." }
    }
    const pending = queue.then(run, run)
    queue = pending.catch(() => {})
    return pending
  }
  return {
    prepare, environment,
    async dispose() {
      lifetime.abort()
      await queue
      await pnpm?.release()
      await node?.release()
      prepared.clear()
    },
  }
}
