import { realpath } from "node:fs/promises"
import path from "node:path"
import { tool } from "@opencode-ai/plugin/tool"
import { createWebRuntimeManager } from "./web-runtime.ts"
import { sanitizePreviewLog } from "./preview-process.ts"

/** OpenCode owns the session, permissions and coding loop. This plugin only
 * inspects projects and manages explicitly selected local Web processes. */
export const WebPreviewPlugin = async () => {
  const manager = createWebRuntimeManager()
  return {
    dispose: () => manager.dispose(),
    async event({ event }: { event: { type: string; properties: unknown } }) {
      if (event.type !== "session.deleted") return
      const properties = event.properties as { info?: { id?: unknown } } | undefined
      const id = properties?.info?.id
      if (typeof id !== "string") return
      for (const record of manager.list(id)) await manager.stop(id, record.runtimeId)
    },
    async "experimental.chat.system.transform"(_input: unknown, output: { system: string[] }) {
      output.system.push("Use pixelcrabs_preview to discover and run trusted local Web projects. Preserve the project's actual framework. Choose an adapter returned by discover; do not infer readiness from detection alone. The runtime has a managed Node capability. Missing project dependencies are separate from missing Node: use the project's package manager through OpenCode's normal permission flow when preparation is needed. Runtime verification checks HTTP and process ownership only; never claim that a desktop panel or screenshot was verified unless presentation evidence was actually returned. Continue to use OpenCode's normal file editing tools and original conversation for all code changes.")
    },
    tool: {
      pixelcrabs_preview: tool({
        description: "Discover, start, verify, list, read logs or stop local Web previews in the current conversation. Does not change project code, install dependencies, publish or call a model.",
        args: {
          action: tool.schema.enum(["discover", "start", "verify", "list", "logs", "stop"]),
          directory: tool.schema.string().optional().describe("Project directory, defaulting to the current OpenCode project. Paths outside it require native permission."),
          adapterId: tool.schema.enum(["web-static", "vite", "next", "nuxt", "astro", "generic-web"]).optional(),
          runtimeId: tool.schema.string().optional(),
        },
        async execute(args, context) {
          context.abort.throwIfAborted()
          const reply = (facts: unknown) => ({ title: `Web preview: ${args.action}`, output: JSON.stringify(facts), metadata: { pixelcrabsPreview: facts } })
          let permissionFailure = false
          const ask: typeof context.ask = async input => {
            try { await context.ask(input) } catch (error) { permissionFailure = true; throw error }
          }
          try {
            if (["list", "logs", "verify", "stop"].includes(args.action)) {
              if (args.action === "list") return reply({ status: "ready", runtimes: manager.list(context.sessionID), presentationVerified: false })
              if (!args.runtimeId) throw new Error("runtimeId is required for this action")
              // The manager verifies ownership before any runtime operation.
              if (args.action === "logs") return reply({ status: "ready", logs: manager.logs(context.sessionID, args.runtimeId) })
              if (args.action === "verify") return reply(await manager.verify(context.sessionID, args.runtimeId))
              await manager.stop(context.sessionID, args.runtimeId)
              return reply({ status: "stopped", runtimeId: args.runtimeId })
            }
            const base = await realpath(context.directory)
            const directory = await realpath(path.resolve(base, args.directory ?? "."))
            const relative = path.relative(base, directory)
            if (path.isAbsolute(relative) || relative === ".." || relative.startsWith(".." + path.sep)) {
              await ask({ permission: "external_directory", patterns: [directory], always: [directory], metadata: { action: args.action, directory } })
            }
            context.abort.throwIfAborted()
            if (args.action === "discover") return reply(await manager.discover(directory))
            if (!args.adapterId) throw new Error("Discover the project and explicitly select an adapterId before startup")
            await ask({ permission: "pixelcrabs_preview", patterns: [directory], always: [directory], metadata: { action: "start", directory, adapterId: args.adapterId } })
            context.abort.throwIfAborted()
            return reply(await manager.start({ conversationId: context.sessionID, directory, adapterId: args.adapterId, signal: context.abort }))
          } catch (error) {
            // Preserve cancellation and permission rejection in the native flow.
            if (context.abort.aborted || permissionFailure) throw error
            return reply({ status: "failed", message: sanitizePreviewLog(error instanceof Error ? error.message : String(error)), presentationVerified: false })
          }
        },
      }),
    },
  }
}

export default WebPreviewPlugin
