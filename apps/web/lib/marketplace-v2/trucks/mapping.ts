/**
 * Row mapping for trucks (#251). Every row schema is strict: a row that carries a column the SQL does not select (a
 * phone, an email, a note) fails closed instead of being passed on. Points are snapped to the public 0.1° grid here
 * too, whatever the row says (V2-DEC-01).
 */

import {
  marketplaceTruckAlertCriteriaSchema,
  snapToPublicGrid,
  type MarketplaceSavedSearchView,
  type MarketplaceVerification
} from "@logloads/contracts"
import type { TruckDirectoryEntry } from "@logloads/services"
import { z } from "zod"

import { MarketplaceStoreError } from "../port"

const uuid = z.string().uuid()

function toIso(value: string): string {
  const instant = new Date(value)

  if (Number.isNaN(instant.getTime())) {
    throw new MarketplaceStoreError(undefined, "22007")
  }

  return instant.toISOString()
}

const timestamp = z.string().transform(toIso)
const nullableTimestamp = z.string().nullable().transform((value) => (value === null ? null : toIso(value)))
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const integer = z.union([z.number().int(), z.string().regex(/^-?\d+$/)]).transform(Number)
/** `numeric` arrives as a JSON number; accept a numeric string too (other transports). */
const coordinate = z.union([z.number(), z.string().regex(/^-?\d+(\.\d+)?$/).transform(Number)]).pipe(z.number().finite())
const verificationStatus = z.enum(["unverified", "pending", "verified", "rejected"])

function reject(code = "22000", cause?: unknown): never {
  throw new MarketplaceStoreError(undefined, code, cause)
}

function parse<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, row: unknown): T {
  const parsed = schema.safeParse(row)

  if (!parsed.success) reject("22000", parsed.error)

  return parsed.data
}

function verificationOf(status: z.infer<typeof verificationStatus>, verifiedAt: string | null): MarketplaceVerification | null {
  return status === "verified" ? { reviewedOn: verifiedAt === null ? null : verifiedAt.slice(0, 10), scope: "business_identity" } : null
}

const equipmentRowSchema = z.object({
  equipment_code: z.string().min(1),
  paired_trailer_code: z.string().min(1).nullable(),
  unit_count: integer.pipe(z.number().int().min(1).max(500))
}).strict()

const reportRowSchema = z.object({
  available_count: integer.pipe(z.number().int().min(1).max(500)),
  available_from: day,
  available_until: day,
  equipment_code: z.string().min(1),
  id: uuid,
  reported_at: timestamp
}).strict()

const directoryRowSchema = z.object({
  accepts_targeted_invitations: z.boolean(),
  availability: z.array(reportRowSchema),
  base_area_label: z.string().nullable(),
  display_name: z.string().min(1),
  equipment: z.array(equipmentRowSchema),
  is_public: z.boolean(),
  operating_states: z.array(z.string().trim().regex(/^[A-Z]{2}$/)),
  org_id: uuid,
  service_lat: coordinate.pipe(z.number().min(-90).max(90)).nullable(),
  service_lng: coordinate.pipe(z.number().min(-180).max(180)).nullable(),
  service_radius_miles: integer.nullable(),
  verification_status: verificationStatus,
  verified_at: nullableTimestamp
}).strict()

