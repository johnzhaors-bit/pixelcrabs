import { existsSync, statSync } from "node:fs"
import { readFile } from "node:fs/promises"
import path from "node:path"

export type PreviewPackageManager = "npm" | "pnpm" | "yarn" | "bun"
export type WebProjectAdapterId = "next" | "nuxt" | "astro" | "vite"
export type WebProjectAdapter = {
  id: WebProjectAdapterId
  label: string
  target: "web"
  dependencies: string[]
  requiredDependencies: string[]
  scripts: string[]
  defaultPort: number
  defaultViewport: "auto"
}

export type PackageManifest = {
  packageManager?: unknown
  scripts?: unknown
  dependencies?: unknown
  devDependencies?: unknown
}

export type PackageProject = {
  manifest: PackageManifest
  scripts: Record<string, unknown>
  dependencies: Set<string>
  hasScripts: boolean
}

export const WEB_PROJECT_ADAPTERS: WebProjectAdapter[] = [
  {
    id: "next",
    label: "Next.js 内部预览",
    target: "web",
    dependencies: ["next"],
    requiredDependencies: ["next"],
    scripts: ["dev"],
    defaultPort: 3000,
    defaultViewport: "auto",
  },
  {
    id: "nuxt",
    label: "Nuxt 内部预览",
    target: "web",
    dependencies: ["nuxt"],
    requiredDependencies: ["nuxt"],
    scripts: ["dev"],
    defaultPort: 3000,
    defaultViewport: "auto",
  },
  {
    id: "astro",
    label: "Astro 内部预览",
    target: "web",
    dependencies: ["astro"],
    requiredDependencies: ["astro"],
    scripts: ["dev"],
    defaultPort: 4321,
    defaultViewport: "auto",
  },
  {
    id: "vite",
    label: "Vite 内部预览",
    target: "web",
    dependencies: ["vite"],
    requiredDependencies: ["vite"],
    scripts: ["dev"],
    defaultPort: 5173,
    defaultViewport: "auto",
  },
]

function record(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return
  return value as Record<string, unknown>
}

function manager(value: unknown): PreviewPackageManager | undefined {
  if (typeof value !== "string") return
  const name = value.split("@")[0]
  if (name === "npm" || name === "pnpm" || name === "yarn" || name === "bun") return name
}

export function resolvePackageManager(directory: string, declaredValue?: unknown): PreviewPackageManager {
  const declared = manager(declaredValue)
  if (declared) return declared
  if (existsSync(path.join(directory, "package-lock.json"))) return "npm"
  if (existsSync(path.join(directory, "pnpm-lock.yaml"))) return "pnpm"
  if (existsSync(path.join(directory, "yarn.lock"))) return "yarn"
  if (existsSync(path.join(directory, "bun.lock")) || existsSync(path.join(directory, "bun.lockb"))) return "bun"
  return "pnpm"
}

export function packageManagerExecutable(value: PreviewPackageManager) {
  if (value === "bun" && path.basename(process.execPath).toLowerCase().startsWith("bun")) return process.execPath
  if (process.platform !== "win32") return value
  return `${value}.cmd`
}

export function packageScriptArgs(value: PreviewPackageManager, scriptName: string) {
  if (value === "pnpm")
    return [
      "--config.manage-package-manager-versions=false",
      "--config.verify-deps-before-run=false",
      "run",
      scriptName,
    ]
  return ["run", scriptName]
}

export async function readPackageProject(directory: string) {
  let manifest: PackageManifest
  try {
    const parsed: unknown = JSON.parse(await readFile(path.join(directory, "package.json"), "utf8"))
    const object = record(parsed)
    if (!object) return
    manifest = object as PackageManifest
  } catch {
    return
  }
  const scripts = record(manifest.scripts) ?? {}
  return {
    manifest,
    scripts,
    hasScripts: Object.keys(scripts).length > 0,
    dependencies: new Set([
      ...Object.keys(record(manifest.dependencies) ?? {}),
      ...Object.keys(record(manifest.devDependencies) ?? {}),
    ]),
  } satisfies PackageProject
}

export function missingProjectDependencies(directory: string, names: Iterable<string>) {
  const root = path.parse(path.resolve(directory)).root
  return [...names].filter((name) => {
    if (!/^(?:@[a-zA-Z0-9_.-]+\/)?[a-zA-Z0-9_.-]+$/.test(name) || name === "." || name === "..") return true
    let current = path.resolve(directory)
    while (true) {
      const localDependency = path.join(current, "node_modules", ...name.split("/"))
      try {
        if (statSync(localDependency).isDirectory()) return false
      } catch {}
      if (current === root) break
      const parent = path.dirname(current)
      if (parent === current) break
      current = parent
    }
    return true
  })
}

export function dependencySearchRoots(directory: string) {
  const roots: string[] = []
  const root = path.parse(path.resolve(directory)).root
  let current = path.resolve(directory)
  while (true) {
    const modules = path.join(current, "node_modules")
    if (existsSync(modules)) {
      try {
        if (statSync(modules).isDirectory()) roots.push(modules)
      } catch {}
    }
    if (current === root) break
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
  return roots
}
