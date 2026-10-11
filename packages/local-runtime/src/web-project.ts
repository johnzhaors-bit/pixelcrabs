import { existsSync, realpathSync, statSync } from "node:fs"
import path from "node:path"
import { staticWebPreviewLaunchProfile } from "./static-web-preview.ts"
import {
  WEB_PROJECT_ADAPTERS, readPackageProject, resolvePackageManager,
  packageManagerExecutable, packageScriptArgs, missingProjectDependencies,
  type PreviewPackageManager, type WebProjectAdapterId,
} from "./web-project-support.ts"

export type WebAdapterId = WebProjectAdapterId | "web-static" | "generic-web"
export type WebLaunchProfile = {
  adapterId: WebAdapterId
  target: "web" | "h5"
  command: string
  args: string[]
  defaultPort: number
  packageManager?: PreviewPackageManager
  scriptName?: string
}
export type WebProjectCandidate = {
  adapterId: WebAdapterId
  status: "requires_check" | "missing"
  missingDependencies: string[]
  launch: WebLaunchProfile
}
export type WebProjectDiscovery = {
  directory: string
  status: "detected" | "invalid" | "unsupported"
  candidates: WebProjectCandidate[]
  message: string
}

/** Read project facts only. The Agent/host selects a candidate and authorizes execution. */
export async function discoverWebProject(directory: string): Promise<WebProjectDiscovery> {
  const empty = (status: "invalid" | "unsupported", message: string): WebProjectDiscovery => ({ directory, status, candidates: [], message })
  try {
    directory = realpathSync(directory)
    if (!statSync(directory).isDirectory()) return empty("invalid", "Choose a project directory.")
  } catch { return empty("invalid", "Project directory is unavailable.") }
  const project = await readPackageProject(directory)
  if (!project && existsSync(path.join(directory, "package.json"))) return empty("invalid", "package.json must contain a valid JSON object.")
  // These are exclusion facts, not platform drivers. Never reinterpret another
  // platform's project as static HTML merely because it contains index.html.
  if (existsSync(path.join(directory, "pubspec.yaml")) ||
    (existsSync(path.join(directory, "app.json")) && existsSync(path.join(directory, "project.config.json"))) ||
    ["@dcloudio/uni-app", "@dcloudio/vite-plugin-uni", "@tarojs/taro", "@tarojs/cli", "react-native"].some(name => project?.dependencies.has(name))) {
    return empty("unsupported", "This project requires a platform adapter outside the public Web edition.")
  }
  const manager = resolvePackageManager(directory, project?.manifest.packageManager)
  const candidate = (id: WebProjectAdapterId | "generic-web", script: string, port: number, required: Iterable<string>): WebProjectCandidate => {
    const missing = missingProjectDependencies(directory, required)
    return {
      adapterId: id, status: missing.length ? "missing" : "requires_check", missingDependencies: missing,
      launch: { adapterId: id, target: "web", command: packageManagerExecutable(manager), args: packageScriptArgs(manager, script), defaultPort: port, packageManager: manager, scriptName: script },
    }
  }
  const recognized = WEB_PROJECT_ADAPTERS.filter(adapter => adapter.dependencies.some(name => project?.dependencies.has(name)))
  if (recognized.length && project) {
    const candidates = recognized.flatMap(adapter => {
      const script = adapter.scripts.find(name => typeof project.scripts[name] === "string" && String(project.scripts[name]).trim())
      return script ? [candidate(adapter.id, script, adapter.defaultPort, adapter.requiredDependencies)] : []
    })
    return { directory, status: candidates.length ? "detected" : "unsupported", candidates, message: candidates.length ? "Framework candidates detected; installation and startup still require verification." : "Recognized framework has no supported development script; preserve its existing stack." }
  }
  try {
    if (statSync(path.join(directory, "index.html")).isFile()) return {
      directory, status: "detected", message: "Static HTML project detected; Node startup still requires verification.",
      candidates: [{ adapterId: "web-static", status: "requires_check", missingDependencies: [], launch: staticWebPreviewLaunchProfile() }],
    }
  } catch {}
  const script = ["dev", "start", "serve", "preview"].find(name => typeof project?.scripts[name] === "string" && String(project.scripts[name]).trim())
  if (script && project) return {
    directory, status: "detected", message: "Existing project script detected; port support must be verified by starting it.",
    candidates: [candidate("generic-web", script, 5173, project.dependencies)],
  }
  return empty("unsupported", "No runnable Web entry detected. Preserve the project and inspect its setup.")
}

export function webPreviewPortArgs(profile: { adapterId: string; packageManager?: PreviewPackageManager }, port: number) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid preview port")
  if (profile.adapterId === "web-static") return ["--", "--host", "127.0.0.1", "--port", String(port)]
  const separator = profile.packageManager === "npm" ? ["--"] : []
  return [...separator, profile.adapterId === "next" ? "--hostname" : "--host", "127.0.0.1", "--port", String(port)]
}
