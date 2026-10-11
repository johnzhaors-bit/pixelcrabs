import { ipcRenderer } from "electron"
import type { PixelCrabPreviewAPI } from "./preview-contract"

export function createWebPreviewAPI(): PixelCrabPreviewAPI {
  return {
    setVisualPanel: (panel) => ipcRenderer.invoke("pixelcrab-preview-visual-panel", panel),
    onVisualPanelAction: (cb) => {
      const handler = (_: unknown, action: Parameters<typeof cb>[0]) => cb(action)
      ipcRenderer.on("pixelcrab-preview-visual-panel-action", handler)
      return () => ipcRenderer.removeListener("pixelcrab-preview-visual-panel-action", handler)
    },
    show: (input) => ipcRenderer.invoke("pixelcrab-preview-show", input),
    setBounds: (bounds) => ipcRenderer.invoke("pixelcrab-preview-bounds", bounds),
    hide: () => ipcRenderer.invoke("pixelcrab-preview-hide"),
    command: (command) => ipcRenderer.invoke("pixelcrab-preview-command", command),
    setSelectionMode: (mode) => ipcRenderer.invoke("pixelcrab-preview-selection-mode", mode),
    recheck: (input) => ipcRenderer.invoke("pixelcrab-preview-recheck", input),
    setUXIssues: (issues) => ipcRenderer.invoke("pixelcrab-preview-ux-issues", issues),
    setVisualChanges: (changes) => ipcRenderer.invoke("pixelcrab-preview-visual-changes", changes),
    diagnostics: (input) => ipcRenderer.invoke("pixelcrab-preview-diagnostics", input),
    clearDiagnostics: () => ipcRenderer.invoke("pixelcrab-preview-diagnostics-clear"),
    showMenu: (input) => ipcRenderer.invoke("pixelcrab-preview-menu", input),
    onNavigation: (cb) => {
      const handler = (_: unknown, state: Parameters<typeof cb>[0]) => cb(state)
      ipcRenderer.on("pixelcrab-preview-navigation", handler)
      return () => ipcRenderer.removeListener("pixelcrab-preview-navigation", handler)
    },
    onFailed: (cb) => {
      const handler = (_: unknown, failure: Parameters<typeof cb>[0]) => cb(failure)
      ipcRenderer.on("pixelcrab-preview-failed", handler)
      return () => ipcRenderer.removeListener("pixelcrab-preview-failed", handler)
    },
    onHealth: (cb) => {
      const handler = (_: unknown, state: Parameters<typeof cb>[0]) => cb(state)
      ipcRenderer.on("pixelcrab-preview-health", handler)
      return () => ipcRenderer.removeListener("pixelcrab-preview-health", handler)
    },
    onEvidence: (cb) => {
      const handler = (_: unknown, evidence: Parameters<typeof cb>[0]) => cb(evidence)
      ipcRenderer.on("pixelcrab-preview-evidence", handler)
      return () => ipcRenderer.removeListener("pixelcrab-preview-evidence", handler)
    },
    onUXIssue: (cb) => {
      const handler = (_: unknown, issueId: Parameters<typeof cb>[0]) => cb(issueId)
      ipcRenderer.on("pixelcrab-preview-ux-issue", handler)
      return () => ipcRenderer.removeListener("pixelcrab-preview-ux-issue", handler)
    },
  }
}
