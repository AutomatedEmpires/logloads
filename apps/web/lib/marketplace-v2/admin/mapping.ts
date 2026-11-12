/**
 * Row mapping for admin (#255). Row schemas are strict: a column the view does not show makes the row fail closed
 * instead of being carried along, so a private field can never reach a page by being added to the SQL. The one
 * exception is `admin_read_landing_private`, which returns the whole `landing_private_details` row by design: its
 * mapping picks the view's fields one by one, and refuses a row for any landing but the one asked for.
 */

import { Buffer } from "node:buffer"

import { z } from "zod"

import {
  FOUNDING_HAULER_BADGE_LIMIT,
  MARKETPLACE_ADMIN_ROLES,
  MARKETPLACE_ORG_VERIFICATION_STATUSES,
  MARKETPLACE_REPORT_STATUSES,
  MARKETPLACE_REPORT_TARGETS,
  type MarketplaceAdminAccess,
  type MarketplaceAdminLandingPrivateView,
  type MarketplaceAdminQueueView,
  type MarketplaceAdminReportView,
  type MarketplaceAdminRole,
  type MarketplaceAdminThreadMessageView,
  type MarketplaceAdminVerificationView,
  type MarketplaceVerificationLapse
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

function drift(): never {
  throw new MarketplaceStoreError(undefined, "22000")
}

/** `admin_roles` → the person's staff roles. A role the contracts do not know grants nothing. */
export function adminAccessFromRows(rows: readonly unknown[]): MarketplaceAdminAccess {
  const named = new Set(rows.map((row) => parse(z.object({ admin_role: z.string() }).strict(), row).admin_role))

  return { roles: MARKETPLACE_ADMIN_ROLES.filter((role): role is MarketplaceAdminRole => named.has(role)) }
}

/** `admin_queue_counts` → the queue's counts. Exactly one row of whole counts, 0 or more; never a missing count shown as 0. */
export function adminQueueFromRows(rows: readonly unknown[]): MarketplaceAdminQueueView {
  if (rows.length !== 1) drift()

  const row = parse(z.object({ jobs_on_hold: count, open_reports: count, pending_verifications: count }).strict(), rows[0])

  return { jobsOnHold: row.jobs_on_hold, openReports: row.open_reports, pendingVerifications: row.pending_verifications }
}

const verificationRowSchema = z
  .object({
    created_at: timestamp,
    display_name: z.string(),
    id: uuid,
    legal_name: z.string().nullable(),
    verification_status: z.enum(MARKETPLACE_ORG_VERIFICATION_STATUSES),
    verified_at: nullableTimestamp
  })
  .strict()

export function adminVerificationFromRow(row: unknown): MarketplaceAdminVerificationView {
  const parsed = parse(verificationRowSchema, row)

  return {
    createdAt: parsed.created_at,
    displayName: parsed.display_name,
    legalName: parsed.legal_name,
    organizationId: parsed.id,
    status: parsed.verification_status,
    verifiedAt: parsed.verified_at
  }
}

const reportRowSchema = z
  .object({
    created_at: timestamp,
    details: z.string().nullable(),
    id: uuid,
    reason: z.string(),
    reporter_user_id: uuid,
    resolution_note: z.string().nullable(),
    reviewed_at: nullableTimestamp,
    status: z.enum(MARKETPLACE_REPORT_STATUSES),
    target_id: uuid,
    target_kind: z.enum(MARKETPLACE_REPORT_TARGETS)
  })
  .strict()

export function adminReportFromRow(row: unknown): MarketplaceAdminReportView {
  const parsed = parse(reportRowSchema, row)

  return {
    createdAt: parsed.created_at,
    details: parsed.details,
    id: parsed.id,
    reason: parsed.reason,
    reporterUserId: parsed.reporter_user_id,
    resolutionNote: parsed.resolution_note,
    reviewedAt: parsed.reviewed_at,
    status: parsed.status,
    target: { id: parsed.target_id, kind: parsed.target_kind }
  }
}

function checkedPoint(lng: number, lat: number): { lat: number; lng: number } {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) drift()

  return { lat, lng }
}

