import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { createUpdaterController } from "./src/main/updater-controller"

for (const channel of ["dev", "beta", "prod"] as const) {
  test(`public ${channel} cannot overwrite another distribution or publish its updates`, async () => {
    const previous = process.env.OPENCODE_CHANNEL
    process.env.OPENCODE_CHANNEL = channel
    try {
      const { default: config } = await import(`./electron-builder.config.ts?channel=${channel}`)
      const id = `com.pixelcrabs.open${channel === "prod" ? "" : `.${channel}`}`
      expect(config.appId).toBe(id)
      expect(config.extraMetadata.desktopName).toBe(`${id}.desktop`)
      expect(config.linux.executableName).toBe(id)
      expect(config.linux.desktop.entry.StartupWMClass).toBe(id)
      expect(config.publish).toBeNull()
      expect(config.protocols.schemes).toEqual(["pixelcrabs-open"])
      expect(config.extraResources).toHaveLength(1)
      expect(JSON.stringify(config)).not.toContain("anomalyco")
      expect(config.win.signtoolOptions).toBeUndefined()
    } finally {
      if (previous === undefined) delete process.env.OPENCODE_CHANNEL
      else process.env.OPENCODE_CHANNEL = previous
    }
  })
}

test("disabled updates never access a backend or install a stale update", async () => {
  const unexpected = () => { throw Error("Disabled updater accessed backend or persistence") }
  const controller = createUpdaterController({
    enabled: false, currentVersion: "0.1.0-preview.1",
    backend: { checkForUpdates: unexpected, downloadUpdate: unexpected, quitAndInstall: unexpected },
    persistence: { get: () => ({ version: "9.9.9" }), set: unexpected, clear: () => {} }, stop: unexpected,
  })
  await controller.start()
  expect((await controller.check()).status).toBe("disabled")
  await expect(controller.install()).rejects.toThrow("Update is not ready to install")
})

test("public desktop startup isolates data and never claims the upstream protocol", () => {
  const main = readFileSync(new URL("./src/main/index.ts", import.meta.url), "utf8")
  expect(main).not.toContain('from "./migrate"')
  expect(main).not.toContain('"ai.opencode.desktop')
  expect(main).not.toContain('setAsDefaultProtocolClient("opencode")')
  expect(main).toContain('join(app.getPath("userData"), "engine", kind.toLowerCase())')
  expect(main).toContain('const SIDECAR_VERSION: string = "v1"')
  const constants = readFileSync(new URL("./src/main/constants.ts", import.meta.url), "utf8")
  expect(constants).toContain("UPDATER_ENABLED = false")
})
