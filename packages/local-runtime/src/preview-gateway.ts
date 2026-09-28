import { createServer, request as httpRequest, type IncomingMessage } from "node:http"
import { connect } from "node:net"

type GatewayTarget = { runtimeId: string; host: string; port: number }

const targets = new Map<string, GatewayTarget>()
const tunnels = new Map<string, Set<() => void>>()
let gatewayPort: number | undefined
let starting: Promise<number> | undefined

function runtimeHost(runtimeId: string) {
  return `${runtimeId.replace(/[^a-z0-9-]/gi, "-").toLowerCase()}.localhost`
}

function runtimeFromRequest(request: IncomingMessage) {
  const hostname = (request.headers.host ?? "").split(":")[0]?.toLowerCase()
  if (hostname !== "127.0.0.1" && hostname !== "localhost" && !hostname?.endsWith(".localhost")) return
  if (hostname?.endsWith(".localhost")) {
    const runtimeId = [...targets.keys()].find((id) => runtimeHost(id) === hostname)
    if (runtimeId) return targets.get(runtimeId)
  }
  const match = request.url?.match(/^\/preview\/([^/]+)(?:\/|$)/)
  try { return match ? targets.get(decodeURIComponent(match[1]!)) : undefined } catch { return }
}

function upstreamPath(request: IncomingMessage, runtimeId: string) {
  const prefix = `/preview/${encodeURIComponent(runtimeId)}`
  if (!request.url?.startsWith(prefix)) return request.url || "/"
  const value = request.url.slice(prefix.length)
  return value.startsWith("/") ? value : `/${value}`
}

const server = createServer((incoming, response) => {
  const target = runtimeFromRequest(incoming)
  if (!target) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" })
    response.end("Preview Runtime not found.")
    return
  }
  const proxy = httpRequest(
    {
      host: target.host,
      port: target.port,
      method: incoming.method,
      path: upstreamPath(incoming, target.runtimeId),
      headers: { ...incoming.headers, host: `${target.host}:${target.port}` },
    },
    (upstream) => {
      const headers = { ...upstream.headers, "x-pixelcrab-runtime-id": target.runtimeId, "cache-control": "no-store" }
      delete headers["content-length"]
      response.writeHead(upstream.statusCode ?? 502, headers)
      upstream.pipe(response)
    },
  )
  proxy.once("error", (error) => {
    if (!response.headersSent) response.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" })
    response.end(`Preview upstream unavailable: ${error.message}`)
  })
  incoming.pipe(proxy)
})

server.on("upgrade", (request, socket, head) => {
  const target = runtimeFromRequest(request)
  if (!target) {
    socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n")
    return
  }
  const upstream = connect(target.port, target.host, () => {
    const headers = Object.entries({ ...request.headers, host: `${target.host}:${target.port}` })
      .filter((entry): entry is [string, string | string[]] => entry[1] !== undefined)
      .flatMap(([name, value]) => (Array.isArray(value) ? value.map((item) => `${name}: ${item}`) : [`${name}: ${value}`]))
      .join("\r\n")
    upstream.write(`${request.method ?? "GET"} ${upstreamPath(request, target.runtimeId)} HTTP/1.1\r\n${headers}\r\n\r\n`)
    if (head.length) upstream.write(head)
    socket.pipe(upstream).pipe(socket)
  })
  upstream.once("error", () => socket.destroy())
  socket.once("error", () => upstream.destroy())
  const owned = tunnels.get(target.runtimeId) ?? new Set<() => void>()
  tunnels.set(target.runtimeId, owned)
  const close = () => {
    socket.destroy()
    upstream.destroy()
    owned.delete(close)
    if (!owned.size && tunnels.get(target.runtimeId) === owned) tunnels.delete(target.runtimeId)
  }
  owned.add(close)
  upstream.once("close", close)
  socket.once("close", close)
})

async function ensureGateway() {
  if (gatewayPort) return gatewayPort
  starting ??= new Promise<number>((resolve, reject) => {
    server.once("error", reject)
    server.listen({ host: "127.0.0.1", port: 0 }, () => {
      const address = server.address()
      if (typeof address !== "object" || !address) return reject(new Error("无法启动 Preview Gateway。"))
      gatewayPort = address.port
      server.unref()
      resolve(address.port)
    })
  })
  return starting
}

export async function registerPreviewGateway(runtimeId: string, upstreamUrl: string) {
  const upstream = new URL(upstreamUrl)
  if (upstream.protocol !== "http:" || !["127.0.0.1", "localhost", "::1"].includes(upstream.hostname))
    throw new Error("Preview Gateway 只允许代理本机回环端点。")
  const port = Number(upstream.port || 80)
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) throw new Error("Preview Runtime 端口无效。")
  const gateway = await ensureGateway()
  targets.set(runtimeId, { runtimeId, host: "127.0.0.1", port })
  return `http://${runtimeHost(runtimeId)}:${gateway}/preview/${encodeURIComponent(runtimeId)}/`
}

export function unregisterPreviewGateway(runtimeId: string) {
  targets.delete(runtimeId)
  for (const close of tunnels.get(runtimeId) ?? []) close()
  tunnels.delete(runtimeId)
}

export function previewGatewayTarget(runtimeId: string) {
  const target = targets.get(runtimeId)
  return target ? { ...target } : undefined
}
