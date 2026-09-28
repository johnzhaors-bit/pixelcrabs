import { spawn, type ChildProcess } from "node:child_process"
import { request } from "node:http"

export function previewSpawnInvocation(command: string, args: string[], options: { platform?: NodeJS.Platform; commandInterpreter?: string } = {}) {
  const platform = options.platform ?? process.platform
  if (platform === "win32" && /\.(?:cmd|bat)$/i.test(command)) return {
    command: options.commandInterpreter ?? process.env.ComSpec ?? "cmd.exe",
    args: ["/d", "/s", "/c", command, ...args],
  }
  return { command, args }
}

export function sanitizePreviewLog(value: string) {
  return value.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\b(authorization|cookie|password|secret|token|session|api[_-]?key)(\s*[:=]\s*)([^\s,;]+)/gi, "$1$2[redacted]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/AIza[0-9A-Za-z_-]{35}/g, "[redacted]")
}

/** Probes local HTTP directly: never inherit an external proxy or follow redirects. */
export async function previewHttpReady(url: string) {
  const target = new URL(url)
  if (target.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(target.hostname)) return false
  return new Promise<boolean>((resolve) => {
    const req = request(target, { method: "GET", timeout: 1500, agent: false }, res => {
      res.resume()
      resolve(Boolean(res.statusCode && res.statusCode >= 200 && res.statusCode < 400))
    })
    req.once("timeout", () => req.destroy())
    req.once("error", () => resolve(false))
    req.end()
  })
}

/** Only accepts a process object created and retained by the calling host. */
export async function stopPreviewProcess(child: ChildProcess) {
  if (!child.pid) return
  if (process.platform === "win32") {
    if (child.exitCode !== null || child.signalCode !== null) return
    await new Promise<void>((resolve, reject) => {
      const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" })
      const timer = setTimeout(() => { killer.kill(); reject(new Error("Preview process cleanup timed out")) }, 5000)
      killer.once("error", error => { clearTimeout(timer); reject(error) })
      killer.once("exit", code => { clearTimeout(timer); code === 0 || child.exitCode !== null ? resolve() : reject(new Error("Preview process cleanup failed")) })
    })
  } else {
    try { process.kill(-child.pid, "SIGTERM") } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error
      return
    }
    const deadline = Date.now() + 2000
    while (Date.now() < deadline) {
      try { process.kill(-child.pid, 0) } catch { return }
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    try { process.kill(-child.pid, "SIGKILL") } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error
    }
  }
  if (child.exitCode === null && child.signalCode === null) await new Promise<void>(resolve => {
    const timer = setTimeout(resolve, 2000)
    child.once("exit", () => { clearTimeout(timer); resolve() })
  })
}
