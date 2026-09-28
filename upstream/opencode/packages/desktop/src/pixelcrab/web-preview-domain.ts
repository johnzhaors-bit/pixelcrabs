export type PixelCrabPreviewBounds = {
  x: number
  y: number
  width: number
  height: number
}

export type PixelCrabSelectionRectangle = PixelCrabPreviewBounds & {
  left?: number
  top?: number
  bottom?: number
}

export type PixelCrabPreviewEndpoint = {
  host: string
  port: number
}

export type PixelCrabSourceCandidate = {
  file: string
  line?: number
  column?: number
  component?: string
  confidence: number
  provider: "code-inspector-plugin"
}

export type PixelCrabPreviewFailureKind = "tls" | "unreachable" | "crashed" | "blocked" | "unknown"

const MAX_PREVIEW_URL_BYTES = 2 * 1024
const MAX_ELEMENT_SELECTOR_BYTES = 4 * 1024
const MAX_ELEMENT_TEXT_BYTES = 16 * 1024
const MAX_ELEMENT_ATTRIBUTE_BYTES = 2 * 1024
const MAX_CONSOLE_MESSAGE_BYTES = 4 * 1024
const MAX_CONSOLE_SOURCE_BYTES = 512
const VISUAL_CHANGE_SAFE_STYLES = new Set([
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
])

function boundedString(value: unknown, max: number) {
  if (typeof value !== "string") return ""
  const bytes = new TextEncoder().encode(value)
  if (bytes.length <= max) return value
  return new TextDecoder().decode(bytes.slice(0, max))
}

const LOCAL_PREVIEW_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "[::1]"])

export function normalizePixelCrabPreviewBounds(input: PixelCrabPreviewBounds): PixelCrabPreviewBounds {
  return {
    x: Math.max(0, Math.round(input.x)),
    y: Math.max(0, Math.round(input.y)),
    width: Math.max(1, Math.round(input.width)),
    height: Math.max(1, Math.round(input.height)),
  }
}

export function resolvePixelCrabSelectionRectangle(input: PixelCrabSelectionRectangle) {
  const left = Number.isFinite(input.left) ? input.left! : input.x
  const top = Number.isFinite(input.top) ? input.top! : input.y
  const bottom = Number.isFinite(input.bottom) ? input.bottom! : top + input.height
  return { left, top, bottom }
}

export async function capturePixelCrabEvidenceScreenshots<T>(
  capture: (clip?: { x: number; y: number; width: number; height: number }) => Promise<T>,
  serialize: (image: T) => string,
  clip: { x: number; y: number; width: number; height: number },
) {
  const screenshot = await capture()
    .then(serialize)
    .catch(() => undefined)
  const regionScreenshot = await capture(clip)
    .then(serialize)
    .catch(() => undefined)
  return { screenshot, regionScreenshot }
}

export function resolvePixelCrabLocalPreviewURL(value: string) {
  if (new TextEncoder().encode(value).length > MAX_PREVIEW_URL_BYTES) return undefined
  if (!URL.canParse(value)) return undefined
  const url = new URL(value)
  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined
  if (url.username || url.password) return undefined
  if (!LOCAL_PREVIEW_HOSTS.has(url.hostname) && !url.hostname.endsWith(".localhost")) return undefined
  return url.href
}

