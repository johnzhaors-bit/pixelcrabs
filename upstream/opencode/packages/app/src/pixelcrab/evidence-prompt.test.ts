import { describe, expect, test } from "bun:test"
import {
  createPixelCrabEvidenceAttachment,
  createPixelCrabEvidenceImageAttachment,
  createPixelCrabEvidenceImageAttachments,
  createPixelCrabUXIssueAttachment,
  formatPixelCrabElementEvidence,
} from "./evidence-prompt"
import type { PixelCrabElementEvidence } from "./evidence-prompt"

describe("PixelCrab element evidence prompt", () => {
  test("serializes the selected element as structured prompt context", () => {
    const output = formatPixelCrabElementEvidence(
      {
        evidenceId: "evidence-1",
        capturedAt: "2026-08-07T10:00:00.000Z",
        pageRevision: 3,
        status: "active",
        source: "selected_element",
        route: "http://localhost:5173/tasks",
        boundingBox: { x: 10, y: 20, width: 120, height: 40 },
        domSelector: "#save",
        domSnapshot: { tagName: "button", id: "save", classNames: ["primary"], attributes: { type: "button" } },
        computedStyles: { color: "rgb(0, 0, 0)" },
        textContent: "Save",
        sourceCandidates: [
          {
            file: "src/main.tsx",
            line: 15,
            column: 7,
            component: "button",
            confidence: 0.98,
            provider: "code-inspector-plugin",
          },
        ],
        captureLevel: "L2_partial",
      },
      "Make this button red",
    )

    expect(output).toContain('"_instruction"')
    expect(output).toContain('"selector": "#save"')
    expect(output).toContain('"tagName": "button"')
    expect(output).toContain('"route": "http://localhost:5173/tasks"')
    expect(output).toContain('"userRequest": "Make this button red"')
    expect(output).toContain('"pageRevision": 3')
    expect(output).toContain('"file": "src/main.tsx"')
    expect(output).toContain('"sourcePrecision": "exact"')

    const attachment = createPixelCrabEvidenceAttachment({
      evidenceId: "evidence-1",
      capturedAt: "2026-08-07T10:00:00.000Z",
      pageRevision: 3,
      status: "active",
      source: "selected_element",
      route: "http://localhost:5173/tasks",
      boundingBox: { x: 10, y: 20, width: 120, height: 40 },
      domSelector: "#save",
      domSnapshot: { tagName: "button", id: "save", classNames: [], attributes: {} },
      computedStyles: {},
      sourceCandidates: [],
      captureLevel: "L1_visual",
    })
    expect(attachment.label).toBe("PixelCrab · button#save")
    expect(attachment.filename).toEndWith(".txt")
    expect(attachment.mime).toBe("text/plain")
    expect(attachment.url).toStartWith("data:text/plain;base64,")
  })

  test("keeps region bounds separate from its DOM source anchor", () => {
    const evidence: PixelCrabElementEvidence = {
      evidenceId: "evidence-region-1",
      capturedAt: "2026-08-07T10:00:00.000Z",
      pageRevision: 4,
      status: "active",
      source: "selected_region",
      route: "http://localhost:5173/tasks",
      boundingBox: { x: 20, y: 30, width: 320, height: 180 },
      selectionBounds: { x: 60, y: 70, width: 140, height: 90 },
      domSelector: "main > section",
      domSnapshot: { tagName: "section", classNames: ["tasks"], attributes: {} },
      computedStyles: { display: "grid" },
      sourceCandidates: [],
      regionScreenshot: "data:image/png;base64,cG5n",
      screenshot: "data:image/png;base64,ZnVsbA==",
      captureLevel: "L1_visual",
    }
    const output = formatPixelCrabElementEvidence(evidence)

    expect(output).toContain('"source": "selected_region"')
    expect(output).toContain('"selectionBounds"')
    expect(output).toContain('"selector": "main > section"')
    expect(output).toContain('"sourcePrecision": "visual_only"')
    expect(output).toContain('"captureLevel": "L1_visual"')
    expect(output).toContain('"regionScreenshotAttached": true')
    expect(output).toContain('"fullContextScreenshotAttached": true')
    expect(createPixelCrabEvidenceImageAttachment(evidence)).toEqual({
      label: "PixelCrab visual evidence evidence-region-1",
      filename: "pixelcrab-region-evidence-region-1.png",
      mime: "image/png",
      url: "data:image/png;base64,cG5n",
    })
    expect(createPixelCrabEvidenceImageAttachments(evidence)).toHaveLength(2)
    expect(createPixelCrabEvidenceImageAttachments(evidence)[1]).toEqual({
      label: "PixelCrab page context evidence-region-1",
      filename: "pixelcrab-context-evidence-region-1.png",
      mime: "image/png",
      url: "data:image/png;base64,ZnVsbA==",
    })
  })

  test("does not attach a screenshot when a selected element has a precise source anchor", () => {
    expect(
      createPixelCrabEvidenceImageAttachment({
        evidenceId: "evidence-exact-1",
        capturedAt: "2026-08-07T10:00:00.000Z",
        pageRevision: 4,
        status: "active",
        source: "selected_element",
        route: "http://localhost:5173/tasks",
        boundingBox: { x: 20, y: 30, width: 120, height: 40 },
        regionScreenshot: "data:image/png;base64,cG5n",
        domSelector: "#save",
        domSnapshot: { tagName: "button", id: "save", classNames: [], attributes: {} },
        computedStyles: {},
        sourceCandidates: [
          { file: "src/main.tsx", line: 10, confidence: 0.99, provider: "code-inspector-plugin" },
        ],
        captureLevel: "L2_partial",
      }),
    ).toBeUndefined()
  })

  test("serializes a UX issue as text evidence for the normal Agent flow", () => {
    const attachment = createPixelCrabUXIssueAttachment(
      {
        evidenceId: "ux-issue-1",
        source: "ux_issue",
        route: "http://localhost:5173/tasks",
        boundingBox: { x: 10, y: 20, width: 300, height: 80 },
        uxIssueIds: ["issue-1"],
        uxCheckReportId: "report-1",
        title: "Text contrast is low",
        description: "The secondary copy is difficult to read.",
        suggestion: "Increase the text contrast.",
        evidenceIds: ["capture-1"],
        confidence: 0.91,
        fixability: "needs_confirmation",
      },
      "Increase the text contrast without changing layout.",
    )

    expect(attachment.label).toBe("PixelCrab UX · Text contrast is low")
    expect(attachment.filename).toBe("pixelcrab-ux-issue-ux-issue-1.txt")
    expect(attachment.mime).toBe("text/plain")
    expect(attachment.url).toStartWith("data:text/plain;base64,")
    const payload = new TextDecoder().decode(
      Uint8Array.from(atob(attachment.url.split(",")[1]), (character) => character.charCodeAt(0)),
    )
    expect(payload).toContain('"source": "ux_issue"')
    expect(payload).toContain('"uxCheckReportId": "report-1"')
    expect(payload).toContain("normal source-location, ChangeSet, and verification flow")
  })
})
