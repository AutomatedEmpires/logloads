import { describe, expect, it } from "vitest"

import {
  MARKETPLACE_LISTING_REPORT_DETAILS_MAX,
  MARKETPLACE_LISTING_REPORT_REASON_LABELS,
  MARKETPLACE_LISTING_REPORT_REASONS,
  reportListingInputSchema,
  toPublicJobView
} from "./marketplace-listing"
import type { MarketplaceJobDetailView } from "./marketplace-v2"

const POSTER_ORG = "77777777-7777-4777-8777-777777777777"
const JOB_ID = "11111111-1111-4111-8111-111111111111"

const detail: MarketplaceJobDetailView = {
  acceptingInterest: true,
  destinationLabel: "Example mill · Riverton, OR",
  endsOn: "2026-11-30",
  equipment: ["log_truck"],
  estimatedDailyLoads: 12,
  estimatedLoadsPerTruckPerDay: 2,
  estimatedTonsPerLoad: 28,
  expiresAt: null,
  haulDistance: { basis: "poster_route_estimate", miles: 54 },
  id: JOB_ID,
  lastConfirmedAt: "2026-11-02T09:00:00.000Z",
  lastModifiedAt: "2026-11-01T09:00:00.000Z",
  origin: { approximatePoint: { lat: 44.1, lng: -122.4 }, label: "Riverton, OR", stateCode: "OR" },
  pay: { amountCents: 52_500, note: null, unit: "per_load" },
  posterName: "Example Timber Co",
  posterOrganizationId: POSTER_ORG,
  posterVerification: null,
  product: "Saw logs",
  publicAccessRequirements: ["Chains Nov to Mar"],
  publicRoadNotes: "Gravel for the last 6 miles",
  scheduleNote: null,
  slug: JOB_ID,
  sponsored: false,
  startsOn: "2026-11-10",
  status: "active",
  title: "Saw logs to the river mill",
  trucks: { perDay: 3, total: 6 }
}

describe("the public job view", () => {
  it("keeps every public field and drops the poster's organization id", () => {
    const view = toPublicJobView(detail)
    const { posterOrganizationId: _dropped, ...expected } = detail

    expect(view).toEqual(expected)
    expect(Object.keys(view)).not.toContain("posterOrganizationId")
    expect(JSON.stringify(view)).not.toContain(POSTER_ORG)
  })

  it("never carries a field the allowlist does not name", () => {
    const widened = { ...detail, exactPoint: { lat: 44.15432, lng: -122.48765 }, gateInstructions: "Green gate 4417" } as MarketplaceJobDetailView

    expect(JSON.stringify(toPublicJobView(widened))).not.toMatch(/44\.15432|Green gate|gateInstructions|exactPoint/)
  })
})

describe("reporting a listing (spec §8.18)", () => {
  it("offers the spec's reasons, each with a label, and something else", () => {
    expect(MARKETPLACE_LISTING_REPORT_REASONS).toEqual([
      "stale",
      "inaccurate_pay",
      "fake_work",
      "wrong_equipment",
      "suspicious_contact",
      "abusive_language",
      "privacy_risk",
      "other"
    ])
    for (const reason of MARKETPLACE_LISTING_REPORT_REASONS) {
      expect(MARKETPLACE_LISTING_REPORT_REASON_LABELS[reason]).toMatch(/^[A-Z]/)
    }
  })

  it("accepts a reason with optional details, trimmed, and stores no empty details", () => {
    expect(reportListingInputSchema.parse({ details: "  Pay was $400, not $525  ", jobId: JOB_ID, reason: "inaccurate_pay" })).toEqual({
      details: "Pay was $400, not $525",
      jobId: JOB_ID,
      reason: "inaccurate_pay"
    })
    expect(reportListingInputSchema.parse({ details: "   ", jobId: JOB_ID, reason: "stale" }).details).toBeNull()
    expect(reportListingInputSchema.parse({ jobId: JOB_ID, reason: "stale" }).details).toBeNull()
  })

  it("refuses a missing or unknown reason, an unknown listing and over-long details, in words", () => {
    const issue = (input: unknown) => {
      const parsed = reportListingInputSchema.safeParse(input)
      return parsed.success ? null : parsed.error.issues[0]?.message
    }

    expect(issue({ jobId: JOB_ID, reason: "" })).toBe("Choose why you are reporting this listing")
    expect(issue({ jobId: JOB_ID, reason: "spam" })).toBe("Choose why you are reporting this listing")
    expect(issue({ jobId: "not-a-job", reason: "stale" })).toBe("Listing not found")
    expect(issue({ details: "x".repeat(MARKETPLACE_LISTING_REPORT_DETAILS_MAX + 1), jobId: JOB_ID, reason: "other" })).toBe(
      "Keep the details to 1000 characters"
    )
  })
})