export function resolvePixelCrabManualPreviewURL(value: string) {
  const trimmed = value.trim()
  if (new TextEncoder().encode(trimmed).length > MAX_PREVIEW_URL_BYTES) return undefined
  const candidate = URL.canParse(trimmed) || /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`
  if (!URL.canParse(candidate)) return undefined
  const url = new URL(candidate)
  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined
  if (url.username || url.password) return undefined
  return url.href
}

export function matchesPixelCrabPreviewRoute(current: string | undefined, route: string) {
  if (!current) return false
  const currentURL = resolvePixelCrabLocalPreviewURL(current)
  const issueURL = resolvePixelCrabLocalPreviewURL(route)
  if (!currentURL || !issueURL) return false
  const active = new URL(currentURL)
  const expected = new URL(issueURL)
  return active.origin === expected.origin && active.pathname === expected.pathname && active.search === expected.search
}

export function matchesPixelCrabEvidenceRoute(current: string | undefined, route: string) {
  if (!current) return false
  const currentURL = resolvePixelCrabLocalPreviewURL(current)
  const evidenceURL = resolvePixelCrabLocalPreviewURL(route)
  if (!currentURL || !evidenceURL) return false
  const active = new URL(currentURL)
  const expected = new URL(evidenceURL)
  return (
    active.origin === expected.origin &&
    active.pathname === expected.pathname &&
    active.search === expected.search &&
    active.hash === expected.hash
  )
}

export function classifyPixelCrabPreviewFailure(errorCode: number): PixelCrabPreviewFailureKind {
  if (errorCode === -202) return "tls"
  if (errorCode <= -100 && errorCode >= -199) return "unreachable"
  return "unknown"
}

export function sanitizePixelCrabPreviewError(value: string) {
  return boundedString(value.replace(/https?:\/\/[^\s]+/g, "preview URL"), 4 * 1024)
}

export function sanitizePixelCrabPreviewConsoleMessage(value: unknown) {
  const message = boundedString(value, MAX_CONSOLE_MESSAGE_BYTES)
  return message
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/\b(authorization|cookie|password|secret|token|session)(\s*[:=]\s*)([^\s,;]+)/gi, "$1$2[redacted]")
}

export function sanitizePixelCrabPreviewConsoleSource(value: unknown) {
  const source = boundedString(value, MAX_CONSOLE_SOURCE_BYTES)
  const local = resolvePixelCrabLocalPreviewURL(source)
  if (!local) return "preview"
  const url = new URL(local)
  return `${url.origin}${url.pathname}`
}

export function normalizePixelCrabElementText(value: unknown) {
  return boundedString(value, MAX_ELEMENT_TEXT_BYTES).trim().replace(/\s+/g, " ")
}

export function normalizePixelCrabElementSelector(value: unknown) {
  return boundedString(value, MAX_ELEMENT_SELECTOR_BYTES)
}

export function normalizePixelCrabElementAttributes(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  const sensitive = /password|secret|token|auth|cookie|session|value/i
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([name, attribute]) => !sensitive.test(name) && typeof attribute === "string" && !sensitive.test(attribute),
      )
      .slice(0, 64)
      .map(([name, attribute]) => [boundedString(name, 256), boundedString(attribute, MAX_ELEMENT_ATTRIBUTE_BYTES)]),
  )
}

export function normalizePixelCrabVisualChanges(
  input: Array<{
    id: string
    number: number
    route: string
    selector: string
    textContent?: string
    styles: Record<string, string>
  }>,
) {
  return input.slice(0, 100).flatMap((change) => {
    const id = boundedString(change.id, 256).trim()
    const route = resolvePixelCrabLocalPreviewURL(change.route)
    const selector = normalizePixelCrabElementSelector(change.selector).trim()
    if (!id || !route || !selector || !Number.isInteger(change.number) || change.number < 1) return []
    const styles = Object.fromEntries(
      Object.entries(change.styles).flatMap(([name, value]) => {
        const next = boundedString(value, 500).trim()
        if (!VISUAL_CHANGE_SAFE_STYLES.has(name) || !next || /url\s*\(|expression\s*\(|@import/i.test(next)) return []
        return [[name, next]]
      }),
    )
    const textContent = change.textContent === undefined ? undefined : boundedString(change.textContent, 2_000)
    if (textContent === undefined && Object.keys(styles).length === 0) return []
    return [{ id, number: change.number, route, selector, textContent, styles }]
  })
}

export function resolvePixelCrabInspectorSourceCandidate(value: unknown): PixelCrabSourceCandidate | undefined {
  const source = boundedString(value, MAX_ELEMENT_ATTRIBUTE_BYTES).trim()
  if (!source) return
  const segments = source.split(":")
  if (segments.length < 4) return
  const component = segments.pop()?.trim()
  const column = Number(segments.pop())
  const line = Number(segments.pop())
  const file = segments.join(":").trim()
  if (!file || !Number.isInteger(line) || line < 1 || !Number.isInteger(column) || column < 1) return
  return {
    file,
    line,
    column,
    component: component || undefined,
    confidence: 0.98,
    provider: "code-inspector-plugin",
  }
}

export function resolvePixelCrabPreviewEndpoint(value: string): PixelCrabPreviewEndpoint | undefined {
  const resolved = resolvePixelCrabLocalPreviewURL(value)
  if (!resolved) return
  const url = new URL(resolved)
  const host = url.hostname.replace(/^\[|\]$/g, "")
  return {
    // Chromium resolves isolated `runtime-*.localhost` hosts to the loopback
    // interface, while Node's socket resolver can prefer ::1. Preview
    // processes are intentionally bound to 127.0.0.1, so probe that same
    // endpoint instead of reporting a healthy page as unavailable.
    host: host === "localhost" || host.endsWith(".localhost") ? "127.0.0.1" : host,
    port: url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80,
  }
}

export function isPixelCrabPreviewNavigationCancelled(error: unknown) {
  if (!(error instanceof Error)) return false
  const candidate = error as Error & { code?: string; errno?: number }
  return candidate.code === "ERR_ABORTED" || candidate.errno === -3 || error.message.includes("ERR_ABORTED (-3)")
}
