import type { VisualChangePanel } from "../../../app/src/pixelcrab/visual-change-panel-contract"
import type {
  PixelCrabPreviewAPI,
  PixelCrabPreviewBounds,
  PixelCrabPreviewRecheckInput,
  PixelCrabPreviewRecheckResult,
  PixelCrabPreviewSelectionMode,
  PixelCrabPreviewUXIssue,
  PixelCrabPreviewVisualChange,
} from "./preview-contract"

type PreviewRequest =
  | { action: "visual-panel"; panel: VisualChangePanel | null }
  | {
      action: "show"
      url: string
      bounds: PixelCrabPreviewBounds
      scope?: string
      adapterId?: string
      runtimeId?: string
      projectId?: string
      source?: "agent" | "manual"
    }
  | { action: "bounds"; bounds: PixelCrabPreviewBounds }
  | { action: "hide" }
  | { action: "command"; command: "reload" | "back" | "forward" }
  | { action: "selection-mode"; mode: PixelCrabPreviewSelectionMode }
  | { action: "recheck"; evidence: PixelCrabPreviewRecheckInput }
  | { action: "ux-issues"; issues: PixelCrabPreviewUXIssue[] }
  | { action: "visual-changes"; changes: PixelCrabPreviewVisualChange[]; requestId: string }
  | {
      action: "menu"
      requestId: string
      x: number
      y: number
      items: Array<
        { type: "separator" } | { type: "item"; id: string; label: string; detail?: string; enabled?: boolean }
      >
    }

export const PIXELCRAB_PREVIEW_REQUEST_EVENT = "pixelcrab:preview:request"
export const PIXELCRAB_PREVIEW_STATE_EVENT = "pixelcrab:preview:state"
export const PIXELCRAB_PREVIEW_FAILURE_EVENT = "pixelcrab:preview:failure"
export const PIXELCRAB_PREVIEW_HEALTH_EVENT = "pixelcrab:preview:health"
export const PIXELCRAB_PREVIEW_EVIDENCE_EVENT = "pixelcrab:preview:evidence"
export const PIXELCRAB_PREVIEW_RECHECK_EVENT = "pixelcrab:preview:recheck"
export const PIXELCRAB_PREVIEW_UX_ISSUE_EVENT = "pixelcrab:preview:ux-issue"
export const PIXELCRAB_PREVIEW_MENU_RESULT_EVENT = "pixelcrab:preview:menu-result"
export const PIXELCRAB_PREVIEW_VISUAL_CHANGES_RESULT_EVENT = "pixelcrab:preview:visual-changes-result"

const RECHECK_RETRY_DELAYS_MS = [250, 750, 1_250]

