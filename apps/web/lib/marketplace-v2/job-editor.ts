import {
  marketplaceJobPublicationIssues,
  previewMarketplaceJob,
  validateMarketplaceJobDraft,
  type MarketplaceDraftIssue,
  type MarketplaceDraftLandingContext,
  type MarketplaceJobDetailView
} from "@logloads/contracts"

import { draftInput, LANDING_NOT_OWNED, validateDraftValues, type DraftFormValues, type DraftTextField } from "./draft-params"

/**
 * The job editor's four steps (UX 02 §B4–B7, spec §4.5, #128). Pure: no session, no store, no React.
 *
 * Every step is a GET form that carries the whole draft in the URL (`draft-params.ts`). Moving forward is
 * validated on the server, step by step; moving back never is. The review step (`/v2/landing/jobs/preview`) is
 * reached only when steps 1–3 pass, and publishing re-checks everything in `publishJobAction`.
 */

export const JOB_EDITOR_STEPS = [
  { id: "basics", label: "Basics & location" },
  { id: "pay", label: "Pay & scope" },
  { id: "equipment", label: "Equipment & volume" },
  { id: "review", label: "Review & publish" }
] as const

export type JobEditorStepId = (typeof JOB_EDITOR_STEPS)[number]["id"]
/** The three steps with form fields; the fourth is the review. */
export type JobEditorInputStepId = Exclude<JobEditorStepId, "review">

export const JOB_EDITOR_STEP_LABELS: readonly string[] = JOB_EDITOR_STEPS.map((step) => step.label)

const STEP_LABEL: Readonly<Record<JobEditorStepId, string>> = Object.freeze(
  Object.fromEntries(JOB_EDITOR_STEPS.map((step) => [step.id, step.label])) as Record<JobEditorStepId, string>
)

export function jobEditorStepLabel(step: JobEditorStepId): string {
  return STEP_LABEL[step]
}

/** Where Next leads from each input step, and where Back leads from each step (none from the first). */
export const JOB_EDITOR_NEXT_STEP: Readonly<Record<JobEditorInputStepId, JobEditorStepId>> = Object.freeze({
  basics: "pay",
  equipment: "review",
  pay: "equipment"
})

export const JOB_EDITOR_PREVIOUS_STEP: Readonly<Record<JobEditorStepId, JobEditorInputStepId | null>> = Object.freeze({
  basics: null,
  equipment: "pay",
  pay: "basics",
  review: "equipment"
})

export const NEW_JOB_PATH = "/v2/landing/jobs/new"
export const REVIEW_JOB_PATH = "/v2/landing/jobs/preview"

type EditorField = DraftTextField | "equipment"

/** The form fields of each input step, in screen order. Every draft field belongs to exactly one step. */
export const JOB_EDITOR_STEP_FIELDS: Readonly<Record<JobEditorInputStepId, readonly EditorField[]>> = Object.freeze({
  basics: ["landingId", "title", "product", "productOther", "destinationLabel", "estOneWayMiles"],
  pay: ["payUnit", "payAmount", "payNote", "startsOn", "endsOn", "durationDays", "ongoing", "trucksRequested", "trucksPerDay"],
  equipment: ["equipment", "estLoadsPerTruckPerDay", "estDailyLoads", "estTonsPerLoad", "publicRoadNotes", "description"]
})

/** Issue fields that are not form fields, and the step that shows them. */
const GROUP_ISSUE_FIELDS: Readonly<Record<string, JobEditorInputStepId>> = Object.freeze({ workPeriod: "pay" })

const INPUT_STEPS: readonly JobEditorInputStepId[] = ["basics", "pay", "equipment"]

/**
 * Required fields that are validated as blank when absent, so the poster reads the contract's own message
 * ("Give the job a short title") rather than a generic "Required". A blank value also keeps the schema's
 * cross-field rules running, which a missing required field would stop.
 */
const BLANK_WHEN_ABSENT: Readonly<Record<JobEditorInputStepId, readonly DraftTextField[]>> = Object.freeze({
  basics: ["landingId", "title"],
  equipment: [],
  pay: ["trucksRequested"]
})

