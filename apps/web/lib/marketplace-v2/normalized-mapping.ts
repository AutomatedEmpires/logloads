import { z } from "zod"

import {
  draftProductLabel,
  expressInterestInputSchema,
  filterMarketplaceJobs,
  haulerInterestReplyInputSchema,
  MARKETPLACE_CAPABILITIES,
  MARKETPLACE_EQUIPMENT_TYPES,
  marketplaceContactPreferenceSchema,
  marketplaceInterestStatusSchema,
  marketplaceJobStatusSchema,
  MARKETPLACE_LISTING_REPORT_REASON_LABELS,
  marketplacePayUnitSchema,
  reportListingInputSchema,
  respondToInterestInputSchema,
  sortMarketplaceJobs,
  withdrawInterestInputSchema,
  type MarketplaceCapability,
  type MarketplaceDraftLandingContext,
  type MarketplaceHaulerEquipmentOption,
  type MarketplaceInquiryJobContext,
  type MarketplaceInterestView,
  type MarketplaceJobDetailView,
  type MarketplaceJobDraft,
  type MarketplaceJobFilters,
  type MarketplaceListingReportReason,
  type MarketplaceListingReportReceipt
} from "@logloads/contracts"

import type { StoredAbuseReason, StoredListingReport } from "./normalized-db"
import { MarketplaceRefusalError, MarketplaceStoreError, type MarketplaceV2ViewerAccess } from "./port"

/**
 * Pure mapping between the V2 read model / inputs and the normalized `marketplace` functions' rows and arguments
 * (architecture/normalized-v2/06_v2_contract_alignment.sql §7, INTERFACE_CONTRACT_H1_H3.md). Rows are the JSON of
 * `to_jsonb(row)` — the same shape PostgREST returns — so this module does not depend on the database driver.
 *
 * Kept honest, as in the pilot mapping:
 * - coordinates are the server's 0.10° public grid values, used as given and never re-rounded (H2, V2-DEC-01);
 * - `lastConfirmedAt` is only the poster's explicit confirmation; `lastModifiedAt` is only an edit time;
 * - truck demand, estimates and pay are what the poster stated; nothing is derived or guessed;
 * - a verification mark claims business identity only, and no review date the function does not return.
 *
 * Unexpected row shapes fail loudly (a contract drift between the SQL and this adapter), never silently.
 */

const uuid = z.string().uuid()

export function isUuid(value: unknown): value is string {
  return uuid.safeParse(value).success
}

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
/** `numeric` and `bigint` arrive as JSON numbers; accept numeric strings too (other transports). */
const numeric = z.union([z.number(), z.string().regex(/^-?\d+(\.\d+)?$/)]).transform(Number).nullable()
const nullableText = z.string().nullable()

const jobRowSchema = z.object({
  accepting_interest: z.boolean(),
  destination_label: nullableText,
  ends_on: calendarDate,
  equipment_codes: z.array(z.string()).nullable(),
  est_one_way_miles: numeric,
  estimated_daily_loads: numeric,
  estimated_loads_per_truck_per_day: numeric,
  estimated_tons_per_load: numeric,
  expires_at: nullableTimestamp,
  job_id: uuid,
  last_confirmed_at: nullableTimestamp,
  last_modified_at: timestamp,
  origin_label: nullableText,
  origin_lat: z.number().nullable(),
  origin_lng: z.number().nullable(),
  origin_state_code: nullableText,
  pay_amount_cents: numeric,
  pay_note: nullableText,
  pay_unit: marketplacePayUnitSchema.nullable(),
  poster_name: z.string(),
  poster_organization_id: uuid,
  poster_verified: z.boolean().nullable(),
  product: nullableText,
  public_access_requirements: z.array(z.string()).nullable(),
  public_road_notes: nullableText,
  schedule_note: nullableText,
  slug: z.string(),
  sponsored: z.boolean().nullable(),
  starts_on: calendarDate,
  status: marketplaceJobStatusSchema,
  title: z.string(),
  trucks_per_day: numeric,
  trucks_total: numeric
})

function parseRow<S extends z.ZodTypeAny>(schema: S, row: unknown): z.output<S> {
  const parsed = schema.safeParse(row)

  if (!parsed.success) {
    // A drift between the SQL and this adapter. The detail stays out of the message shown to people.
    throw new MarketplaceStoreError(undefined, "22000", parsed.error)
  }

  return parsed.data
}

