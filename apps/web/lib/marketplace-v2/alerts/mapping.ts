/**
 * Row mapping for alerts (#252). Shapes that drift from the SQL fail closed. An unavailable saved job keeps its id
 * and when it was saved, and loses every listing field, even if a row still carries one.
 */

import { z } from "zod"

import {
  MARKETPLACE_SAVED_JOB_AVAILABILITY,
  marketplaceJobAlertCriteriaSchema,
  marketplacePayUnitSchema,
  type MarketplaceNotificationPreferenceView,
  type MarketplaceSavedJobView,
  type MarketplaceSavedSearchView
} from "@logloads/contracts"

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
const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable()
const integer = z.union([z.number().int(), z.string().regex(/^-?\d+$/)]).transform(Number)
const nullableInteger = integer.nullable()

function reject(code = "22000"): never {
  throw new MarketplaceStoreError(undefined, code)
}

function parse<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, row: unknown): T {
  const parsed = schema.safeParse(row)

  if (!parsed.success) reject()

  return parsed.data
}

const savedJobRowSchema = z.object({
  availability: z.enum(MARKETPLACE_SAVED_JOB_AVAILABILITY),
  ends_on: calendarDate,
  job_id: uuid,
  last_confirmed_at: nullableTimestamp,
  last_modified_at: nullableTimestamp,
  origin_label: z.string().nullable(),
  origin_state_code: z.string().nullable(),
  pay_amount_cents: nullableInteger,
  pay_note: z.string().nullable(),
  pay_unit: marketplacePayUnitSchema.nullable(),
  poster_name: z.string().nullable(),
  saved_at: timestamp,
  starts_on: calendarDate,
  title: z.string().nullable(),
  trucks_total: nullableInteger
}).strict()

function stateCode(value: string | null): string | null {
  if (value === null) return null

  const trimmed = value.trim().toUpperCase()

  if (trimmed.length === 0) return null
  if (!/^[A-Z]{2}$/.test(trimmed)) reject("22000")

  return trimmed
}

/** `list_saved_jobs` row → the public saved-job view. */
export function savedJobFromRow(row: unknown): MarketplaceSavedJobView {
  const parsed = parse(savedJobRowSchema, row)
  const hidden = parsed.availability === "unavailable"
  const label = hidden ? null : parsed.origin_label
  const payMissing = parsed.pay_amount_cents === null && parsed.pay_unit === null && parsed.pay_note === null

  return {
    availability: parsed.availability,
    endsOn: hidden ? null : parsed.ends_on,
    jobId: parsed.job_id,
    lastConfirmedAt: hidden ? null : parsed.last_confirmed_at,
    lastModifiedAt: hidden ? null : parsed.last_modified_at,
    origin: hidden || label === null ? null : { label, stateCode: stateCode(parsed.origin_state_code) },
    pay: hidden || payMissing ? null : { amountCents: parsed.pay_amount_cents, note: parsed.pay_note, unit: parsed.pay_unit },
    posterName: hidden ? null : parsed.poster_name,
    savedAt: parsed.saved_at,
    startsOn: hidden ? null : parsed.starts_on,
    title: hidden ? null : parsed.title,
    trucksTotal: hidden ? null : parsed.trucks_total
  }
}

const savedSearchRowSchema = z.object({
  alerts_enabled: z.boolean(),
  criteria: marketplaceJobAlertCriteriaSchema,
  id: uuid,
  kind: z.literal("jobs"),
  last_alerted_at: nullableTimestamp,
  name: z.string().min(1).max(80),
  updated_at: timestamp
}).strict()

/**
 * One `saved_searches` row of kind `jobs`. The port types `criteria` as an open record, so the parsed fields are
 * copied onto one. The schema has already refused anything that is not a job-alert filter.
 */
export function savedJobSearchFromRow(row: unknown): MarketplaceSavedSearchView {
  const parsed = parse(savedSearchRowSchema, row)
  const criteria: Record<string, unknown> = {}

  criteria.equipment = parsed.criteria.equipment
  criteria.place = parsed.criteria.place
  criteria.radiusMiles = parsed.criteria.radiusMiles
  criteria.stateCode = parsed.criteria.stateCode

  return {
    alertsEnabled: parsed.alerts_enabled,
    criteria,
    id: parsed.id,
    kind: "jobs",
    lastAlertedAt: parsed.last_alerted_at,
    name: parsed.name,
    updatedAt: parsed.updated_at
  }
}

const preferenceRowSchema = z.object({
  category: z.enum(["inquiry_reply", "targeted_invitation", "job_alert"]),
  channel: z.enum(["in_app", "email"]),
  enabled: z.boolean(),
  updated_at: timestamp
}).strict()

/** One stored consent. The person and the business are not part of the view. */
export function preferenceFromRow(row: unknown): MarketplaceNotificationPreferenceView {
  const parsed = parse(preferenceRowSchema, row)

  return { category: parsed.category, channel: parsed.channel, enabled: parsed.enabled, updatedAt: parsed.updated_at }
}

const idRowSchema = z.object({ id: uuid }).strict()

/** An insert or update that returns an id, or null when it changed nothing. An unexpected shape fails closed. */
export function idFromRow(row: unknown): string | null {
  if (row === undefined || row === null) return null

  return parse(idRowSchema, row).id
}

const changedRowSchema = z.object({ changed: z.boolean() }).strict()

/**
 * A write that answers one row for a member of the active business: whether it changed anything (saving a job again,
 * or removing one already gone, is `false`). `null` when there is no row: the person is not a member, so nothing was
 * written. An unexpected shape fails closed.
 */
export function changedFromRow(row: unknown): boolean | null {
  if (row === undefined || row === null) return null

  return parse(changedRowSchema, row).changed
}
