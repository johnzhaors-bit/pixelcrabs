import type { PixelCrabElementEvidence } from "./evidence-prompt"

export const VISUAL_CHANGE_SAFE_STYLES = [
  "color",
  "background-color",
  "font-family",
  "font-size",
  "font-weight",
  "line-height",
  "text-align",
  "border-color",
  "border-style",
  "border-width",
  "border-radius",
  "opacity",
  "padding",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "margin",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "gap",
  "width",
  "height",
] as const

export type VisualChangeStyleName = (typeof VISUAL_CHANGE_SAFE_STYLES)[number]

export type VisualChangeValue = {
  before: string
  after: string
}

export type VisualChangeItem = {
  id: string
  number: number
  runtimeId?: string
  projectId?: string
  projectDirectory?: string
  route: string
  pageRevision: number
  selector: string
  label: string
  description?: string
  boundingBox: PixelCrabElementEvidence["boundingBox"]
  element: PixelCrabElementEvidence["domSnapshot"]
  baselineComputedStyles: PixelCrabElementEvidence["computedStyles"]
  baselineTextContent?: string
  sourceCandidates: PixelCrabElementEvidence["sourceCandidates"]
  screenshot?: string
  text?: VisualChangeValue
  styles: Partial<Record<VisualChangeStyleName, VisualChangeValue>>
  status: "draft" | "stale" | "applying" | "applied" | "failed"
  createdAt: string
  updatedAt: string
  failureReason?: string
}

export type VisualChangeRecheckResult = {
  evidenceId: string
  status: "matched" | "missing"
  textContent?: string
  computedStyles?: Record<string, string>
  changes?: {
    textContent?: boolean
    computedStyles?: string[]
  }
}

export type VisualChangeSet = {
  runtimeId?: string
  projectId?: string
  projectDirectory?: string
  route: string
  items: VisualChangeItem[]
  selectedIds: string[]
}

export type VisualChangeAIPayloadItem = {
  id: string
  number: number
  runtimeId?: string
  projectId?: string
  projectDirectory?: string
  route: string
  pageRevision: number
  selector: string
  boundingBox: VisualChangeItem["boundingBox"]
  element: VisualChangeItem["element"]
  sourceCandidates: VisualChangeItem["sourceCandidates"]
  description?: string
  text?: VisualChangeItem["text"]
  styles: VisualChangeItem["styles"]
}

export type VisualChangeDraft = {
  id: string
  label?: string
  description?: string
  textContent?: string
  styles?: Record<string, string>
  capturedAt?: string
}

export function createVisualChangeSet(
  input: { runtimeId?: string; projectId?: string; projectDirectory?: string; route?: string } = {},
): VisualChangeSet {
  return {
    runtimeId: input.runtimeId,
    projectId: input.projectId,
    projectDirectory: input.projectDirectory,
    route: input.route ?? "",
    items: [],
    selectedIds: [],
  }
}

