import { describe, expect, test } from "bun:test"
import { reloadAndRecheck } from "./web-preview-recheck"
import type { PixelCrabPreviewAPI, PixelCrabPreviewRecheckInput } from "./web-preview-contract"

function fixture() {
  let navigate: Parameters<PixelCrabPreviewAPI["onNavigation"]>[0] | undefined
  let fail: Parameters<PixelCrabPreviewAPI["onFailed"]>[0] | undefined
  const calls: string[] = []
  const api = {
    command: async () => { calls.push("reload") },
    onNavigation: (callback: typeof navigate) => { navigate = callback; return () => { navigate = undefined } },
    onFailed: (callback: typeof fail) => { fail = callback; return () => { fail = undefined } },
    recheck: async (request: PixelCrabPreviewRecheckInput) => { calls.push("recheck"); return { evidenceId: request.evidenceId } as Awaited<ReturnType<PixelCrabPreviewAPI["recheck"]>> },
  }
  return { api, calls, loading: (loading: boolean) => navigate?.({ url: "http://localhost/", title: "Fixture", loading, canGoBack: false, canGoForward: false }), fail: () => fail?.({} as Parameters<NonNullable<typeof fail>>[0]), listening: () => !!navigate || !!fail }
}
const requests = [{ evidenceId: "evidence" } as PixelCrabPreviewRecheckInput]
describe("verification reads refreshed source, not temporary overlays", () => {
  test("waits for a new load cycle before reading targets", async () => {
    const f = fixture()
    const pending = reloadAndRecheck(f.api, requests, new AbortController().signal)
    f.loading(false)
    expect(f.calls).toEqual(["reload"])
    f.loading(true); f.loading(false)
    expect((await pending).map(result => result.evidenceId)).toEqual(["evidence"])
    expect(f.calls).toEqual(["reload", "recheck"])
    expect(f.listening()).toBe(false)
  })
  test("navigation failure never runs a target check", async () => {
    const f = fixture()
    const pending = reloadAndRecheck(f.api, requests, new AbortController().signal)
    f.fail()
    await expect(pending).rejects.toThrow("refresh failed")
    expect(f.calls).toEqual(["reload"])
    expect(f.listening()).toBe(false)
  })
  test("changing sessions cancels the pending refresh and listeners", async () => {
    const f = fixture(), controller = new AbortController()
    const pending = reloadAndRecheck(f.api, requests, controller.signal)
    controller.abort(new Error("Session changed"))
    await expect(pending).rejects.toThrow("Session changed")
    expect(f.calls).toEqual(["reload"])
    expect(f.listening()).toBe(false)
  })
  test("missing load events time out without claiming success", async () => {
    const f = fixture()
    await expect(reloadAndRecheck(f.api, requests, new AbortController().signal, 5)).rejects.toThrow("timed out")
    expect(f.calls).toEqual(["reload"])
    expect(f.listening()).toBe(false)
  })
})