/** `list_marketplace_jobs` / `get_marketplace_job` row → the public V2 job view. */
export function jobViewFromRow(row: unknown): MarketplaceJobDetailView {
  const job = parseRow(jobRowSchema, row)
  const point = job.origin_lat !== null && job.origin_lng !== null ? { lat: job.origin_lat, lng: job.origin_lng } : null

  return {
    acceptingInterest: job.accepting_interest,
    destinationLabel: job.destination_label,
    endsOn: job.ends_on,
    // Taxonomy codes, as the pilot mapping gives them (#185); every screen shows each code's label.
    equipment: job.equipment_codes ?? [],
    estimatedDailyLoads: job.estimated_daily_loads,
    estimatedLoadsPerTruckPerDay: job.estimated_loads_per_truck_per_day,
    estimatedTonsPerLoad: job.estimated_tons_per_load,
    expiresAt: job.expires_at,
    haulDistance: job.est_one_way_miles !== null && job.est_one_way_miles > 0
      ? { basis: "poster_route_estimate", miles: job.est_one_way_miles }
      : null,
    id: job.job_id,
    lastConfirmedAt: job.last_confirmed_at,
    lastModifiedAt: job.last_modified_at,
    origin: {
      approximatePoint: point,
      label: job.origin_label?.trim() || "Location shared on request",
      stateCode: job.origin_state_code?.trim() || null
    },
    pay: {
      amountCents: job.pay_unit === "negotiable" ? null : job.pay_amount_cents,
      note: job.pay_note,
      unit: job.pay_unit
    },
    posterName: job.poster_name,
    posterOrganizationId: job.poster_organization_id,
    posterVerification: job.poster_verified ? { reviewedOn: null, scope: "business_identity" } : null,
    product: job.product,
    publicAccessRequirements: job.public_access_requirements ?? [],
    publicRoadNotes: job.public_road_notes,
    scheduleNote: job.schedule_note,
    slug: job.slug,
    sponsored: job.sponsored === true,
    startsOn: job.starts_on,
    status: job.status,
    title: job.title,
    trucks: { perDay: job.trucks_per_day, total: job.trucks_total }
  }
}

const interestRowSchema = z.object({
  available_from: calendarDate,
  available_until: calendarDate,
  contact_preference: marketplaceContactPreferenceSchema,
  created_at: timestamp,
  equipment: z.array(z.object({ configurationKey: z.string(), count: z.number().int(), label: z.string() })),
  hauler_org_id: uuid,
  hauler_org_name: z.string(),
  hauler_org_type: z.string(),
  id: uuid,
  job_accepting_interest: z.boolean(),
  job_id: uuid,
  job_slug: z.string(),
  job_status: marketplaceJobStatusSchema,
  job_title: z.string(),
  landing_org_id: uuid,
  landing_org_name: z.string(),
  message: nullableText,
  replies: z.array(z.object({
    authorName: z.string(),
    authorSide: z.enum(["hauler", "landing"]),
    authorUserId: uuid,
    body: z.string(),
    createdAt: timestamp,
    id: uuid
  })),
  status: marketplaceInterestStatusSchema,
  submitted_by_name: z.string(),
  submitted_by_user_id: uuid,
  trucks_offered: z.number().int(),
  updated_at: timestamp
})

/** `list_marketplace_interests` row → the V2 inquiry view (either side). */
export function interestViewFromRow(row: unknown): MarketplaceInterestView {
  const interest = parseRow(interestRowSchema, row)

  return {
    availableFrom: interest.available_from,
    availableUntil: interest.available_until,
    contactPreference: interest.contact_preference,
    createdAt: interest.created_at,
    equipment: interest.equipment.map((line) => ({ configurationKey: line.configurationKey, count: line.count, label: line.label })),
    haulerOrganization: { id: interest.hauler_org_id, name: interest.hauler_org_name, type: interest.hauler_org_type },
    id: interest.id,
    job: {
      acceptingInterest: interest.job_accepting_interest,
      id: interest.job_id,
      slug: interest.job_slug,
      status: interest.job_status,
      title: interest.job_title
    },
    landingOrganization: { id: interest.landing_org_id, name: interest.landing_org_name },
    message: interest.message,
    replies: interest.replies.map((reply) => ({
      authorName: reply.authorName,
      authorSide: reply.authorSide,
      authorUserId: reply.authorUserId,
      body: reply.body,
      createdAt: reply.createdAt,
      id: reply.id
    })),
    status: interest.status,
    submittedBy: { name: interest.submitted_by_name, userId: interest.submitted_by_user_id },
    trucksOffered: interest.trucks_offered,
    updatedAt: interest.updated_at
  }
}

