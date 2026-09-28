export type EvidenceRecheckLifecycle = {
  evidenceId?: string
  phase: "idle" | "awaiting_task" | "task_running"
  busy: boolean
}

export type EvidenceRecheckTransition = {
  state: EvidenceRecheckLifecycle
  recheckEvidenceId?: string
}

export function createEvidenceRecheckLifecycle(busy = false): EvidenceRecheckLifecycle {
  return { phase: "idle", busy }
}

export function captureEvidenceForRecheck(
  state: EvidenceRecheckLifecycle,
  evidenceId: string,
  busy: boolean,
): EvidenceRecheckLifecycle {
  return { evidenceId, phase: "awaiting_task", busy }
}

export function observeEvidenceTaskState(
  state: EvidenceRecheckLifecycle,
  busy: boolean,
): EvidenceRecheckTransition {
  if (!state.evidenceId || state.phase === "idle") return { state: { phase: "idle", busy } }

  if (state.phase === "awaiting_task") {
    if (!state.busy && busy) return { state: { ...state, phase: "task_running", busy: true } }
    return { state: { ...state, busy } }
  }

  if (busy) return { state: { ...state, busy: true } }
  return {
    state: { phase: "idle", busy: false },
    recheckEvidenceId: state.evidenceId,
  }
}