/**
 * Valid stand-ins for the fields of steps the poster has not reached yet, for the same reason: without them the
 * schema stops at the empty equipment list or the missing truck count, and "Other needs a description" or the
 * pay rules would surface a step late. They serve that check alone: they are never shown, stored, previewed or
 * published, and every issue on a later step's field is discarded.
 */
const LATER_STEP_STAND_INS: Readonly<Record<JobEditorInputStepId, Record<string, unknown>>> = Object.freeze({
  basics: {},
  equipment: { equipment: ["log_truck"] },
  pay: { payNote: "Stand-in note", payUnit: "negotiable", trucksRequested: "1" }
})

export function jobEditorStepIndex(step: JobEditorStepId): number {
  return JOB_EDITOR_STEPS.findIndex((candidate) => candidate.id === step)
}

export function parseJobEditorStep(value: string | string[] | undefined): JobEditorStepId | null {
  const raw = Array.isArray(value) ? value[0] : value
  return JOB_EDITOR_STEPS.find((step) => step.id === raw)?.id ?? null
}

/** The step whose screen shows an issue. Anything unrecognised (e.g. a whole-form issue) belongs to the first step. */
export function jobEditorStepForField(field: string): JobEditorInputStepId {
  return GROUP_ISSUE_FIELDS[field] ?? INPUT_STEPS.find((step) => (JOB_EDITOR_STEP_FIELDS[step] as readonly string[]).includes(field)) ?? "basics"
}

/**
 * How to set aside a field that failed the draft rules, so the publishing rules can still be checked on the rest
 * of the draft in the same pass (`marketplaceJobPublicationIssues` needs a parsed draft). Required fields get a
 * valid stand-in; optional ones are dropped, with the fields their rule depends on.
 */
const SET_ASIDE: Readonly<Record<string, Record<string, unknown>>> = Object.freeze({
  durationDays: { durationDays: undefined },
  endsOn: { endsOn: undefined },
  equipment: { equipment: ["log_truck"] },
  landingId: { landingId: "00000000-0000-4000-8000-000000000000" },
  payAmount: { payAmount: undefined, payNote: "Stand-in note", payUnit: "negotiable" },
  payNote: { payAmount: undefined, payNote: "Stand-in note", payUnit: "negotiable" },
  payUnit: { payAmount: undefined, payNote: "Stand-in note", payUnit: "negotiable" },
  productOther: { productOther: "Stand-in product" },
  startsOn: { durationDays: undefined, endsOn: undefined, startsOn: undefined },
  title: { title: "Stand-in title" },
  trucksPerDay: { trucksPerDay: undefined },
  trucksRequested: { trucksPerDay: undefined, trucksRequested: "1" },
  workPeriod: { durationDays: undefined, endsOn: undefined, ongoing: undefined }
})

/** A publishing rule says nothing new when one of these fields already failed the draft rules. */
const PUBLICATION_RULE_FIELDS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  product: ["product"],
  startsOn: ["startsOn"],
  workPeriod: ["workPeriod", "startsOn", "endsOn", "durationDays", "ongoing"]
})

/** The draft rules' issues and the publishing rules' issues together, in one pass. */
function draftAndPublicationIssues(input: Record<string, unknown>): MarketplaceDraftIssue[] {
  const validation = validateMarketplaceJobDraft(input)

  if (validation.ok) return marketplaceJobPublicationIssues(validation.draft)

  const failed = new Set(validation.issues.map((issue) => issue.field))
  const setAside = { ...input }

  for (const field of failed) Object.assign(setAside, SET_ASIDE[field] ?? { [field]: undefined })

  const rest = validateMarketplaceJobDraft(setAside)
  const publication = rest.ok
    ? marketplaceJobPublicationIssues(rest.draft).filter((issue) => !(PUBLICATION_RULE_FIELDS[issue.field] ?? [issue.field]).some((name) => failed.has(name)))
    : []

  return [...validation.issues, ...publication]
}

/** Generic schema wording, said the way the editor says everything else. The contract's own messages pass through. */
function editorMessage(issue: MarketplaceDraftIssue): MarketplaceDraftIssue {
  if (/^Expected number/.test(issue.message)) return { ...issue, message: "Enter a number" }
  if (/^Invalid enum value/.test(issue.message)) return { ...issue, message: "Choose one of the listed options" }
  if (issue.message === "Invalid date") return { ...issue, message: "Enter a date" }
  return issue
}