const accessRowSchema = z.object({
  capabilities: z.array(z.string()),
  hauler_profile: z.boolean(),
  landing_workspace_seat: z.boolean(),
  organization_id: uuid,
  organization_name: z.string(),
  role: z.string()
})

export type ViewerAccessRow = z.infer<typeof accessRowSchema>

export function viewerAccessRow(row: unknown): ViewerAccessRow {
  return parseRow(accessRowSchema, row)
}

const isCapability = (value: string): value is MarketplaceCapability => (MARKETPLACE_CAPABILITIES as readonly string[]).includes(value)

/** `get_viewer_marketplace_access` row → capabilities in the active business (unknown names are dropped). */
export function viewerAccessFromRow(row: unknown): MarketplaceV2ViewerAccess {
  const access = viewerAccessRow(row)

  return { capabilities: access.capabilities.filter(isCapability), organizationName: access.organization_name }
}

const landingRowSchema = z.object({ area_label: nullableText, id: uuid, name: z.string(), state_code: nullableText })

export function landingFromRow(row: unknown): MarketplaceDraftLandingContext {
  const landing = parseRow(landingRowSchema, row)

  return { areaLabel: landing.area_label?.trim() ?? "", id: landing.id, name: landing.name, stateCode: landing.state_code?.trim() || null }
}

const equipmentRowSchema = z.object({ configuration_key: z.string(), label: z.string(), units_listed: z.number().int() })

const EQUIPMENT_CODES = new Set<string>(MARKETPLACE_EQUIPMENT_TYPES.map((type) => type.code))

/**
 * The codes in a configuration key. `equipment_units.configuration_key` is generated as `equipment_code` or
 * `equipment_code|paired_trailer_code` (06, `equipment_units`), both `equipment_types` codes. Anything outside the
 * contract's taxonomy is left out, never guessed.
 */
export function configurationEquipmentCodes(configurationKey: string): string[] {
  return Array.from(new Set(configurationKey.split("|").map((part) => part.trim()).filter((code) => EQUIPMENT_CODES.has(code))))
}

export function equipmentOptionFromRow(row: unknown): MarketplaceHaulerEquipmentOption {
  const option = parseRow(equipmentRowSchema, row)

  return {
    configurationKey: option.configuration_key,
    equipmentCodes: configurationEquipmentCodes(option.configuration_key),
    label: option.label,
    unitsListed: option.units_listed
  }
}

const ATTACHMENT_CODES = new Set<string>(MARKETPLACE_EQUIPMENT_TYPES.filter((type) => type.category === "attachment").map((type) => type.code))

/**
 * Whether a configuration is a truck to offer. An extra (On-board scales, Central tire inflation) is its own
 * `equipment_units` row (#126), so `list_hauler_equipment_options` also returns it, keyed by the attachment code
 * alone. It is not a truck, so it is never offered on its own (UX-08, #131).
 * TODO(normalized-v2 schema batch): drop this once `list_hauler_equipment_options` leaves attachments out itself.
 */
export function isOfferableConfiguration(configurationKey: string): boolean {
  const head = configurationKey.split("|")[0]?.trim() ?? ""
  return head !== "" && !ATTACHMENT_CODES.has(head)
}

/** `list_hauler_equipment_options` rows → the configurations a hauler can offer, with extras left out. */
export function equipmentOptionsFromRows(rows: readonly unknown[]): MarketplaceHaulerEquipmentOption[] {
  return rows.map(equipmentOptionFromRow).filter((option) => isOfferableConfiguration(option.configurationKey))
}

/** `submit_expression_of_interest` row → the inquiry id. */
export function submittedInterestId(row: unknown): string {
  return parseRow(z.object({ interest_id: uuid }), row).interest_id
}

/** A scalar uuid result (`publish_job_posting`). */
export function uuidValue(value: unknown): string {
  return parseRow(uuid, value)
}

/**
 * The discovery filters and order that `list_marketplace_jobs` does not take yet. They are applied to its rows with
 * the contract's own pure rules, exactly as the pilot adapter applies them:
 * - the viewer's equipment setups;
 * - product and start date;
 * - distance from a typed place, snapped to the 0.1° grid and measured to each job's public point;
 * - then the chosen sort.
 * Text, equipment and pay basis were already applied by the function. They are not re-applied, because its text
 * match is broader. Pushing these into SQL is a follow-up.
 */