/**
 * A geography point as the store hands it over: `null`, GeoJSON (`{"type":"Point","coordinates":[lng, lat]}`, where
 * PostGIS casts to json), or PostgreSQL's text output of a geography, hex EWKB (a 2D point, optionally with its SRID).
 * Anything else, including another geometry type or a 3D point, fails closed.
 */
export function pointFromStore(value: unknown): { lat: number; lng: number } | null {
  if (value === null) return null

  if (typeof value === "object") {
    const geo = parse(z.object({ coordinates: z.tuple([z.number(), z.number()]), type: z.literal("Point") }).passthrough(), value)

    return checkedPoint(geo.coordinates[0], geo.coordinates[1])
  }

  if (typeof value !== "string" || !/^(?:[0-9a-fA-F]{2})+$/.test(value)) drift()

  const bytes = Buffer.from(value, "hex")

  if (bytes.length < 21) drift()

  const little = bytes.readUInt8(0) === 1
  const type = little ? bytes.readUInt32LE(1) : bytes.readUInt32BE(1)
  const hasSrid = (type & 0x20000000) !== 0
  // Only a 2D point: no Z or M flag, and base type 1.
  if ((type & 0xcfffffff) !== 1) drift()

  const offset = hasSrid ? 9 : 5

  if (bytes.length !== offset + 16) drift()

  const lng = little ? bytes.readDoubleLE(offset) : bytes.readDoubleBE(offset)
  const lat = little ? bytes.readDoubleLE(offset + 8) : bytes.readDoubleBE(offset + 8)

  // PostGIS writes an empty point as NaN coordinates.
  if (Number.isNaN(lng) && Number.isNaN(lat)) return null

  return checkedPoint(lng, lat)
}

const landingPrivateRowSchema = z
  .object({
    exact_point: z.unknown(),
    gate_instructions: z.string().nullable(),
    landing_id: uuid,
    site_contact_name: z.string().nullable(),
    site_contact_phone: z.string().nullable()
  })
  .passthrough()

/** `admin_read_landing_private` → only the fields the view shows. A row for any other landing fails closed. */
export function adminLandingPrivateFromRows(rows: readonly unknown[], landingId: string): MarketplaceAdminLandingPrivateView | null {
  if (rows.length === 0) return null
  if (rows.length !== 1) drift()

  const row = parse(landingPrivateRowSchema, rows[0])

  if (row.landing_id !== landingId.toLowerCase()) drift()

  return {
    exactPoint: pointFromStore(row.exact_point ?? null),
    gateInstructions: row.gate_instructions,
    landingId: row.landing_id,
    siteContactName: row.site_contact_name,
    siteContactPhone: row.site_contact_phone
  }
}

const threadRowSchema = z
  .object({
    message_author_side: z.enum(["hauler", "landing"]),
    message_body: z.string(),
    message_created_at: timestamp,
    message_id: uuid
  })
  .strict()

export function adminThreadMessageFromRow(row: unknown): MarketplaceAdminThreadMessageView {
  const parsed = parse(threadRowSchema, row)

  return { authorSide: parsed.message_author_side, body: parsed.message_body, createdAt: parsed.message_created_at, id: parsed.message_id }
}

/** `admin_grant_founding_promotion` → the redemption id. */
export function redemptionIdFromValues(values: readonly unknown[]): string {
  if (values.length !== 1) drift()

  return parse(uuid, values[0])
}

/** `admin_grant_founding_hauler_badge` → the badge number, 1 to `FOUNDING_HAULER_BADGE_LIMIT`. */
export function badgeNumberFromValues(values: readonly unknown[]): number {
  if (values.length !== 1) drift()

  return parse(count.pipe(z.number().int().min(1).max(FOUNDING_HAULER_BADGE_LIMIT)), values[0])
}

const lapsedRowSchema = z
  .object({ lapsed_at: timestamp, notices_queued: count, org_id: uuid, previous_verified_at: timestamp })
  .strict()

/** One row of `lapse_expired_org_verifications`. */
export function verificationLapseFromRow(row: unknown): MarketplaceVerificationLapse {
  const parsed = parse(lapsedRowSchema, row)

  return {
    lapsedAt: parsed.lapsed_at,
    noticesQueued: parsed.notices_queued,
    organizationId: parsed.org_id,
    previousVerifiedAt: parsed.previous_verified_at
  }
}
