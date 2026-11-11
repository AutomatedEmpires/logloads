import "server-only"

import {
  MARKETPLACE_OTHER_PRODUCT,
  MARKETPLACE_PRODUCTS,
  marketplaceJobDraftSchema,
  type MarketplaceJobDraft
} from "@logloads/contracts"
import { z } from "zod"

import { jobViewFromRow } from "../normalized-mapping"
import { MarketplaceStoreError } from "../port"
import type { StoredOwnJob } from "./store"

/**
 * Rows of the normalized store → the jobs group's records (#247). The public view is `jobViewFromRow`, so the desk's
 * "Public preview" is exactly what haulers see. The editable terms come from the same `list_marketplace_jobs` row
 * (stage 06 returns `description` and `duration_days`, which the public view leaves out). The own-job facts row is
 * the shape the own-jobs statement returns. A row that does not match is a drift between the SQL and this adapter,
 * reported as a store error whose message names no value.
 */

function toIso(value: string): string {
  const instant = new Date(value)

  if (Number.isNaN(instant.getTime())) {
    throw new MarketplaceStoreError(undefined, "22007")
  }

  return instant.toISOString()
}

const uuid = z.string().uuid()
const timestamp = z.string().transform(toIso)
const nullableTimestamp = z.string().nullable().transform((value) => (value === null ? null : toIso(value)))
const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable()
const numeric = z.union([z.number(), z.string().regex(/^-?\d+(\.\d+)?$/)]).transform(Number).nullable()
const nullableText = z.string().nullable()

function parseRow<S extends z.ZodTypeAny>(schema: S, row: unknown): z.output<S> {
  const parsed = schema.safeParse(row)

  if (!parsed.success) {
    throw new MarketplaceStoreError(undefined, "22000", parsed.error)
  }

  return parsed.data
}

/** The editable terms in a `list_marketplace_jobs` row. */
const termsRowSchema = z.object({
  description: nullableText,
  destination_label: nullableText,
  duration_days: numeric,
  ends_on: calendarDate,
  equipment_codes: z.array(z.string()).nullable(),
  est_one_way_miles: numeric,
  estimated_daily_loads: numeric,
  estimated_loads_per_truck_per_day: numeric,
  estimated_tons_per_load: numeric,
  pay_amount_cents: numeric,
  pay_note: nullableText,
  pay_unit: nullableText,
  product: nullableText,
  public_road_notes: nullableText,
  starts_on: calendarDate,
  title: z.string(),
  trucks_per_day: numeric,
  trucks_total: numeric
})

const optional = <T>(value: T | null): T | undefined => (value === null ? undefined : value)

/**
 * The stored terms of a job read back as the draft the editor opens (`publishArguments`, reversed). A listed product
 * comes back as itself and any other text as "Other" with that description. The period comes back as stated: an end
 * date (the store keeps one for a stated duration too), a duration only where no end date is kept, or Ongoing when it
 * has a start and neither. Returns `null` when the stored terms do not pass today's draft rules.
 */
export function storedJobDraft(row: unknown, landingId: string): MarketplaceJobDraft | null {
  const terms = parseRow(termsRowSchema, row)
  const listed = terms.product !== null && (MARKETPLACE_PRODUCTS as readonly string[]).includes(terms.product)
  const fixedPay = terms.pay_unit !== null && terms.pay_unit !== "negotiable" && terms.pay_amount_cents !== null

  const candidate = {
    description: optional(terms.description),
    destinationLabel: optional(terms.destination_label),
    durationDays: terms.ends_on === null ? optional(terms.duration_days) : undefined,
    endsOn: optional(terms.ends_on),
    equipment: terms.equipment_codes ?? [],
    estDailyLoads: optional(terms.estimated_daily_loads),
    estLoadsPerTruckPerDay: optional(terms.estimated_loads_per_truck_per_day),
    estOneWayMiles: optional(terms.est_one_way_miles),
    estTonsPerLoad: optional(terms.estimated_tons_per_load),
    landingId,
    ongoing: terms.starts_on !== null && terms.ends_on === null && terms.duration_days === null,
    payAmount: fixedPay ? (terms.pay_amount_cents as number) / 100 : undefined,
    payNote: optional(terms.pay_note),
    payUnit: optional(terms.pay_unit),
    product: terms.product === null ? undefined : listed ? terms.product : MARKETPLACE_OTHER_PRODUCT,
    productOther: terms.product !== null && !listed ? terms.product : undefined,
    publicRoadNotes: optional(terms.public_road_notes),
    startsOn: optional(terms.starts_on),
    title: terms.title,
    trucksPerDay: optional(terms.trucks_per_day),
    trucksRequested: optional(terms.trucks_total)
  }

  const draft = marketplaceJobDraftSchema.safeParse(candidate)
  return draft.success ? draft.data : null
}

/**
 * One row of the own-jobs statement: the job's landing, when it was saved, its delivered targeted invitations and its
 * latest boost window. `moderation_hold` is absent or `null` while the store gives the business no read of
 * `job_moderation_holds`.
 */
const ownJobFactsRowSchema = z.object({
  boost_active: z.boolean().nullable(),
  boost_ends_at: nullableTimestamp,
  boost_starts_at: nullableTimestamp,
  created_at: timestamp,
  invitations_delivered: z.number().int().min(0).nullable(),
  job_id: uuid,
  landing_id: uuid,
  landing_name: z.string(),
  moderation_hold: z.boolean().nullable().optional()
})

/** One own job from its `list_marketplace_jobs` row and its own-jobs facts row, which must be the same job. */
export function storedOwnJob(publicRow: unknown, factsRow: unknown): StoredOwnJob {
  const job = jobViewFromRow(publicRow)
  const facts = parseRow(ownJobFactsRowSchema, factsRow)

  if (facts.job_id !== job.id) {
    throw new MarketplaceStoreError(undefined, "22000")
  }

  return {
    boost: facts.boost_starts_at !== null && facts.boost_ends_at !== null
      ? { active: facts.boost_active === true, endsAt: facts.boost_ends_at, startsAt: facts.boost_starts_at }
      : null,
    createdAt: facts.created_at,
    draft: storedJobDraft(publicRow, facts.landing_id),
    invitationsDelivered: facts.invitations_delivered,
    job,
    landing: { id: facts.landing_id, name: facts.landing_name },
    moderationHold: facts.moderation_hold ?? null
  }
}