export function refineDiscovery<T extends MarketplaceJobDetailView>(jobs: readonly T[], filters: MarketplaceJobFilters): T[] {
  const refined = filterMarketplaceJobs(jobs, {
    acceptingOnly: filters.acceptingOnly,
    equipmentSetups: filters.equipmentSetups,
    near: filters.near,
    product: filters.product,
    radiusMiles: filters.radiusMiles,
    startsBy: filters.startsBy
  })

  return sortMarketplaceJobs(refined, { near: filters.near, sort: filters.sort })
}

// ---------------------------------------------------------------------------
// Inputs → function arguments
// ---------------------------------------------------------------------------

const QUERY_LIMIT = 200
const LIST_LIMIT = 200

function boundedText(value: string | null | undefined, max: number): string | null {
  const text = typeof value === "string" ? value.trim() : ""
  return text ? text.slice(0, max) : null
}

/**
 * `listJobs` filters → `list_marketplace_jobs` arguments, or `null` when the filter can match nothing. The function
 * takes text, one equipment code or label, the pay basis and "accepting only". `refineDiscovery` applies the rest.
 */
export function jobFilterArguments(filters: MarketplaceJobFilters) {
  const payUnit = filters.payUnit ? marketplacePayUnitSchema.safeParse(filters.payUnit) : null

  if (payUnit && !payUnit.success) {
    return null
  }

  return {
    p_accepting_only: filters.acceptingOnly ?? true,
    p_equipment: boundedText(filters.equipment, 160),
    p_limit: LIST_LIMIT,
    p_pay_unit: payUnit?.success ? payUnit.data : null,
    p_query: boundedText(filters.query, QUERY_LIMIT)
  }
}

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Check the form and try again"
}

function parseInput<S extends z.ZodTypeAny>(schema: S, input: unknown): z.output<S> {
  const parsed = schema.safeParse(input)

  if (!parsed.success) {
    throw new MarketplaceRefusalError(firstIssue(parsed.error), "22023")
  }

  return parsed.data
}

/** The hauler's inquiry → `submit_expression_of_interest`. Only keys and counts; labels and limits come from the profile. */
export function expressInterestArguments(haulerOrganizationId: string, input: unknown) {
  const parsed = parseInput(expressInterestInputSchema, input)

  return {
    p_available_from: parsed.availableFrom ?? null,
    p_available_until: parsed.availableUntil ?? null,
    p_contact_preference: parsed.contactPreference,
    p_equipment: parsed.equipment.map((line) => ({ configurationKey: line.configurationKey, count: line.count })),
    p_hauler_org_id: haulerOrganizationId,
    p_job_id: parsed.loadPostingId,
    p_message: parsed.message,
    p_trucks_offered: parsed.equipment.length > 0 ? null : parsed.trucksOffered ?? null
  }
}

/** The landing's response → `respond_to_interest`. Private details are never shared by this call (no disclosure yet). */
export function respondArguments(input: unknown) {
  const parsed = parseInput(respondToInterestInputSchema, input)

  return {
    p_body: parsed.body,
    p_interest_id: parsed.interestId,
    p_reply_id: parsed.replyId ?? null,
    p_status: parsed.decision
  }
}

export function haulerReplyArguments(input: unknown) {
  const parsed = parseInput(haulerInterestReplyInputSchema, input)

  return { p_body: parsed.body, p_interest_id: parsed.interestId, p_reply_id: parsed.replyId }
}

/** Days in a work period, counting both ends. */
function periodDays(startsOn: string, endsOn: string): number {
  return Math.round((Date.parse(`${endsOn}T00:00:00.000Z`) - Date.parse(`${startsOn}T00:00:00.000Z`)) / 86_400_000) + 1
}

/**
 * The stated work period as `publish_job_posting` takes it: a start date and a duration in days. An end date the
 * poster chose is the same information (the function stores `work_ends_on = start + duration - 1`); "ongoing" is
 * neither.
 */
export function workDurationDays(draft: Pick<MarketplaceJobDraft, "startsOn" | "endsOn" | "durationDays">): number | null {
  if (draft.durationDays !== undefined) {
    return draft.durationDays
  }

  return draft.startsOn && draft.endsOn ? periodDays(draft.startsOn, draft.endsOn) : null
}

