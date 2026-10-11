const STATIC_PREVIEW_SERVER = String.raw`
const http = require("node:http")
const fs = require("node:fs")
const path = require("node:path")
const root = fs.realpathSync(process.cwd())
const value = (name, fallback) => {
  const index = process.argv.indexOf(name)
  return index < 0 ? fallback : process.argv[index + 1]
}
const host = value("--host", "127.0.0.1")
const port = Number(value("--port", "4173"))
if (!["127.0.0.1", "localhost", "::1"].includes(host) || !Number.isInteger(port) || port < 0 || port > 65535) {
  console.error("Static preview requires a loopback host and a valid port")
  process.exit(1)
}
const types = { ".css": "text/css", ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".mjs": "text/javascript", ".svg": "image/svg+xml", ".txt": "text/plain", ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".ico": "image/x-icon", ".woff": "font/woff", ".woff2": "font/woff2", ".wasm": "application/wasm" }
const inside = (file) => {
  const relative = path.relative(root, file)
  return !path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(".." + path.sep)
}
const hidden = (file) => path.relative(root, file).split(path.sep).some((part) => part.startsWith("."))
const server = http.createServer(async (request, response) => {
  const reply = (status, text) => response.writeHead(status).end(text)
  response.setHeader("Cache-Control", "no-store")
  response.setHeader("X-Content-Type-Options", "nosniff")
  try {
    const authority = new URL("http://" + request.headers.host)
    if (!["127.0.0.1", "localhost", "[::1]"].includes(authority.hostname) || authority.username || authority.password) return reply(403, "Forbidden")
    if (!["GET", "HEAD"].includes(request.method)) {
      response.setHeader("Allow", "GET, HEAD")
      return reply(405, "Method not allowed")
    }
    let pathname
    try { pathname = decodeURIComponent(new URL(request.url || "/", "http://localhost").pathname) }
    catch { return reply(400, "Bad request") }
    if (/[\\\x00:]/.test(pathname)) return reply(400, "Bad request")
    const candidate = path.resolve(root, "." + pathname)
    if (!inside(candidate) || hidden(candidate)) return reply(403, "Forbidden")
    let file
    try {
      file = await fs.promises.realpath(candidate)
      if (!inside(file) || hidden(file)) return reply(403, "Forbidden")
      if (!(await fs.promises.stat(file)).isFile()) file = path.join(root, "index.html")
    } catch (error) {
      if (!["ENOENT", "ENOTDIR"].includes(error.code)) throw error
      if (path.extname(pathname)) return reply(404, "Not found")
      file = path.join(root, "index.html")
    }
    file = await fs.promises.realpath(file)
    if (!inside(file) || hidden(file)) return reply(403, "Forbidden")
    if (!(await fs.promises.stat(file)).isFile()) return reply(404, "Not found")
    const type = types[path.extname(file).toLowerCase()] || "application/octet-stream"
    response.setHeader("Content-Type", type + (type.startsWith("text/") ? "; charset=utf-8" : ""))
    if (request.method === "HEAD") return response.end()
    const stream = fs.createReadStream(file)
    stream.on("error", () => response.headersSent ? response.destroy() : reply(404, "Not found"))
    response.on("close", () => stream.destroy())
    stream.pipe(response)
  } catch (error) {
    reply(["ENOENT", "ENOTDIR"].includes(error.code) ? 404 : 400, "Unable to serve request")
  }
})
server.on("error", (error) => { console.error("Static preview failed: " + error.code); process.exitCode = 1 })
server.listen(port, host, () => console.log("Static preview: http://" + (host === "::1" ? "[::1]" : host) + ":" + server.address().port))
`

/** Launch recipe only: project eligibility and process ownership remain with the caller. */
export function staticWebPreviewLaunchProfile() {
  return {
    adapterId: "web-static" as const,
    target: "h5" as const,
    command: process.execPath,
    args: ["-e", STATIC_PREVIEW_SERVER],
    defaultPort: 4173,
    fidelity: "web_native" as const,
    viewportPreference: {
      defaultViewport: "auto" as const,
      supportedViewports: ["auto", "tablet", "mobile"] as ("auto" | "tablet" | "mobile")[],
      agentSelectable: true,
    },
  }
}
