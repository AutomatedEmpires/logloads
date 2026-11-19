import { entitlementSchema, type Entitlement } from "@logloads/contracts"
import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import {
  isFleetOrganizationType,
  isHostOrganizationType,
  latestIdentityReviewAt,
  planViewForEntitlement,
  reviewedByLogLoadsLabel,
  verificationView
} from "./plans"

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111"
const CREATED_AT = "2026-08-05T12:00:00.000Z"

function entitlement(
  overrides: Partial<Entitlement> = {}
): Entitlement {
  return entitlementSchema.parse({
    activeLandingLimit: null,
    activeTruckLimit: null,
    createdAt: CREATED_AT,
    currentPeriodEndsAt: null,
    features: [],
    id: "91919191-9191-4191-8191-919191919191",
    organizationId: ORGANIZATION_ID,
    product: "fleet_operations",
    status: "active",
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    updatedAt: CREATED_AT,
    ...overrides
  })
}

describe("commercial plan projection", () => {
  it("projects an unbound fleet capability as current Fleet Free even when stale trial fields remain", () => {
    const view = planViewForEntitlement(
      entitlement({
        activeTruckLimit: 5,
        currentPeriodEndsAt: "2099-08-19T12:00:00.000Z",
        status: "trialing"
      })
    )
    const serialized = JSON.stringify(view).toLowerCase()

    expect(view).toMatchObject({
      limitLines: [],
      name: "Fleet Free",
      priceLine: "Free",
      recordMode: "current",
      statusLine: "Included"
    })
    expect(serialized).not.toContain("$499")
    expect(serialized).not.toContain("trial")
    expect(serialized).not.toContain("subscription")
  })

  it("projects a provider-bound fleet entitlement as explicit Dispatch Pro history", () => {
    const view = planViewForEntitlement(
      entitlement({
        activeTruckLimit: 12,
        stripeCustomerId: "cus_historical_logloads",
        stripeSubscriptionId: "sub_historical_logloads"
      })
    )

    expect(view).toMatchObject({
      limitLines: ["Recorded limit: 12 active trucks"],
      name: "Dispatch Pro — historical",
      priceLine: "Recorded monthly amount: $499",
      recordMode: "historical",
      statusLine: "Recorded active"
    })
    expect(view.statusDetail).toContain("does not authorize new work")
  })

  it("does not present a customer-only provider record as a $499 subscription", () => {
    const view = planViewForEntitlement(
      entitlement({
        status: "trialing",
        stripeCustomerId: "cus_historical_logloads"
      })
    )

    expect(view).toMatchObject({
      name: "Dispatch Pro enrollment — historical",
      priceLine: "No subscription created",
      recordMode: "historical",
      statusLine: "Historical trial record"
    })
    expect(JSON.stringify(view)).not.toContain("$499")
  })

  it.each(["landing_operations", "enterprise"] as const)(
    "keeps %s entitlements historical",
    (product) => {
      const view = planViewForEntitlement(
        entitlement({ product })
      )

      expect(view.recordMode).toBe("historical")
      expect(view.statusDetail).toMatch(/histor|frozen/i)
    }
  )

  it.each(["landing_source", "destination"])(
    "recognizes %s as a Host billing workspace",
    (type) => {
      expect(isHostOrganizationType(type)).toBe(true)
    }
  )

  it.each(["fleet", "carrier", "platform", null, undefined])(
    "does not recognize %s as a Host billing workspace",
    (type) => {
      expect(isHostOrganizationType(type)).toBe(false)
    }
  )

  it.each(["fleet", "carrier"])(
    "recognizes %s as a Fleet Free workspace",
    (type) => {
      expect(isFleetOrganizationType(type)).toBe(true)
    }
  )

  it.each(["landing_source", "destination", "platform", null, undefined])(
    "does not recognize %s as a Fleet Free workspace",
    (type) => {
      expect(isFleetOrganizationType(type)).toBe(false)
    }
  )

  it.each([
    ["rejected", "Not approved", "request a new review"],
    ["suspended", "Suspended", "steps required for reinstatement"]
  ])(
    "describes %s organizations as operationally locked with a real support path",
    (status, label, supportCopy) => {
      const view = verificationView(status)

      expect(view).toMatchObject({ label, tone: "critical" })
      expect(view.meaning).toContain("Operations and network visibility are locked")
      expect(view.meaning).toContain("Contact LogLoads support")
      expect(view.meaning).toContain(supportCopy)
      expect(view.meaning).not.toMatch(/message|thread/i)
    }
  )
})