/** A validated draft → `publish_job_posting`, with the explicit attestation (V2-DEC-03) and stated pay (V2-DEC-02). */
export function publishArguments(draft: MarketplaceJobDraft) {
  const fixedAmount = draft.payUnit !== undefined && draft.payUnit !== "negotiable" && draft.payAmount !== undefined

  return {
    p_attest_available: true,
    p_description: draft.description ?? null,
    p_destination_label: draft.destinationLabel ?? null,
    p_duration_days: workDurationDays(draft),
    p_equipment_codes: [...draft.equipment],
    p_est_daily_loads: draft.estDailyLoads ?? null,
    p_est_loads_per_truck_per_day: draft.estLoadsPerTruckPerDay ?? null,
    p_est_one_way_miles: draft.estOneWayMiles ?? null,
    p_est_tons_per_load: draft.estTonsPerLoad ?? null,
    p_landing_id: draft.landingId,
    // INTERFACE_CONTRACT_H1_H3 §H1: dollars as typed → whole cents.
    p_pay_amount_cents: fixedAmount ? Math.round((draft.payAmount as number) * 100) : null,
    p_pay_note: draft.payNote ?? null,
    p_pay_unit: draft.payUnit ?? null,
    p_product: draftProductLabel(draft),
    p_public_road_notes: draft.publicRoadNotes ?? null,
    p_title: draft.title,
    p_trucks_per_day: draft.trucksPerDay ?? null,
    p_trucks_requested: draft.trucksRequested,
    p_work_starts_on: draft.startsOn ?? null
  }
}

// ---------------------------------------------------------------------------
// Inquiry conversations (UX-09, #132)
// ---------------------------------------------------------------------------

const inquiryJobRowSchema = z.object({
  equipment_codes: z.array(z.string()).nullable(),
  job_id: uuid,
  landing_id: uuid.nullable(),
  landing_name: z.string().nullable()
})

/** An `INQUIRY_JOBS` row (normalized-db.ts) → the inbox's job context. */
export function inquiryJobFromRow(row: unknown): MarketplaceInquiryJobContext {
  const job = parseRow(inquiryJobRowSchema, row)

  return {
    equipmentCodes: job.equipment_codes ?? [],
    jobId: job.job_id,
    landing: job.landing_id && job.landing_name ? { id: job.landing_id, name: job.landing_name } : null
  }
}

/** The hauler's withdrawal with an optional reason → the reason as a `post_hauler_interest_reply`, or none. */
export function withdrawArguments(input: unknown) {
  const parsed = parseInput(withdrawInterestInputSchema, input)

  return {
    interestId: parsed.interestId,
    reason: parsed.reason && parsed.replyId ? { p_body: parsed.reason, p_interest_id: parsed.interestId, p_reply_id: parsed.replyId } : null
  }
}

// ---------------------------------------------------------------------------
// Listing reports (UX-07, #130)
// ---------------------------------------------------------------------------

/**
 * The spec's report reasons (§8.18) as `abuse_reports.reason` stores them. Three have no code of their own in the
 * schema (no longer available, suspicious contact, wrong equipment): they are stored as `other` with the reason the
 * person chose written first in `details`, so staff still see it. Nothing the person wrote is dropped.
 */
const STORED_REPORT_REASONS: Readonly<Record<MarketplaceListingReportReason, StoredAbuseReason>> = Object.freeze({
  abusive_language: "abuse",
  fake_work: "nonexistent_job",
  inaccurate_pay: "inaccurate_pay",
  other: "other",
  privacy_risk: "unsafe_disclosure",
  stale: "other",
  suspicious_contact: "other",
  wrong_equipment: "other"
})

/** A report as the form sent it → the row `fileListingReport` writes. Refuses input the contract does not accept. */
export function listingReportRow(input: unknown): { jobId: string; reason: StoredAbuseReason; details: string | null } {
  const parsed = parseInput(reportListingInputSchema, input)
  const reason = STORED_REPORT_REASONS[parsed.reason]
  const chosen = reason === "other" && parsed.reason !== "other" ? `Reason: ${MARKETPLACE_LISTING_REPORT_REASON_LABELS[parsed.reason]}.` : null
  const details = [chosen, parsed.details].filter((part): part is string => Boolean(part)).join("\n")

  return { details: details || null, jobId: parsed.jobId, reason }
}

/** The stored report → the receipt the page acknowledges. */
export function listingReportReceipt(report: StoredListingReport, alreadyReported: boolean): MarketplaceListingReportReceipt {
  if (!isUuid(report.id)) {
    throw new MarketplaceStoreError(undefined, "22023")
  }

  return { alreadyReported, reportId: report.id, reportedAt: toIso(report.createdAt) }
}
