import { describe, expect, test } from "bun:test"
import {
  captureEvidenceForRecheck,
  createEvidenceRecheckLifecycle,
  observeEvidenceTaskState,
} from "./evidence-recheck-lifecycle"

describe("preview evidence recheck lifecycle", () => {
  test("rechecks once after the task submitted for captured evidence finishes", () => {
    let state = captureEvidenceForRecheck(createEvidenceRecheckLifecycle(), "evidence-1", false)
    let transition = observeEvidenceTaskState(state, true)
    expect(transition.recheckEvidenceId).toBeUndefined()
    state = transition.state

    transition = observeEvidenceTaskState(state, false)
    expect(transition.recheckEvidenceId).toBe("evidence-1")
    expect(observeEvidenceTaskState(transition.state, false).recheckEvidenceId).toBeUndefined()
  })

  test("does not mistake an already-running unrelated task for the evidence task", () => {
    let state = captureEvidenceForRecheck(createEvidenceRecheckLifecycle(true), "evidence-2", true)
    let transition = observeEvidenceTaskState(state, false)
    expect(transition.recheckEvidenceId).toBeUndefined()
    state = transition.state

    transition = observeEvidenceTaskState(state, true)
    expect(transition.recheckEvidenceId).toBeUndefined()
    state = transition.state

    transition = observeEvidenceTaskState(state, false)
    expect(transition.recheckEvidenceId).toBe("evidence-2")
  })

  test("uses the newest selection when the user continues selecting before submitting", () => {
    let state = captureEvidenceForRecheck(createEvidenceRecheckLifecycle(), "evidence-old", false)
    state = captureEvidenceForRecheck(state, "evidence-new", false)
    state = observeEvidenceTaskState(state, true).state
    expect(observeEvidenceTaskState(state, false).recheckEvidenceId).toBe("evidence-new")
  })
})
