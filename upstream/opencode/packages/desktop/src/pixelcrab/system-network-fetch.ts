import { net, session } from "electron"

let reload: Promise<void> | undefined

// Chromium owns per-target system proxy/PAC resolution. Never replay a failed write.
export const desktopNetworkFetch: typeof fetch = async (input, init) => {
  try {
    return await net.fetch(input instanceof URL ? input.toString() : input, init)
  } catch (error) {
    if (!init?.signal?.aborted && !(input instanceof Request && input.signal.aborted)) {
      const code = error instanceof Error ? error.message.match(/net::ERR_[A-Z_]+/)?.[0] : undefined
      console.warn("PixelCrab network transport failed", { code: code ?? "transport_error" })
      // Refresh configuration for subsequent attempts; no forced direct fallback or connection reset.
      reload ??= session.defaultSession.forceReloadProxyConfig().catch(() => undefined).finally(() => { reload = undefined })
    }
    throw error
  }
}
