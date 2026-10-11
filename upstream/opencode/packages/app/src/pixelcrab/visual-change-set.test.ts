import { describe, expect, test } from "bun:test"
import type { PixelCrabElementEvidence } from "./evidence-prompt"
import {
  addVisualChange,
  createVisualChangeSet,
  formatVisualChangesAIPrompt,
  markVisualChangesStale,
  removeVisualChange,
  selectedVisualChanges,
  selectVisualChange,
  visualChangesAIPayload,
  visualChangeRecheckExpectation,
  visualChangeRecheckPassed,
} from "./visual-change-set"

const evidence: PixelCrabElementEvidence = {
  evidenceId: "evidence-1",
  runtimeId: "runtime-1",
  projectId: "project-1",
  capturedAt: "2026-08-28T08:00:00.000Z",
  pageRevision: 3,
  status: "active",
  source: "selected_element",
  route: "http://127.0.0.1:5173/",
  boundingBox: { x: 10, y: 20, width: 100, height: 40 },
  domSelector: "#buy",
  domSnapshot: { tagName: "button", id: "buy", classNames: ["primary"], attributes: { id: "buy" } },
  computedStyles: { color: "rgb(255, 255, 255)", "background-color": "rgb(0, 0, 255)" },
  textContent: "立即购买",
  sourceCandidates: [{ file: "src/BuyButton.tsx", line: 12, confidence: 0.99, provider: "code-inspector-plugin" }],
  captureLevel: "L2_partial",
}

