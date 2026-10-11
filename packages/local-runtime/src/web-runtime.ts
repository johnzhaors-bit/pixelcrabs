import { spawn, type ChildProcess } from "node:child_process"
import path from "node:path"
import { discoverWebProject, webPreviewPortArgs, type WebAdapterId } from "./web-project.ts"
import { acquireNodeToolchain, type NodeToolchainLease } from "./node-toolchain.ts"
import { reservePreviewPort } from "./preview-port.ts"
import { previewSpawnInvocation, previewHttpReady, sanitizePreviewLog, stopPreviewProcess } from "./preview-process.ts"
import { verifyPreviewPortOwnership } from "./preview-port-ownership.ts"
import { registerPreviewGateway, unregisterPreviewGateway } from "./preview-gateway.ts"
import {
  registerPreviewRuntime, updatePreviewRuntime, getPreviewRuntime,
  activatePreviewRuntime, deactivatePreviewRuntime, type PreviewRuntimeRecord,
} from "./preview-runtime-registry.ts"

type Managed = { child: ChildProcess; lease: NodeToolchainLease; record: PreviewRuntimeRecord; log: string; error?: string }
export type WebRuntimeResult = { status: "running" | "failed" | "missing" | "unsupported"; message: string; record?: PreviewRuntimeRecord; logs: string; missingDependencies?: string[]; projectIdentityVerified: boolean }
export type WebRuntimeStart = { conversationId: string; directory: string; adapterId: WebAdapterId; signal?: AbortSignal }

/** Host must authorize the explicit project before calling. This manager owns
 * only its spawned processes; an HTTP 200 alone never establishes ownership. */
