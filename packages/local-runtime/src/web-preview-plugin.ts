import { realpath } from "node:fs/promises"
import path from "node:path"
import { tool } from "@opencode-ai/plugin/tool"
import { createWebRuntimeManager } from "./web-runtime.ts"
import { sanitizePreviewLog } from "./preview-process.ts"
import { exportStaticWeb } from "./web-export.ts"
import { createWebEnvironment, type WebEnvironmentOptions } from "./web-environment.ts"

/** OpenCode owns the session, permissions and coding loop. This plugin only
 * inspects projects and manages explicitly selected local Web processes. */
export const WebPreviewPlugin = async (_input?: unknown, options?: WebEnvironmentOptions) => {
  const environment = createWebEnvironment(options)
  const manager = createWebRuntimeManager({ environment: directory => environment.environment(directory) })
  return {
    async dispose() { await manager.dispose(); await environment.dispose() },
    async "shell.env"(input: { cwd: string }, output: { env: Record<string, string> }) {
      const directory = await realpath(input.cwd)
      const env = environment.environment(directory, output.env)
      if (env.PATH) output.env.PATH = env.PATH
      if (env.Path) output.env.Path = env.Path
    },
    async event({ event }: { event: { type: string; properties: unknown } }) {
      if (event.type !== "session.deleted") return
      const properties = event.properties as { info?: { id?: unknown } } | undefined
      const id = properties?.info?.id
      if (typeof id !== "string") return
      for (const record of manager.list(id)) await manager.stop(id, record.runtimeId)
    },
    async "experimental.chat.system.transform"(_input: unknown, output: { system: string[] }) {
      output.system.push("Use pixelcrabs_preview to discover and run trusted local Web projects. Preserve the project's actual framework. Choose an adapter returned by discover; do not infer readiness from detection alone. Node is managed. When dependencies are missing, call pixelcrabs_prepare_web under native permissions, then rediscover and start the preview. Preparation preserves the project's package manager and lockfile, skips lifecycle scripts, and reports unsupported toolchains; it never proves preview readiness. Use native terminal tools for explicitly needed rebuild/build scripts. Runtime verification checks HTTP and process ownership only; never claim that a desktop panel or screenshot was verified unless presentation evidence was actually returned. Continue to use OpenCode's normal file editing tools and original conversation for all code changes.")
    },
    tool: {
      pixelcrabs_prepare_web: tool({
        description: "Prepare dependencies of a trusted Web project under native permissions. Reuses managed Node, preserves the project's manager and lockfile; can supply pinned pnpm when none is installed. Skips lifecycle scripts; does not build, edit source or verify preview. Desktop downloads the managed tool using its network transport; package-manager dependency requests retain the manager's proxy/registry configuration.",
        args: { directory: tool.schema.string().optional() },
        async execute(args, context) {
          context.abort.throwIfAborted()
          const base = await realpath(context.directory)
          const directory = await realpath(path.resolve(base, args.directory ?? "."))
          const relative = path.relative(base, directory)
          if (path.isAbsolute(relative) || relative === ".." || relative.startsWith(".." + path.sep)) {
            await context.ask({ permission: "external_directory", patterns: [directory], always: [directory], metadata: { action: "prepare", directory } })
          }
          await context.ask({ permission: "pixelcrabs_prepare_web", patterns: [directory], always: [directory], metadata: { directory, lifecycleScripts: "disabled" } })
          context.abort.throwIfAborted()
          try {
            const facts = await environment.prepare(directory, context.abort)
            return { title: "Web environment", output: JSON.stringify(facts), metadata: { pixelcrabsEnvironment: facts } }
          } catch (error) {
            if (context.abort.aborted) throw error
            return { title: "Web environment failed", output: JSON.stringify({ status: "failed", message: sanitizePreviewLog(error instanceof Error ? error.message : String(error)) }), metadata: {} }
          }
        },
      }),
      pixelcrabs_web_export: tool({
        description: "Export a trusted static Web artifact directory containing index.html into a new unique local folder. Run the project's real build through native tools first when needed. Does not build, upload or deploy. Excludes hidden files, dependencies, package manifests, source maps and non-Web file types; not a secret scanner. Server-only output requires a different deployment target.",
        args: {
          sourceDirectory: tool.schema.string().describe("Explicit static artifact directory, relative to the current project or absolute."),
          destinationParent: tool.schema.string().describe("Existing parent directory outside the artifact tree. A new unique subdirectory will be created."),
        },
        async execute(args, context) {
          context.abort.throwIfAborted()
          const base = await realpath(context.directory)
          const source = await realpath(path.resolve(base, args.sourceDirectory))
          const parent = await realpath(path.resolve(base, args.destinationParent))
          for (const directory of new Set([source, parent])) {
            const relative = path.relative(base, directory)
            if (path.isAbsolute(relative) || relative === ".." || relative.startsWith(".." + path.sep)) {
              await context.ask({ permission: "external_directory", patterns: [directory], always: [directory], metadata: { action: "export", directory } })
            }
          }
          await context.ask({ permission: "pixelcrabs_web_export", patterns: [source], always: [source], metadata: { source, destinationParent: parent } })
          context.abort.throwIfAborted()
          try {
            const facts = await exportStaticWeb({ sourceDirectory: source, destinationParent: parent, signal: context.abort })
            return { title: "Web export", output: JSON.stringify(facts), metadata: { pixelcrabsWebExport: facts } }
          } catch (error) {
            if (context.abort.aborted) throw error
            return { title: "Web export failed", output: JSON.stringify({ status: "failed", message: sanitizePreviewLog(error instanceof Error ? error.message : String(error)), published: false }), metadata: {} }
          }
        },
      }),
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
