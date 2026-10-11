import { renderVisualChangePanel } from "./visual-change-panel"
import type { VisualChangePanel, VisualChangePanelAction } from "../../../app/src/pixelcrab/visual-change-panel-contract"
import { session, WebContentsView, type BrowserWindow, type Rectangle } from "electron"
import { createConnection } from "node:net"
import { randomUUID } from "node:crypto"
import {
  capturePixelCrabEvidenceScreenshots,
  classifyPixelCrabPreviewFailure,
  isPixelCrabPreviewNavigationCancelled,
  normalizePixelCrabElementAttributes,
  normalizePixelCrabElementSelector,
  normalizePixelCrabElementText,
  normalizePixelCrabPreviewBounds,
  normalizePixelCrabVisualChanges,
  matchesPixelCrabEvidenceRoute,
  matchesPixelCrabPreviewRoute,
  resolvePixelCrabPreviewEndpoint,
  resolvePixelCrabInspectorSourceCandidate,
  resolvePixelCrabLocalPreviewURL,
  resolvePixelCrabManualPreviewURL,
  resolvePixelCrabSelectionRectangle,
  sanitizePixelCrabPreviewConsoleMessage,
  sanitizePixelCrabPreviewConsoleSource,
  sanitizePixelCrabPreviewError,
} from "./web-preview-domain"
import type {
  PixelCrabPreviewRecheckInput,
  PixelCrabPreviewRecheckResult,
  PixelCrabPreviewUXIssue,
  PixelCrabPreviewVisualChange,
  PixelCrabPreviewVisualChangeResult,
} from "./preview-contract"

export type PixelCrabPreviewNavigationState = {
  url: string
  title: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  render?: PixelCrabPreviewRenderState
}

export type PixelCrabPreviewRenderState = {
  readyState: string
  textLength: number
  elementCount: number
  body: { width: number; height: number }
  appMounted: boolean
  hasVisibleContent: boolean
}

export type PixelCrabPreviewControllerEvents = {
  external(win: BrowserWindow, url: string): void
  navigation(win: BrowserWindow, state: PixelCrabPreviewNavigationState): void
  failed(
    win: BrowserWindow,
    input: {
      url: string
      errorCode: number
      errorDescription: string
      kind: "tls" | "unreachable" | "crashed" | "blocked" | "unknown"
    },
  ): void
  health(win: BrowserWindow, state: PixelCrabPreviewHealthState): void
  evidence(win: BrowserWindow, evidence: PixelCrabPreviewEvidenceContext): void
  visualPanel?(win: BrowserWindow, action: VisualChangePanelAction): void
  issue(win: BrowserWindow, issueId: string): void
}

export type PixelCrabPreviewHealthState = {
  url: string
  status: "connecting" | "running" | "unavailable"
  reason?: string
}

export type PixelCrabPreviewSelectionMode = "interact" | "element" | "region" | "visual"

export type PixelCrabPreviewConsoleEntry = {
  id: number
  level: number
  message: string
  line: number
  source: string
  timestamp: string
}

export type PixelCrabPreviewDiagnostics = {
  url: string
  health: PixelCrabPreviewHealthState["status"]
  render?: PixelCrabPreviewRenderState
  screenshot?: string
  console: PixelCrabPreviewConsoleEntry[]
  droppedConsoleEntries: number
}

export type PixelCrabPreviewEvidenceContext = {
  evidenceId: string
  runtimeId?: string
  projectId?: string
  capturedAt: string
  pageRevision: number
  status: "active"
  source: "selected_element" | "selected_region"
  userRequest: string
  visualChange?: {
    textContent?: string
    styles: Record<string, string>
    description?: string
  }
  route: string
  viewport: {
    width: number
    height: number
    deviceScaleFactor: number
    scrollX: number
    scrollY: number
  }
  boundingBox: Rectangle
  selectionBounds?: Rectangle
  screenshot?: string
  regionScreenshot?: string
  domSelector: string
  domSnapshot: {
    tagName: string
    id?: string
    classNames: string[]
    attributes: Record<string, string>
  }
  computedStyles: Record<string, string>
  textContent?: string
  regionFingerprint?: {
    textContent?: string
    elements: Array<{
      selector: string
      tagName: string
      textContent?: string
      computedStyles: Record<string, string>
    }>
  }
  sourceCandidates: Array<{
    file: string
    line?: number
    column?: number
    component?: string
    confidence: number
    provider: string
  }>
  captureLevel: "L1_visual" | "L2_partial"
}

type ElementSelection = Omit<
  PixelCrabPreviewEvidenceContext,
  | "evidenceId"
  | "capturedAt"
  | "status"
  | "source"
  | "route"
  | "screenshot"
  | "regionScreenshot"
  | "sourceCandidates"
  | "captureLevel"
>

type PreviewState = {
  view: WebContentsView
  scope: string
  partition: string
  visible: boolean
  attached: boolean
  url?: string
  healthTimer?: ReturnType<typeof setInterval>
  lastHealth?: string
  lastHealthStatus?: PixelCrabPreviewHealthState["status"]
  lastHealthReason?: PixelCrabPreviewHealthState["reason"]
  selectionMode: PixelCrabPreviewSelectionMode
  selectionRun: number
  captureInProgress: boolean
  consoleEntries: PixelCrabPreviewConsoleEntry[]
  consoleSequence: number
  droppedConsoleEntries: number
  uxIssues: PixelCrabPreviewUXIssue[]
  visualPanel?: VisualChangePanel
  visualPanelToken?: string
  visualChanges: PixelCrabPreviewVisualChange[]
  adapterId?: string
  runtimeId?: string
  projectId?: string
  activationRun: number
  renderMisses: number
  allowRemoteNavigation: boolean
}

const ELEMENT_PICKER_WORLD_ID = 1001
const MAX_SCREENSHOT_BYTES = 12 * 1024 * 1024
const MAX_SCREENSHOT_EDGE = 4_096
const MAX_CONSOLE_ENTRIES = 200
const UX_ISSUE_SCHEME = "pixelcrab-ux-issue:"

const PAGE_REVISION_SCRIPT = `(() => {
  const key = "__pixelcrabPageRevision"
  if (!globalThis[key]) {
    const state = { value: 1, queued: false, suppressed: false }
    const isWorkbenchNode = (node) => node instanceof Element && (
      node.matches("[data-pixelcrab-selection-overlay], [data-pixelcrab-selection-hint], [data-pixelcrab-selection-editor], [data-pixelcrab-ux-issue-layer], [data-pixelcrab-visual-change-layer], [data-pixelcrab-visual-panel]") ||
      Boolean(node.closest("[data-pixelcrab-selection-editor], [data-pixelcrab-ux-issue-layer], [data-pixelcrab-visual-change-layer], [data-pixelcrab-visual-panel]"))
    )
    const observer = new MutationObserver((mutations) => {
      if (state.suppressed) return
      const relevant = mutations.some((mutation) => {
        if (isWorkbenchNode(mutation.target)) return false
        const changed = [...mutation.addedNodes, ...mutation.removedNodes]
        return changed.length === 0 || changed.some((node) => !isWorkbenchNode(node))
      })
      if (!relevant || state.queued) return
      state.queued = true
      queueMicrotask(() => {
        state.value += 1
        state.queued = false
      })
    })
    observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true })
    globalThis[key] = state
  }
  return globalThis[key].value
})()`

function screenshotDataURL(image: Electron.NativeImage) {
  const size = image.getSize()
  const bounded =
    size.width > MAX_SCREENSHOT_EDGE || size.height > MAX_SCREENSHOT_EDGE
      ? image.resize({
          width: Math.min(size.width, MAX_SCREENSHOT_EDGE),
          height: Math.min(size.height, MAX_SCREENSHOT_EDGE),
          quality: "best",
        })
      : image
  const png = bounded.toPNG()
  if (png.byteLength > MAX_SCREENSHOT_BYTES) throw new Error("Preview screenshot exceeds the evidence size limit")
  return `data:image/png;base64,${png.toString("base64")}`
}

export type PreviewPresentationPolicy = {
  probe?(view: WebContentsView, input: { reachable: boolean; adapterId?: string; renderMisses: number }): Promise<{ health: Omit<PixelCrabPreviewHealthState, "url">; renderMisses: number }>
  allowReconnect?(previousReason?: string): boolean
  allowSelectionClick?(adapterId?: string): boolean
}

export class PixelCrabPreviewController {
  readonly #states = new WeakMap<BrowserWindow, PreviewState>()
  readonly #registeredWindows = new WeakSet<BrowserWindow>()

  constructor(private readonly events: PixelCrabPreviewControllerEvents, private readonly policy: PreviewPresentationPolicy = {}) {}

