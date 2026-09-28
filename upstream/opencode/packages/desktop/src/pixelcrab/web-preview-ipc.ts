import type { VisualChangePanel } from "../../../app/src/pixelcrab/visual-change-panel-contract"
import { BrowserWindow, ipcMain, Menu, type IpcMainInvokeEvent, type MenuItemConstructorOptions } from "electron"
import { PixelCrabPreviewController, type PixelCrabPreviewSelectionMode, type PreviewPresentationPolicy } from "./preview-controller"
import type { PixelCrabPreviewBounds } from "./web-preview-domain"
import type {
  PixelCrabPreviewMenuInput,
  PixelCrabPreviewRecheckInput,
  PixelCrabPreviewUXIssue,
  PixelCrabPreviewVisualChange,
} from "./preview-contract"

type PreviewCommand = "reload" | "back" | "forward"

function senderWindow(event: IpcMainInvokeEvent) {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win || win.isDestroyed() || win.webContents !== event.sender || event.senderFrame !== event.sender.mainFrame) {
    throw new Error("Invalid PixelCrab preview sender")
  }
  return win
}

export function registerWebPreviewIPC(options: { openExternal(url: string): void; policy?: PreviewPresentationPolicy }) {
  const controller = new PixelCrabPreviewController({
    external: (_win, url) => options.openExternal(url),
    navigation: (win, state) => {
      if (!win.isDestroyed()) win.webContents.send("pixelcrab-preview-navigation", state)
    },
    failed: (win, error) => {
      if (!win.isDestroyed()) win.webContents.send("pixelcrab-preview-failed", error)
    },
    health: (win, state) => {
      if (!win.isDestroyed()) win.webContents.send("pixelcrab-preview-health", state)
    },
    evidence: (win, evidence) => {
      if (!win.isDestroyed()) win.webContents.send("pixelcrab-preview-evidence", evidence)
    },
    visualPanel: (win, action) => {
      if (!win.isDestroyed()) win.webContents.send("pixelcrab-preview-visual-panel-action", action)
    },
    issue: (win, issueId) => {
      if (!win.isDestroyed()) win.webContents.send("pixelcrab-preview-ux-issue", issueId)
    },
  }, options.policy)

  ipcMain.handle(
    "pixelcrab-preview-show",
    (
      event: IpcMainInvokeEvent,
      input: {
        url: string
        bounds: PixelCrabPreviewBounds
        scope?: string
        adapterId?: string
        runtimeId?: string
        projectId?: string
        source?: "agent" | "manual"
      },
    ) => controller.show(senderWindow(event), input),
  )
  ipcMain.handle("pixelcrab-preview-visual-panel", (event: IpcMainInvokeEvent, panel: VisualChangePanel | null) =>
    controller.setVisualPanel(senderWindow(event), panel),
  )
  ipcMain.handle("pixelcrab-preview-bounds", (event: IpcMainInvokeEvent, bounds: PixelCrabPreviewBounds) =>
    controller.setBounds(senderWindow(event), bounds),
  )
  ipcMain.handle("pixelcrab-preview-hide", (event: IpcMainInvokeEvent) => controller.hide(senderWindow(event)))
  ipcMain.handle("pixelcrab-preview-selection-mode", (event: IpcMainInvokeEvent, mode: PixelCrabPreviewSelectionMode) => {
    if (mode !== "interact" && mode !== "element" && mode !== "region" && mode !== "visual") {
      throw new Error(`Unsupported PixelCrab selection mode: ${mode}`)
    }
    return controller.setSelectionMode(senderWindow(event), mode)
  })
  ipcMain.handle("pixelcrab-preview-recheck", (event: IpcMainInvokeEvent, input: PixelCrabPreviewRecheckInput) =>
    controller.recheck(senderWindow(event), input),
  )
  ipcMain.handle("pixelcrab-preview-ux-issues", (event: IpcMainInvokeEvent, issues: PixelCrabPreviewUXIssue[]) =>
    controller.setUXIssues(senderWindow(event), issues),
  )
  ipcMain.handle("pixelcrab-preview-visual-changes", (event: IpcMainInvokeEvent, changes: PixelCrabPreviewVisualChange[]) =>
    controller.setVisualChanges(senderWindow(event), changes),
  )
  ipcMain.handle("pixelcrab-preview-command", (event: IpcMainInvokeEvent, command: PreviewCommand) => {
    const win = senderWindow(event)
    if (command === "reload") return controller.reload(win)
    if (command === "back") return controller.goBack(win)
    if (command === "forward") return controller.goForward(win)
    throw new Error(`Unsupported PixelCrab preview command: ${command satisfies never}`)
  })
  ipcMain.handle("pixelcrab-preview-diagnostics", (event: IpcMainInvokeEvent, input?: { screenshot?: boolean }) =>
    controller.diagnostics(senderWindow(event), input),
  )
  ipcMain.handle("pixelcrab-preview-diagnostics-clear", (event: IpcMainInvokeEvent) =>
    controller.clearDiagnostics(senderWindow(event)),
  )
  ipcMain.handle("pixelcrab-preview-menu", (event: IpcMainInvokeEvent, input: PixelCrabPreviewMenuInput) => {
    const win = senderWindow(event)
    return new Promise<string | undefined>((resolve) => {
      let selected: string | undefined
      const template: MenuItemConstructorOptions[] = input.items.map((item) => {
        if (item.type === "separator") return { type: "separator" }
        return {
          label: item.detail ? `${item.label} — ${item.detail}` : item.label,
          enabled: item.enabled !== false,
          click: () => {
            selected = item.id
          },
        }
      })
      Menu.buildFromTemplate(template).popup({
        window: win,
        x: Math.max(0, Math.round(input.x)),
        y: Math.max(0, Math.round(input.y)),
        callback: () => resolve(selected),
      })
    })
  })
  return controller
}
