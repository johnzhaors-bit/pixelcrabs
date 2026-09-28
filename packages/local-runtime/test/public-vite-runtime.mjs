import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises"
import { get } from "node:http"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"
import { createWebRuntimeManager } from "../src/web-runtime.ts"

// Node on Windows need not resolve Chromium's *.localhost names. Keep the
// gateway Host header while connecting explicitly to its loopback listener.
function page(url) {
  const target = new URL(url)
  return new Promise((resolve, reject) => {
    const request = get({ hostname: "127.0.0.1", port: target.port,
      path: target.pathname + target.search, headers: { host: target.host }, timeout: 5000 }, response => {
      let body = ""
      response.setEncoding("utf8")
      response.on("data", chunk => body += chunk)
      response.on("end", () => resolve({ status: response.statusCode, body }))
      response.on("error", reject)
    })
    request.on("timeout", () => request.destroy(new Error("Gateway request timed out")))
    request.on("error", reject)
  })
}

test("real Vite: discovery, transforms, source update, ownership and process cleanup", { timeout: 180000 }, async () => {
  const parent = path.resolve(os.tmpdir())
  const directory = await mkdtemp(path.join(parent, "pixelcrabs-vite-test-"))
  const bun = process.env.PIXELCRABS_TEST_BUN || "bun"
  const environment = { ...process.env }
  if (path.isAbsolute(bun)) environment.PATH = path.dirname(bun) + path.delimiter + (environment.PATH || "")
  const manager = createWebRuntimeManager({ environment: () => environment, startupTimeoutMs: 45000 })
  try {
    await mkdir(path.join(directory, "src"))
    await writeFile(path.join(directory, "package.json"), JSON.stringify({ private: true, type: "module",
      packageManager: "bun@1.3.14", scripts: { dev: "vite --host 127.0.0.1" }, devDependencies: { vite: "7.1.4" } }))
    await writeFile(path.join(directory, "index.html"), '<!doctype html><div id="app"></div><script type="module" src="/src/main.js"></script>')
    const source = path.join(directory, "src/main.js")
    await writeFile(source, 'document.querySelector("#app").textContent = "Framework preview"')
    execFileSync(bun, ["install", "--ignore-scripts"], { cwd: directory, env: environment, windowsHide: true, stdio: "pipe", timeout: 120000 })
    const discovery = await manager.discover(directory)
    assert.equal(discovery.candidates[0].adapterId, "vite")
    assert.deepEqual(discovery.candidates[0].missingDependencies, [])
    const started = await manager.start({ conversationId: "vite-test", directory, adapterId: "vite" })
    assert.equal(started.status, "running", started.message + "\n" + started.logs)
    assert.equal(started.projectIdentityVerified, true)
    const response = await page(started.record.url)
    assert.equal(response.status, 200)
    assert.ok(response.body.includes("/@vite/client"))
    const moduleURL = new URL("/src/main.js", started.record.url)
    assert.ok((await page(moduleURL)).body.includes("Framework preview"))
    await writeFile(source, 'document.querySelector("#app").textContent = "Framework updated"')
    const deadline = Date.now() + 5000
    while (!(await page(moduleURL)).body.includes("Framework updated")) {
      assert.ok(Date.now() < deadline, "Vite must invalidate the changed source")
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    assert.equal((await manager.verify("vite-test", started.record.runtimeId)).status, "running")
    await manager.stop("vite-test", started.record.runtimeId)
    assert.deepEqual(manager.list("vite-test"), [])
    await assert.rejects(fetch(started.record.upstreamUrl, { signal: AbortSignal.timeout(3000) }))
  } finally {
    await manager.dispose()
    // Delete only the fresh fixture created by this test, never a supplied path.
    assert.equal(path.dirname(path.resolve(directory)), parent)
    assert.ok(path.basename(directory).startsWith("pixelcrabs-vite-test-"))
    await rm(directory, { recursive: true, force: true })
  }
})
