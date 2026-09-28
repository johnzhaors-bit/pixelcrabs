export type PixelCrabElementEvidence = {
  evidenceId: string
  runtimeId?: string
  projectId?: string
  capturedAt: string
  pageRevision: number
  status: "active"
  source: "selected_element" | "selected_region"
  route: string
  boundingBox: { x: number; y: number; width: number; height: number }
  selectionBounds?: { x: number; y: number; width: number; height: number }
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

export type PixelCrabUXIssueEvidence = {
  evidenceId: string
  source: "ux_issue"
  route: string
  boundingBox?: { x: number; y: number; width: number; height: number }
  uxIssueIds: string[]
  uxCheckReportId: string
  title: string
  description: string
  suggestion?: string
  evidenceIds: string[]
  confidence: number
  fixability: "safe_auto_fix" | "needs_confirmation" | "suggestion_only" | "not_fixable"
}

const json = (value: unknown) => JSON.stringify(value, null, 2)

export function formatPixelCrabElementEvidence(evidence: PixelCrabElementEvidence, userRequest?: string) {
  const sourcePrecision =
    evidence.sourceCandidates.some((candidate) => candidate.confidence >= 0.9)
      ? "exact"
      : evidence.sourceCandidates.length > 0
        ? "candidate"
        : "visual_only"
  return json({
    _instruction: [
      "Use this PixelCrab preview evidence as the exact visual target for the user's next request.",
      sourcePrecision === "visual_only"
        ? "No precise source anchor is available. Use the attached region screenshot and runtime evidence, then locate source through the normal OpenCode tools."
        : "Do not infer a different element when this selector still resolves.",
    ],
    userRequest: userRequest?.trim() || undefined,
    evidence: {
      version: 1,
      evidenceId: evidence.evidenceId,
      runtimeId: evidence.runtimeId,
      projectId: evidence.projectId,
      capturedAt: evidence.capturedAt,
      pageRevision: evidence.pageRevision,
      status: evidence.status,
      source: evidence.source,
      route: evidence.route,
      selector: evidence.domSelector,
      boundingBox: evidence.boundingBox,
      selectionBounds: evidence.selectionBounds,
      element: evidence.domSnapshot,
      computedStyles: evidence.computedStyles,
      textContent: evidence.textContent,
      regionFingerprint: evidence.regionFingerprint,
      sourceCandidates: evidence.sourceCandidates,
      sourcePrecision,
      regionScreenshotAttached: shouldAttachPixelCrabEvidenceImage(evidence),
      fullContextScreenshotAttached: shouldAttachPixelCrabFullContextImage(evidence),
      captureLevel: evidence.captureLevel,
    },
  })
}

export function shouldAttachPixelCrabEvidenceImage(evidence: PixelCrabElementEvidence) {
  return Boolean(evidence.regionScreenshot) && (evidence.source === "selected_region" || evidence.sourceCandidates.length === 0)
}

export function shouldAttachPixelCrabFullContextImage(evidence: PixelCrabElementEvidence) {
  return Boolean(evidence.screenshot) && evidence.source === "selected_region" && evidence.sourceCandidates.length === 0
}

export function createPixelCrabEvidenceImageAttachment(evidence: PixelCrabElementEvidence) {
  if (!shouldAttachPixelCrabEvidenceImage(evidence) || !evidence.regionScreenshot) return
  const mime = evidence.regionScreenshot.match(/^data:([^;,]+)[;,]/)?.[1]
  if (mime !== "image/png" && mime !== "image/jpeg" && mime !== "image/webp") return
  const extension = mime === "image/jpeg" ? "jpg" : mime.split("/")[1]
  return {
    label: `PixelCrab visual evidence ${evidence.evidenceId}`,
    filename: `pixelcrab-region-${evidence.evidenceId}.${extension}`,
    mime,
    url: evidence.regionScreenshot,
  }
}

export function createPixelCrabEvidenceImageAttachments(evidence: PixelCrabElementEvidence) {
  const result = []
  const region = createPixelCrabEvidenceImageAttachment(evidence)
  if (region) result.push(region)
  if (!shouldAttachPixelCrabFullContextImage(evidence) || !evidence.screenshot) return result
  const mime = evidence.screenshot.match(/^data:([^;,]+)[;,]/)?.[1]
  if (mime !== "image/png" && mime !== "image/jpeg" && mime !== "image/webp") return result
  const extension = mime === "image/jpeg" ? "jpg" : mime.split("/")[1]
  result.push({
    label: `PixelCrab page context ${evidence.evidenceId}`,
    filename: `pixelcrab-context-${evidence.evidenceId}.${extension}`,
    mime,
    url: evidence.screenshot,
  })
  return result
}

export function createPixelCrabEvidenceAttachment(evidence: PixelCrabElementEvidence, userRequest?: string) {
  const payload = formatPixelCrabElementEvidence(evidence, userRequest)
  const bytes = new TextEncoder().encode(payload)
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return {
    label: `PixelCrab · ${evidence.domSnapshot.tagName}${evidence.domSnapshot.id ? `#${evidence.domSnapshot.id}` : ""}`,
    filename: `pixelcrab-element-${evidence.evidenceId}.txt`,
    // OpenCode providers consistently accept text attachments, while some
    // reject application/json before the Agent can inspect the evidence.
    // The payload remains structured JSON; only its transport media type is
    // normalized for provider compatibility.
    mime: "text/plain",
    url: `data:text/plain;base64,${btoa(binary)}`,
  }
}

export function createPixelCrabUXIssueAttachment(evidence: PixelCrabUXIssueEvidence, userRequest?: string) {
  const payload = json({
    _instruction: [
      "Use this PixelCrab UXIssue as evidence for the user's next request.",
      "Treat boundingBox and issue metadata as candidates; keep the normal source-location, ChangeSet, and verification flow.",
    ],
    userRequest: userRequest?.trim() || evidence.suggestion || undefined,
    evidence: {
      version: 1,
      ...evidence,
    },
  })
  const bytes = new TextEncoder().encode(payload)
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return {
    label: `PixelCrab UX · ${evidence.title}`,
    filename: `pixelcrab-ux-issue-${evidence.evidenceId}.txt`,
    mime: "text/plain",
    url: `data:text/plain;base64,${btoa(binary)}`,
  }
}