export function addVisualChange(
  set: VisualChangeSet,
  evidence: PixelCrabElementEvidence,
  draft: VisualChangeDraft,
): VisualChangeSet {
  if (set.runtimeId && evidence.runtimeId && set.runtimeId !== evidence.runtimeId)
    throw new Error("Visual change evidence belongs to a different preview runtime.")
  if (set.projectId && evidence.projectId && set.projectId !== evidence.projectId)
    throw new Error("Visual change evidence belongs to a different project.")
  const styles = Object.fromEntries(
    Object.entries(draft.styles ?? {}).flatMap(([name, after]) => {
      if (!VISUAL_CHANGE_SAFE_STYLES.includes(name as VisualChangeStyleName)) return []
      const before = evidence.computedStyles[name] ?? ""
      const next = after.trim().slice(0, 500)
      if (!next || next === before) return []
      return [[name, { before, after: next }]]
    }),
  ) as VisualChangeItem["styles"]
  const beforeText = evidence.textContent ?? ""
  const afterText = draft.textContent?.trim().slice(0, 2_000)
  const text =
    afterText !== undefined && afterText !== beforeText ? { before: beforeText, after: afterText } : undefined
  if (!text && Object.keys(styles).length === 0)
    throw new Error("Visual change must contain at least one changed value.")
  const capturedAt = draft.capturedAt ?? new Date().toISOString()
  const item: VisualChangeItem = {
    id: draft.id,
    number: Math.max(0, ...set.items.map((value) => value.number)) + 1,
    runtimeId: evidence.runtimeId,
    projectId: evidence.projectId,
    projectDirectory: set.projectDirectory,
    route: evidence.route,
    pageRevision: evidence.pageRevision,
    selector: evidence.domSelector,
    label: draft.label?.trim().slice(0, 120) || visualChangeLabel(evidence),
    description: draft.description?.trim().slice(0, 1_000) || undefined,
    boundingBox: evidence.boundingBox,
    element: evidence.domSnapshot,
    baselineComputedStyles: evidence.computedStyles,
    baselineTextContent: evidence.textContent,
    sourceCandidates: evidence.sourceCandidates,
    screenshot: evidence.regionScreenshot,
    text,
    styles,
    status: "draft",
    createdAt: capturedAt,
    updatedAt: capturedAt,
  }
  return {
    runtimeId: set.runtimeId ?? evidence.runtimeId,
    projectId: set.projectId ?? evidence.projectId,
    projectDirectory: set.projectDirectory,
    route: evidence.route,
    items: [...set.items, item],
    selectedIds: [...set.selectedIds, item.id],
  }
}

export function removeVisualChange(set: VisualChangeSet, id: string): VisualChangeSet {
  return {
    ...set,
    items: set.items.filter((item) => item.id !== id),
    selectedIds: set.selectedIds.filter((value) => value !== id),
  }
}

export function selectVisualChange(set: VisualChangeSet, id: string, selected: boolean): VisualChangeSet {
  if (!set.items.some((item) => item.id === id)) return set
  return {
    ...set,
    selectedIds: selected ? [...new Set([...set.selectedIds, id])] : set.selectedIds.filter((value) => value !== id),
  }
}

export function markVisualChangesStale(
  set: VisualChangeSet,
  input: { runtimeId?: string; projectId?: string; route: string; pageRevision: number; updatedAt: string },
): VisualChangeSet {
  const sameRuntime = !set.runtimeId || !input.runtimeId || set.runtimeId === input.runtimeId
  const sameProject = !set.projectId || !input.projectId || set.projectId === input.projectId
  return {
    ...set,
    items: set.items.map((item) => {
      if (item.status !== "draft") return item
      if (sameRuntime && sameProject && item.route === input.route && item.pageRevision === input.pageRevision)
        return item
      return { ...item, status: "stale", updatedAt: input.updatedAt }
    }),
  }
}

export function selectedVisualChanges(set: VisualChangeSet) {
  const selected = new Set(set.selectedIds)
  return set.items.filter((item) => selected.has(item.id) && item.status === "draft")
}

export function visualChangesAIPayload(items: readonly VisualChangeItem[]): VisualChangeAIPayloadItem[] {
  return items.map((item) => ({
    id: item.id,
    number: item.number,
    runtimeId: item.runtimeId,
    projectId: item.projectId,
    projectDirectory: item.projectDirectory,
    route: item.route,
    pageRevision: item.pageRevision,
    selector: item.selector,
    boundingBox: {
      x: item.boundingBox.x,
      y: item.boundingBox.y,
      width: item.boundingBox.width,
      height: item.boundingBox.height,
    },
    element: item.element,
    sourceCandidates: item.sourceCandidates,
    description: item.description,
    text: item.text,
    styles: item.styles,
  }))
}

