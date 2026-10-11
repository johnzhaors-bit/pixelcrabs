import assert from "node:assert/strict";
import test from "node:test";
import { SystemNetworkBridge } from "../src/system-network-bridge.ts";

test("shared transport has no platform endpoints and rejects missing capabilities", async (t) => {
  let calls = 0;
  const bridge = new SystemNetworkBridge({ fetchImpl: async () => { calls++; return new Response("ok"); } });
  t.after(() => bridge.close());
  const [a, b] = await Promise.all([bridge.start(), bridge.start()]);
  assert.equal(a, b);
  for (const url of [new URL("/outbound?url=https://example.test", a), `${a}/v1/market/items/example/resolve-download`, `${a}/chat/completions`]) {
    assert.equal((await fetch(url, { method: "POST" })).status, 404);
  }
  assert.equal(calls, 0);
});

test("failed model writes are returned once without replay", async (t) => {
  let calls = 0;
  const bridge = new SystemNetworkBridge({ fetchImpl: async () => { calls++; throw new Error("internal-diagnostic-sentinel"); } });
  t.after(() => bridge.close());
  const base = await bridge.start();
  const response = await fetch(`${base}/outbound?url=https://example.test/generate`, { method: "POST", body: "test" });
  assert.equal(response.status, 502);
  assert.equal(calls, 1);
  assert.ok(!(await response.text()).includes("internal-diagnostic-sentinel"));
});

test("closing the bridge aborts an active response and releases its port", { timeout: 5000 }, async () => {
  let upstreamSignal;
  const bridge = new SystemNetworkBridge({ fetchImpl: async (_input, init) => {
    upstreamSignal = init.signal;
    return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode("data: first\n\n"));
      init.signal.addEventListener("abort", () => controller.error(new Error("closed")), { once: true });
    } }));
  } });
  const base = await bridge.start();
  try {
    const response = await fetch(`${base}/outbound?url=https://example.test/stream`);
    const reader = response.body.getReader();
    assert.equal((await reader.read()).done, false);
    const pending = reader.read().catch(() => undefined);
    await bridge.close();
    await pending;
    assert.equal(upstreamSignal.aborted, true);
    await assert.rejects(fetch(base));
  } finally { await bridge.close(); }
});

test("forwards authenticated provider and remote MCP HTTPS traffic with streaming responses", async (t) => {
  const calls = [];
  const bridge = new SystemNetworkBridge({
    token: "outbound-secret",
    fetchImpl: async (input, init) => {
      const chunks = [];
      if (init.body instanceof Uint8Array) chunks.push(Buffer.from(init.body));
      else for await (const chunk of init.body) chunks.push(Buffer.from(chunk));
      calls.push({
        url: String(input),
        method: init.method,
        headers: new Headers(init.headers),
        body: Buffer.concat(chunks).toString(),
      });
      return new Response("event: message\ndata: {\"ok\":true}\n\n", {
        headers: { "content-type": "text/event-stream", "mcp-session-id": "session-1" },
      });
    },
  });
  t.after(() => bridge.close());
  const baseURL = await bridge.start();
  const target = "https://mcp.example/events?space=a%20b";
  const response = await fetch(`${baseURL}/outbound?url=${encodeURIComponent(target)}`, {
    method: "POST",
    headers: { authorization: "Bearer remote-token", "x-api-key": "key-1", "mcp-session-id": "client-session" },
    body: JSON.stringify({ jsonrpc: "2.0" }),
  });

  assert.equal(await response.text(), "event: message\ndata: {\"ok\":true}\n\n");
  assert.equal(response.headers.get("mcp-session-id"), "session-1");
  assert.equal(calls[0].url, target);
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].headers.get("authorization"), "Bearer remote-token");
  assert.equal(calls[0].headers.get("x-api-key"), "key-1");
  assert.equal(calls[0].headers.get("mcp-session-id"), "client-session");
  assert.equal(calls[0].body, JSON.stringify({ jsonrpc: "2.0" }));
});