/**
 * Everything that stands between the draft and the end of `throughStep`: the draft rules and the publishing
 * rules (product, timing) for the fields of the steps up to and including it, plus the landing being one of
 * the organization's own. Later steps' fields are replaced by stand-ins, so they never block or mask this check.
 * Through "equipment" nothing is replaced, so this is the complete pre-publish check (the attestation aside,
 * which is given on the review step per request).
 */
export function jobEditorIssuesThrough(
  values: DraftFormValues,
  ownLandings: ReadonlyArray<{ id: string }>,
  throughStep: JobEditorInputStepId
): MarketplaceDraftIssue[] {
  const through = jobEditorStepIndex(throughStep)
  const input = draftInput(values)

  INPUT_STEPS.forEach((step, index) => {
    if (index <= through) {
      for (const field of BLANK_WHEN_ABSENT[step]) input[field] ??= ""
      return
    }

    for (const field of JOB_EDITOR_STEP_FIELDS[step]) delete input[field]
    Object.assign(input, LATER_STEP_STAND_INS[step])
  })

  const landingId = values.text.landingId
  const notOwned = Boolean(landingId) && !ownLandings.some((landing) => landing.id === landingId)
  const issues = [
    ...(notOwned ? [{ field: "landingId", message: LANDING_NOT_OWNED }] : []),
    ...draftAndPublicationIssues(input).filter((issue) => !(notOwned && issue.field === "landingId"))
  ]

  return issues
    .filter((issue) => jobEditorStepIndex(jobEditorStepForField(issue.field)) <= through)
    .map(editorMessage)
}

/** The issues of one step's own fields. */
export function jobEditorStepIssues(
  values: DraftFormValues,
  ownLandings: ReadonlyArray<{ id: string }>,
  step: JobEditorInputStepId
): MarketplaceDraftIssue[] {
  return jobEditorIssuesThrough(values, ownLandings, step).filter((issue) => jobEditorStepForField(issue.field) === step)
}

/** The first step before `beforeStep` that has issues, with them; `null` when every one passes. */
export function firstIncompleteJobEditorStep(
  values: DraftFormValues,
  ownLandings: ReadonlyArray<{ id: string }>,
  beforeStep: JobEditorStepId = "review"
): { step: JobEditorInputStepId; issues: MarketplaceDraftIssue[] } | null {
  const steps = INPUT_STEPS.filter((step) => jobEditorStepIndex(step) < jobEditorStepIndex(beforeStep))
  const last = steps.at(-1)

  if (!last) return null

  const issues = jobEditorIssuesThrough(values, ownLandings, last)

  for (const step of steps) {
    const own = issues.filter((issue) => jobEditorStepForField(issue.field) === step)
    if (own.length > 0) return { issues: own, step }
  }

  return null
}

export type JobEditorScreen =
  | { kind: "step"; step: JobEditorInputStepId; issues: MarketplaceDraftIssue[] }
  | { kind: "review" }

/**
 * What `/v2/landing/jobs/new` shows for a request.
 *
 * - `step` is the screen asked for (the Next button's value, or a Back, edit or restore link); `from` is the step
 *   whose form was submitted. Asking for a later step than `from` validates every step before the one asked
 *   for, and the first that fails is shown with its issues instead. Going back is never blocked.
 * - Asking for the review, including a refused publish (which returns with `error` and no step), validates all
 *   three steps. When they pass, the caller redirects to the review page.
 * - A link to an input step without `from` shows it as it is, without errors.
 */
export function resolveJobEditorScreen(
  query: Record<string, string | string[] | undefined>,
  values: DraftFormValues,
  ownLandings: ReadonlyArray<{ id: string }>
): JobEditorScreen {
  const from = parseJobEditorStep(query.from)
  const error = Array.isArray(query.error) ? query.error[0] : query.error
  const target = parseJobEditorStep(query.step) ?? (error ? "review" : "basics")
  const forward = target === "review" || (from !== null && jobEditorStepIndex(target) > jobEditorStepIndex(from))

  if (forward) {
    const incomplete = firstIncompleteJobEditorStep(values, ownLandings, target)
    if (incomplete) return { issues: incomplete.issues, kind: "step", step: incomplete.step }
  }

  return target === "review" ? { kind: "review" } : { issues: [], kind: "step", step: target }
}