/** One `truck_directory` row → the entry the directory rules filter and project. */
export function truckEntryFromRow(row: unknown): TruckDirectoryEntry {
  const parsed = parse(directoryRowSchema, row)
  const placed = parsed.service_lat !== null && parsed.service_lng !== null

  return {
    acceptsInvitations: parsed.accepts_targeted_invitations,
    availability: parsed.availability.map((report) => ({
      availableCount: report.available_count,
      availableFrom: report.available_from,
      availableUntil: report.available_until,
      equipmentCode: report.equipment_code,
      id: report.id,
      reportedAt: report.reported_at
    })),
    businessName: parsed.display_name,
    equipment: parsed.equipment.map((unit) => ({ equipmentCode: unit.equipment_code, trailerCode: unit.paired_trailer_code, units: unit.unit_count })),
    homeBase: parsed.base_area_label,
    listed: parsed.is_public,
    operatingStates: parsed.operating_states.map((state) => state.trim()),
    organizationId: parsed.org_id,
    servicePoint: placed ? snapToPublicGrid({ lat: parsed.service_lat as number, lng: parsed.service_lng as number }) : null,
    serviceRadiusMiles: parsed.service_radius_miles,
    verification: verificationOf(parsed.verification_status, parsed.verified_at)
  }
}

const identityRowSchema = z.object({
  org_id: uuid,
  verification_status: verificationStatus,
  verified_at: nullableTimestamp
}).strict()

/** `truck_viewer_identity` row → the active business's review status; `null` when the person is not a member. */
export function viewerIdentityFromRow(row: unknown): { verificationStatus: string } | null {
  if (row === undefined || row === null) return null

  return { verificationStatus: parse(identityRowSchema, row).verification_status }
}

const grantRowSchema = z.object({
  allowed: z.boolean(),
  pages_used: integer.pipe(z.number().int().nonnegative()),
  views_granted: integer.pipe(z.number().int().nonnegative()),
  views_used: integer.pipe(z.number().int().nonnegative())
}).strict()

export interface TruckDirectoryPageGrant {
  allowed: boolean
  views: number
  pagesUsed: number
  viewsUsed: number
}

/** `record_truck_directory_page` row → whether the page may be read and how many of its cards may be shown. */
export function directoryGrantFromRow(row: unknown): TruckDirectoryPageGrant {
  if (row === undefined || row === null) reject()

  const parsed = parse(grantRowSchema, row)

  return { allowed: parsed.allowed, pagesUsed: parsed.pages_used, views: parsed.allowed ? parsed.views_granted : 0, viewsUsed: parsed.views_used }
}

const savedSearchRowSchema = z.object({
  alerts_enabled: z.boolean(),
  criteria: marketplaceTruckAlertCriteriaSchema,
  id: uuid,
  kind: z.literal("trucks"),
  last_alerted_at: nullableTimestamp,
  name: z.string().min(1).max(80),
  updated_at: timestamp
}).strict()

/**
 * One `saved_searches` row of kind `trucks`. The port types `criteria` as an open record, so the parsed fields are
 * copied onto one; the schema has already refused anything that is not a truck-alert filter.
 */
export function savedTruckSearchFromRow(row: unknown): MarketplaceSavedSearchView {
  const parsed = parse(savedSearchRowSchema, row)
  const criteria: Record<string, unknown> = {}

  criteria.equipment = parsed.criteria.equipment
  criteria.identityReviewedOnly = parsed.criteria.identityReviewedOnly
  criteria.near = parsed.criteria.near
  criteria.place = parsed.criteria.place
  criteria.radiusMiles = parsed.criteria.radiusMiles

  return {
    alertsEnabled: parsed.alerts_enabled,
    criteria,
    id: parsed.id,
    kind: "trucks",
    lastAlertedAt: parsed.last_alerted_at,
    name: parsed.name,
    updatedAt: parsed.updated_at
  }
}

const idRowSchema = z.object({ id: uuid }).strict()

/** An insert or update that returns an id, or null when it changed nothing. An unexpected shape fails closed. */
export function idFromRow(row: unknown): string | null {
  if (row === undefined || row === null) return null

  return parse(idRowSchema, row).id
}

const changedRowSchema = z.object({ changed: z.boolean() }).strict()

/** A member's delete answers one row; `null` (no row) means the person is not a member, so nothing was written. */
export function changedFromRow(row: unknown): boolean | null {
  if (row === undefined || row === null) return null

  return parse(changedRowSchema, row).changed
}