export function formatVisualChangesAIPrompt(instruction: string, items: readonly VisualChangeItem[]) {
  const checklist = items
    .map((item) => {
      const expected = [
        item.text ? `textContent=${JSON.stringify(item.text.after)}` : "",
        ...Object.entries(item.styles).flatMap(([name, value]) => (value ? [`${name}=${JSON.stringify(value.after)}`] : [])),
      ].filter(Boolean)
      return `- marker ${item.number}: selector ${JSON.stringify(item.selector)} must end with ${expected.join(", ")}`
    })
    .join("\n")
  return [
    instruction.trim(),
    "Completion contract:",
    "- Preserve the existing project tech stack and source structure unless it is impossible.",
    "- The marker numbers are visual labels only; do not write marker numbers into page text or styles.",
    "- For every item below, treat each after value as the required final source-backed target.",
    "- Start source lookup from each item's projectDirectory when present. This is evidence from the active preview, not a constraint that the preview tool chooses or changes project folders.",
    "- If sourceCandidates is empty, locate the source by searching the real project files under projectDirectory for the before text, selectors, nearby labels, and style values; do not guess from the temporary preview overlay.",
    "- Prefer the normal source editing capability for the project. If a shell command is the only available edit path, read the target file first and use a minimal, verifiable replacement.",
    "- If a first edit attempt fails, inspect the real source again and keep correcting until preview recheck reaches the target values.",
    checklist,
    "Visual change evidence JSON:",
    JSON.stringify(visualChangesAIPayload(items), null, 2),
  ]
    .filter(Boolean)
    .join("\n\n")
}

export function visualChangeRecheckExpectation(item: VisualChangeItem) {
  return {
    evidenceId: item.id,
    pageRevision: item.pageRevision,
    route: item.route,
    boundingBox: {
      x: item.boundingBox.x,
      y: item.boundingBox.y,
      width: item.boundingBox.width,
      height: item.boundingBox.height,
    },
    domSelector: item.selector,
    computedStyles: Object.fromEntries([
      ...Object.entries(item.baselineComputedStyles).map(([name, value]) => [name, String(value)]),
      ...Object.entries(item.styles).map(([name, value]) => [name, value?.after ?? ""]),
    ]),
    textContent: item.text?.after ?? item.baselineTextContent,
  }
}

export function visualChangeRecheckPassed(item: VisualChangeItem, result: VisualChangeRecheckResult) {
  if (result.evidenceId !== item.id || result.status !== "matched") return false
  if (item.text) {
    if (result.textContent !== undefined) {
      if (normalizeVisualChangeText(result.textContent) !== normalizeVisualChangeText(item.text.after)) return false
    } else return false
  }
  for (const [name, value] of Object.entries(item.styles)) {
    if (!value) continue
    if (result.computedStyles) {
      if (!visualChangeStyleValueMatches(name, result.computedStyles[name] ?? "", value.after)) return false
    } else return false
  }
  return true
}

function visualChangeLabel(evidence: PixelCrabElementEvidence) {
  const text = evidence.textContent?.trim().replace(/\s+/g, " ").slice(0, 40)
  if (text) return text
  if (evidence.domSnapshot.id) return `${evidence.domSnapshot.tagName}#${evidence.domSnapshot.id}`
  return evidence.domSnapshot.tagName
}

function normalizeVisualChangeText(value: string) {
  return value.trim().replace(/\s+/g, " ")
}

function visualChangeStyleValueMatches(name: string, actual: string, expected: string) {
  return normalizeVisualChangeStyleValue(name, actual) === normalizeVisualChangeStyleValue(name, expected)
}

function normalizeVisualChangeStyleValue(name: string, value: string) {
  const trimmed = value.trim().toLowerCase().replace(/\s+/g, " ")
  if (!isColorStyle(name)) return trimmed
  const hex = trimmed.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (!hex) return trimmed.replace(/\s*,\s*/g, ", ")
  const raw = hex[1]!
  const expanded =
    raw.length === 3
      ? raw
          .split("")
          .map((part) => `${part}${part}`)
          .join("")
      : raw
  const red = Number.parseInt(expanded.slice(0, 2), 16)
  const green = Number.parseInt(expanded.slice(2, 4), 16)
  const blue = Number.parseInt(expanded.slice(4, 6), 16)
  return `rgb(${red}, ${green}, ${blue})`
}

function isColorStyle(name: string) {
  return name === "color" || name.endsWith("-color")
}