export function createWebRuntimeManager(options: { environment?: (directory: string) => NodeJS.ProcessEnv; startupTimeoutMs?: number } = {}) {
  const managed = new Map<string, Managed>()
  const queues = new Map<string, Promise<unknown>>()
  let disposed = false
  const queue = <T>(conversation: string, work: () => Promise<T>): Promise<T> => {
    if (!conversation.trim()) return Promise.reject(new Error("Conversation is required"))
    const pending = (queues.get(conversation) ?? Promise.resolve()).then(work, work)
    queues.set(conversation, pending)
    void pending.finally(() => { if (queues.get(conversation) === pending) queues.delete(conversation) }).catch(() => {})
    return pending
  }
  const owned = (conversation: string, id: string) => {
    const item = managed.get(id)
    if (!item || item.record.conversationId !== conversation) throw new Error("Runtime does not belong to this conversation")
    return item
  }
  const stop = async (item: Managed) => {
    try { await stopPreviewProcess(item.child) } catch (error) {
      updatePreviewRuntime(item.record.runtimeId, { health: "failed", message: "Unable to stop owned preview process; retry cleanup." })
      throw error
    }
    unregisterPreviewGateway(item.record.runtimeId)
    deactivatePreviewRuntime(item.record.runtimeId)
    updatePreviewRuntime(item.record.runtimeId, { health: "stopped", message: "Preview stopped." })
    managed.delete(item.record.runtimeId)
    await item.lease.release()
  }
  const verify = async (item: Managed) => {
    const record = getPreviewRuntime(item.record.runtimeId)!
    if (item.error || item.child.exitCode !== null || item.child.signalCode !== null || !record.upstreamUrl || !(await previewHttpReady(record.upstreamUrl))) return false
    const ownership = await verifyPreviewPortOwnership({ port: record.port!, rootPid: item.child.pid, processGroupId: record.processGroupId })
    return ownership.status === "verified"
  }
  const result = (item: Managed, verified: boolean, message: string): WebRuntimeResult => ({
    status: verified ? "running" : "failed", message, record: getPreviewRuntime(item.record.runtimeId),
    logs: sanitizePreviewLog(item.log), projectIdentityVerified: verified,
  })
  const start = async (input: WebRuntimeStart): Promise<WebRuntimeResult> => {
    if (disposed) throw new Error("Preview manager is disposed")
    if (!path.isAbsolute(input.directory)) throw new Error("An absolute project directory is required")
    input.signal?.throwIfAborted()
    const discovery = await discoverWebProject(input.directory)
    const candidate = discovery.candidates.find(candidate => candidate.adapterId === input.adapterId)
    if (!candidate) return { status: "unsupported", message: discovery.message, logs: "", projectIdentityVerified: false }
    if (candidate.missingDependencies.length) return { status: "missing", message: "Prepare project dependencies before startup.", missingDependencies: candidate.missingDependencies, logs: "", projectIdentityVerified: false }
    const existing = [...managed.values()].find(item => item.record.conversationId === input.conversationId && item.record.directory === discovery.directory && item.record.adapterId === input.adapterId)
    if (existing && await verify(existing)) return result(existing, true, "Existing preview remains running.")
    if (existing) await stop(existing)
    const profile = candidate.launch
    const reservation = await reservePreviewPort(profile.defaultPort)
    let item: Managed | undefined
    let lease: NodeToolchainLease | undefined
    try {
      lease = await acquireNodeToolchain()
      await lease.ensureNode()
      const invocation = previewSpawnInvocation(profile.command, [...profile.args, ...webPreviewPortArgs(profile, reservation.port)])
      const child = spawn(invocation.command, invocation.args, {
        cwd: discovery.directory, env: { ...lease.environment(options.environment?.(discovery.directory) ?? process.env), BROWSER: "none", BOT: "false", ...(process.versions.electron && profile.command === process.execPath ? { ELECTRON_RUN_AS_NODE: "1" } : {}) },
        windowsHide: true, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"],
      })
      const upstreamUrl = `http://127.0.0.1:${reservation.port}/`
      const record = registerPreviewRuntime({ conversationId: input.conversationId, directory: discovery.directory, adapterId: profile.adapterId, target: profile.target, pid: child.pid, processGroupId: process.platform === "win32" ? undefined : child.pid, port: reservation.port, upstreamUrl, health: "starting", message: "Preview is starting." })
      item = { child, lease, record, log: "" }
      const current = item
      managed.set(record.runtimeId, current)
      for (const stream of [child.stdout, child.stderr]) {
        stream.setEncoding("utf8")
        stream.on("data", (chunk: string) => { current.log = (current.log + chunk).slice(-64000) })
      }
      child.once("error", error => { current.error = sanitizePreviewLog(error.message); current.log += current.error })
      child.once("exit", () => {
        if (managed.has(record.runtimeId)) {
          updatePreviewRuntime(record.runtimeId, { health: "failed", message: "Preview process exited." })
          deactivatePreviewRuntime(record.runtimeId)
        }
      })
      const url = await registerPreviewGateway(record.runtimeId, upstreamUrl)
      updatePreviewRuntime(record.runtimeId, { url })
      const deadline = Date.now() + (options.startupTimeoutMs ?? 30000)
      while (Date.now() < deadline && !current.error && child.exitCode === null && child.signalCode === null) {
        input.signal?.throwIfAborted()
        if (await previewHttpReady(upstreamUrl)) {
          const identity = await verifyPreviewPortOwnership({ port: reservation.port, rootPid: child.pid, processGroupId: record.processGroupId })
          if (identity.status === "verified") {
            input.signal?.throwIfAborted()
            for (const previous of [...managed.values()]) if (previous !== current && previous.record.conversationId === input.conversationId) await stop(previous)
            updatePreviewRuntime(record.runtimeId, { health: "running", message: "Process and port verified; presentation must be checked separately." })
            activatePreviewRuntime(input.conversationId, record.runtimeId)
            return result(current, true, "Web runtime is ready. Desktop presentation has not yet been verified.")
          }
          if (identity.status !== "missing") throw new Error(identity.message)
        }
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      throw new Error(current.error ?? "Preview did not become ready before the startup deadline")
    } catch (error) {
      const message = sanitizePreviewLog(error instanceof Error ? error.message : String(error))
      if (item) {
        const logs = sanitizePreviewLog(item.log)
        await stop(item)
        const record = updatePreviewRuntime(item.record.runtimeId, { health: "failed", message })
        return { status: "failed", record, message, logs, projectIdentityVerified: false }
      }
      await lease?.release()
      return { status: "failed", message, logs: "", projectIdentityVerified: false }
    } finally { reservation.release() }
  }
  return {
    discover: discoverWebProject,
    start: (input: WebRuntimeStart) => queue(input.conversationId, () => start(input)),
    stop: (conversation: string, id: string) => queue(conversation, () => stop(owned(conversation, id))),
    async verify(conversation: string, id: string) {
      return queue(conversation, async () => {
        const item = owned(conversation, id)
        const valid = await verify(item)
        if (!valid) {
          updatePreviewRuntime(id, { health: "failed", message: "Runtime verification failed." })
          deactivatePreviewRuntime(id)
        }
        return result(item, valid, valid ? "Runtime verified; presentation is separate." : "Runtime verification failed.")
      })
    },
    list(conversation: string) { return [...managed.values()].filter(item => item.record.conversationId === conversation).map(item => getPreviewRuntime(item.record.runtimeId)!) },
    logs(conversation: string, id: string) { return sanitizePreviewLog(owned(conversation, id).log) },
    async dispose() {
      disposed = true
      await Promise.allSettled([...queues.values()])
      for (const item of [...managed.values()]) await stop(item)
    },
  }
}
