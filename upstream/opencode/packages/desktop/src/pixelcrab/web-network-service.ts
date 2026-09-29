import { app } from "electron"
import { SystemNetworkBridge } from "../../../../../../packages/platform-desktop/src/system-network-bridge"
import { desktopNetworkFetch } from "./system-network-fetch"

const bridge = new SystemNetworkBridge({ fetchImpl: desktopNetworkFetch })
let started: Promise<string> | undefined

/** Process-level transport only; no account, provider registration or service URL. */
export function startWebNetwork(): Promise<string> {
  if (started) return started
  app.once("will-quit", () => void bridge.close().catch(() => undefined))
  started = app.whenReady().then(() => bridge.start()).catch(error => {
    started = undefined
    throw error
  })
  return started
}