describe("visual change set", () => {
  test("records only changed safe values and assigns a stable marker number", () => {
    const result = addVisualChange(createVisualChangeSet(), evidence, {
      id: "change-1",
      textContent: "确认购买",
      description: "  更突出一些  ",
      styles: { color: "rgb(255, 255, 255)", "background-color": "#6750a4", position: "fixed" },
      capturedAt: "2026-08-28T08:01:00.000Z",
    })
    expect(result.items[0]).toMatchObject({
      id: "change-1",
      number: 1,
      label: "立即购买",
      description: "更突出一些",
      text: { before: "立即购买", after: "确认购买" },
      styles: { "background-color": { before: "rgb(0, 0, 255)", after: "#6750a4" } },
      status: "draft",
    })
    expect(result.items[0]?.styles).not.toHaveProperty("position")
    expect(selectedVisualChanges(result)).toHaveLength(1)
    expect(visualChangeRecheckExpectation(result.items[0]!)).toMatchObject({
      evidenceId: "change-1",
      textContent: "确认购买",
      computedStyles: {
        color: "rgb(255, 255, 255)",
        "background-color": "#6750a4",
      },
    })
    expect(structuredClone(visualChangeRecheckExpectation(result.items[0]!))).toBeDefined()
  })

  test("accepts recheck results that reached the saved visual target", () => {
    const result = addVisualChange(createVisualChangeSet(), evidence, {
      id: "change-1",
      textContent: "确认购买",
      styles: { "background-color": "#6750a4" },
      capturedAt: "2026-08-28T08:01:00.000Z",
    })
    const item = result.items[0]!

    expect(
      visualChangeRecheckPassed(item, {
        evidenceId: item.id,
        status: "matched",
        textContent: "确认购买",
        computedStyles: { color: "rgb(255, 255, 255)", "background-color": "#6750a4" },
        changes: { textContent: true, computedStyles: ["background-color"] },
      }),
    ).toBe(true)

    expect(
      visualChangeRecheckPassed(item, {
        evidenceId: item.id,
        status: "matched",
        textContent: "立即购买",
        computedStyles: { color: "rgb(255, 255, 255)", "background-color": "#6750a4" },
        changes: { textContent: false, computedStyles: [] },
      }),
    ).toBe(false)

    expect(
      visualChangeRecheckPassed(item, {
        evidenceId: item.id,
        status: "missing",
        changes: { textContent: false, computedStyles: [] },
      }),
    ).toBe(false)
  })

  test("requires actual target values from the same evidence before confirming a change", () => {
    const item = addVisualChange(createVisualChangeSet(), evidence, {
      id: "change-verified",
      textContent: "Updated",
      styles: { color: "#111111" },
    }).items[0]!
    const matched = { evidenceId: item.id, status: "matched" as const }
    expect(visualChangeRecheckPassed(item, matched)).toBe(false)
    expect(visualChangeRecheckPassed(item, { ...matched, changes: { textContent: false, computedStyles: [] } })).toBe(false)
    expect(visualChangeRecheckPassed(item, { ...matched, textContent: "Updated" })).toBe(false)
    expect(visualChangeRecheckPassed(item, { ...matched, computedStyles: { color: "#111111" } })).toBe(false)
    expect(visualChangeRecheckPassed(item, {
      ...matched, evidenceId: "unrelated", textContent: "Updated", computedStyles: { color: "#111111" },
    })).toBe(false)
    expect(visualChangeRecheckPassed(item, {
      ...matched, textContent: "Updated", computedStyles: { color: "rgb(17, 17, 17)" },
    })).toBe(true)
  })

  test("serializes selected visual changes with markers and location evidence for the Agent", () => {
    const first = addVisualChange(
      createVisualChangeSet({ projectDirectory: "D:\\PixelCrab\\preview-acceptance" }),
      evidence,
      {
        id: "change-1",
        textContent: "确认购买",
        capturedAt: "2026-08-28T08:01:00.000Z",
      },
    )
    const secondEvidence: PixelCrabElementEvidence = {
      ...evidence,
      evidenceId: "evidence-2",
      domSelector: ".hero-title",
      domSnapshot: { tagName: "h1", classNames: ["hero-title"], attributes: { class: "hero-title" } },
      boundingBox: { x: 16, y: 40, width: 320, height: 60 },
      textContent: "旧标题",
      sourceCandidates: [],
      captureLevel: "L1_visual",
    }
    const second = addVisualChange(first, secondEvidence, {
      id: "change-2",
      styles: { color: "#111111", "font-size": "32px" },
      capturedAt: "2026-08-28T08:02:00.000Z",
    })

    expect(visualChangesAIPayload(selectedVisualChanges(second))).toEqual([
      {
        id: "change-1",
        number: 1,
        runtimeId: "runtime-1",
        projectId: "project-1",
        projectDirectory: "D:\\PixelCrab\\preview-acceptance",
        route: "http://127.0.0.1:5173/",
        pageRevision: 3,
        selector: "#buy",
        boundingBox: { x: 10, y: 20, width: 100, height: 40 },
        element: { tagName: "button", id: "buy", classNames: ["primary"], attributes: { id: "buy" } },
        sourceCandidates: [
          { file: "src/BuyButton.tsx", line: 12, confidence: 0.99, provider: "code-inspector-plugin" },
        ],
        description: undefined,
        text: { before: "立即购买", after: "确认购买" },
        styles: {},
      },
      {
        id: "change-2",
        number: 2,
        runtimeId: "runtime-1",
        projectId: "project-1",
        projectDirectory: "D:\\PixelCrab\\preview-acceptance",
        route: "http://127.0.0.1:5173/",
        pageRevision: 3,
        selector: ".hero-title",
        boundingBox: { x: 16, y: 40, width: 320, height: 60 },
        element: { tagName: "h1", classNames: ["hero-title"], attributes: { class: "hero-title" } },
        sourceCandidates: [],
        description: undefined,
        text: undefined,
        styles: {
          color: { before: "rgb(255, 255, 255)", after: "#111111" },
          "font-size": { before: "", after: "32px" },
        },
      },
    ])

    const prompt = formatVisualChangesAIPrompt("Apply these recorded targets.", selectedVisualChanges(second))
    expect(prompt).toContain("Apply these recorded targets.")
    expect(prompt).toContain("Completion contract:")
    expect(prompt).toContain("projectDirectory")
    expect(prompt).toContain("D:\\\\PixelCrab\\\\preview-acceptance")
    expect(prompt).toContain('marker 1: selector "#buy" must end with textContent="确认购买"')
    expect(prompt).toContain("The marker numbers are visual labels only")
    expect(prompt).toContain('"number": 1')
    expect(prompt).toContain('"number": 2')
    expect(prompt).toContain('"selector": "#buy"')
    expect(prompt).toContain('"selector": ".hero-title"')
    expect(prompt).toContain('"before": "立即购买"')
    expect(prompt).toContain('"after": "确认购买"')
    expect(prompt).toContain('"boundingBox"')
  })

  test("matches color styles after browser normalization", () => {
    const result = addVisualChange(createVisualChangeSet(), evidence, {
      id: "change-1",
      styles: { color: "#b91c1c", "background-color": "#1d4ed8" },
      capturedAt: "2026-08-28T08:01:00.000Z",
    })
    const item = result.items[0]!

    expect(
      visualChangeRecheckPassed(item, {
        evidenceId: item.id,
        status: "matched",
        computedStyles: { color: "rgb(185, 28, 28)", "background-color": "rgb(29, 78, 216)" },
        changes: { computedStyles: ["color", "background-color"] },
      }),
    ).toBe(true)
  })

  test("rejects empty changes and evidence from another project", () => {
    expect(() => addVisualChange(createVisualChangeSet(), evidence, { id: "empty", textContent: "立即购买" })).toThrow()
    expect(() =>
      addVisualChange(createVisualChangeSet({ projectId: "another-project" }), evidence, {
        id: "wrong-project",
        textContent: "新的文字",
      }),
    ).toThrow("different project")
  })

  test("supports selection, removal and stale lifecycle without renumbering", () => {
    const initial = addVisualChange(createVisualChangeSet(), evidence, {
      id: "change-1",
      styles: { color: "#111111" },
      capturedAt: "2026-08-28T08:01:00.000Z",
    })
    const unselected = selectVisualChange(initial, "change-1", false)
    expect(selectedVisualChanges(unselected)).toEqual([])
    const stale = markVisualChangesStale(initial, {
      runtimeId: "runtime-1",
      projectId: "project-1",
      route: evidence.route,
      pageRevision: 4,
      updatedAt: "2026-08-28T08:02:00.000Z",
    })
    expect(stale.items[0]).toMatchObject({ number: 1, status: "stale" })
    expect(removeVisualChange(stale, "change-1").items).toEqual([])
  })
})
