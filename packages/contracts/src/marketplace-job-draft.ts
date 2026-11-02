import { z } from "zod"

import {
  marketplaceEquipmentCodeSchema,
  marketplaceEquipmentLabel,
  marketplacePayUnitSchema,
  type MarketplaceJobDetailView
} from "./marketplace-v2"

/**
 * Native V2 job authoring (UX spec §8 "Create/Edit Job"). The draft mirrors the columns and CHECK
 * constraints of `marketplace.job_postings` in the normalized-v2 prototype, so anything this schema
 * accepts the normalized store will accept. It deliberately has no route-pack, slot, assignment or
 * trip fields: a job is an advertisement.
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

const SENSITIVE_MESSAGE = "Remove coordinates and gate or lock codes. Share private access details only after you approve a hauler."

const blankToUndefined = (value: unknown) => (typeof value === "string" && value.trim() === "" ? undefined : value)

const publicText = (max: number) =>
  z.preprocess(blankToUndefined, z.string().trim().max(max).refine((text) => !containsSensitiveAccessText(text), SENSITIVE_MESSAGE).optional())

const optionalInt = (min: number, max: number) => z.preprocess(blankToUndefined, z.coerce.number().int().min(min).max(max).optional())
const optionalDecimal = (min: number, max: number) => z.preprocess(blankToUndefined, z.coerce.number().min(min).max(max).optional())
const optionalDate = z.preprocess(blankToUndefined, z.string().date().optional())

export const MARKETPLACE_DRAFT_LIMITS = Object.freeze({
  durationDays: 365,
  estDailyLoads: 500,
  estLoadsPerTruckPerDay: 24,
  estOneWayMiles: 1000,
  estTonsPerLoad: 100,
  trucksRequested: 9999
})

export const marketplaceJobDraftSchema = z.object({
  landingId: z.string().uuid({ message: "Choose one of your landings" }),
  title: z.string().trim().min(3, "Give the job a short title (3+ characters)").max(140).refine((text) => !containsSensitiveAccessText(text), SENSITIVE_MESSAGE),
  product: z.preprocess(blankToUndefined, z.string().trim().max(120).optional()),
  description: publicText(6000),
  equipment: z.array(marketplaceEquipmentCodeSchema).min(1, "Choose at least one equipment type").max(11),
  payUnit: z.preprocess(blankToUndefined, marketplacePayUnitSchema.optional()),
  /** Dollars as typed (e.g. "525" or "4.25"); stored as whole cents. */
  payAmount: z.preprocess(blankToUndefined, z.coerce.number().positive("Pay must be more than $0").max(1_000_000).optional()),
  payNote: publicText(300),
  trucksRequested: z.coerce.number({ message: "Enter how many trucks the job needs" }).int().min(1, "At least 1 truck").max(MARKETPLACE_DRAFT_LIMITS.trucksRequested),
  trucksPerDay: optionalInt(1, MARKETPLACE_DRAFT_LIMITS.trucksRequested),
  startsOn: optionalDate,
  durationDays: optionalInt(1, MARKETPLACE_DRAFT_LIMITS.durationDays),
  estLoadsPerTruckPerDay: optionalDecimal(0.5, MARKETPLACE_DRAFT_LIMITS.estLoadsPerTruckPerDay),
  estDailyLoads: optionalInt(1, MARKETPLACE_DRAFT_LIMITS.estDailyLoads),
  estTonsPerLoad: optionalDecimal(0.1, MARKETPLACE_DRAFT_LIMITS.estTonsPerLoad),
  destinationLabel: publicText(160),
  estOneWayMiles: optionalInt(1, MARKETPLACE_DRAFT_LIMITS.estOneWayMiles),
  publicRoadNotes: publicText(1000)
}).superRefine((draft, context) => {
  // `job_postings` pay CHECK: no pay; or negotiable with a note and no amount; or any other basis with an amount.
  if (draft.payUnit === "negotiable") {
    if (draft.payAmount !== undefined) context.addIssue({ code: "custom", message: "Negotiable pay has no fixed amount — describe it in the pay note", path: ["payAmount"] })
    if (!draft.payNote || draft.payNote.length < 3) context.addIssue({ code: "custom", message: "Explain how negotiable pay is set", path: ["payNote"] })
  } else if (draft.payUnit !== undefined && draft.payAmount === undefined) {
    context.addIssue({ code: "custom", message: "Enter the pay amount for this basis", path: ["payAmount"] })
  } else if (draft.payUnit === undefined && draft.payAmount !== undefined) {
    context.addIssue({ code: "custom", message: "Choose what the pay amount is per", path: ["payUnit"] })
  }

  if (draft.trucksPerDay !== undefined && draft.trucksPerDay > draft.trucksRequested) {
    context.addIssue({ code: "custom", message: "Trucks per day cannot exceed total trucks requested", path: ["trucksPerDay"] })
  }

  if (draft.durationDays !== undefined && draft.startsOn === undefined) {
    context.addIssue({ code: "custom", message: "Add a start date to state a duration", path: ["startsOn"] })
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

export function draftEndsOn(draft: Pick<MarketplaceJobDraft, "startsOn" | "durationDays">): string | null {
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
 * exactly what would be published. Nothing is persisted; the preview has never been confirmed.
 */
export function previewMarketplaceJob(
  draft: MarketplaceJobDraft,
  context: { landing: MarketplaceDraftLandingContext; posterOrganizationId: string; posterName: string; posterVerified: boolean; now: string }
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
    posterVerified: context.posterVerified,
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