/** Screen order for focus, with the work-period group where it sits on the pay step. */
const FOCUS_ORDER: Readonly<Record<JobEditorInputStepId, readonly string[]>> = Object.freeze({
  basics: JOB_EDITOR_STEP_FIELDS.basics,
  equipment: JOB_EDITOR_STEP_FIELDS.equipment,
  pay: ["payUnit", "payAmount", "payNote", "startsOn", "workPeriod", "endsOn", "durationDays", "ongoing", "trucksRequested", "trucksPerDay"]
})

/** The first field, in screen order, that has an issue: it receives focus. */
export function firstInvalidJobEditorField(step: JobEditorInputStepId, issues: readonly MarketplaceDraftIssue[]): string | null {
  const fields = new Set(issues.map((issue) => issue.field))
  return FOCUS_ORDER[step].find((field) => fields.has(field)) ?? issues[0]?.field ?? null
}

/**
 * The draft as haulers will meet it once published, rendered through `previewMarketplaceJob` (the read model the
 * discovery screens use), or `null` until the draft is complete enough to preview on one of the organization's
 * own landings. Three presentation adjustments, nothing else:
 * - the contract's preview is a not-yet-listed view (`paused`, not accepting interest); the preview shows the
 *   listing as published, accepting interest, so it doesn't read "Paused by the poster";
 * - equipment is passed as codes, which the marketplace components turn into labels themselves;
 * - an explicit Ongoing (UX-DEC-02) is shown as the schedule note, because the read model has no field for it.
 * `lastConfirmedAt` stays null: a preview is never a confirmation.
 */
export function jobEditorPreview(
  values: DraftFormValues,
  ownLandings: readonly MarketplaceDraftLandingContext[],
  context: { now: string; posterName: string; posterOrganizationId: string }
): { job: MarketplaceJobDetailView; landing: MarketplaceDraftLandingContext } | null {
  const validation = validateDraftValues(values)
  if (!validation.ok) return null

  const landing = ownLandings.find((candidate) => candidate.id === validation.draft.landingId)
  if (!landing) return null

  const { draft } = validation
  const job = previewMarketplaceJob(draft, { ...context, landing, posterVerification: null })

  return {
    job: {
      ...job,
      acceptingInterest: true,
      equipment: [...draft.equipment],
      scheduleNote: draft.ongoing && job.endsOn === null ? "Ongoing" : job.scheduleNote,
      status: "active"
    },
    landing
  }
}

/** The "What's required" list beside the editor (UX 02 §B4–B7), each item tied to the step that sets it. */
export const JOB_EDITOR_REQUIREMENTS = [
  { fields: ["landingId", "title", "product", "productOther"], label: "Landing, title and product", step: "basics" },
  { fields: ["payUnit", "payAmount", "payNote"], label: "Pay with its basis, or Negotiable with a note", step: "pay" },
  { fields: ["startsOn", "endsOn", "durationDays", "ongoing", "workPeriod"], label: "Start date, and an end date, a duration or Ongoing", step: "pay" },
  { fields: ["trucksRequested", "trucksPerDay"], label: "Trucks needed for the job", step: "pay" },
  { fields: ["equipment"], label: "At least one equipment type", step: "equipment" }
] as const satisfies ReadonlyArray<{ fields: readonly string[]; label: string; step: JobEditorInputStepId }>

/**
 * Each requirement and whether the draft meets it now, judged by the same rules as the steps rather than by how
 * far the poster has clicked. The three publish statements are not in this list: they are ticked per request.
 */
export function jobEditorChecklist(
  values: DraftFormValues,
  ownLandings: ReadonlyArray<{ id: string }>
): Array<{ label: string; step: JobEditorInputStepId; met: boolean }> {
  const issueFields = new Set(INPUT_STEPS.flatMap((step) => jobEditorStepIssues(values, ownLandings, step).map((issue) => issue.field)))

  return JOB_EDITOR_REQUIREMENTS.map((requirement) => ({
    label: requirement.label,
    met: !requirement.fields.some((field) => issueFields.has(field)),
    step: requirement.step
  }))
}
