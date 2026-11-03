import { describe, expect, it } from "vitest"

import { DRAFT_TEXT_FIELDS, withDraftQuery, type DraftFormValues } from "./draft-params"
import {
  firstInvalidJobEditorField,
  firstIncompleteJobEditorStep,
  JOB_EDITOR_STEP_FIELDS,
  jobEditorChecklist,
  jobEditorIssuesThrough,
  jobEditorPreview,
  jobEditorStepForField,
  resolveJobEditorScreen
} from "./job-editor"
import { DEFAULT_JOB_POSTING_TAB, jobPostingTab, jobPostingTabCounts, jobPostingTabHref, parseJobPostingTab } from "./job-postings"

const LANDING = { areaLabel: "Oakridge, OR", id: "66666666-6666-4666-8666-666666666666", name: "Landing 7", stateCode: "OR" }
const LANDINGS = [LANDING]

const COMPLETE: DraftFormValues = {
  equipment: ["log_truck"],
  text: {
    durationDays: "10",
    landingId: LANDING.id,
    payAmount: "525",
    payUnit: "per_load",
    product: "Saw logs",
    startsOn: "2026-11-10",
    title: "Oak saw logs to Cascade Mill",
    trucksRequested: "4"
  }
}

function without(values: DraftFormValues, ...fields: string[]): DraftFormValues {
  const text = { ...values.text }
  for (const field of fields) delete text[field as keyof typeof text]
  return { equipment: fields.includes("equipment") ? [] : values.equipment, text }
}

const fieldsOf = (issues: ReadonlyArray<{ field: string }>) => issues.map((issue) => issue.field).sort()

describe("job editor steps", () => {
  it("puts every draft field on exactly one step", () => {
    const placed = Object.values(JOB_EDITOR_STEP_FIELDS).flat()

    expect([...placed].sort()).toEqual([...DRAFT_TEXT_FIELDS, "equipment"].sort())
    expect(new Set(placed).size).toBe(placed.length)
  })

  it("shows group and unknown issues on the right step", () => {
    expect(jobEditorStepForField("workPeriod")).toBe("pay")
    expect(jobEditorStepForField("equipment")).toBe("equipment")
    expect(jobEditorStepForField("form")).toBe("basics")
  })

  it("checks a step on its own, without blocking on later steps", () => {
    const basicsOnly: DraftFormValues = { equipment: [], text: { landingId: LANDING.id, product: "Saw logs", title: "Oak saw logs" } }

    expect(jobEditorIssuesThrough(basicsOnly, LANDINGS, "basics")).toEqual([])
    // Through pay, a missing truck count reads as blank (the contract's own message), not "Required".
    expect(fieldsOf(jobEditorIssuesThrough(basicsOnly, LANDINGS, "pay"))).toEqual(["payUnit", "startsOn", "trucksRequested", "workPeriod"])
  })

  it("reports a whole step's issues at once, including the publishing rules", () => {
    expect(fieldsOf(jobEditorIssuesThrough({ equipment: [], text: {} }, LANDINGS, "basics"))).toEqual(["landingId", "product", "title"])
    expect(fieldsOf(jobEditorIssuesThrough(without(COMPLETE, "payUnit", "payAmount", "startsOn", "durationDays"), LANDINGS, "pay"))).toEqual([
      "payUnit",
      "startsOn",
      "workPeriod"
    ])
  })

  it("flags a landing that is not the organization's own", () => {
    const issues = jobEditorIssuesThrough({ ...COMPLETE, text: { ...COMPLETE.text, landingId: "99999999-9999-4999-8999-999999999999" } }, LANDINGS, "basics")
    expect(issues).toEqual([{ field: "landingId", message: "Choose one of your organization's landings" }])
  })

  it("words generic schema messages for people", () => {
    const issues = jobEditorIssuesThrough({ ...COMPLETE, text: { ...COMPLETE.text, estTonsPerLoad: "lots" } }, LANDINGS, "equipment")
    expect(issues).toEqual([{ field: "estTonsPerLoad", message: "Enter a number" }])
  })

  it("finds the first incomplete step before a target", () => {
    expect(firstIncompleteJobEditorStep(COMPLETE, LANDINGS)).toBeNull()
    expect(firstIncompleteJobEditorStep(without(COMPLETE, "equipment"), LANDINGS)?.step).toBe("equipment")
    expect(firstIncompleteJobEditorStep(without(COMPLETE, "title", "equipment"), LANDINGS)?.step).toBe("basics")
    expect(firstIncompleteJobEditorStep(without(COMPLETE, "equipment"), LANDINGS, "equipment")).toBeNull()
  })

  it("focuses the first invalid field in screen order", () => {
    expect(firstInvalidJobEditorField("pay", [{ field: "trucksRequested", message: "" }, { field: "workPeriod", message: "" }])).toBe("workPeriod")
    expect(firstInvalidJobEditorField("basics", [{ field: "product", message: "" }, { field: "title", message: "" }])).toBe("title")
  })
})

