import { test, expect } from "bun:test"
import { mkdtemp, writeFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { ToolContext } from "@opencode-ai/plugin/tool"
import { WebPreviewPlugin } from "../src/web-preview-plugin"

test("native preview tool asks permission, preserves conversation ownership and disposes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pixelcrabs-plugin-"))
  const hooks = await WebPreviewPlugin()
  const calls: string[] = []
  const context: ToolContext = { sessionID: "a", messageID: "m", agent: "build", directory: root, worktree: root, abort: new AbortController().signal, metadata() {}, async ask(input) { calls.push(input.permission) } }
  const execute = async (args: Record<string, unknown>, ctx = context) => {
    const result = await hooks.tool.pixelcrabs_preview.execute(args as Parameters<typeof hooks.tool.pixelcrabs_preview.execute>[0], ctx)
    return JSON.parse(typeof result === "string" ? result : result.output)
  }
  try {
    await writeFile(path.join(root, "index.html"), "<button>Plugin fixture</button>")
    expect((await execute({ action: "discover" })).status).toBe("detected")
    expect(calls).toEqual([])
    expect((await execute({ action: "start" })).status).toBe("failed")
    const result = await execute({ action: "start", adapterId: "web-static" })
    expect(result.status).toBe("running")
    expect(calls).toEqual(["pixelcrabs_preview"])
    expect((await execute({ action: "list" }, { ...context, sessionID: "b" })).runtimes).toEqual([])
    expect((await execute({ action: "stop", runtimeId: result.record.runtimeId }, { ...context, sessionID: "b" })).status).toBe("failed")
    expect((await execute({ action: "verify", runtimeId: result.record.runtimeId })).projectIdentityVerified).toBe(true)
    const denied = { ...context, async ask() { const error = new Error("Permission denied"); error.name = "DeniedError"; throw error } }
    await expect(execute({ action: "start", adapterId: "web-static" }, denied)).rejects.toThrow("Permission denied")
  } finally {
    await hooks.dispose!()
    if (!root.startsWith(path.join(os.tmpdir(), "pixelcrabs-plugin-"))) throw new Error("Invalid fixture")
    await rm(root, { recursive: true, force: true })
  }
}, 30000)

test("external directory permission rejects before discovery and cancellation stays native", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pixelcrabs-plugin-"))
  const hooks = await WebPreviewPlugin()
  const calls: string[] = []
  const context: ToolContext = {
    sessionID: "external", messageID: "m", agent: "build", directory: root, worktree: root,
    abort: new AbortController().signal, metadata() {},
    async ask(input) { calls.push(input.permission); throw new Error("Native rejection") },
  }
  try {
    await expect(hooks.tool.pixelcrabs_preview.execute({ action: "discover", directory: ".." }, context)).rejects.toThrow("Native rejection")
    expect(calls).toEqual(["external_directory"])
    await expect(hooks.tool.pixelcrabs_preview.execute({ action: "discover" }, { ...context, abort: AbortSignal.abort() })).rejects.toThrow()
    expect(calls).toHaveLength(1)
  } finally {
    await hooks.dispose()
    if (!root.startsWith(path.join(os.tmpdir(), "pixelcrabs-plugin-"))) throw new Error("Invalid fixture")
    await rm(root, { recursive: true, force: true })
  }
})
