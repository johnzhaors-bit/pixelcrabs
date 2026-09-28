import { createPromptProjectController } from "@/components/prompt-project-selector"
import { useTitlebarRightMount } from "@/components/titlebar"
import { useSettings } from "@/context/settings"
import { createEffect, createResource, createSignal, Show } from "solid-js"
import { useSearchParams } from "@solidjs/router"
import { WebPreviewSession, publicWebPreviewAPI } from "@/pixelcrab/web-preview-session"
import { createNewSessionDraftController } from "./new-session/new-session-draft-controller"
import { NewSessionStatus, NewSessionView } from "./new-session/new-session-view"
import { createNewSessionWorkspaceController } from "./new-session/new-session-workspace-controller"
import { useNewSessionCommands } from "./new-session/use-new-session-commands"

/** The draft-only V2 session page. Submitting promotes the draft into a real session. */
export default function NewSessionPage() {
  const [webPreviewOpen, setWebPreviewOpen] = createSignal(!!publicWebPreviewAPI())
  const [search] = useSearchParams<{ draftId?: string }>()
  const settings = useSettings()
  const rightMount = useTitlebarRightMount()
  const workspace = createNewSessionWorkspaceController()
  const draft = createNewSessionDraftController({
    worktree: workspace.selection.value,
    resetWorktree: workspace.selection.reset,
  })
  const project = createPromptProjectController({
    controls: draft.project.controls,
    onDone: draft.input.restoreFocus,
  })
  useNewSessionCommands({
    restoreFocus: draft.input.restoreFocus,
    project: {
      empty: project.empty,
      open: () => project.setOpen(true),
    },
  })
  createEffect(() => {
    if (!draft.prompt.ready()) return
    draft.input.restoreFocus()
  })
  const ready = Promise.resolve()
  const [suspendUntilPromptReady] = createResource(
    () => draft.prompt.readyPromise() ?? ready,
    (promise) => promise.then(() => true),
  )

  return (
    <div class="relative size-full overflow-hidden flex flex-col">
      {suspendUntilPromptReady()}
      <NewSessionStatus mount={rightMount} visible={settings.visibility.status} />
      <Show when={publicWebPreviewAPI()}><button class="px-3 py-1 text-xs text-left" onClick={() => setWebPreviewOpen(value => !value)}>Web Preview</button></Show>
      <div class="flex flex-1 min-h-0"><div class="min-h-0 flex flex-col gap-2 p-2" style={{ width: webPreviewOpen() ? "42%" : "100%" }}>
        <NewSessionView input={draft.input} project={project} workspace={workspace} />
      </div>
        <Show when={publicWebPreviewAPI() && webPreviewOpen()}><WebPreviewSession scope={`draft:${search.draftId ?? ""}`} onClose={() => setWebPreviewOpen(false)} /></Show>
      </div>
    </div>
  )
}