export function installPixelCrabPreviewRendererAdapter(api: PixelCrabPreviewAPI) {
  const safely = (operation: Promise<void>, url = "") => {
    void operation.catch((error) => {
      const errorDescription = error instanceof Error ? error.message : "预览操作失败"
      console.warn("PixelCrab preview operation failed", error)
      window.dispatchEvent(
        new CustomEvent(PIXELCRAB_PREVIEW_FAILURE_EVENT, {
          detail: { url, errorCode: 0, errorDescription },
        }),
      )
    })
  }
  const recheckWithReloadRetry = async (evidence: PixelCrabPreviewRecheckInput): Promise<PixelCrabPreviewRecheckResult> => {
    let lastError: unknown
    for (const delay of [0, ...RECHECK_RETRY_DELAYS_MS]) {
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay))
      try {
        return await api.recheck(evidence)
      } catch (error) {
        lastError = error
      }
    }
    console.warn("PixelCrab preview recheck failed", lastError)
    return {
      evidenceId: evidence.evidenceId,
      parentEvidenceId: evidence.evidenceId,
      pageRevision: evidence.pageRevision,
      lifecycleStatus: "stale",
      status: "missing",
      route: evidence.route,
      domSelector: evidence.domSelector,
      capturedAt: new Date().toISOString(),
      changes: {
        boundingBox: false,
        textContent: false,
        regionScreenshot: false,
        regionFingerprint: false,
        computedStyles: [],
      },
    }
  }
  const request = (event: Event) => {
    if (!(event instanceof CustomEvent)) return
    const detail = event.detail as PreviewRequest
    if (detail.action === "visual-panel") {
      safely(api.setVisualPanel(detail.panel))
      return
    }
    if (detail.action === "show") {
      safely(
        api.show({
          url: detail.url,
          bounds: detail.bounds,
          scope: detail.scope,
          adapterId: detail.adapterId,
          runtimeId: detail.runtimeId,
          projectId: detail.projectId,
          source: detail.source,
        }),
        detail.url,
      )
      return
    }
    if (detail.action === "bounds") {
      safely(api.setBounds(detail.bounds))
      return
    }
    if (detail.action === "hide") {
      safely(api.hide())
      return
    }
    if (detail.action === "selection-mode") {
      safely(api.setSelectionMode(detail.mode))
      return
    }
    if (detail.action === "recheck") {
      void recheckWithReloadRetry(detail.evidence).then((result) =>
        window.dispatchEvent(new CustomEvent(PIXELCRAB_PREVIEW_RECHECK_EVENT, { detail: result })),
      )
      return
    }
    if (detail.action === "ux-issues") {
      safely(api.setUXIssues(detail.issues))
      return
    }
    if (detail.action === "visual-changes") {
      void api
        .setVisualChanges(detail.changes)
        .then((results) =>
          window.dispatchEvent(
            new CustomEvent(PIXELCRAB_PREVIEW_VISUAL_CHANGES_RESULT_EVENT, {
              detail: { requestId: detail.requestId, results },
            }),
          ),
        )
        .catch((error) => {
          const errorDescription = error instanceof Error ? error.message : "预览视觉修改失败"
          window.dispatchEvent(
            new CustomEvent(PIXELCRAB_PREVIEW_FAILURE_EVENT, {
              detail: { url: "", errorCode: 0, errorDescription },
            }),
          )
        })
      return
    }
    if (detail.action === "menu") {
      void api
        .showMenu({ x: detail.x, y: detail.y, items: detail.items })
        .then((id) =>
          window.dispatchEvent(
            new CustomEvent(PIXELCRAB_PREVIEW_MENU_RESULT_EVENT, { detail: { requestId: detail.requestId, id } }),
          ),
        )
      return
    }
    if (detail.action === "command") safely(api.command(detail.command))
  }
  window.addEventListener(PIXELCRAB_PREVIEW_REQUEST_EVENT, request)
  const offNavigation = api.onNavigation((detail) =>
    window.dispatchEvent(new CustomEvent(PIXELCRAB_PREVIEW_STATE_EVENT, { detail })),
  )
  const offFailure = api.onFailed((detail) =>
    window.dispatchEvent(new CustomEvent(PIXELCRAB_PREVIEW_FAILURE_EVENT, { detail })),
  )
  const offHealth = api.onHealth?.((detail) =>
    window.dispatchEvent(new CustomEvent(PIXELCRAB_PREVIEW_HEALTH_EVENT, { detail })),
  )
  const offEvidence = api.onEvidence?.((detail) =>
    window.dispatchEvent(new CustomEvent(PIXELCRAB_PREVIEW_EVIDENCE_EVENT, { detail })),
  )
  const offUXIssue = api.onUXIssue?.((detail) =>
    window.dispatchEvent(new CustomEvent(PIXELCRAB_PREVIEW_UX_ISSUE_EVENT, { detail })),
  )
  const offVisualPanel = api.onVisualPanelAction((detail) =>
    window.dispatchEvent(new CustomEvent("pixelcrab:preview:visual-panel-action", { detail })),
  )
  return () => {
    offVisualPanel()
    window.removeEventListener(PIXELCRAB_PREVIEW_REQUEST_EVENT, request)
    offNavigation()
    offFailure()
    offHealth?.()
    offEvidence?.()
    offUXIssue?.()
    safely(api.hide())
  }
}