  async #captureRenderState(view: WebContentsView): Promise<PixelCrabPreviewRenderState | undefined> {
    if (view.webContents.isLoading()) return undefined
    return view.webContents
      .executeJavaScriptInIsolatedWorld(ELEMENT_PICKER_WORLD_ID, [
        {
          code: `(() => {
  const body = document.body
  const rect = body?.getBoundingClientRect()
  const visibleRect = (element) => {
    const box = element.getBoundingClientRect()
    const style = getComputedStyle(element)
    return box.width > 0 && box.height > 0 && style.display !== "none" && style.visibility !== "hidden"
  }
  const visibleMedia = body ? Array.from(body.querySelectorAll("canvas, svg, img, video")).some(visibleRect) : false
  const appMounted = Boolean(
    body?.querySelector("#app, [data-app], [data-v-app]") ||
    (body && Array.from(body.children).some(visibleRect))
  )
  const textLength = (body?.innerText || "").trim().length
  const bodyWidth = Math.max(0, Math.round(rect?.width || 0))
  const bodyHeight = Math.max(0, Math.round(rect?.height || 0))
  const hasVisibleContent = bodyHeight > 0 && (textLength > 0 || visibleMedia || appMounted)
  return {
    readyState: document.readyState,
    textLength,
    elementCount: body?.querySelectorAll("*").length || 0,
    body: { width: bodyWidth, height: bodyHeight },
    appMounted,
    hasVisibleContent,
  }
})()`,
        },
      ])
      .catch(() => undefined)
  }

  async #navigation(view: WebContentsView): Promise<PixelCrabPreviewNavigationState> {
    return {
      url: view.webContents.getURL(),
      title: view.webContents.getTitle(),
      loading: view.webContents.isLoading(),
      canGoBack: view.webContents.navigationHistory.canGoBack(),
      canGoForward: view.webContents.navigationHistory.canGoForward(),
      render: await this.#captureRenderState(view),
    }
  }

  async #emitNavigation(win: BrowserWindow, view: WebContentsView) {
    this.events.navigation(win, await this.#navigation(view))
  }

  #scheduleRenderEvidence(win: BrowserWindow, view: WebContentsView) {
    for (const delayMs of [250, 1_000, 2_500, 5_000, 10_000]) {
      setTimeout(() => {
        const current = this.#states.get(win)
        if (!current || current.view !== view || !current.visible || win.isDestroyed() || view.webContents.isDestroyed())
          return
        void this.#emitNavigation(win, view)
      }, delayMs).unref?.()
    }
  }

  #emitHealth(win: BrowserWindow, state: PreviewState, health: PixelCrabPreviewHealthState) {
    const key = `${health.url}:${health.status}:${health.reason ?? "none"}`
    if (key === state.lastHealth) return
    state.lastHealth = key
    state.lastHealthStatus = health.status
    state.lastHealthReason = health.reason
    this.events.health(win, health)
  }

  async #probe(win: BrowserWindow, state: PreviewState, url: string) {
    const endpoint = resolvePixelCrabPreviewEndpoint(url)
    if (!endpoint) return
    const running = await new Promise<boolean>((resolve) => {
      const socket = createConnection(endpoint)
      let settled = false
      const finish = (value: boolean) => {
        if (settled) return
        settled = true
        socket.destroy()
        resolve(value)
      }
      socket.setTimeout(1_500)
      socket.once("connect", () => finish(true))
      socket.once("error", () => finish(false))
      socket.once("timeout", () => finish(false))
    })
    if (!state.visible || state.url !== url || win.isDestroyed()) return
    const probe = this.policy.probe
      ? await this.policy.probe(state.view, { reachable: running, adapterId: state.adapterId, renderMisses: state.renderMisses })
      : { health: running ? { status: "running" as const } : { status: "unavailable" as const, reason: "endpoint_unreachable" }, renderMisses: 0 }
    state.renderMisses = probe.renderMisses
    const health = probe.health
    const reconnect = state.lastHealthStatus === "unavailable" && health.status === "running" && (this.policy.allowReconnect?.(state.lastHealthReason) ?? true)
    this.#emitHealth(win, state, { url, ...health })
    if (health.status === "running") void this.#emitNavigation(win, state.view)
    if (reconnect) {
      await state.view.webContents.loadURL(url).catch((error) => {
        if (!isPixelCrabPreviewNavigationCancelled(error)) console.warn("PixelCrab preview reconnect failed", error)
      })
    }
  }

  #startHealth(win: BrowserWindow, state: PreviewState, url: string) {
    if (state.url === url && state.healthTimer) return
    if (state.healthTimer) clearInterval(state.healthTimer)
    state.url = url
    state.lastHealth = undefined
    state.lastHealthStatus = undefined
    state.lastHealthReason = undefined
    state.renderMisses = 0
    this.#emitHealth(win, state, { url, status: "connecting" })
    void this.#probe(win, state, url)
    state.healthTimer = setInterval(() => void this.#probe(win, state, url), 3_000)
    state.healthTimer.unref()
  }

  #stopHealth(state: PreviewState) {
    if (state.healthTimer) clearInterval(state.healthTimer)
    state.healthTimer = undefined
  }

  async #renderUXIssues(state: PreviewState) {
    const issues = state.uxIssues
      .filter((issue) => matchesPixelCrabPreviewRoute(state.view.webContents.getURL(), issue.route))
      .filter((issue) => issue.boundingBox)
      .map((issue) => ({
        issueId: issue.issueId,
        title: issue.title,
        description: issue.description,
        suggestion: issue.suggestion,
        severity: issue.severity,
        fixability: issue.fixability,
        boundingBox: issue.boundingBox,
      }))
    await state.view.webContents.executeJavaScriptInIsolatedWorld(
      ELEMENT_PICKER_WORLD_ID,
      [
        {
          code: `(() => {
            const key = "__pixelcrabUXIssueLayer"
            document.querySelector("[data-pixelcrab-ux-issue-layer]")?.remove()
            if (${JSON.stringify(issues)}.length === 0) {
              delete globalThis[key]
              return
            }
            const issues = ${JSON.stringify(issues)}
            const root = document.createElement("div")
            root.setAttribute("data-pixelcrab-ux-issue-layer", "")
            Object.assign(root.style, {
              position: "fixed",
              inset: "0",
              zIndex: "2147483644",
              pointerEvents: "none",
            })
            const colors = {
              critical: { solid: "#dc2626", soft: "rgba(220, 38, 38, 0.12)" },
              warning: { solid: "#ea580c", soft: "rgba(234, 88, 12, 0.12)" },
              suggestion: { solid: "#ca8a04", soft: "rgba(202, 138, 4, 0.12)" },
            }
            let openCard
            const closeCard = () => {
              openCard?.remove()
              openCard = undefined
            }
            issues.forEach((issue, index) => {
              const rect = issue.boundingBox
              const color = colors[issue.severity] || colors.warning
              const outline = document.createElement("div")
              Object.assign(outline.style, {
                position: "fixed",
                left: rect.x + "px",
                top: rect.y + "px",
                width: rect.width + "px",
                height: rect.height + "px",
                boxSizing: "border-box",
                border: "2px solid " + color.solid,
                background: color.soft,
                pointerEvents: "none",
              })
              const marker = document.createElement("button")
              marker.type = "button"
              marker.textContent = String(index + 1)
              marker.title = issue.title
              marker.setAttribute("aria-label", issue.title)
              Object.assign(marker.style, {
                position: "fixed",
                left: Math.max(6, Math.min(window.innerWidth - 30, rect.x + rect.width - 12)) + "px",
                top: Math.max(6, Math.min(window.innerHeight - 30, rect.y - 12)) + "px",
                width: "24px",
                height: "24px",
                padding: "0",
                border: "2px solid #fff",
                borderRadius: "999px",
                background: color.solid,
                color: "#fff",
                boxShadow: "0 4px 14px rgba(15, 23, 42, 0.28)",
                font: "700 11px/20px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
                cursor: "pointer",
                pointerEvents: "auto",
              })
              marker.addEventListener("click", (event) => {
                event.preventDefault()
                event.stopPropagation()
                closeCard()
                const card = document.createElement("section")
                openCard = card
                Object.assign(card.style, {
                  position: "fixed",
                  left: Math.max(12, Math.min(window.innerWidth - 332, rect.x)) + "px",
                  top: Math.max(12, Math.min(window.innerHeight - 220, rect.y + rect.height + 12)) + "px",
                  width: "320px",
                  maxHeight: "208px",
                  overflow: "auto",
                  boxSizing: "border-box",
                  padding: "12px",
                  border: "1px solid rgba(24, 24, 27, 0.14)",
                  borderRadius: "12px",
                  background: "#fff",
                  color: "#18181b",
                  boxShadow: "0 18px 50px rgba(15, 23, 42, 0.30)",
                  pointerEvents: "auto",
                  font: "13px/1.45 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
                })
                const title = document.createElement("strong")
                title.textContent = issue.title
                title.style.display = "block"
                const description = document.createElement("p")
                description.textContent = issue.description
                Object.assign(description.style, { margin: "7px 0", color: "#52525b" })
                const action = document.createElement("button")
                action.type = "button"
                action.textContent = document.documentElement.lang.toLowerCase().startsWith("zh")
                  ? "转入修复"
                  : "Fix with AI"
                Object.assign(action.style, {
                  height: "30px",
                  padding: "0 11px",
                  border: "1px solid #18181b",
                  borderRadius: "8px",
                  background: "#18181b",
                  color: "#fff",
                  cursor: "pointer",
                  float: "right",
                })
                action.addEventListener("click", () => window.open(${JSON.stringify(UX_ISSUE_SCHEME)} + encodeURIComponent(issue.issueId)))
                card.append(title, description)
                if (issue.suggestion) {
                  const suggestion = document.createElement("p")
                  suggestion.textContent = issue.suggestion
                  Object.assign(suggestion.style, { margin: "0 0 9px", color: "#3f3f46" })
                  card.append(suggestion)
                }
                if (issue.fixability !== "not_fixable") card.append(action)
                root.append(card)
              })
              root.append(outline, marker)
            })
            document.documentElement.appendChild(root)
            globalThis[key] = { remove: () => root.remove() }
          })()`,
        },
      ],
      true,
    )
  }

  async #beginElementSelection(win: BrowserWindow, state: PreviewState) {
    if (state.captureInProgress || state.selectionMode === "interact" || !state.visible) return
    // Each picker owns its cancellation; overlapping starts must not rearm one another.
    const run = ++state.selectionRun
    const selectionMode = state.selectionMode
    const regionMode = selectionMode === "region"
    const visualMode = selectionMode === "visual"
    const nativeInspector = Boolean(this.policy.allowSelectionClick?.(state.adapterId)) && !regionMode && !visualMode
    const script = `(() => {
      const regionMode = ${regionMode}
      const visualMode = ${visualMode}
      const nativeInspector = ${nativeInspector}
      const resolveSelectionRectangle = ${resolvePixelCrabSelectionRectangle.toString()}
      const key = "__pixelcrabElementSelection"
      window[key]?.cancel?.()
      return new Promise((resolve) => {
        const overlay = document.createElement("div")
        overlay.setAttribute("data-pixelcrab-selection-overlay", "")
        Object.assign(overlay.style, {
          position: "fixed",
          pointerEvents: "none",
          zIndex: "2147483645",
          border: "2px solid #2563eb",
          background: "rgba(37, 99, 235, 0.10)",
          boxSizing: "border-box",
          display: "none",
        })
        document.documentElement.appendChild(overlay)
        const chinese = (document.documentElement.lang || navigator.language || "").toLowerCase().startsWith("zh")
        const hint = document.createElement("div")
        hint.setAttribute("data-pixelcrab-selection-hint", "")
        hint.textContent = regionMode
          ? (chinese ? "拖拽框选需要修改的区域 · Esc 取消" : "Drag to select a region · Esc to cancel")
          : visualMode
            ? (chinese ? "点击元素并直接调整样式 · Esc 取消" : "Click an element to adjust its styles · Esc to cancel")
          : (chinese ? "点击需要修改的元素 · Esc 取消" : "Click an element to modify · Esc to cancel")
        Object.assign(hint.style, {
          position: "fixed",
          zIndex: "2147483647",
          top: "12px",
          left: "50%",
          transform: "translateX(-50%)",
          maxWidth: "calc(100vw - 24px)",
          boxSizing: "border-box",
          padding: "8px 12px",
          border: "1px solid rgba(255, 255, 255, 0.30)",
          borderRadius: "999px",
          background: "#2563eb",
          color: "#ffffff",
          boxShadow: "0 8px 24px rgba(15, 23, 42, 0.26)",
          font: "600 12px/1.4 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          pointerEvents: "none",
        })
        document.documentElement.appendChild(hint)
        let target
        let editor
        let dragStart
        let selectionRect
        let activePointerId
        let pointerCaptureTarget
        let restoreVisualPreview
        const selector = (element) => {
          if (element.id) return "#" + CSS.escape(element.id)
          const parts = []
          let current = element
          while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.documentElement) {
            let part = current.tagName.toLowerCase()
            const parent = current.parentElement
            if (parent) {
              const siblings = Array.from(parent.children).filter((item) => item.tagName === current.tagName)
              if (siblings.length > 1) part += ":nth-of-type(" + (siblings.indexOf(current) + 1) + ")"
            }
            parts.unshift(part)
            current = parent
          }
          return parts.join(" > ")
        }
        const position = (element, rectOverride) => {
          const rect = rectOverride || element.getBoundingClientRect()
          Object.assign(overlay.style, {
            display: "block",
            left: rect.left + "px",
            top: rect.top + "px",
            width: rect.width + "px",
            height: rect.height + "px",
          })
        }
        const move = (event) => {
          if (!dragStart && event.target instanceof Element && event.target.closest("[data-pixelcrab-visual-panel]")) return
          if (activePointerId !== undefined && "pointerId" in event && event.pointerId !== activePointerId) return
          if (regionMode && dragStart) {
            const left = Math.min(dragStart.x, event.clientX)
            const top = Math.min(dragStart.y, event.clientY)
            selectionRect = {
              x: left,
              y: top,
              width: Math.abs(event.clientX - dragStart.x),
              height: Math.abs(event.clientY - dragStart.y),
            }
            Object.assign(overlay.style, {
              display: "block",
              left: selectionRect.x + "px",
              top: selectionRect.y + "px",
              width: selectionRect.width + "px",
              height: selectionRect.height + "px",
            })
            return
          }
          if (regionMode || (event.target instanceof Element && event.target.closest("[data-pixelcrab-visual-panel]"))) return
          const element = event.target instanceof Element ? event.target : undefined
          if (!element || element === overlay) return
          target = element
          position(element)
        }
        const positionEditor = (element, rectOverride) => {
          if (!editor) return
          const rect = rectOverride || element.getBoundingClientRect()
          const popup = editor.getBoundingClientRect()
          const margin = 12
          const { left: rectLeft, top: rectTop, bottom: rectBottom } = resolveSelectionRectangle(rect)
          const left = Math.min(
            Math.max(margin, rectLeft),
            Math.max(margin, window.innerWidth - popup.width - margin),
          )
          const below = rectBottom + margin
          const top = below + popup.height <= window.innerHeight - margin
            ? below
            : Math.max(margin, rectTop - popup.height - margin)
          Object.assign(editor.style, { left: left + "px", top: top + "px" })
        }
        const cleanup = () => {
          document.removeEventListener("mousemove", move, true)
          document.removeEventListener("pointermove", move, true)
          document.removeEventListener("click", click, true)
          document.removeEventListener("mousedown", regionStart, true)
          document.removeEventListener("mouseup", regionEnd, true)
          document.removeEventListener("pointerdown", regionStart, true)
          document.removeEventListener("pointerup", regionEnd, true)
          document.removeEventListener("pointercancel", regionEnd, true)
          document.removeEventListener("keydown", keydown, true)
          window.removeEventListener("resize", reposition, true)
          window.removeEventListener("scroll", reposition, true)
          editor?.remove()
          hint.remove()
          overlay.remove()
          delete window[key]
        }
        const cancel = () => {
          restoreVisualPreview?.()
          cleanup()
          resolve(null)
        }
        const keydown = (event) => {
          if (event.key !== "Escape") return
          event.preventDefault()
          cancel()
        }
        const reposition = () => {
          if (!target) return
          position(target, selectionRect)
          positionEditor(target, selectionRect)
        }
        const showEditor = (element, result, rectOverride) => {
          hint.remove()
          editor = document.createElement("form")
          editor.setAttribute("data-pixelcrab-selection-editor", "")
          Object.assign(editor.style, {
            position: "fixed",
            zIndex: "2147483647",
            width: "min(360px, calc(100vw - 24px))",
            maxHeight: "calc(100vh - 24px)",
            overflow: "auto",
            boxSizing: "border-box",
            padding: "12px",
            border: "1px solid rgba(37, 99, 235, 0.48)",
            borderRadius: "12px",
            background: "#ffffff",
            color: "#18181b",
            boxShadow: "0 18px 50px rgba(15, 23, 42, 0.30), 0 0 0 3px rgba(37, 99, 235, 0.10)",
            font: "13px/1.45 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          })
          const heading = document.createElement("div")
          heading.textContent = regionMode
            ? (chinese ? "已框选区域" : "Region selected")
            : visualMode
              ? (chinese ? "视觉修改" : "Visual change")
            : (chinese ? "已选择元素" : "Element selected")
          Object.assign(heading.style, {
            display: "flex",
            alignItems: "center",
            gap: "7px",
            marginBottom: "9px",
            color: "#18181b",
            fontWeight: "650",
          })
          const marker = document.createElement("span")
          Object.assign(marker.style, {
            display: "inline-block",
            width: "8px",
            height: "8px",
            flex: "0 0 auto",
            borderRadius: "999px",
            background: "#2563eb",
            boxShadow: "0 0 0 3px rgba(37, 99, 235, 0.14)",
          })
          heading.prepend(marker)
          const textarea = document.createElement("textarea")
          textarea.placeholder = regionMode
            ? (chinese ? "描述这个区域需要如何修改…" : "Describe how this region should change…")
            : (chinese ? "描述这个元素需要如何修改…" : "Describe how this element should change…")
          textarea.setAttribute("aria-label", textarea.placeholder)
          Object.assign(textarea.style, {
            display: "block",
            width: "100%",
            minHeight: "76px",
            resize: "vertical",
            boxSizing: "border-box",
            padding: "9px 10px",
            border: "1px solid #d4d4d8",
            borderRadius: "8px",
            outline: "none",
            background: "#ffffff",
            color: "#18181b",
            font: "inherit",
          })
          const visualInputs = {}
          if (visualMode) {
            textarea.placeholder = chinese ? "补充修改说明（可选）…" : "Optional change instructions…"
            textarea.style.minHeight = "58px"
            const fields = [
              ["textContent", chinese ? "文字" : "Text", result.textContent || ""],
              ["color", chinese ? "文字颜色" : "Text color", result.computedStyles["color"] || ""],
              ["background-color", chinese ? "背景颜色" : "Background", result.computedStyles["background-color"] || ""],
              ["font-size", chinese ? "字号" : "Font size", result.computedStyles["font-size"] || ""],
              ["border-radius", chinese ? "圆角" : "Corner radius", result.computedStyles["border-radius"] || ""],
            ]
            const originalText = element.textContent || ""
            const leafText = element.childElementCount === 0
            const originalStyles = Object.fromEntries(fields.slice(1).map(([name]) => [name, {
              value: element.style.getPropertyValue(name),
              priority: element.style.getPropertyPriority(name),
            }]))
            restoreVisualPreview = () => {
              globalThis.__pixelcrabPageRevision && (globalThis.__pixelcrabPageRevision.suppressed = true)
              if (leafText) element.textContent = originalText
              Object.entries(originalStyles).forEach(([name, original]) => {
                if (original.value) element.style.setProperty(name, original.value, original.priority)
                else element.style.removeProperty(name)
              })
              queueMicrotask(() => globalThis.__pixelcrabPageRevision && (globalThis.__pixelcrabPageRevision.suppressed = false))
            }
            const grid = document.createElement("div")
            Object.assign(grid.style, { display: "grid", gridTemplateColumns: "92px 1fr", gap: "8px", marginBottom: "10px", alignItems: "center" })
            const toHexColor = (value) => {
              const trimmed = (value || "").trim()
              const short = trimmed.match(/^#([0-9a-f]{3})$/i)
              if (short) return "#" + short[1].split("").map((part) => part + part).join("").toLowerCase()
              const hex = trimmed.match(/^#([0-9a-f]{6})$/i)
              if (hex) return "#" + hex[1].toLowerCase()
              const rgb = trimmed.match(/^rgba?\\(\\s*(\\d{1,3})\\s*,\\s*(\\d{1,3})\\s*,\\s*(\\d{1,3})(?:\\s*,\\s*(?:0|1|0?\\.\\d+))?\\s*\\)$/i)
              if (!rgb) return ""
              const alpha = trimmed.match(/^rgba\\([^)]*,\\s*(0|0?\\.\\d+)\\s*\\)$/i)
              if (alpha && Number(alpha[1]) <= 0) return ""
              const parts = rgb.slice(1, 4).map((part) => Math.max(0, Math.min(255, Number(part))))
              return "#" + parts.map((part) => part.toString(16).padStart(2, "0")).join("")
            }
            const isColorField = (name) => name === "color" || name.endsWith("-color")
            const numericField = (name) => {
              if (name === "font-size") return { min: 8, max: 72, step: 1, fallback: 16, unit: "px" }
              if (name === "border-radius") return { min: 0, max: 48, step: 1, fallback: 0, unit: "px" }
              return undefined
            }
            const numericValue = (value, fallback) => {
              const parsed = Number.parseFloat((value || "").trim())
              return Number.isFinite(parsed) ? parsed : fallback
            }
            fields.forEach(([name, label, value]) => {
              const caption = document.createElement("label")
              caption.textContent = label
              caption.style.color = "#52525b"
              const input = document.createElement("input")
              const initialHex = isColorField(name) ? toHexColor(value) : ""
              input.value = initialHex || value
              input.disabled = name === "textContent" && !leafText
              input.title = input.disabled ? (chinese ? "包含子元素的内容请交给 AI 修改" : "Content with child elements should be changed by AI") : ""
              Object.assign(input.style, { width: "100%", height: "30px", boxSizing: "border-box", padding: "0 8px", border: "1px solid #d4d4d8", borderRadius: "7px", background: input.disabled ? "#f4f4f5" : "#fff", color: "#18181b", font: "inherit" })
              input.addEventListener("input", () => {
                if (input.disabled) return
                globalThis.__pixelcrabPageRevision && (globalThis.__pixelcrabPageRevision.suppressed = true)
                if (name === "textContent") element.textContent = input.value
                else if (input.value.trim()) element.style.setProperty(name, input.value.trim())
                else element.style.removeProperty(name)
                position(element)
                positionEditor(element, rectOverride)
                queueMicrotask(() => globalThis.__pixelcrabPageRevision && (globalThis.__pixelcrabPageRevision.suppressed = false))
              })
              let field = input
              if (isColorField(name)) {
                const wrapper = document.createElement("div")
                Object.assign(wrapper.style, { display: "grid", gridTemplateColumns: "1fr 30px", gap: "6px", alignItems: "center" })
                const picker = document.createElement("input")
                picker.type = "color"
                picker.value = initialHex || "#000000"
                picker.title = chinese ? "选择颜色" : "Choose color"
                picker.setAttribute("aria-label", picker.title)
                Object.assign(picker.style, { width: "30px", height: "30px", padding: "0", border: "1px solid #d4d4d8", borderRadius: "7px", background: "transparent", cursor: "pointer" })
                picker.addEventListener("input", () => {
                  input.value = picker.value
                  input.dispatchEvent(new Event("input", { bubbles: true }))
                })
                input.addEventListener("input", () => {
                  const next = toHexColor(input.value)
                  if (next) picker.value = next
                })
                wrapper.append(input, picker)
                field = wrapper
              }
              const numeric = numericField(name)
              if (numeric) {
                const wrapper = document.createElement("div")
                Object.assign(wrapper.style, { display: "grid", gridTemplateColumns: "30px 1fr 30px", gridTemplateRows: "30px 24px", gap: "6px", alignItems: "center" })
                const minus = document.createElement("button")
                const plus = document.createElement("button")
                const range = document.createElement("input")
                minus.type = "button"
                plus.type = "button"
                minus.textContent = "−"
                plus.textContent = "+"
                minus.title = chinese ? "减小" : "Decrease"
                plus.title = chinese ? "增大" : "Increase"
                range.type = "range"
                range.min = String(numeric.min)
                range.max = String(numeric.max)
                range.step = String(numeric.step)
                range.value = String(Math.max(numeric.min, Math.min(numeric.max, numericValue(input.value, numeric.fallback))))
                Object.assign(minus.style, { width: "30px", height: "30px", padding: "0", border: "1px solid #d4d4d8", borderRadius: "7px", background: "#fff", color: "#18181b", font: "inherit", cursor: "pointer" })
                Object.assign(plus.style, { width: "30px", height: "30px", padding: "0", border: "1px solid #d4d4d8", borderRadius: "7px", background: "#fff", color: "#18181b", font: "inherit", cursor: "pointer" })
                Object.assign(range.style, { gridColumn: "1 / span 3", width: "100%", height: "20px", margin: "0", accentColor: "#2563eb" })
                const setNumeric = (next) => {
                  const bounded = Math.max(numeric.min, Math.min(numeric.max, next))
                  input.value = String(bounded) + numeric.unit
                  range.value = String(bounded)
                  input.dispatchEvent(new Event("input", { bubbles: true }))
                }
                minus.addEventListener("click", () => setNumeric(numericValue(input.value, numeric.fallback) - numeric.step))
                plus.addEventListener("click", () => setNumeric(numericValue(input.value, numeric.fallback) + numeric.step))
                range.addEventListener("input", () => setNumeric(Number(range.value)))
                input.addEventListener("input", () => {
                  const next = numericValue(input.value, Number(range.value))
                  if (Number.isFinite(next)) range.value = String(Math.max(numeric.min, Math.min(numeric.max, next)))
                })
                wrapper.append(minus, input, plus, range)
                field = wrapper
              }
              visualInputs[name] = input
              grid.append(caption, field)
            })
            editor.append(heading, grid, textarea)
          }
          const footer = document.createElement("div")
          Object.assign(footer.style, {
            display: "flex",
            alignItems: "center",
            gap: "8px",
            marginTop: "10px",
          })
          const summary = document.createElement("span")
          summary.textContent = result.domSnapshot.tagName + (result.domSnapshot.id ? "#" + result.domSnapshot.id : "")
          Object.assign(summary.style, {
            minWidth: "0",
            flex: "1",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            opacity: "0.62",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: "11px",
          })
          const makeButton = (label, primary) => {
            const button = document.createElement("button")
            button.type = primary ? "submit" : "button"
            button.textContent = label
            Object.assign(button.style, {
              height: "30px",
              padding: "0 11px",
              border: primary ? "1px solid #18181b" : "1px solid #d4d4d8",
              borderRadius: "8px",
              background: primary ? "#18181b" : "#ffffff",
              color: primary ? "#fff" : "#18181b",
              font: "inherit",
              cursor: "pointer",
            })
            return button
          }
          const cancelButton = makeButton(chinese ? "取消" : "Cancel", false)
          const submitButton = makeButton(visualMode ? (chinese ? "保存为修改" : "Save change") : (chinese ? "添加到对话" : "Add to chat"), true)
          cancelButton.addEventListener("click", cancel)
          editor.addEventListener("click", (event) => event.stopPropagation())
          editor.addEventListener("submit", (event) => {
            event.preventDefault()
            const userRequest = textarea.value.trim()
            const styles = visualMode ? Object.fromEntries(Object.entries(visualInputs)
              .filter(([name, input]) => name !== "textContent" && input.value.trim() !== (result.computedStyles[name] || "").trim())
              .map(([name, input]) => [name, input.value.trim()])) : {}
            const textContent = visualMode && visualInputs.textContent && !visualInputs.textContent.disabled && visualInputs.textContent.value !== (result.textContent || "")
              ? visualInputs.textContent.value
              : undefined
            if (visualMode && textContent === undefined && Object.keys(styles).length === 0) return
            restoreVisualPreview?.()
            cleanup()
            resolve(visualMode
              ? { ...result, userRequest: userRequest || (chinese ? "应用已标记的视觉修改" : "Apply the marked visual change"), visualChange: { textContent, styles, description: userRequest || undefined } }
              : { ...result, userRequest })
          })
          textarea.addEventListener("keydown", (event) => {
            if (event.key === "Escape") {
              event.preventDefault()
              cancel()
              return
            }
            if (event.key !== "Enter" || event.shiftKey) return
            event.preventDefault()
            editor.requestSubmit()
          })
          footer.append(summary, cancelButton, submitButton)
          if (!visualMode) editor.append(heading, textarea)
          editor.append(footer)
          document.documentElement.appendChild(editor)
          positionEditor(element, rectOverride)
          window.addEventListener("resize", reposition, true)
          window.addEventListener("scroll", reposition, true)
          textarea.focus()
        }
        const styleProperties = [
          "display", "position", "color", "background-color", "font-family", "font-size", "font-weight",
          "line-height", "text-align", "border", "border-radius", "padding", "margin", "width", "height",
          "gap", "grid-template-columns", "align-items", "justify-content", "overflow"
        ]
        const normalizeText = (value) => (value || "").trim().replace(/\\s+/g, " ")
        const readStyles = (element) => {
          const style = getComputedStyle(element)
          return Object.fromEntries(styleProperties.map((name) => [name, style.getPropertyValue(name)]))
        }
        const intersects = (a, b) => {
          const right = Math.min(a.x + a.width, b.x + b.width)
          const left = Math.max(a.x, b.x)
          const bottom = Math.min(a.y + a.height, b.y + b.height)
          const top = Math.max(a.y, b.y)
          return right - left >= 1 && bottom - top >= 1
        }
        const isWorkbenchNode = (node) => node instanceof Element && (
          node.matches("[data-pixelcrab-selection-overlay], [data-pixelcrab-selection-hint], [data-pixelcrab-selection-editor], [data-pixelcrab-ux-issue-layer], [data-pixelcrab-visual-change-layer], [data-pixelcrab-visual-panel]") ||
          Boolean(node.closest("[data-pixelcrab-selection-editor], [data-pixelcrab-ux-issue-layer], [data-pixelcrab-visual-change-layer], [data-pixelcrab-visual-panel]"))
        )
        const cleanText = (element) => {
          const clone = element.cloneNode(true)
          if (clone instanceof Element) {
            clone.querySelectorAll("[data-pixelcrab-selection-overlay], [data-pixelcrab-selection-hint], [data-pixelcrab-selection-editor], [data-pixelcrab-ux-issue-layer], [data-pixelcrab-visual-change-layer], [data-pixelcrab-visual-panel]").forEach((node) => node.remove())
          }
          return normalizeText(clone.textContent)
        }
        const buildRegionFingerprint = (bounds) => {
          if (!bounds) return undefined
          const elements = Array.from(document.querySelectorAll("body *"))
            .filter((candidate) => candidate instanceof HTMLElement)
            .filter((candidate) => {
              if (isWorkbenchNode(candidate)) return false
              const rect = candidate.getBoundingClientRect()
              if (rect.width < 1 || rect.height < 1) return false
              return intersects(bounds, { x: rect.x, y: rect.y, width: rect.width, height: rect.height })
            })
            .slice(0, 32)
            .map((candidate) => ({
              selector: selector(candidate),
              tagName: candidate.tagName.toLowerCase(),
              textContent: cleanText(candidate).slice(0, 160) || undefined,
              computedStyles: readStyles(candidate),
            }))
          return {
            textContent: normalizeText(elements.map((item) => item.textContent || "").join(" ")).slice(0, 2_000) || undefined,
            elements,
          }
        }
        const buildResult = (element, selectedBounds) => {
          const rect = element.getBoundingClientRect()
          const sensitive = /password|secret|token|auth|cookie|session|value/i
          const attributes = Object.fromEntries(Array.from(element.attributes)
            .filter((item) => !sensitive.test(item.name) && !sensitive.test(item.value))
            .slice(0, 64)
            .map((item) => [item.name, item.value]))
          return {
            viewport: {
              width: window.innerWidth,
              height: window.innerHeight,
              deviceScaleFactor: window.devicePixelRatio,
              scrollX: window.scrollX,
              scrollY: window.scrollY,
            },
            boundingBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            selectionBounds: selectedBounds,
            domSelector: selector(element),
            domSnapshot: {
              tagName: element.tagName.toLowerCase(),
              id: element.id || undefined,
              classNames: Array.from(element.classList),
              attributes,
            },
            computedStyles: readStyles(element),
            textContent: cleanText(element) || undefined,
            regionFingerprint: buildRegionFingerprint(selectedBounds),
            pageRevision: globalThis.__pixelcrabPageRevision?.value || 1,
          }
        }
        const click = (event) => {
          if (regionMode || (event.target instanceof Element && event.target.closest("[data-pixelcrab-visual-panel]"))) return
          const element = event.target instanceof Element ? event.target : target
          if (!element || element === overlay || editor?.contains(element)) return
          if (!nativeInspector) {
            event.preventDefault()
            event.stopImmediatePropagation()
          }
          const result = buildResult(element)
          document.removeEventListener("mousemove", move, true)
          document.removeEventListener("click", click, true)
          target = element
          position(element)
          showEditor(element, result)
        }
        const regionStart = (event) => {
          if (!regionMode || editor || dragStart || event.button !== 0 || (event.target instanceof Element && event.target.closest("[data-pixelcrab-visual-panel]"))) return
          if ("isPrimary" in event && !event.isPrimary) return
          event.preventDefault()
          event.stopImmediatePropagation()
          dragStart = { x: event.clientX, y: event.clientY }
          selectionRect = { x: event.clientX, y: event.clientY, width: 0, height: 0 }
          if ("pointerId" in event) {
            activePointerId = event.pointerId
            const captureTarget = event.target
            if (captureTarget instanceof Element && "setPointerCapture" in captureTarget) {
              try {
                captureTarget.setPointerCapture(event.pointerId)
                pointerCaptureTarget = captureTarget
              } catch {}
            }
          }
        }
        const regionEnd = (event) => {
          if (!regionMode || !dragStart || editor) return
          if (activePointerId !== undefined && "pointerId" in event && event.pointerId !== activePointerId) return
          event.preventDefault()
          event.stopImmediatePropagation()
          const rect = selectionRect
          dragStart = undefined
          if (activePointerId !== undefined && pointerCaptureTarget) {
            try {
              pointerCaptureTarget.releasePointerCapture(activePointerId)
            } catch {}
          }
          activePointerId = undefined
          pointerCaptureTarget = undefined
          if (!rect || rect.width < 4 || rect.height < 4) {
            overlay.style.display = "none"
            selectionRect = undefined
            return
          }
          const centerX = Math.min(window.innerWidth - 1, Math.max(0, rect.x + rect.width / 2))
          const centerY = Math.min(window.innerHeight - 1, Math.max(0, rect.y + rect.height / 2))
          const element = document.elementFromPoint(centerX, centerY)
          if (!(element instanceof Element) || element === overlay) return cancel()
          target = element
          const result = buildResult(element, rect)
          document.removeEventListener("mousemove", move, true)
          document.removeEventListener("pointermove", move, true)
          document.removeEventListener("mousedown", regionStart, true)
          document.removeEventListener("mouseup", regionEnd, true)
          document.removeEventListener("pointerdown", regionStart, true)
          document.removeEventListener("pointerup", regionEnd, true)
          document.removeEventListener("pointercancel", regionEnd, true)
          position(element, rect)
          showEditor(element, result, rect)
        }
        document.addEventListener("mousemove", move, true)
        document.addEventListener("pointermove", move, true)
        if (regionMode) {
          document.addEventListener("mousedown", regionStart, true)
          document.addEventListener("mouseup", regionEnd, true)
          document.addEventListener("pointerdown", regionStart, true)
          document.addEventListener("pointerup", regionEnd, true)
          document.addEventListener("pointercancel", regionEnd, true)
        } else {
          document.addEventListener("click", click, true)
        }
        document.addEventListener("keydown", keydown, true)
        window[key] = { cancel }
      })
    })()`
    let selection: ElementSelection | null
    try {
      selection = (await state.view.webContents.executeJavaScriptInIsolatedWorld(
        ELEMENT_PICKER_WORLD_ID,
        [{ code: script }],
        true,
      )) as ElementSelection | null
    } catch {
      return
    }
    if (run !== state.selectionRun || state.selectionMode !== selectionMode || win.isDestroyed()) return
    if (!selection) {
      queueMicrotask(() => {
        if (run === state.selectionRun) void this.#beginElementSelection(win, state)
      })
      return
    }
    const source = selectionMode === "region" ? "selected_region" : "selected_element"
    selection.domSelector = normalizePixelCrabElementSelector(selection.domSelector)
    selection.domSnapshot.attributes = normalizePixelCrabElementAttributes(selection.domSnapshot.attributes)
    selection.textContent = normalizePixelCrabElementText(selection.textContent) || undefined
    const sourceCandidate = resolvePixelCrabInspectorSourceCandidate(selection.domSnapshot.attributes["data-insp-path"])
    state.captureInProgress = true
    const captureToken = randomUUID()
    try {
      await state.view.webContents.executeJavaScriptInIsolatedWorld(ELEMENT_PICKER_WORLD_ID, [{ code: `(() => {
        (globalThis.__pixelcrabCaptureTokens ??= new Set()).add(${JSON.stringify(captureToken)})
        const panel = globalThis.__pixelcrabVisualPanel
        if (panel) panel.host.style.visibility = "hidden"
      })()` }])
      const box = selection.selectionBounds ?? selection.boundingBox
      const clip = {
        x: Math.max(0, Math.floor(box.x)),
        y: Math.max(0, Math.floor(box.y)),
        width: Math.max(1, Math.ceil(Math.min(box.width, selection.viewport.width - Math.max(0, box.x)))),
        height: Math.max(1, Math.ceil(Math.min(box.height, selection.viewport.height - Math.max(0, box.y)))),
      }
      const screenshots = await capturePixelCrabEvidenceScreenshots(
        (bounds) => state.view.webContents.capturePage(bounds),
        screenshotDataURL,
        clip,
      )
      if (run !== state.selectionRun || state.selectionMode !== selectionMode || win.isDestroyed()) return
      this.events.evidence(win, {
        ...selection,
        evidenceId: `evidence-${randomUUID()}`,
        runtimeId: state.runtimeId,
        projectId: state.projectId,
        capturedAt: new Date().toISOString(),
        pageRevision: selection.pageRevision,
        status: "active",
        source,
        route: state.view.webContents.getURL(),
        ...screenshots,
        sourceCandidates: sourceCandidate ? [sourceCandidate] : [],
        captureLevel: sourceCandidate ? "L2_partial" : "L1_visual",
      })
    } catch (error) {
      if (run !== state.selectionRun || win.isDestroyed()) return
      this.events.failed(win, {
        url: state.view.webContents.getURL(),
        errorCode: 0,
        errorDescription: sanitizePixelCrabPreviewError(
          error instanceof Error ? error.message : "Evidence capture failed",
        ),
        kind: "unknown",
      })
    } finally {
      if (!state.view.webContents.isDestroyed()) await state.view.webContents.executeJavaScriptInIsolatedWorld(ELEMENT_PICKER_WORLD_ID, [{ code: `(() => {
        globalThis.__pixelcrabCaptureTokens?.delete(${JSON.stringify(captureToken)})
        const panel = globalThis.__pixelcrabVisualPanel
        if (panel) panel.host.style.visibility = globalThis.__pixelcrabCaptureTokens?.size ? "hidden" : "visible"
      })()` }]).catch(() => undefined)
      if (run === state.selectionRun && state.selectionMode === selectionMode && !win.isDestroyed()) {
        state.captureInProgress = false
        queueMicrotask(() => {
          if (run === state.selectionRun) void this.#beginElementSelection(win, state)
        })
      }
    }
  }

  async setSelectionMode(win: BrowserWindow, mode: PixelCrabPreviewSelectionMode) {
    const state = this.#states.get(win)
    if (!state) return
    state.selectionRun += 1
    const run = state.selectionRun
    state.captureInProgress = false
    state.selectionMode = mode
    await state.view.webContents
      .executeJavaScriptInIsolatedWorld(ELEMENT_PICKER_WORLD_ID, [
        { code: "globalThis.__pixelcrabCaptureTokens?.clear(); if (globalThis.__pixelcrabVisualPanel) globalThis.__pixelcrabVisualPanel.host.style.visibility = 'visible'; globalThis.__pixelcrabElementSelection?.cancel?.()" },
      ])
      .catch(() => undefined)
    if (run !== state.selectionRun || mode === "interact" || win.isDestroyed()) return
    void this.#beginElementSelection(win, state)
  }

  async recheck(win: BrowserWindow, input: PixelCrabPreviewRecheckInput): Promise<PixelCrabPreviewRecheckResult> {
    const state = this.#states.get(win)
    if (!state?.visible) throw new Error("PixelCrab preview is not visible")
    const selector = normalizePixelCrabElementSelector(input.domSelector)
    const activeRoute = state.view.webContents.getURL()
    if (!matchesPixelCrabEvidenceRoute(activeRoute, input.route)) {
      return {
        evidenceId: input.evidenceId,
        parentEvidenceId: input.evidenceId,
        pageRevision: input.pageRevision,
        route: activeRoute,
        domSelector: selector,
        capturedAt: new Date().toISOString(),
        status: "missing",
        lifecycleStatus: "stale",
        changes: {
          boundingBox: false,
          textContent: false,
          regionScreenshot: false,
          regionFingerprint: false,
          computedStyles: [],
        },
      }
    }
    const current = (await state.view.webContents.executeJavaScriptInIsolatedWorld(
      ELEMENT_PICKER_WORLD_ID,
      [
        {
          code: `(() => {
            ${PAGE_REVISION_SCRIPT};
            const element = document.querySelector(${JSON.stringify(selector)})
            if (!element) return null
            const rect = element.getBoundingClientRect()
            const styleProperties = [
              "display", "position", "color", "background-color", "font-family", "font-size", "font-weight",
              "line-height", "text-align", "border", "border-radius", "padding", "margin", "width", "height",
              "gap", "grid-template-columns", "align-items", "justify-content", "overflow"
            ]
            const normalizeText = (value) => (value || "").trim().replace(/\\s+/g, " ")
            const readStyles = (element) => {
              const style = getComputedStyle(element)
              return Object.fromEntries(styleProperties.map((name) => [name, style.getPropertyValue(name)]))
            }
            const selectorFor = (element) => {
              if (element.id) return "#" + CSS.escape(element.id)
              const parts = []
              let current = element
              while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.documentElement) {
                let part = current.tagName.toLowerCase()
                const parent = current.parentElement
                if (parent) {
                  const siblings = Array.from(parent.children).filter((item) => item.tagName === current.tagName)
                  if (siblings.length > 1) part += ":nth-of-type(" + (siblings.indexOf(current) + 1) + ")"
                }
                parts.unshift(part)
                current = parent
              }
              return parts.join(" > ")
            }
            const isWorkbenchNode = (node) => node instanceof Element && (
              node.matches("[data-pixelcrab-selection-overlay], [data-pixelcrab-selection-hint], [data-pixelcrab-selection-editor], [data-pixelcrab-ux-issue-layer], [data-pixelcrab-visual-change-layer], [data-pixelcrab-visual-panel]") ||
              Boolean(node.closest("[data-pixelcrab-selection-editor], [data-pixelcrab-ux-issue-layer], [data-pixelcrab-visual-change-layer], [data-pixelcrab-visual-panel]"))
            )
            const cleanText = (element) => {
              const clone = element.cloneNode(true)
              if (clone instanceof Element) {
                clone.querySelectorAll("[data-pixelcrab-selection-overlay], [data-pixelcrab-selection-hint], [data-pixelcrab-selection-editor], [data-pixelcrab-ux-issue-layer], [data-pixelcrab-visual-change-layer], [data-pixelcrab-visual-panel]").forEach((node) => node.remove())
              }
              return normalizeText(clone.textContent)
            }
            const intersects = (a, b) => {
              const right = Math.min(a.x + a.width, b.x + b.width)
              const left = Math.max(a.x, b.x)
              const bottom = Math.min(a.y + a.height, b.y + b.height)
              const top = Math.max(a.y, b.y)
              return right - left >= 1 && bottom - top >= 1
            }
            const fingerprintBounds = ${JSON.stringify(input.selectionBounds ?? input.boundingBox)}
            const buildRegionFingerprint = (bounds) => {
              if (!bounds || !${JSON.stringify(Boolean(input.regionFingerprint))}) return undefined
              const elements = Array.from(document.querySelectorAll("body *"))
                .filter((candidate) => candidate instanceof HTMLElement)
                .filter((candidate) => {
                  if (isWorkbenchNode(candidate)) return false
                  const rect = candidate.getBoundingClientRect()
                  if (rect.width < 1 || rect.height < 1) return false
                  return intersects(bounds, { x: rect.x, y: rect.y, width: rect.width, height: rect.height })
                })
                .slice(0, 32)
                .map((candidate) => ({
                  selector: selectorFor(candidate),
                  tagName: candidate.tagName.toLowerCase(),
                  textContent: cleanText(candidate).slice(0, 160) || undefined,
                  computedStyles: readStyles(candidate),
                }))
              return {
                textContent: normalizeText(elements.map((item) => item.textContent || "").join(" ")).slice(0, 2_000) || undefined,
                elements,
              }
            }
            return {
              boundingBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
              computedStyles: readStyles(element),
              textContent: cleanText(element) || undefined,
              regionFingerprint: buildRegionFingerprint(fingerprintBounds),
              pageRevision: globalThis.__pixelcrabPageRevision?.value || 1,
            }
          })()`,
        },
      ],
      true,
    )) as {
      boundingBox: Rectangle
      computedStyles: Record<string, string>
      textContent?: string
      regionFingerprint?: PixelCrabPreviewEvidenceContext["regionFingerprint"]
      pageRevision: number
    } | null
    const base = {
      evidenceId: input.evidenceId,
      parentEvidenceId: input.evidenceId,
      pageRevision: current?.pageRevision ?? input.pageRevision,
      route: state.view.webContents.getURL(),
      domSelector: selector,
      capturedAt: new Date().toISOString(),
    }
    if (!current) {
      return {
        ...base,
        status: "missing",
        lifecycleStatus: "stale",
        changes: {
          boundingBox: false,
          textContent: false,
          regionScreenshot: false,
          regionFingerprint: false,
          computedStyles: [],
        },
      }
    }
    current.textContent = normalizePixelCrabElementText(current.textContent) || undefined
    const changedStyles = [...new Set([...Object.keys(input.computedStyles), ...Object.keys(current.computedStyles)])]
      .filter((name) => (input.computedStyles[name] ?? "") !== (current.computedStyles[name] ?? ""))
      .sort()
    const before = input.boundingBox
    const after = current.boundingBox
    const boxChanged = ["x", "y", "width", "height"].some(
      (key) => Math.abs(before[key as keyof Rectangle] - after[key as keyof Rectangle]) > 0.5,
    )
    const regionFingerprintChanged =
      JSON.stringify(input.regionFingerprint ?? undefined) !== JSON.stringify(current.regionFingerprint ?? undefined)
    const clip = {
      x: Math.max(0, Math.floor((input.selectionBounds ?? after).x)),
      y: Math.max(0, Math.floor((input.selectionBounds ?? after).y)),
      width: Math.max(1, Math.ceil((input.selectionBounds ?? after).width)),
      height: Math.max(1, Math.ceil((input.selectionBounds ?? after).height)),
    }
    const regionScreenshot = await Promise.resolve()
      .then(() => state.view.webContents.capturePage(clip))
      .then(screenshotDataURL)
      .catch(() => undefined)
    return {
      ...base,
      status: "matched",
      lifecycleStatus: "revalidated",
      boundingBox: after,
      computedStyles: current.computedStyles,
      textContent: current.textContent,
      regionFingerprint: current.regionFingerprint,
      regionScreenshot,
      screenshotStatus: regionScreenshot ? "captured" : "unavailable",
      changes: {
        boundingBox: boxChanged,
        textContent: (input.textContent ?? "") !== (current.textContent ?? ""),
        regionScreenshot: Boolean(input.regionScreenshot && regionScreenshot) && input.regionScreenshot !== regionScreenshot,
        regionFingerprint: regionFingerprintChanged,
        computedStyles: changedStyles,
      },
    }
  }

  #create(win: BrowserWindow, scope: string) {
    const partition = `pixelcrab-preview-${randomUUID()}`
    const previewSession = session.fromPartition(partition, { cache: true })
    previewSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    previewSession.setPermissionCheckHandler(() => false)
    previewSession.on("will-download", (event) => event.preventDefault())
    const view = new WebContentsView({
      webPreferences: {
        partition,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    })
    view.setBackgroundColor("#ffffff")
    view.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith("pixelcrab-visual-panel:")) {
        const current = this.#states.get(win)
        const input = new URL(url)
        const action = input.searchParams.get("action")
        const id = input.searchParams.get("id") ?? undefined
        const panel = current?.visualPanel
        if (!panel || !current.visible || input.searchParams.get("token") !== current.visualPanelToken) return { action: "deny" }
        const row = panel.items.find((item) => item.id === id)
        const allowed = action === "close" || ((action === "select" || action === "delete") && !!row && !panel.busy) ||
          panel.actions.some((item) => item.id === action && !item.disabled)
        if (allowed) this.events.visualPanel?.(win, { action: action as VisualChangePanelAction["action"], id, selected: input.searchParams.get("selected") === "true" })
        return { action: "deny" }
      }
      if (url.startsWith(UX_ISSUE_SCHEME)) {
        const issueId = decodeURIComponent(url.slice(UX_ISSUE_SCHEME.length))
        const current = this.#states.get(win)
        if (current?.uxIssues.some((issue) => issue.issueId === issueId)) this.events.issue(win, issueId)
        return { action: "deny" }
      }
      this.events.external(win, url)
      return { action: "deny" }
    })
    view.webContents.on("will-navigate", (event, url) => {
      const current = this.#states.get(win)
      if (resolvePixelCrabLocalPreviewURL(url) || (current?.allowRemoteNavigation && resolvePixelCrabManualPreviewURL(url)))
        return
      event.preventDefault()
      this.events.external(win, url)
    })
    view.webContents.on("will-redirect", (event, url) => {
      const current = this.#states.get(win)
      if (resolvePixelCrabLocalPreviewURL(url) || (current?.allowRemoteNavigation && resolvePixelCrabManualPreviewURL(url)))
        return
      event.preventDefault()
      this.events.failed(win, {
        url,
        errorCode: 0,
        errorDescription: "Blocked navigation outside the local preview",
        kind: "blocked",
      })
    })
    view.webContents.on("did-start-loading", () => {
      const current = this.#states.get(win)
      if (current) current.visualChanges = []
      void this.#emitNavigation(win, view)
    })
    view.webContents.on("did-stop-loading", () => {
      void this.#emitNavigation(win, view)
      this.#scheduleRenderEvidence(win, view)
      const current = this.#states.get(win)
      void view.webContents
        .executeJavaScriptInIsolatedWorld(ELEMENT_PICKER_WORLD_ID, [{ code: PAGE_REVISION_SCRIPT }])
        .catch(() => undefined)
      if (current?.visualPanel) void this.setVisualPanel(win, current.visualPanel)
      if (current?.uxIssues.length) void this.#renderUXIssues(current)
      if (current && current.selectionMode !== "interact") void this.#beginElementSelection(win, current)
    })
    view.webContents.on("did-finish-load", () => {
      const current = this.#states.get(win)
      if (!current || current.view !== view || !current.visible || current.attached) return
      win.contentView.addChildView(view)
      current.attached = true
    })
    view.webContents.on("did-navigate", () => void this.#emitNavigation(win, view))
    view.webContents.on("did-navigate-in-page", () => void this.#emitNavigation(win, view))
    view.webContents.on("page-title-updated", () => void this.#emitNavigation(win, view))
    view.webContents.on("console-message", (_event, level, message, line, sourceId) => {
      const current = this.#states.get(win)
      if (!current || current.view !== view) return
      current.consoleEntries.push({
        id: ++current.consoleSequence,
        level,
        message: sanitizePixelCrabPreviewConsoleMessage(message),
        line: Math.max(0, Math.round(line)),
        source: sanitizePixelCrabPreviewConsoleSource(sourceId),
        timestamp: new Date().toISOString(),
      })
      if (current.consoleEntries.length <= MAX_CONSOLE_ENTRIES) return
      const overflow = current.consoleEntries.length - MAX_CONSOLE_ENTRIES
      current.consoleEntries.splice(0, overflow)
      current.droppedConsoleEntries += overflow
    })
    view.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame || errorCode === -3) return
      const current = this.#states.get(win)
      if (current?.view === view && current.visible) {
        if (current.attached) win.contentView.removeChildView(view)
        current.attached = false
        current.visible = false
        this.#stopHealth(current)
      }
      this.events.failed(win, {
        url: validatedURL,
        errorCode,
        errorDescription: sanitizePixelCrabPreviewError(errorDescription),
        kind: classifyPixelCrabPreviewFailure(errorCode),
      })
    })
    view.webContents.on("render-process-gone", (_event, details) => {
      this.events.failed(win, {
        url: view.webContents.getURL(),
        errorCode: 0,
        errorDescription: sanitizePixelCrabPreviewError(`Preview renderer stopped unexpectedly (${details.reason})`),
        kind: "crashed",
      })
    })
    win.contentView.addChildView(view)
    const state: PreviewState = {
      view,
      scope,
      partition,
      visible: true,
      attached: true,
      selectionMode: "interact" as const,
      selectionRun: 0,
      captureInProgress: false,
      consoleEntries: [],
      consoleSequence: 0,
      droppedConsoleEntries: 0,
      uxIssues: [],
      visualChanges: [],
      renderMisses: 0,
      allowRemoteNavigation: false,
      activationRun: 0,
    }
    this.#states.set(win, state)
    if (!this.#registeredWindows.has(win)) {
      this.#registeredWindows.add(win)
      win.once("closed", () => this.destroy(win))
    }
    return state
  }

  #state(win: BrowserWindow, scope: string) {
    const current = this.#states.get(win)
    if (!current) return this.#create(win, scope)
    if (current.scope === scope) return current
    this.destroy(win)
    return this.#create(win, scope)
  }

  async show(
    win: BrowserWindow,
    input: {
      url: string
      bounds: Rectangle
      scope?: string
      adapterId?: string
      runtimeId?: string
      projectId?: string
      source?: "agent" | "manual"
    },
  ) {
    const manual = input.source === "manual"
    const url = manual ? resolvePixelCrabManualPreviewURL(input.url) : resolvePixelCrabLocalPreviewURL(input.url)
    if (!url) {
      throw new Error(
        manual
          ? `PixelCrab preview only accepts HTTP(S) targets: ${input.url}`
          : `PixelCrab preview only accepts local HTTP(S) targets: ${input.url}`,
      )
    }
    if (input.runtimeId && !/^runtime_[A-Za-z0-9_-]{1,80}$/.test(input.runtimeId))
      throw new Error("Invalid Preview Runtime ID")
    if (input.projectId && !/^project_[a-f0-9]{16}$/.test(input.projectId))
      throw new Error("Invalid Preview Project ID")
    const state = this.#state(win, input.scope?.trim() || "default")
    const activationRun = ++state.activationRun
    if (state.adapterId !== input.adapterId) {
      state.adapterId = input.adapterId
    }
    const localURL = resolvePixelCrabLocalPreviewURL(url)
    state.allowRemoteNavigation = manual && !localURL
    if (state.runtimeId !== input.runtimeId || state.projectId !== input.projectId) {
      state.runtimeId = input.runtimeId
      state.projectId = input.projectId
      state.uxIssues = []
      state.consoleEntries = []
      state.droppedConsoleEntries = 0
      state.selectionRun += 1
      state.captureInProgress = false
    }
    if (!state.visible || !state.attached) {
      win.contentView.addChildView(state.view)
      state.attached = true
      state.visible = true
    }
    state.view.setBounds(normalizePixelCrabPreviewBounds(input.bounds))
    if (localURL) {
      this.#startHealth(win, state, url)
    } else {
      this.#stopHealth(state)
      state.url = url
      state.lastHealth = undefined
      state.lastHealthStatus = undefined
      state.lastHealthReason = undefined
      this.#emitHealth(win, state, { url, status: "connecting" })
    }
    if (state.view.webContents.getURL() !== url) {
      await state.view.webContents.loadURL(url).catch((error) => {
        if (isPixelCrabPreviewNavigationCancelled(error)) return
        if (activationRun === state.activationRun) this.hide(win)
        throw error
      })
    }
    if (activationRun !== state.activationRun) return
    if (!localURL) this.#emitHealth(win, state, { url, status: "running" })
    void this.#emitNavigation(win, state.view)
  }

  async setVisualPanel(win: BrowserWindow, panel: VisualChangePanel | null) {
    const state = this.#states.get(win)
    if (!state || state.view.webContents.isDestroyed()) return
    state.visualPanel = panel ?? undefined
    state.visualPanelToken = panel ? (state.visualPanelToken ?? randomUUID()) : undefined
    await state.view.webContents.executeJavaScriptInIsolatedWorld(ELEMENT_PICKER_WORLD_ID, [{
      code: `(${renderVisualChangePanel.toString()})(${JSON.stringify(panel)}, ${JSON.stringify(`pixelcrab-visual-panel://action?token=${state.visualPanelToken ?? ""}`)})`,
    }])
  }

  async setUXIssues(win: BrowserWindow, issues: PixelCrabPreviewUXIssue[]) {
    const state = this.#states.get(win)
    if (!state?.visible) return
    state.uxIssues = issues.filter(
      (issue) =>
        Boolean(issue.issueId?.trim()) &&
        Boolean(issue.reportId?.trim()) &&
        Number.isFinite(issue.confidence) &&
        issue.confidence >= 0 &&
        issue.confidence <= 1,
    )
    await this.#renderUXIssues(state)
  }

  async setVisualChanges(
    win: BrowserWindow,
    changes: PixelCrabPreviewVisualChange[],
  ): Promise<PixelCrabPreviewVisualChangeResult[]> {
    const state = this.#states.get(win)
    if (!state?.visible) return []
    state.visualChanges = normalizePixelCrabVisualChanges(changes).filter((change) =>
      matchesPixelCrabEvidenceRoute(state.view.webContents.getURL(), change.route),
    )
    return state.view.webContents.executeJavaScriptInIsolatedWorld(
      ELEMENT_PICKER_WORLD_ID,
      [
        {
          code: `(() => {
            const key = "__pixelcrabVisualChangeLayer"
            const revision = globalThis.__pixelcrabPageRevision
            if (revision) revision.suppressed = true
            const previous = globalThis[key]
            previous?.records?.forEach((record) => {
              if (!(record.element instanceof HTMLElement) || !record.element.isConnected) return
              record.styles.forEach((value, name) => {
                if (value.value) record.element.style.setProperty(name, value.value, value.priority)
                else record.element.style.removeProperty(name)
              })
              if (record.textContent !== undefined) record.element.textContent = record.textContent
            })
            previous?.root?.remove()
            previous?.dispose?.()
            const changes = ${JSON.stringify(state.visualChanges)}
            const root = document.createElement("div")
            root.setAttribute("data-pixelcrab-visual-change-layer", "")
            Object.assign(root.style, {
              position: "fixed", inset: "0", zIndex: "2147483645", pointerEvents: "none",
            })
            document.documentElement.appendChild(root)
            const records = new Map()
            const markers = []
            const results = changes.map((change) => {
              let element
              try { element = document.querySelector(change.selector) } catch { return { id: change.id, status: "missing" } }
              if (!(element instanceof HTMLElement)) return { id: change.id, status: "missing" }
              if (change.textContent !== undefined && element.childElementCount > 0) {
                return { id: change.id, status: "unsafe_text_target" }
              }
              const styles = new Map()
              Object.entries(change.styles).forEach(([name, value]) => {
                styles.set(name, { value: element.style.getPropertyValue(name), priority: element.style.getPropertyPriority(name) })
                element.style.setProperty(name, value)
              })
              const textContent = change.textContent === undefined ? undefined : element.textContent
              if (change.textContent !== undefined) element.textContent = change.textContent
              records.set(change.id, { element, styles, textContent })
              const marker = document.createElement("div")
              marker.textContent = String(change.number)
              marker.setAttribute("data-pixelcrab-visual-change-marker", change.id)
              Object.assign(marker.style, {
                position: "fixed", width: "22px", height: "22px", borderRadius: "999px",
                display: "grid", placeItems: "center", color: "white", background: "#2563eb",
                border: "2px solid white", boxShadow: "0 2px 8px rgba(0,0,0,.28)",
                font: "600 12px/1 system-ui, sans-serif", pointerEvents: "none",
              })
              root.appendChild(marker)
              markers.push({ marker, element })
              const rect = element.getBoundingClientRect()
              return { id: change.id, status: "applied", boundingBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } }
            })
            const position = () => markers.forEach(({ marker, element }) => {
              if (!element.isConnected) { marker.style.display = "none"; return }
              const rect = element.getBoundingClientRect()
              marker.style.display = rect.width > 0 && rect.height > 0 ? "grid" : "none"
              marker.style.left = Math.max(2, Math.min(innerWidth - 24, rect.right - 11)) + "px"
              marker.style.top = Math.max(2, Math.min(innerHeight - 24, rect.top - 11)) + "px"
            })
            position()
            addEventListener("scroll", position, true)
            addEventListener("resize", position, true)
            globalThis[key] = {
              root, records,
              dispose: () => {
                removeEventListener("scroll", position, true)
                removeEventListener("resize", position, true)
              },
            }
            setTimeout(() => { if (revision) revision.suppressed = false }, 0)
            return results
          })()`,
        },
      ],
      true,
    ) as Promise<PixelCrabPreviewVisualChangeResult[]>
  }

  setBounds(win: BrowserWindow, bounds: Rectangle) {
    const state = this.#states.get(win)
    if (!state?.visible) return
    state.view.setBounds(normalizePixelCrabPreviewBounds(bounds))
  }

  hide(win: BrowserWindow) {
    const state = this.#states.get(win)
    if (!state?.visible) return
    void this.setVisualChanges(win, []).catch(() => undefined)
    state.selectionRun += 1
    state.captureInProgress = false
    state.selectionMode = "interact"
    void state.view.webContents
      .executeJavaScriptInIsolatedWorld(ELEMENT_PICKER_WORLD_ID, [
        { code: "globalThis.__pixelcrabCaptureTokens?.clear(); if (globalThis.__pixelcrabVisualPanel) globalThis.__pixelcrabVisualPanel.host.style.visibility = 'visible'; globalThis.__pixelcrabElementSelection?.cancel?.()" },
      ])
      .catch(() => undefined)
    if (state.attached) win.contentView.removeChildView(state.view)
    state.attached = false
    state.visible = false
    this.#stopHealth(state)
  }

  reload(win: BrowserWindow) {
    this.#states.get(win)?.view.webContents.reload()
  }

  goBack(win: BrowserWindow) {
    const history = this.#states.get(win)?.view.webContents.navigationHistory
    if (history?.canGoBack()) history.goBack()
  }

  goForward(win: BrowserWindow) {
    const history = this.#states.get(win)?.view.webContents.navigationHistory
    if (history?.canGoForward()) history.goForward()
  }

  async diagnostics(
    win: BrowserWindow,
    input: { screenshot?: boolean } = {},
  ): Promise<PixelCrabPreviewDiagnostics | undefined> {
    const state = this.#states.get(win)
    if (!state) return
    const status = state.lastHealthStatus ?? "connecting"
    const image = input.screenshot
      ? await state.view.webContents
          .capturePage()
          .then(screenshotDataURL)
          .catch(() => undefined)
      : undefined
    return {
      url: state.view.webContents.getURL(),
      health: status,
      render: await this.#captureRenderState(state.view),
      screenshot: image,
      console: state.consoleEntries.map((entry) => ({ ...entry })),
      droppedConsoleEntries: state.droppedConsoleEntries,
    }
  }

  clearDiagnostics(win: BrowserWindow) {
    const state = this.#states.get(win)
    if (!state) return
    state.consoleEntries.length = 0
    state.droppedConsoleEntries = 0
  }

  destroy(win: BrowserWindow) {
    const state = this.#states.get(win)
    if (!state) return
    this.#stopHealth(state)
    if (state.attached && !win.isDestroyed()) win.contentView.removeChildView(state.view)
    if (!state.view.webContents.isDestroyed()) state.view.webContents.close()
    this.#states.delete(win)
    const previewSession = session.fromPartition(state.partition)
    void Promise.allSettled([previewSession.clearStorageData(), previewSession.clearCache()])
  }
}
