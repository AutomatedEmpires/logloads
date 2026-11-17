/**
 * Row mapping for boosts (#254). Every row schema is strict: a column the view does not show (a payment reference, the
 * purchaser, a point) makes the row fail closed instead of being carried along, so a private field can never reach a
 * page by being added to the SQL. A count must be a whole number, 0 or more; anything else is a drift between the SQL
 * and this adapter, and fails closed too.
 */

import { z } from "zod"

import {
  BOOST_PACKAGES,
  MARKETPLACE_BOOST_STATUSES,
  type BoostPackageCode,
  type MarketplaceBoostAudienceView,
  type MarketplaceBoostView
} from "@logloads/contracts"

import { MarketplaceStoreError } from "../port"

const uuid = z.string().uuid().transform((value) => value.toLowerCase())

function toIso(value: string): string {
  const instant = new Date(value)

  if (Number.isNaN(instant.getTime())) {
    throw new MarketplaceStoreError(undefined, "22007")
  }

  return instant.toISOString()
}

const timestamp = z.string().transform(toIso)
const nullableTimestamp = z.string().nullable().transform((value) => (value === null ? null : toIso(value)))
const count = z.union([z.number().int(), z.string().regex(/^\d+$/).transform(Number)]).pipe(z.number().int().nonnegative().safe())

function parse<S extends z.ZodTypeAny>(schema: S, row: unknown): z.output<S> {
  const parsed = schema.safeParse(row)

  if (!parsed.success) {
    // A drift between the SQL and this adapter. The detail stays out of the message shown to people.
    throw new MarketplaceStoreError(undefined, "22000", parsed.error)
  }

  return parsed.data
}

/** `get_marketplace_job` → the business that posted the job. The rest of the public row is not read here. */
export function jobPosterFromRow(row: unknown): string {
  return parse(z.object({ poster_organization_id: uuid }).passthrough(), row).poster_organization_id
}

const estimateRowSchema = z.object({
  active_availability_reports: count,
  opted_in_haulers: count,
  radius_miles: count.pipe(z.number().int().positive())
}).strict()

/**
 * `estimate_boost_audience` (one row) and `count_boost_audience_trucks` (one value) → the audience view. Exactly one
 * of each, or the read fails closed: a missing count is never shown as zero.
 */
export function audienceFromRows(
  jobId: string,
  packageCode: BoostPackageCode,
  estimateRows: readonly unknown[],
  truckValues: readonly unknown[]
): MarketplaceBoostAudienceView {
  if (estimateRows.length !== 1 || truckValues.length !== 1) {
    throw new MarketplaceStoreError(undefined, "22000")
  }

  const estimate = parse(estimateRowSchema, estimateRows[0])

  return {
    activeAvailabilityReports: estimate.active_availability_reports,
    availableTrucks: parse(count, truckValues[0]),
    jobId,
    optedInHaulers: estimate.opted_in_haulers,
    packageCode,
    radiusMiles: estimate.radius_miles
  }
}

const PACKAGE_CODES: ReadonlySet<string> = new Set(Object.keys(BOOST_PACKAGES))

const boostRowSchema = z.object({
  created_at: timestamp,
  duration_days: z.number().int().min(1).max(90),
  ends_at: nullableTimestamp,
  id: uuid,
  job_id: uuid,
  org_id: uuid,
  package_code: z.string().nullable(),
  price_cents: z.number().int().nonnegative().safe(),
  radius_miles: z.number().int().min(10).max(500),
  starts_at: nullableTimestamp,
  status: z.enum(MARKETPLACE_BOOST_STATUSES)
}).strict().refine(
  // The store's own checks (01_schema.sql): a window has both ends or neither, and an active or ended boost has one.
  (row) => (row.starts_at === null) === (row.ends_at === null) && (row.starts_at !== null || (row.status !== "active" && row.status !== "ended")),
  "a boost window the store cannot hold"
)

/** `boost_list` row → one boost of the active business. A row of any other business is a drift and fails closed. */
export function boostFromRow(row: unknown, organizationId: string): MarketplaceBoostView {
  const parsed = parse(boostRowSchema, row)

  if (parsed.org_id !== organizationId.toLowerCase()) {
    throw new MarketplaceStoreError(undefined, "22000")
  }

  return {
    createdAt: parsed.created_at,
    durationDays: parsed.duration_days,
    endsAt: parsed.ends_at,
    id: parsed.id,
    jobId: parsed.job_id,
    packageCode: parsed.package_code !== null && PACKAGE_CODES.has(parsed.package_code) ? (parsed.package_code as BoostPackageCode) : null,
    priceCents: parsed.price_cents,
    radiusMiles: parsed.radius_miles,
    startsAt: parsed.starts_at,
    status: parsed.status
  }
}
