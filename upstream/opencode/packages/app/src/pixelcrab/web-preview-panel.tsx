import { createEffect, createSignal, onCleanup, onMount, Show, untrack } from "solid-js"
import type { PixelCrabPreviewAPI, PixelCrabPreviewEvidenceContext, PixelCrabPreviewSelectionMode } from "./web-preview-contract"
import {
  addVisualChange, createVisualChangeSet, markVisualChangesStale, removeVisualChange,
  selectedVisualChanges, selectVisualChange, type VisualChangeItem,
} from "./visual-change-set"

export type WebPreviewPanelRuntime = {
  runtimeId: string
  projectId: string
  directory: string
  adapterId: string
  url: string
}

/** Presentation only. The owning session supplies the native composer and tool
 * results. No model calls, project edits or framework selection happen here. */
export function WebPreviewPanel(props: {
  api: PixelCrabPreviewAPI
  scope: string
  runtime?: WebPreviewPanelRuntime
  suspended?: boolean
  busy?: boolean
  onEvidence(evidence: PixelCrabPreviewEvidenceContext): void
  onChanges(items: readonly VisualChangeItem[]): void
  onClose(): void
}) {
  let viewport!: HTMLDivElement
  const [address, setAddress] = createSignal("")
  const [url, setUrl] = createSignal("")
  const [error, setError] = createSignal("")
  const [status, setStatus] = createSignal("Ask the Agent to preview this project, or enter a Web address.")
  const [mode, setMode] = createSignal<PixelCrabPreviewSelectionMode>("interact")
  const [changes, setChanges] = createSignal(createVisualChangeSet())
  const [panelOpen, setPanelOpen] = createSignal(false)
  const [mounted, setMounted] = createSignal(false)
  const [logs, setLogs] = createSignal<string>()
  let disposed = false
  let revision = 0
  let syncQueue = Promise.resolve()
  const report = (reason: unknown) => { if (!disposed) setError(reason instanceof Error ? reason.message : String(reason)) }
  const run = (operation: Promise<unknown>) => { void operation.catch(report) }
  const reset = () => {
    setChanges(createVisualChangeSet({ ...props.runtime, projectDirectory: props.runtime?.directory, route: url() }))
    setPanelOpen(false)
    run(props.api.setVisualChanges([]))
  }
  const selectMode = async (next: PixelCrabPreviewSelectionMode) => {
    if (next === mode()) return
    reset()
    await props.api.setSelectionMode(next)
    setMode(next)
  }
  const bounds = () => {
    const rect = viewport.getBoundingClientRect()
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
  }
  const sync = () => {
    const current = ++revision
    syncQueue = syncQueue.catch(() => {}).then(async () => {
      if (disposed || current !== revision) return
      if (props.suspended || logs() !== undefined || !url()) return props.api.hide()
      const runtime = props.runtime
      await props.api.show({
        url: url(), bounds: bounds(), scope: props.scope,
        ...(runtime && runtime.url === url() ? { runtimeId: runtime.runtimeId, projectId: runtime.projectId, adapterId: runtime.adapterId, source: "agent" as const } : { source: "manual" as const }),
      })
    })
    run(syncQueue)
  }
  const navigate = () => {
    try {
      const parsed = new URL(address())
      if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error("Use an HTTP or HTTPS URL without credentials.")
      reset()
      setError("")
      setUrl(parsed.href)
    } catch (reason) { report(reason) }
  }
  createEffect(() => {
    props.scope
    const runtime = props.runtime
    untrack(() => {
      setAddress(runtime?.url ?? "")
      setUrl(runtime?.url ?? "")
      setError("")
      reset()
      run(selectMode("interact"))
    })
  })
  createEffect(() => {
    props.suspended; props.scope; url(); logs()
    if (mounted()) sync()
  })
  createEffect(() => {
    const items = changes().items
    run(props.api.setVisualPanel(panelOpen() ? {
      title: "Visual changes", description: "Add targets to the current conversation. The Agent edits the source.",
      error: "", empty: "Select an element to record a change.", close: "Close", select: "Select", delete: "Remove",
      busy: props.busy === true,
      items: items.map(item => ({ id: item.id, number: item.number, label: item.label, detail: item.selector, description: item.description ?? "", status: item.status, selected: changes().selectedIds.includes(item.id) })),
      actions: [
        { id: "add", label: "Add to conversation", disabled: props.busy === true || selectedVisualChanges(changes()).length === 0 },
        { id: "clear", label: "Clear", disabled: props.busy === true || items.length === 0 },
      ],
    } : null))
    run(props.api.setVisualChanges(items.filter(item => item.status === "draft").map(item => ({
      id: item.id, number: item.number, route: item.route, selector: item.selector, textContent: item.text?.after,
      styles: Object.fromEntries(Object.entries(item.styles).flatMap(([key, value]) => value ? [[key, value.after]] : [])),
    }))))
  })
  onMount(() => {
    const unsubscribe = [
      props.api.onNavigation(state => {
        setAddress(state.url)
        setStatus(state.loading ? "Loading…" : "Preview ready")
        if (state.loading) setChanges(value => markVisualChangesStale(value, { route: state.url, pageRevision: -1, updatedAt: new Date().toISOString() }))
      }),
      props.api.onFailed(failure => setError(failure.errorDescription)),
      props.api.onHealth(health => setStatus(health.status === "running" ? "Preview connected" : health.status)),
      props.api.onEvidence(evidence => {
        if (props.suspended || logs() !== undefined || disposed) return
        if (evidence.visualChange) {
          try {
            setChanges(value => addVisualChange(value, evidence, { id: evidence.evidenceId, ...evidence.visualChange }))
            setPanelOpen(true)
          } catch (reason) { report(reason) }
          return
        }
        props.onEvidence(evidence)
      }),
      props.api.onVisualPanelAction(action => {
        if (action.action === "close") return setPanelOpen(false)
        if (props.busy) return
        if (action.action === "select" && action.id) setChanges(value => selectVisualChange(value, action.id!, action.selected === true))
        if (action.action === "delete" && action.id) setChanges(value => removeVisualChange(value, action.id!))
        if (action.action === "clear") reset()
        if (action.action === "add") {
          const selected = selectedVisualChanges(changes())
          if (!selected.length) return
          props.onChanges(selected)
          reset()
          run(selectMode("interact"))
        }
      }),
    ]
    const observer = new ResizeObserver(sync)
    observer.observe(viewport)
    window.addEventListener("resize", sync)
    setMounted(true)
    onCleanup(() => {
      disposed = true
      revision++
      observer.disconnect()
      window.removeEventListener("resize", sync)
      unsubscribe.forEach(stop => stop())
      // Serialize after any pending show so an unmounted session cannot reopen it.
      void syncQueue.catch(() => {}).then(() => props.api.hide()).catch(() => {})
      void props.api.setVisualPanel(null).catch(() => {})
    })
  })
  return <section class="flex min-w-0 flex-1 flex-col border-l border-border-base" aria-label="Web Preview">
    <form class="flex gap-2 p-2 border-b border-border-base" onSubmit={event => { event.preventDefault(); navigate() }}>
      <input class="min-w-0 flex-1 px-2" aria-label="Preview URL" value={address()} onInput={event => setAddress(event.currentTarget.value)} placeholder="http://localhost:…" />
      <button type="submit">Open</button>
      <button type="button" onClick={() => run(props.api.command("reload"))}>Refresh</button>
      <button type="button" onClick={props.onClose} aria-label="Close preview">×</button>
    </form>
    <div class="flex flex-wrap gap-3 p-2 border-b border-border-base">
      {([ ["interact", "Browse"], ["element", "Point"], ["region", "Region"], ["visual", "Multi-select"] ] as const).map(([key, label]) =>
        <button aria-pressed={mode() === key} onClick={() => run(selectMode(key))}>{label}</button>)}
      <button onClick={() => setPanelOpen(value => !value)}>Changes ({changes().items.length})</button>
      <button onClick={() => {
        if (logs() !== undefined) return setLogs(undefined)
        run(props.api.diagnostics().then(result => setLogs(result?.console.map(entry => entry.message).join("\n") || "No browser logs.")))
      }}>Logs</button>
    </div>
    <div class="px-2 text-xs" role="status">{error() || status()}</div>
    <div ref={viewport} class="relative flex-1 min-h-0">
      <Show when={logs() !== undefined}><pre class="absolute inset-0 overflow-auto whitespace-pre-wrap p-3">{logs()}</pre></Show>
    </div>
  </section>
}
