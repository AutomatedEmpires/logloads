import { z } from "zod"

import {
  marketplaceEquipmentCodeSchema,
  marketplaceEquipmentLabel,
  marketplacePayUnitSchema,
  type MarketplaceJobDetailView,
  type MarketplaceVerification
} from "./marketplace-v2"

/**
 * Native V2 job authoring (UX spec §8 "Create/Edit Job"). The draft mirrors the columns and CHECK
 * constraints of `marketplace.job_postings` in the normalized-v2 prototype, so anything this schema
 * accepts the normalized store will accept. Some rules are stricter than the database: pay is required
 * (C1), public text may not carry a phone number or email address (UX-DEC-04), and publishing needs a
 * product and work timing (UX-DEC-02, UX-DEC-03). It deliberately has no route-pack, slot, assignment
 * or trip fields: a job is an advertisement.
 */

/**
 * Mirrors `marketplace.contains_sensitive_access_pattern`: decimal coordinate pairs and gate/lock codes
 * must never appear in public job text. Private access details belong to the landing's restricted record.
 */
const COORDINATE_PAIR = /[-+]?[0-9]{1,2}\.[0-9]{4,}\s*[,;/\s]\s*[-+]?[0-9]{1,3}\.[0-9]{4,}/
const ACCESS_CODE = /\b(gate\s*(code|combo|pin|combination)|lock\s*(code|combo|combination)|padlock\s*(code|combo)|combo\s*[:#]\s*[0-9a-z-]+)\b/i

export function containsSensitiveAccessText(text: string | null | undefined): boolean {
  return Boolean(text) && (COORDINATE_PAIR.test(text as string) || ACCESS_CODE.test(text as string))
}

/**
 * UX-DEC-04: first contact is always through LogLoads messages, so public job text never carries an
 * email address or a phone number. The database has no such CHECK, so this is stricter. Message bodies
 * are not checked: inside a conversation either party may choose to share direct contact details.
 */
const EMAIL_ADDRESS = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/i
const PHONE_NUMBER = /(?:\+?1[\s.-]?)?(?:\(\d{3}\)\s?|\b\d{3}[\s.-]?)\d{3}[\s.-]?\d{4}\b/

export function containsPublicContactText(text: string | null | undefined): boolean {
  return Boolean(text) && (EMAIL_ADDRESS.test(text as string) || PHONE_NUMBER.test(text as string))
}

const SENSITIVE_MESSAGE = "Remove coordinates and gate or lock codes. Share private access details only after you approve a hauler."
const CONTACT_MESSAGE = "Remove phone numbers and email addresses. Haulers contact you through LogLoads messages."

const blankToUndefined = (value: unknown) => (typeof value === "string" && value.trim() === "" ? undefined : value)

/** Public job text: trimmed, bounded, and free of private access details and direct contact details. */
const publicString = (max: number, min?: { length: number; message: string }) =>
  (min ? z.string().trim().min(min.length, min.message) : z.string().trim())
    .max(max)
    .refine((text) => !containsSensitiveAccessText(text), SENSITIVE_MESSAGE)
    .refine((text) => !containsPublicContactText(text), CONTACT_MESSAGE)

const publicText = (max: number) => z.preprocess(blankToUndefined, publicString(max).optional())

const optionalInt = (min: number, max: number) => z.preprocess(blankToUndefined, z.coerce.number().int().min(min).max(max).optional())
const optionalDecimal = (min: number, max: number) => z.preprocess(blankToUndefined, z.coerce.number().min(min).max(max).optional())
const optionalDate = z.preprocess(blankToUndefined, z.string().date().optional())

/** An HTML checkbox: absent or blank is false; "1", "on" or "true" is true; anything else is invalid. */
const checkbox = z.preprocess((value) => {
  if (value === undefined || value === null || value === false || value === "") return false
  if (value === true || value === "1" || value === "on" || value === "true") return true
  return value
}, z.boolean())

export const MARKETPLACE_DRAFT_LIMITS = Object.freeze({
  durationDays: 365,
  estDailyLoads: 500,
  estLoadsPerTruckPerDay: 24,
  estOneWayMiles: 1000,
  estTonsPerLoad: 100,
  trucksRequested: 9999
})

/** Days in a work period, counting both the start and the end day. */
function periodDays(startsOn: string, endsOn: string): number {
  return Math.round((Date.parse(`${endsOn}T00:00:00.000Z`) - Date.parse(`${startsOn}T00:00:00.000Z`)) / 86_400_000) + 1
}

export const marketplaceJobDraftSchema = z.object({
  landingId: z.string().uuid({ message: "Choose one of your landings" }),
  title: publicString(140, { length: 3, message: "Give the job a short title (3+ characters)" }),
  product: publicText(120),
  description: publicText(6000),
  equipment: z.array(marketplaceEquipmentCodeSchema).min(1, "Choose at least one equipment type").max(11),
  payUnit: z.preprocess(blankToUndefined, marketplacePayUnitSchema.optional()),
  /** Dollars as typed (e.g. "525" or "4.25"); stored as whole cents. */
  payAmount: z.preprocess(blankToUndefined, z.coerce.number().positive("Pay must be more than $0").max(1_000_000).optional()),
  payNote: publicText(300),
  trucksRequested: z.coerce.number({ message: "Enter how many trucks the job needs" }).int().min(1, "At least 1 truck").max(MARKETPLACE_DRAFT_LIMITS.trucksRequested),
  trucksPerDay: optionalInt(1, MARKETPLACE_DRAFT_LIMITS.trucksRequested),
  startsOn: optionalDate,
  /** `job_postings.work_ends_on` as the poster states it (UX-DEC-02). */
  endsOn: optionalDate,
  durationDays: optionalInt(1, MARKETPLACE_DRAFT_LIMITS.durationDays),
  /** The poster's explicit "no set end" choice (UX-DEC-02); stored as both end fields null. */
  ongoing: checkbox,
  estLoadsPerTruckPerDay: optionalDecimal(0.5, MARKETPLACE_DRAFT_LIMITS.estLoadsPerTruckPerDay),
  estDailyLoads: optionalInt(1, MARKETPLACE_DRAFT_LIMITS.estDailyLoads),
  estTonsPerLoad: optionalDecimal(0.1, MARKETPLACE_DRAFT_LIMITS.estTonsPerLoad),
  destinationLabel: publicText(160),
  estOneWayMiles: optionalInt(1, MARKETPLACE_DRAFT_LIMITS.estOneWayMiles),
  publicRoadNotes: publicText(1000)
}).superRefine((draft, context) => {
  // Pay disclosure (founder decision C1, #114): every posting states an amount with its basis, or
  // Negotiable with supporting detail. Stricter than the `job_postings` pay CHECK, which allows no pay.
  if (draft.payUnit === undefined) {
    context.addIssue({
      code: "custom",
      message: draft.payAmount === undefined
        ? "State the pay: an amount and what it is per, or Negotiable with a note"
        : "Choose what the pay amount is per",
      path: ["payUnit"]
    })
  } else if (draft.payUnit === "negotiable") {
    if (draft.payAmount !== undefined) context.addIssue({ code: "custom", message: "Negotiable pay has no fixed amount — describe it in the pay note", path: ["payAmount"] })
    if (!draft.payNote || draft.payNote.length < 3) context.addIssue({ code: "custom", message: "Explain how negotiable pay is set", path: ["payNote"] })
  } else {
    if (draft.payAmount === undefined) context.addIssue({ code: "custom", message: "Enter the pay amount for this basis", path: ["payAmount"] })
    // "Other basis" names no basis by itself, so the note has to say what the amount is per.
    if (draft.payUnit === "other" && (!draft.payNote || draft.payNote.length < 3)) {
      context.addIssue({ code: "custom", message: "Say what the pay amount is per in the pay note", path: ["payNote"] })
    }
  }

  if (draft.trucksPerDay !== undefined && draft.trucksPerDay > draft.trucksRequested) {
    context.addIssue({ code: "custom", message: "Trucks per day cannot exceed total trucks requested", path: ["trucksPerDay"] })
  }

  // Work period (UX-DEC-02): at most one of an end date, a duration or Ongoing. Publishing requires one.
  const periodChoices = [draft.endsOn !== undefined, draft.durationDays !== undefined, draft.ongoing].filter(Boolean).length

  if (periodChoices > 1) {
    context.addIssue({ code: "custom", message: "Choose only one: an end date, a duration, or ongoing", path: ["workPeriod"] })
  }

  if ((draft.durationDays !== undefined || draft.endsOn !== undefined) && draft.startsOn === undefined) {
    context.addIssue({ code: "custom", message: "Add a start date to state how long the work runs", path: ["startsOn"] })
  }

  if (draft.startsOn !== undefined && draft.endsOn !== undefined) {
    const days = periodDays(draft.startsOn, draft.endsOn)

    if (days < 1) {
      context.addIssue({ code: "custom", message: "The end date cannot be before the start date", path: ["endsOn"] })
    } else if (days > MARKETPLACE_DRAFT_LIMITS.durationDays) {
      context.addIssue({ code: "custom", message: `Keep the work period within ${MARKETPLACE_DRAFT_LIMITS.durationDays} days`, path: ["endsOn"] })
    }
  }
})

export type MarketplaceJobDraft = z.infer<typeof marketplaceJobDraftSchema>

export interface MarketplaceDraftIssue {
  field: string
  message: string
}

/** Field-keyed, user-readable validation result for the authoring form. */
export function validateMarketplaceJobDraft(input: unknown):
  | { ok: true; draft: MarketplaceJobDraft }
  | { ok: false; issues: MarketplaceDraftIssue[] } {
  const parsed = marketplaceJobDraftSchema.safeParse(input)

  if (parsed.success) {
    return { draft: parsed.data, ok: true }
  }

  return {
    issues: parsed.error.issues.map((issue) => ({ field: String(issue.path[0] ?? "form"), message: issue.message })),
    ok: false
  }
}

/**
 * Rules a draft may leave open but a published job may not: the product (UX-DEC-03) and the work
 * timing (UX-DEC-02: a start date plus an end date, a duration, or an explicit Ongoing).
 */
export function marketplaceJobPublicationIssues(draft: MarketplaceJobDraft): MarketplaceDraftIssue[] {
  const issues: MarketplaceDraftIssue[] = []

  if (!draft.product) {
    issues.push({ field: "product", message: "Name the product before publishing" })
  }

  if (!draft.startsOn) {
    issues.push({ field: "startsOn", message: "Add the expected start date before publishing" })
  }

  if (draft.endsOn === undefined && draft.durationDays === undefined && !draft.ongoing) {
    issues.push({ field: "workPeriod", message: "Before publishing, add an end date or a duration, or mark the work as ongoing" })
  }

  return issues
}

/**
 * The explicit availability attestation (V2-DEC-03; founder decision ATT-1 in #114: it may set the
 * initial, server-generated `lastConfirmedAt`). The label is a neutral placeholder until the founder
 * decides the wording (#114, UX-05 / #128); only the label text changes when that lands.
 */
export const MARKETPLACE_AVAILABILITY_ATTESTATION = Object.freeze({
  field: "availabilityAttestation",
  label: "I confirm this job is currently available as described.",
  value: "confirmed"
})

export type MarketplaceAvailabilityAction = "publish" | "reconfirm"

export interface MarketplaceAvailabilityAttestation {
  /** The explicit action that produced it. Editing a job never produces one. */
  action: MarketplaceAvailabilityAction
  /**
   * The server clock at the moment of the explicit confirmation. This is the only value an adapter may
   * write to a job's `lastConfirmedAt`; it is never read from the request.
   */
  confirmedAt: string
}

/**
 * Turns the submitted checkbox into an attestation, or `null` when the poster did not explicitly
 * confirm. Only the exact checkbox value counts. The timestamp comes from `now` (the server), never
 * from the form.
 */
export function attestAvailability(
  submitted: unknown,
  action: MarketplaceAvailabilityAction,
  now: Date
): MarketplaceAvailabilityAttestation | null {
  if (submitted !== MARKETPLACE_AVAILABILITY_ATTESTATION.value || Number.isNaN(now.getTime())) {
    return null
  }

  return { action, confirmedAt: now.toISOString() }
}

export const AVAILABILITY_ATTESTATION_REQUIRED = "Tick the availability confirmation before publishing"

/**
 * Everything publishing requires of the request itself, in one server-side check: the draft rules (pay,
 * sensitive and contact text, limits), the publishing rules and the explicit attestation. Landing
 * ownership and the `job.publish` capability depend on the viewer's organization and are checked by
 * the caller.
 */
export function validateMarketplaceJobPublication(input: unknown, attestationValue: unknown, now: Date):
  | { ok: true; draft: MarketplaceJobDraft; attestation: MarketplaceAvailabilityAttestation }
  | { ok: false; issues: MarketplaceDraftIssue[] } {
  const validation = validateMarketplaceJobDraft(input)
  const attestation = attestAvailability(attestationValue, "publish", now)
  const issues = [
    ...(validation.ok ? marketplaceJobPublicationIssues(validation.draft) : validation.issues),
    ...(attestation ? [] : [{ field: MARKETPLACE_AVAILABILITY_ATTESTATION.field, message: AVAILABILITY_ATTESTATION_REQUIRED }])
  ]

  if (!validation.ok || !attestation || issues.length > 0) {
    return { issues, ok: false }
  }

  return { attestation, draft: validation.draft, ok: true }
}

export function draftEndsOn(draft: Pick<MarketplaceJobDraft, "startsOn" | "durationDays" | "endsOn">): string | null {
  if (draft.endsOn) {
    return draft.endsOn
  }

  if (!draft.startsOn || !draft.durationDays) {
    return null
  }

  const end = new Date(`${draft.startsOn}T00:00:00.000Z`)
  end.setUTCDate(end.getUTCDate() + draft.durationDays - 1)
  return end.toISOString().slice(0, 10)
}

export interface MarketplaceDraftLandingContext {
  id: string
  name: string
  /** Public, approximate label only (e.g. "Oakridge, OR"). */
  areaLabel: string
  stateCode: string | null
}

/**
 * Renders a validated draft through the same read model hauler-facing screens use, so the preview is
 * exactly what would be published. Nothing is persisted, and a preview is never a confirmation:
 * `lastConfirmedAt` stays null until an explicit attestation is recorded.
 */
export function previewMarketplaceJob(
  draft: MarketplaceJobDraft,
  context: { landing: MarketplaceDraftLandingContext; posterOrganizationId: string; posterName: string; posterVerification: MarketplaceVerification | null; now: string }
): MarketplaceJobDetailView {
  return {
    acceptingInterest: false,
    destinationLabel: draft.destinationLabel ?? null,
    endsOn: draftEndsOn(draft),
    equipment: draft.equipment.map(marketplaceEquipmentLabel),
    estimatedDailyLoads: draft.estDailyLoads ?? null,
    estimatedLoadsPerTruckPerDay: draft.estLoadsPerTruckPerDay ?? null,
    estimatedTonsPerLoad: draft.estTonsPerLoad ?? null,
    expiresAt: null,
    haulDistance: draft.estOneWayMiles ? { basis: "poster_route_estimate", miles: draft.estOneWayMiles } : null,
    id: "preview",
    lastConfirmedAt: null,
    lastModifiedAt: context.now,
    origin: { approximatePoint: null, label: context.landing.areaLabel, stateCode: context.landing.stateCode },
    pay: {
      amountCents: draft.payUnit && draft.payUnit !== "negotiable" && draft.payAmount !== undefined ? Math.round(draft.payAmount * 100) : null,
      note: draft.payNote ?? null,
      unit: draft.payUnit ?? null
    },
    posterName: context.posterName,
    posterOrganizationId: context.posterOrganizationId,
    posterVerification: context.posterVerification,
    product: draft.product ?? null,
    publicAccessRequirements: [],
    publicRoadNotes: draft.publicRoadNotes ?? null,
    scheduleNote: null,
    slug: "preview",
    sponsored: false,
    startsOn: draft.startsOn ?? null,
    status: "paused",
    title: draft.title,
    trucks: { perDay: draft.trucksPerDay ?? null, total: draft.trucksRequested }
  }
}
