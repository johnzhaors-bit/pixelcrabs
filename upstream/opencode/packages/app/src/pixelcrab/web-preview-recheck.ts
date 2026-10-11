import type { PixelCrabPreviewAPI, PixelCrabPreviewRecheckInput } from "./web-preview-contract"

/** Reload actual project output before inspecting targets: selection overlays
 * are temporary presentation and must never count as source changes. */
export async function reloadAndRecheck(
  api: Pick<PixelCrabPreviewAPI, "command" | "onNavigation" | "onFailed" | "recheck">,
  requests: readonly PixelCrabPreviewRecheckInput[],
  signal: AbortSignal,
  timeoutMs = 15000,
) {
  signal.throwIfAborted()
  await new Promise<void>((resolve, reject) => {
    let loading = false
    let settled = false
    const cleanups: Array<() => void> = []
    const finish = (error?: unknown) => {
      if (settled) return
      settled = true
      cleanups.forEach(cleanup => cleanup())
      if (error) reject(error)
      else resolve()
    }
    const timer = setTimeout(() => finish(new Error("Preview refresh timed out; verification was not run.")), timeoutMs)
    cleanups.push(() => clearTimeout(timer))
    const abort = () => finish(signal.reason ?? new Error("Preview verification cancelled."))
    signal.addEventListener("abort", abort, { once: true })
    cleanups.push(() => signal.removeEventListener("abort", abort))
    cleanups.push(api.onNavigation(state => {
      if (state.loading) loading = true
      else if (loading) finish()
    }))
    cleanups.push(api.onFailed(() => finish(new Error("Preview refresh failed; verification was not run."))))
    if (signal.aborted) return abort()
    void api.command("reload").catch(finish)
  })
  signal.throwIfAborted()
  const results = await Promise.all(requests.map(request => api.recheck(request)))
  signal.throwIfAborted()
  return results
}
