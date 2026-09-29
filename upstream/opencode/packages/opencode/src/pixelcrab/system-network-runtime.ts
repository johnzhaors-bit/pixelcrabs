let bridge: string | undefined

/** Desktop startup context. Provider credentials never select the transport. */
export function configure(value?: string) {
  if (!value) { bridge = undefined; return }
  const url = new URL(value)
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.username || url.password || url.search || url.hash || !/^\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)) {
    throw new TypeError("PixelCrab network bridge must be a scoped loopback URL")
  }
  bridge = url.toString().replace(/\/+$/, "")
}

configure(process.env.PIXELCRAB_NETWORK_BRIDGE_URL)
// The capability belongs to this runtime, not arbitrary tool subprocess environments.
delete process.env.PIXELCRAB_NETWORK_BRIDGE_URL

export function networkBridgeURL() { return bridge }

function canBridge(url: URL) {
  const host = url.hostname.toLowerCase().replace(/\.$/, "")
  return url.protocol === "https:" && !url.username && !url.password &&
    host !== "localhost" && !host.endsWith(".localhost") && !/^127\.\d+\.\d+\.\d+$/.test(host) &&
    host !== "[::1]" && !/^\[::ffff:7f[0-9a-f]{2}:/.test(host)
}

export function networkURL(input: string | URL | Request): string | URL | Request {
  if (!bridge) return input
  const url = new URL(input instanceof Request ? input.url : input.toString())
  if (!canBridge(url)) return input
  return `${bridge}/outbound?url=${encodeURIComponent(url.toString())}`
}

export function networkBaseURL(input: string): string {
  if (!bridge) return input
  const url = new URL(input)
  if (!canBridge(url) || url.search || url.hash) return input
  return `${bridge}/outbound-base/${Buffer.from(url.toString()).toString("base64url")}`
}

export function networkOriginBridge(input: string): { baseURL: string; headers: string[] } | undefined {
  if (!bridge) return
  const upstream = new URL(input)
  if (!canBridge(upstream) || upstream.search || upstream.hash) return
  const local = new URL(bridge)
  return {
    baseURL: local.origin,
    headers: [
      `X-PixelCrab-Bridge-Token: ${local.pathname.slice(1)}`,
      `X-PixelCrab-Bridge-Upstream: ${Buffer.from(upstream.toString()).toString("base64url")}`,
    ],
  }
}

export async function networkFetch(input: string | URL | Request, init?: RequestInit, fetchImpl: typeof fetch = fetch): Promise<Response> {
  if (!(input instanceof Request)) return fetchImpl(networkURL(input), init)
  if (networkURL(input) === input) return fetchImpl(input, init)
  const request = new Request(input, init)
  const method = request.method.toUpperCase()
  const body = method === "GET" || method === "HEAD" ? undefined : await request.arrayBuffer()
  return fetchImpl(networkURL(request), { method, headers: request.headers, body, signal: request.signal, redirect: request.redirect })
}

export * as SystemNetworkRuntime from "./system-network-runtime"