test("buffers small official CLI signed requests instead of changing them to chunked uploads", async (t) => {
  let received;
  const bridge = new SystemNetworkBridge({
    token: "alipay-signed-request",
    fetchImpl: async (input, init) => {
      received = {
        url: String(input),
        headers: new Headers(init.headers),
        body: init.body,
        duplex: init.duplex,
      };
      return Response.json({ success: true });
    },
  });
  t.after(() => bridge.close());
  const baseURL = await bridge.start();
  const target = "https://ideservice.alipay.com/api/preview";
  const signedBody = JSON.stringify({ request: "signed-control-payload" });
  const response = await fetch(`${baseURL}/outbound?url=${encodeURIComponent(target)}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-alipay-signature": "signed" },
    body: signedBody,
  });

  assert.equal(response.status, 200);
  assert.equal(received.url, target);
  assert.equal(received.headers.get("x-alipay-signature"), "signed");
  assert.equal(Buffer.from(received.body).toString(), signedBody);
  assert.equal(received.duplex, undefined);
});

test("preserves official CLI authentication context on exact outbound requests", async (t) => {
  let received;
  const bridge = new SystemNetworkBridge({
    token: "official-cli-secret",
    fetchImpl: async (input, init) => {
      received = { url: String(input), headers: new Headers(init.headers) };
      return Response.json({ success: true });
    },
  });
  t.after(() => bridge.close());
  const baseURL = await bridge.start();
  const target = "https://ideservice.alipay.com/api/preview";
  const response = await fetch(`${baseURL}/outbound?url=${encodeURIComponent(target)}`, {
    headers: {
      cookie: "tool-session=signed",
      origin: "https://open.alipay.com",
      referer: "https://open.alipay.com/mini/dev",
      "sec-fetch-site": "same-site",
      "x-pixelcrab-bridge-token": "must-not-leak",
      "proxy-authorization": "must-not-leak",
    },
  });

  assert.equal(response.status, 200);
  assert.equal(received.url, target);
  assert.equal(received.headers.get("cookie"), "tool-session=signed");
  assert.equal(received.headers.get("origin"), "https://open.alipay.com");
  assert.equal(received.headers.get("referer"), "https://open.alipay.com/mini/dev");
  assert.equal(received.headers.get("sec-fetch-site"), "same-site");
  // Node fetch adds this automatically; Electron must derive its own mode.
  assert.equal(received.headers.get("sec-fetch-mode"), null);
  assert.equal(received.headers.get("x-pixelcrab-bridge-token"), null);
  assert.equal(received.headers.get("proxy-authorization"), null);
});

test("generic outbound bridge rejects non-HTTPS and credential-bearing targets", async (t) => {
  let called = false;
  const bridge = new SystemNetworkBridge({ token: "outbound-secret", fetchImpl: async () => { called = true; return new Response(); } });
  t.after(() => bridge.close());
  const baseURL = await bridge.start();

  assert.equal((await fetch(`${baseURL}/outbound?url=${encodeURIComponent("http://mcp.example/events")}`)).status, 502);
  assert.equal((await fetch(`${baseURL}/outbound?url=${encodeURIComponent("https://user:pass@mcp.example/events")}`)).status, 502);
  assert.equal(called, false);
});

test("maps an HTTPS API base and appended paths through Electron networking", async (t) => {
  const calls = [];
  const bridge = new SystemNetworkBridge({ token: "base-secret", fetchImpl: async (input, init) => {
    calls.push({ url: String(input), method: init.method, authorization: new Headers(init.headers).get("authorization") });
    return Response.json({ ok: true });
  } });
  t.after(() => bridge.close());
  const local = await bridge.start();
  const encoded = Buffer.from("https://mastergo.com/api").toString("base64url");
  const response = await fetch(`${local}/outbound-base/${encoded}/v1/files?page=2`, { headers: { authorization: "Bearer design-token" } });
  assert.equal(response.status, 200);
  assert.deepEqual(calls, [{ url: "https://mastergo.com/api/v1/files?page=2", method: "GET", authorization: "Bearer design-token" }]);
});

test("maps origin-only MCP clients through authenticated bridge headers", async (t) => {
  const calls = [];
  const bridge = new SystemNetworkBridge({ token: "mcp-secret", fetchImpl: async (input, init) => {
    calls.push({ url: String(input), headers: new Headers(init.headers) });
    return Response.json({ ok: true });
  } });
  t.after(() => bridge.close());
  const local = await bridge.start();
  const upstream = Buffer.from("https://mastergo.com/").toString("base64url");
  const response = await fetch(`${new URL(local).origin}/mcp/extract-svg?fileId=1`, {
    headers: {
      "x-mg-useraccesstoken": "design-token",
      "x-pixelcrab-bridge-token": "mcp-secret",
      "x-pixelcrab-bridge-upstream": upstream,
    },
  });

  assert.equal(response.status, 200);
  assert.equal(calls[0].url, "https://mastergo.com/mcp/extract-svg?fileId=1");
  assert.equal(calls[0].headers.get("x-mg-useraccesstoken"), "design-token");
  assert.equal(calls[0].headers.get("x-pixelcrab-bridge-token"), null);
  assert.equal(calls[0].headers.get("x-pixelcrab-bridge-upstream"), null);
  assert.equal((await fetch(`${new URL(local).origin}/mcp/extract-svg`, {
    headers: { "x-pixelcrab-bridge-upstream": upstream },
  })).status, 404);
});
