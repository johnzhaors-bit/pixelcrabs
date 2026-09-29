import { afterEach, expect, test } from "bun:test"
import { SystemNetworkRuntime } from "../../src/pixelcrab/system-network-runtime"

afterEach(() => { SystemNetworkRuntime.configure() })

test("standalone transport preserves the original request", () => {
  SystemNetworkRuntime.configure()
  const request = new Request("https://provider.example/v1/models")
  expect(SystemNetworkRuntime.networkURL(request)).toBe(request)
})

test("desktop transport routes HTTPS independently and keeps loopback direct", () => {
  SystemNetworkRuntime.configure("http://127.0.0.1:4321/bridge")
  expect(SystemNetworkRuntime.networkURL("https://provider.example/v1/models")).toBe("http://127.0.0.1:4321/bridge/outbound?url=https%3A%2F%2Fprovider.example%2Fv1%2Fmodels")
  for (const target of ["http://127.0.0.1:11434", "https://127.0.0.2:11434", "https://localhost:8443", "https://localhost.:8443", "https://app.localhost:8443", "https://[::1]:8443", "https://[::ffff:127.0.0.1]:8443"]) {
    expect(SystemNetworkRuntime.networkURL(target)).toBe(target)
    expect(SystemNetworkRuntime.networkBaseURL(target)).toBe(target)
    expect(SystemNetworkRuntime.networkOriginBridge(target)).toBeUndefined()
  }
  expect(String(SystemNetworkRuntime.networkURL("https://10.1.2.3/v1"))).toContain("/outbound?")
  expect(String(SystemNetworkRuntime.networkURL("https://127.models.example/v1"))).toContain("/outbound?")
})

test("rejects unscoped or remote network bootstrap addresses", () => {
  for (const target of ["https://remote.example/secret", "http://127.0.0.1/", "http://user@127.0.0.1/secret", "http://127.0.0.1/secret?x=1"]) {
    expect(() => SystemNetworkRuntime.configure(target)).toThrow()
  }
})

test("does not retry failed model writes or replace caller authorization", async () => {
  SystemNetworkRuntime.configure("http://127.0.0.1:4321/bridge")
  let calls = 0
  const fetcher = (async (_url: URL | RequestInfo, init?: RequestInit) => {
    calls++
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer provider-fixture")
    expect(init?.method).toBe("POST")
    throw new Error("fixture network failure")
  }) as unknown as typeof fetch
  await expect(SystemNetworkRuntime.networkFetch(new Request("https://provider.example/v1/chat", {
    method: "POST", headers: { authorization: "Bearer provider-fixture" }, body: "{}",
  }), undefined, fetcher)).rejects.toThrow("fixture network failure")
  expect(calls).toBe(1)
})
