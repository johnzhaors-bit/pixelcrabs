import { createHash, randomUUID } from "node:crypto"
import { realpathSync } from "node:fs"
import path from "node:path"

export type PreviewRuntimeHealth = "starting" | "running" | "failed" | "stopped"

export type PreviewRuntimeRecord = {
  runtimeId: string
  projectId: string
  directory: string
  conversationId: string
  adapterId: string
  target: string
  pid?: number
  processGroupId?: number
  port?: number
  url?: string
  upstreamUrl?: string
  health: PreviewRuntimeHealth
  createdAt: number
  updatedAt: number
  message: string
}

const records = new Map<string, PreviewRuntimeRecord>()
const activeByConversation = new Map<string, string>()

export function previewProjectId(directory: string) {
  const resolved = path.resolve(directory)
  const canonical = (() => {
    try {
      return realpathSync.native(resolved)
    } catch {
      return resolved
    }
  })()
  const identity = process.platform === "win32" ? canonical.toLowerCase() : canonical
  return `project_${createHash("sha256").update(identity).digest("hex").slice(0, 16)}`
}

export function registerPreviewRuntime(
  input: Omit<PreviewRuntimeRecord, "runtimeId" | "projectId" | "createdAt" | "updatedAt">,
) {
  const now = Date.now()
  const record: PreviewRuntimeRecord = {
    ...input,
    runtimeId: `runtime_${randomUUID()}`,
    projectId: previewProjectId(input.directory),
    createdAt: now,
    updatedAt: now,
  }
  records.set(record.runtimeId, record)
  return { ...record }
}

export function updatePreviewRuntime(runtimeId: string, patch: Partial<Omit<PreviewRuntimeRecord, "runtimeId">>) {
  const current = records.get(runtimeId)
  if (!current) return
  const next = { ...current, ...patch, runtimeId, updatedAt: Date.now() }
  records.set(runtimeId, next)
  return { ...next }
}

export function getPreviewRuntime(runtimeId: string) {
  const record = records.get(runtimeId)
  return record ? { ...record } : undefined
}

export function listPreviewRuntimes(conversationId?: string) {
  return [...records.values()]
    .filter((record) => !conversationId || record.conversationId === conversationId)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((record) => ({ ...record }))
}

export function activatePreviewRuntime(conversationId: string, runtimeId: string) {
  const record = records.get(runtimeId)
  if (!record || record.conversationId !== conversationId) return
  if (record.health !== "running" || !record.url) return
  activeByConversation.set(conversationId, runtimeId)
  return { ...record }
}

export function activePreviewRuntime(conversationId: string) {
  const runtimeId = activeByConversation.get(conversationId)
  if (!runtimeId) return
  const record = records.get(runtimeId)
  if (!record || record.health !== "running") {
    activeByConversation.delete(conversationId)
    return
  }
  return { ...record }
}

export function deactivatePreviewRuntime(runtimeId: string) {
  for (const [conversationId, activeRuntimeId] of activeByConversation) {
    if (activeRuntimeId === runtimeId) activeByConversation.delete(conversationId)
  }
}

export function clearPreviewRuntimeRegistry() {
  records.clear()
  activeByConversation.clear()
}
