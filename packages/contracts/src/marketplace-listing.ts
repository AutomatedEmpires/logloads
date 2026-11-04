import { z } from "zod"

import type { MarketplaceJobCardView, MarketplaceJobDetailView } from "./marketplace-v2"

/**
 * A public listing as the browser receives it, and reports about a listing (UX-07, #130).
 *
 * The port's `MarketplaceJobDetailView` carries `posterOrganizationId` because the server needs it: ownership checks
 * (reconfirming, "this is your organization's job") compare it with the session's business. A browser never needs it,
 * so pages hand client components, and the shared JobDetail, the public view below instead.
 */

/** The public card view without the poster's organization id. */
export type MarketplacePublicJobCardView = Omit<MarketplaceJobCardView, "posterOrganizationId">

/** The public detail view without the poster's organization id: everything a job page or a detail panel renders. */
export type MarketplacePublicJobView = Omit<MarketplaceJobDetailView, "posterOrganizationId">

/**
 * The fields a public view copies, as an allowlist: a field added to the detail view later reaches the browser only
 * once it is listed here (the type check below fails until it is listed or deliberately left out).
 */
const PUBLIC_JOB_FIELDS = [
  "acceptingInterest",
  "destinationLabel",
  "endsOn",
  "equipment",
  "estimatedDailyLoads",
  "estimatedLoadsPerTruckPerDay",
  "estimatedTonsPerLoad",
  "expiresAt",
  "haulDistance",
  "id",
  "lastConfirmedAt",
  "lastModifiedAt",
  "origin",
  "pay",
  "posterName",
  "posterVerification",
  "product",
  "publicAccessRequirements",
  "publicRoadNotes",
  "scheduleNote",
  "slug",
  "sponsored",
  "startsOn",
  "status",
  "title",
  "trucks"
] as const satisfies ReadonlyArray<keyof MarketplacePublicJobView>

type UnlistedPublicField = Exclude<keyof MarketplacePublicJobView, (typeof PUBLIC_JOB_FIELDS)[number]>
// Compile-time: every public field is listed. A new field fails here until it is added above.
const EVERY_PUBLIC_FIELD_LISTED: [UnlistedPublicField] extends [never] ? true : never = true
void EVERY_PUBLIC_FIELD_LISTED

/** Copies a job's public fields only. Server-side ids that are not part of the public view are left behind. */
export function toPublicJobView(job: MarketplaceJobDetailView): MarketplacePublicJobView {
  return Object.fromEntries(PUBLIC_JOB_FIELDS.map((field) => [field, job[field]])) as MarketplacePublicJobView
}

// ---------------------------------------------------------------------------
// Reporting a listing (UX spec §8.18, §10.27; UX 02 §A7)
// ---------------------------------------------------------------------------

/**
 * The reasons a person can give, from spec §8.18 (fake work, inaccurate pay, stale, suspicious contact, abusive
 * language, wrong equipment, privacy risk), plus "something else" from UX 02 §A7 for a concern outside that list.
 */
export const MARKETPLACE_LISTING_REPORT_REASONS = [
  "stale",
  "inaccurate_pay",
  "fake_work",
  "wrong_equipment",
  "suspicious_contact",
  "abusive_language",
  "privacy_risk",
  "other"
] as const
export type MarketplaceListingReportReason = (typeof MARKETPLACE_LISTING_REPORT_REASONS)[number]

/** Short reason choices (spec §8.18), worded as what the person saw, never as an accusation. */
export const MARKETPLACE_LISTING_REPORT_REASON_LABELS: Readonly<Record<MarketplaceListingReportReason, string>> = Object.freeze({
  abusive_language: "Abusive language",
  fake_work: "The work doesn't seem real",
  inaccurate_pay: "Pay looks inaccurate",
  other: "Something else",
  privacy_risk: "It shows private or access details",
  stale: "No longer available",
  suspicious_contact: "Suspicious contact request",
  wrong_equipment: "Wrong equipment listed"
})

/** The most a reporter may write. The store keeps 2,000 characters; the rest is room for the stored reason. */
export const MARKETPLACE_LISTING_REPORT_DETAILS_MAX = 1000

export const reportListingInputSchema = z.object({
  jobId: z.string().trim().uuid("Listing not found"),
  reason: z.enum(MARKETPLACE_LISTING_REPORT_REASONS, { message: "Choose why you are reporting this listing" }),
  details: z
    .string()
    .trim()
    .max(MARKETPLACE_LISTING_REPORT_DETAILS_MAX, `Keep the details to ${MARKETPLACE_LISTING_REPORT_DETAILS_MAX} characters`)
    .optional()
    .transform((value) => (value ? value : null))
})
export type ReportListingInput = z.infer<typeof reportListingInputSchema>

/** What the store recorded. A repeat report of the same listing returns the person's standing report. */
export interface MarketplaceListingReportReceipt {
  reportId: string
  /** When the report was first filed (ISO 8601). */
  reportedAt: string
  /** True when the person had already reported this listing and nothing new was filed. */
  alreadyReported: boolean
}
