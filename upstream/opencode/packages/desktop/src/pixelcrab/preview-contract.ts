import type { VisualChangePanel, VisualChangePanelAction } from "../../../app/src/pixelcrab/visual-change-panel-contract"

export type PixelCrabPreviewBounds = { x: number; y: number; width: number; height: number }
export type PixelCrabPreviewRegionFingerprint = {
  textContent?: string
  elements: Array<{
    selector: string
    tagName: string
    textContent?: string
    computedStyles: Record<string, string>
  }>
}
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
export type PixelCrabPreviewFailure = {
  url: string
  errorCode: number
  errorDescription: string
  kind: "tls" | "unreachable" | "crashed" | "blocked" | "unknown"
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
  boundingBox: PixelCrabPreviewBounds
  selectionBounds?: PixelCrabPreviewBounds
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
  regionFingerprint?: PixelCrabPreviewRegionFingerprint
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
export type PixelCrabPreviewRecheckInput = Pick<
  PixelCrabPreviewEvidenceContext,
  | "evidenceId"
  | "pageRevision"
  | "route"
  | "boundingBox"
  | "selectionBounds"
  | "domSelector"
  | "computedStyles"
  | "textContent"
  | "regionScreenshot"
  | "regionFingerprint"
>
export type PixelCrabPreviewRecheckResult = {
  screenshotStatus?: "captured" | "unavailable"
  evidenceId: string
  parentEvidenceId: string
  pageRevision: number
  lifecycleStatus: "revalidated" | "stale"
  status: "matched" | "missing"
  route: string
  domSelector: string
  capturedAt: string
  boundingBox?: PixelCrabPreviewBounds
  computedStyles?: Record<string, string>
  textContent?: string
  regionScreenshot?: string
  regionFingerprint?: PixelCrabPreviewRegionFingerprint
  changes: {
    boundingBox: boolean
    textContent: boolean
    regionScreenshot: boolean
    regionFingerprint: boolean
    computedStyles: string[]
  }
}
export type PixelCrabPreviewUXIssue = {
  issueId: string
  reportId: string
  title: string
  description: string
  suggestion?: string
  route: string
  boundingBox?: PixelCrabPreviewBounds
  severity: "critical" | "warning" | "suggestion"
  fixability: "safe_auto_fix" | "needs_confirmation" | "suggestion_only" | "not_fixable"
  confidence: number
  evidenceIds: string[]
}
export type PixelCrabPreviewVisualChange = {
  id: string
  number: number
  route: string
  selector: string
  textContent?: string
  styles: Record<string, string>
}
export type PixelCrabPreviewVisualChangeResult = {
  id: string
  status: "applied" | "missing" | "unsafe_text_target"
  boundingBox?: PixelCrabPreviewBounds
}
export type PixelCrabPreviewAPI = {
  setVisualPanel(panel: VisualChangePanel | null): Promise<void>
  onVisualPanelAction(cb: (action: VisualChangePanelAction) => void): () => void
  show(input: {
    url: string
    bounds: PixelCrabPreviewBounds
    scope?: string
    adapterId?: string
    runtimeId?: string
    projectId?: string
    source?: "agent" | "manual"
  }): Promise<void>
  setBounds(bounds: PixelCrabPreviewBounds): Promise<void>
  hide(): Promise<void>
  command(command: "reload" | "back" | "forward"): Promise<void>
  setSelectionMode(mode: PixelCrabPreviewSelectionMode): Promise<void>
  recheck(input: PixelCrabPreviewRecheckInput): Promise<PixelCrabPreviewRecheckResult>
  setUXIssues(issues: PixelCrabPreviewUXIssue[]): Promise<void>
  setVisualChanges(changes: PixelCrabPreviewVisualChange[]): Promise<PixelCrabPreviewVisualChangeResult[]>
  diagnostics(input?: { screenshot?: boolean }): Promise<PixelCrabPreviewDiagnostics | undefined>
  clearDiagnostics(): Promise<void>
  showMenu(input: PixelCrabPreviewMenuInput): Promise<string | undefined>
  onNavigation(cb: (state: PixelCrabPreviewNavigationState) => void): () => void
  onFailed(cb: (failure: PixelCrabPreviewFailure) => void): () => void
  onHealth(cb: (state: PixelCrabPreviewHealthState) => void): () => void
  onEvidence(cb: (evidence: PixelCrabPreviewEvidenceContext) => void): () => void
  onUXIssue(cb: (issueId: string) => void): () => void
}

export type PixelCrabPreviewMenuInput = {
  x: number
  y: number
  items: Array<{ type: "separator" } | { type: "item"; id: string; label: string; detail?: string; enabled?: boolean }>
}