// #428: a reviewed organization reads as LogLoads' dated statement, never the bare word (legal review §7.3 items 1
// and 4). The wording is the Marketplace V2 mark's, from describeMarketplaceVerification.
describe("an organization's business identity review", () => {
  const NOW = "2026-11-18T12:00:00.000Z"
  const BARE = /^(?:verified|trusted|approved|vetted|safe|certified|background[ -]checked)\b/i

  it("names who reviewed what, and when", () => {
    const view = verificationView("verified", "2026-10-14T16:00:00.000Z", NOW)

    expect(view).toMatchObject({ label: "Business identity reviewed by LogLoads on Oct 14, 2026", tone: "success" })
    expect(view.meaning).toContain("LogLoads reviewed this organization's business identity.")
    expect(view.meaning).toContain("does not cover insurance, operating authority, licences, safety record or equipment")
    // Only what every path records (#412): no claim that details or documents were sent.
    expect(view.meaning).not.toMatch(/\bsent\b|documents?/i)
  })

  it("shows a review older than 12 months as last reviewed, in a neutral tone", () => {
    const view = verificationView("verified", "2025-09-03T10:00:00.000Z", NOW)

    expect(view).toMatchObject({ label: "Business identity last reviewed by LogLoads on Sep 3, 2025", tone: "neutral" })
    expect(view.meaning).toContain("more than 12 months old")
  })

  it("says the date is not on record rather than inventing one", () => {
    const view = verificationView("verified", null, NOW)

    expect(view).toMatchObject({ label: "Business identity reviewed by LogLoads, date not on record", tone: "neutral" })
  })

  it.each(["verified", "pending", "rejected", "suspended", "unknown"])("never labels %s with a bare word", (status) => {
    expect(verificationView(status, "2026-10-14T16:00:00.000Z", NOW).label).not.toMatch(BARE)
  })

  it("takes the latest identity review of that organization only", () => {
    const record = (overrides: Partial<Parameters<typeof latestIdentityReviewAt>[0][number]>) => ({
      status: "verified" as const,
      subjectId: ORGANIZATION_ID,
      subjectType: "organization" as const,
      verificationType: "organization" as const,
      verifiedAt: "2026-03-01T00:00:00.000Z",
      ...overrides
    })

    expect(
      latestIdentityReviewAt(
        [
          record({}),
          record({ verifiedAt: "2026-09-30T00:00:00.000Z" }),
          // Another organization, another kind of record, a refusal and a record with no date never count.
          record({ subjectId: "33333333-3333-4333-8333-333333333399", verifiedAt: "2026-11-01T00:00:00.000Z" }),
          record({ verificationType: "insurance_document", verifiedAt: "2026-11-02T00:00:00.000Z" }),
          record({ status: "rejected", verifiedAt: "2026-11-03T00:00:00.000Z" }),
          record({ verifiedAt: null })
        ],
        ORGANIZATION_ID
      )
    ).toBe("2026-09-30T00:00:00.000Z")
    expect(latestIdentityReviewAt([], ORGANIZATION_ID)).toBeNull()
  })
})

// #428: a verification record (identity, insurance, equipment and the rest) reads as a dated review by LogLoads.
describe("a reviewed verification record", () => {
  it("names LogLoads and the review date", () => {
    expect(reviewedByLogLoadsLabel("2026-10-14T16:00:00.000Z")).toBe("Reviewed by LogLoads on Oct 14, 2026")
  })

  it("says the date is not on record when it is missing or unreadable", () => {
    expect(reviewedByLogLoadsLabel(null)).toBe("Reviewed by LogLoads, date not on record")
    expect(reviewedByLogLoadsLabel("not a date")).toBe("Reviewed by LogLoads, date not on record")
  })
})
