import { createEffect, createMemo, createSignal, onCleanup, Show } from "solid-js"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { usePrompt } from "@/context/prompt"
import { useSync } from "@/context/sync"
import type { ContentPart } from "@/context/prompt-state"
import { WebPreviewPanel, type WebPreviewPanelRuntime } from "./web-preview-panel"
import type { PixelCrabPreviewAPI, PixelCrabPreviewRecheckInput } from "./web-preview-contract"
import { createPixelCrabEvidenceAttachment, createPixelCrabEvidenceImageAttachments } from "./evidence-prompt"
import { formatVisualChangesAIPrompt, visualChangeRecheckExpectation, visualChangeRecheckPassed, type VisualChangeItem } from "./visual-change-set"

export function publicWebPreviewAPI(): PixelCrabPreviewAPI | undefined {
  if (typeof window === "undefined") return
  return (window as Window & { api?: { pixelcrabPreview?: PixelCrabPreviewAPI } }).api?.pixelcrabPreview
}

/** Attach to the current native draft only; sending, model selection, editing
 * and permissions remain entirely owned by the original OpenCode session. */
export function WebPreviewSession(props: { sessionID?: string; scope: string; onClose(): void }) {
  const api = publicWebPreviewAPI()
  if (!api) return null
  const prompt = usePrompt()
  const sync = useSync()
  const dialog = useDialog()
  const [verification, setVerification] = createSignal("")
  const busy = createMemo(() => !!props.sessionID && sync().data.session_status[props.sessionID]?.type !== undefined && sync().data.session_status[props.sessionID]?.type !== "idle")
  const runtime = createMemo<WebPreviewPanelRuntime | undefined>(() => {
    if (!props.sessionID) return
    let selected: WebPreviewPanelRuntime | undefined
    for (const message of sync().data.message[props.sessionID] ?? []) {
      for (const part of sync().data.part[message.id] ?? []) {
        if (part.type !== "tool" || part.tool !== "pixelcrabs_preview" || part.state.status !== "completed") continue
        const facts = part.state.metadata?.pixelcrabsPreview as Record<string, unknown> | undefined
        if (!facts || typeof facts !== "object") continue
        if (facts.status === "stopped" && selected?.runtimeId === facts.runtimeId) selected = undefined
        if (facts.status !== "running" || facts.projectIdentityVerified !== true) continue
        const record = facts.record as Record<string, unknown> | undefined
        if (!record || record.conversationId !== props.sessionID || record.health !== "running") continue
        const keys = ["runtimeId", "projectId", "directory", "adapterId", "url"] as const
        if (!keys.every(key => typeof record[key] === "string")) continue
        selected = Object.fromEntries(keys.map(key => [key, record[key]])) as WebPreviewPanelRuntime
      }
    }
    return selected
  }, undefined, { equals: (left, right) => left?.runtimeId === right?.runtimeId && left?.url === right?.url && left?.projectId === right?.projectId })
  let pending: { scope: string; requests: PixelCrabPreviewRecheckInput[]; items?: readonly VisualChangeItem[]; phase: "waiting" | "running"; previousBusy: boolean } | undefined
  let generation = 0
  let disposed = false
  const append = (text: string, attachments: Array<{ label: string; filename: string; mime: string; url: string }> = []) => {
    const target = prompt.capture()
    const current = target.current()
    let offset = current.reduce((sum, part) => sum + ("content" in part ? part.content.length : 0), 0)
    const additions: ContentPart[] = []
    if (text) {
      const content = (offset ? "\n" : "") + text
      additions.push({ type: "text", content, start: offset, end: offset + content.length })
      offset += content.length
    }
    for (const attachment of attachments) {
      additions.push({ type: "file", content: attachment.label, path: `.pixelcrab/evidence/${attachment.filename}`, start: offset, end: offset + attachment.label.length, filename: attachment.filename, mime: attachment.mime, url: attachment.url })
      offset += attachment.label.length
    }
    target.set([...current, ...additions], offset)
  }
  const arm = (requests: PixelCrabPreviewRecheckInput[], items?: readonly VisualChangeItem[]) => {
    generation++
    pending = { scope: props.scope, requests, items, phase: "waiting", previousBusy: busy() }
    setVerification("Added to the conversation draft. Send your request to apply changes.")
  }
  createEffect(() => {
    const currentBusy = busy()
    const scope = props.scope
    const task = pending
    if (!task) return
    if (task.scope !== scope) { pending = undefined; generation++; setVerification(""); return }
    if (task.phase === "waiting") {
      if (!task.previousBusy && currentBusy) task.phase = "running"
      task.previousBusy = currentBusy
      return
    }
    if (currentBusy) return
    pending = undefined
    const requestGeneration = generation
    setVerification("Rechecking the preview…")
    void Promise.all(task.requests.map(request => api.recheck(request))).then(results => {
      if (disposed || requestGeneration !== generation || props.scope !== scope) return
      const passed = task.items
        ? task.items.every(item => { const result = results.find(result => result.evidenceId === item.id); return !!result && visualChangeRecheckPassed(item, result) })
        : results.every(result => result.status === "matched" && result.lifecycleStatus === "revalidated")
      setVerification(passed ? (task.items ? "Recorded visual targets verified." : "Selected evidence relocated. Review the preview to confirm your request.") : "Preview verification incomplete. Inspect the page and retry with the Agent.")
    }).catch(error => {
      if (!disposed && requestGeneration === generation) setVerification(error instanceof Error ? error.message : "Preview verification failed.")
    })
  })
  onCleanup(() => { disposed = true; generation++; pending = undefined })
  return <div class="flex flex-col flex-1 min-w-0 min-h-0">
    <WebPreviewPanel api={api} scope={props.scope} runtime={runtime()} suspended={!!dialog.active} busy={busy()} onClose={props.onClose}
      onEvidence={evidence => {
        append(evidence.userRequest, [createPixelCrabEvidenceAttachment(evidence, evidence.userRequest), ...createPixelCrabEvidenceImageAttachments(evidence)])
        arm([evidence])
      }}
      onChanges={items => {
        append(formatVisualChangesAIPrompt("Apply these recorded visual targets to the project source and verify the preview.", items))
        arm(items.map(visualChangeRecheckExpectation), items)
      }}
    />
    <Show when={verification()}><div role="status" class="p-2 text-xs">{verification()}</div></Show>
  </div>
}