describe("resolving the editor screen", () => {
  it("validates forward moves and never backward ones", () => {
    expect(resolveJobEditorScreen({ from: "basics", step: "pay" }, { equipment: [], text: {} }, LANDINGS)).toMatchObject({ kind: "step", step: "basics" })
    expect(resolveJobEditorScreen({ from: "pay", step: "basics" }, { equipment: [], text: {} }, LANDINGS)).toEqual({ issues: [], kind: "step", step: "basics" })
    expect(resolveJobEditorScreen({ step: "equipment" }, { equipment: [], text: {} }, LANDINGS)).toEqual({ issues: [], kind: "step", step: "equipment" })
  })

  it("reaches the review only when steps 1–3 pass", () => {
    expect(resolveJobEditorScreen({ from: "equipment", step: "review" }, COMPLETE, LANDINGS)).toEqual({ kind: "review" })
    expect(resolveJobEditorScreen({ step: "review" }, without(COMPLETE, "payUnit"), LANDINGS)).toMatchObject({ kind: "step", step: "pay" })
    expect(resolveJobEditorScreen({ error: "Fix the highlighted fields before publishing" }, without(COMPLETE, "equipment"), LANDINGS)).toMatchObject({
      kind: "step",
      step: "equipment"
    })
  })

  it("starts on the first step and ignores an unknown step", () => {
    expect(resolveJobEditorScreen({}, { equipment: [], text: {} }, LANDINGS)).toEqual({ issues: [], kind: "step", step: "basics" })
    expect(resolveJobEditorScreen({ step: "dispatch" }, COMPLETE, LANDINGS)).toEqual({ issues: [], kind: "step", step: "basics" })
  })
})

describe("the required-items checklist", () => {
  it("is judged by the rules, not by how far the poster clicked", () => {
    expect(jobEditorChecklist(COMPLETE, LANDINGS).every((item) => item.met)).toBe(true)
    expect(jobEditorChecklist({ equipment: [], text: {} }, LANDINGS).some((item) => item.met)).toBe(false)

    const unmet = jobEditorChecklist(without(COMPLETE, "startsOn", "durationDays"), LANDINGS).filter((item) => !item.met)
    expect(unmet.map((item) => item.step)).toEqual(["pay"])
  })
})

describe("the editor preview", () => {
  const context = { now: "2026-11-02T12:00:00.000Z", posterName: "North Pine", posterOrganizationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }

  it("is null until the draft can be previewed on one of the organization's landings", () => {
    expect(jobEditorPreview(without(COMPLETE, "equipment"), LANDINGS, context)).toBeNull()
    expect(jobEditorPreview(COMPLETE, [], context)).toBeNull()
  })

  it("shows the listing as published but never as confirmed", () => {
    const preview = jobEditorPreview(COMPLETE, LANDINGS, context)

    expect(preview?.landing).toEqual(LANDING)
    expect(preview?.job).toMatchObject({
      acceptingInterest: true,
      endsOn: "2026-11-19",
      equipment: ["log_truck"],
      lastConfirmedAt: null,
      pay: { amountCents: 52_500, note: null, unit: "per_load" },
      status: "active",
      title: COMPLETE.text.title
    })
  })

  it("says Ongoing for an explicit Ongoing", () => {
    const ongoing = { ...COMPLETE, text: { ...without(COMPLETE, "durationDays").text, ongoing: "1" } }
    expect(jobEditorPreview(ongoing, LANDINGS, context)?.job.scheduleNote).toBe("Ongoing")
    expect(jobEditorPreview(COMPLETE, LANDINGS, context)?.job.scheduleNote).toBeNull()
  })
})

describe("draft links", () => {
  it("swap in the current draft and keep the other parameters", () => {
    const href = withDraftQuery("/v2/landing/jobs/new?step=basics&title=Old&equipment=chip_van", { equipment: ["log_truck"], text: { title: "New title" } })
    const url = new URL(href, "http://test.invalid")

    expect(url.pathname).toBe("/v2/landing/jobs/new")
    expect(url.searchParams.get("step")).toBe("basics")
    expect(url.searchParams.get("title")).toBe("New title")
    expect(url.searchParams.getAll("equipment")).toEqual(["log_truck"])
  })
})

describe("job postings tabs", () => {
  it("map every stored status to one tab, honestly", () => {
    expect(jobPostingTab("active")).toBe("published")
    expect(jobPostingTab("filled")).toBe("published")
    expect(jobPostingTab("paused")).toBe("paused")
    expect(jobPostingTab("expired")).toBe("expired")
    expect(jobPostingTab("closed")).toBe("archived")
  })

  it("count jobs per tab and never count drafts", () => {
    expect(jobPostingTabCounts([{ status: "active" }, { status: "filled" }, { status: "closed" }])).toEqual({ archived: 1, expired: 0, paused: 0, published: 2 })
  })

  it("default to Published and link to each tab", () => {
    expect(parseJobPostingTab(undefined)).toBe(DEFAULT_JOB_POSTING_TAB)
    expect(parseJobPostingTab("deleted")).toBe("published")
    expect(parseJobPostingTab(["draft", "paused"])).toBe("draft")
    expect(jobPostingTabHref("published")).toBe("/v2/landing/jobs")
    expect(jobPostingTabHref("archived")).toBe("/v2/landing/jobs?tab=archived")
  })
})
