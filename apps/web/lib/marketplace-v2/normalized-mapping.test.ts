import { describe, expect, it } from "vitest"

import { validateMarketplaceJobDraft } from "@logloads/contracts"

import {
  configurationEquipmentCodes,
  equipmentOptionFromRow,
  expressInterestArguments,
  interestViewFromRow,
  jobFilterArguments,
  jobViewFromRow,
  landingFromRow,
  listingReportReceipt,
  listingReportRow,
  publishArguments,
  refineDiscovery,
  respondArguments,
  viewerAccessFromRow,
  workDurationDays
} from "./normalized-mapping"
import { MarketplaceRefusalError, MarketplaceStoreError } from "./port"

const JOB_ID = "11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const ORG_ID = "33333333-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const HAULER_ID = "44444444-cccc-4ccc-8ccc-cccccccccccc"
const USER_ID = "55555555-dddd-4ddd-8ddd-dddddddddddd"
const INTEREST_ID = "66666666-eeee-4eee-8eee-eeeeeeeeeeee"
const LANDING_ID = "77777777-ffff-4fff-8fff-ffffffffffff"

/** A row as `to_jsonb(list_marketplace_jobs(...))` returns it. */
function jobRow(overrides: Record<string, unknown> = {}) {
  return {
    accepting_interest: true,
    description: "Not part of the public view model",
    destination_label: "Mill near Albany, OR",
    distance_miles: null,
    duration_days: 10,
    ends_on: "2026-12-10",
    equipment_codes: ["log_truck"],
    est_one_way_miles: 42,
    estimated_daily_loads: 12,
    estimated_loads_per_truck_per_day: 2.5,
    estimated_tons_per_load: 28.5,
    expires_at: null,
    job_id: JOB_ID,
    last_confirmed_at: "2026-11-03T12:00:00.123456+00:00",
    last_modified_at: "2026-11-03T11:59:59.5+00:00",
    origin_label: "Near Vida, OR",
    origin_lat: 44.2,
    origin_lng: -122.5,
    origin_state_code: "OR",
    pay_amount_cents: 9100,
    pay_note: null,
    pay_unit: "per_ton",
    poster_name: "Adapter Timber",
    poster_organization_id: ORG_ID,
    poster_verified: false,
    product: "Saw logs",
    public_access_requirements: [],
    public_road_notes: "Gravel road",
    schedule_note: null,
    slug: JOB_ID,
    sponsored: false,
    starts_on: "2026-12-01",
    status: "active",
    title: "Adapter Sawlog Run",
    trucks_per_day: 2,
    trucks_total: 3,
    ...overrides
  }
}

describe("jobViewFromRow", () => {
  it("maps a public job row to the V2 view without re-rounding the server's coordinates (H2)", () => {
    const view = jobViewFromRow(jobRow({ origin_lat: 47.7, origin_lng: -117.5 }))

    expect(view.origin).toEqual({ approximatePoint: { lat: 47.7, lng: -117.5 }, label: "Near Vida, OR", stateCode: "OR" })
    expect(view).toMatchObject({
      acceptingInterest: true,
      equipment: ["log_truck"],
      estimatedLoadsPerTruckPerDay: 2.5,
      estimatedTonsPerLoad: 28.5,
      haulDistance: { basis: "poster_route_estimate", miles: 42 },
      id: JOB_ID,
      lastConfirmedAt: "2026-11-03T12:00:00.123Z",
      lastModifiedAt: "2026-11-03T11:59:59.500Z",
      pay: { amountCents: 9100, note: null, unit: "per_ton" },
      posterOrganizationId: ORG_ID,
      posterVerification: null,
      sponsored: false,
      status: "active",
      trucks: { perDay: 2, total: 3 }
    })
    expect(Object.keys(view)).not.toContain("description")
  })

  it("claims business identity only for a verified poster, with no invented review date", () => {
    expect(jobViewFromRow(jobRow({ poster_verified: true })).posterVerification).toEqual({ reviewedOn: null, scope: "business_identity" })
  })

  it("keeps unknowns unknown", () => {
    const view = jobViewFromRow(jobRow({
      est_one_way_miles: null,
      last_confirmed_at: null,
      origin_label: null,
      origin_lat: null,
      origin_lng: null,
      pay_amount_cents: null,
      pay_note: "Depends on haul length",
      pay_unit: "negotiable",
      trucks_per_day: null
    }))

    expect(view.origin.approximatePoint).toBeNull()
    expect(view.origin.label).toBe("Location shared on request")
    expect(view.haulDistance).toBeNull()
    expect(view.lastConfirmedAt).toBeNull()
    expect(view.pay).toEqual({ amountCents: null, note: "Depends on haul length", unit: "negotiable" })
    expect(view.trucks).toEqual({ perDay: null, total: 3 })
  })

  it("fails loudly on a row that drifted from the contract", () => {
    expect(() => jobViewFromRow(jobRow({ status: "draft" }))).toThrow(MarketplaceStoreError)
    expect(() => jobViewFromRow(jobRow({ pay_unit: "per_bushel" }))).toThrow(MarketplaceStoreError)
    expect(() => jobViewFromRow({ job_id: JOB_ID })).toThrow(MarketplaceStoreError)
  })
})

describe("interestViewFromRow", () => {
  it("maps an inquiry row and its replies", () => {
    const view = interestViewFromRow({
      available_from: "2026-12-01",
      available_until: null,
      contact_preference: "in_app",
      created_at: "2026-11-03T12:00:00+00:00",
      equipment: [{ configurationKey: "log_truck", count: 2, label: "Log truck" }],
      hauler_org_id: HAULER_ID,
      hauler_org_name: "Adapter Hauling",
      hauler_org_type: "fleet",
      id: INTEREST_ID,
      job_accepting_interest: true,
      job_id: JOB_ID,
      job_slug: JOB_ID,
      job_status: "active",
      job_title: "Adapter Sawlog Run",
      landing_org_id: ORG_ID,
      landing_org_name: "Adapter Timber",
      message: "Two trucks",
      replies: [{ authorName: "Land Owner", authorSide: "landing", authorUserId: USER_ID, body: "Call us", createdAt: "2026-11-03T12:05:00.000Z", id: INTEREST_ID }],
      responded_at: "2026-11-03T12:05:00+00:00",
      status: "replied",
      submitted_by_name: "Haul Owner",
      submitted_by_user_id: USER_ID,
      trucks_offered: 2,
      updated_at: "2026-11-03T12:05:00+00:00",
      withdrawn_at: null
    })

    expect(view).toMatchObject({
      equipment: [{ configurationKey: "log_truck", count: 2, label: "Log truck" }],
      haulerOrganization: { id: HAULER_ID, name: "Adapter Hauling", type: "fleet" },
      job: { acceptingInterest: true, id: JOB_ID, status: "active", title: "Adapter Sawlog Run" },
      landingOrganization: { id: ORG_ID, name: "Adapter Timber" },
      replies: [{ authorName: "Land Owner", authorSide: "landing", body: "Call us", createdAt: "2026-11-03T12:05:00.000Z" }],
      status: "replied",
      submittedBy: { name: "Haul Owner", userId: USER_ID },
      updatedAt: "2026-11-03T12:05:00.000Z"
    })
  })
})

describe("viewer access, landings", () => {
  it("keeps only capabilities the V2 contract knows", () => {
    expect(viewerAccessFromRow({
      capabilities: ["job.publish", "inquiry.respond", "dispatch.assign"],
      hauler_profile: false,
      landing_workspace_seat: true,
      organization_id: ORG_ID,
      organization_name: "Adapter Timber",
      role: "owner"
    })).toEqual({ capabilities: ["job.publish", "inquiry.respond"], organizationName: "Adapter Timber" })
  })

  it("maps a landing to its public label only", () => {
    expect(landingFromRow({ area_label: "Near Vida, OR", id: LANDING_ID, name: "Upper Spur", state_code: "OR" }))
      .toEqual({ areaLabel: "Near Vida, OR", id: LANDING_ID, name: "Upper Spur", stateCode: "OR" })
  })
})

describe("arguments", () => {
  function draft(overrides: Record<string, unknown> = {}) {
    const result = validateMarketplaceJobDraft({
      destinationLabel: "Mill near Albany, OR",
      durationDays: "10",
      equipment: ["log_truck"],
      estTonsPerLoad: "28.5",
      landingId: LANDING_ID,
      payAmount: "4.25",
      payUnit: "per_mile",
      product: "Saw logs",
      startsOn: "2026-12-01",
      title: "Adapter Sawlog Run",
      trucksRequested: "3",
      ...overrides
    })

    if (!result.ok) throw new Error(JSON.stringify(result.issues))
    return result.draft
  }

  it("publishes with the explicit attestation, whole cents and the stated period", () => {
    expect(publishArguments(draft())).toMatchObject({
      p_attest_available: true,
      p_duration_days: 10,
      p_equipment_codes: ["log_truck"],
      p_landing_id: LANDING_ID,
      p_pay_amount_cents: 425,
      p_pay_unit: "per_mile",
      p_product: "Saw logs",
      p_trucks_per_day: null,
      p_trucks_requested: 3,
      p_work_starts_on: "2026-12-01"
    })
  })

  it("sends negotiable pay with its note and no amount, and an Other product as its description", () => {
    expect(publishArguments(draft({ payAmount: "", payNote: "Depends on haul length", payUnit: "negotiable", product: "Other", productOther: "Cedar shakes" })))
      .toMatchObject({ p_pay_amount_cents: null, p_pay_note: "Depends on haul length", p_pay_unit: "negotiable", p_product: "Cedar shakes" })
  })

  it("states a chosen end date as the equivalent duration, and ongoing work as neither", () => {
    expect(workDurationDays({ endsOn: "2026-12-10", startsOn: "2026-12-01" })).toBe(10)
    expect(workDurationDays({ endsOn: "2026-12-01", startsOn: "2026-12-01" })).toBe(1)
    expect(workDurationDays({ startsOn: "2026-12-01" })).toBeNull()
    expect(publishArguments(draft({ durationDays: "", ongoing: "1" })).p_duration_days).toBeNull()
  })

  it("filters discovery on the server and matches nothing for an unknown pay basis", () => {
    expect(jobFilterArguments({})).toEqual({ p_accepting_only: true, p_equipment: null, p_limit: 200, p_pay_unit: null, p_query: null })
    expect(jobFilterArguments({ acceptingOnly: false, equipment: " Log truck ", payUnit: "per_ton", query: "  saw " }))
      .toEqual({ p_accepting_only: false, p_equipment: "Log truck", p_limit: 200, p_pay_unit: "per_ton", p_query: "saw" })
    expect(jobFilterArguments({ payUnit: "per_bushel" as never })).toBeNull()
  })

  it("sends only equipment keys and counts from the inquiry form; the hauler business is the viewer's", () => {
    expect(expressInterestArguments(HAULER_ID, {
      equipment: [{ configurationKey: "log_truck", count: "2" }, { configurationKey: "self_loader", count: "0" }],
      loadPostingId: JOB_ID,
      message: " Two trucks ",
      trucksOffered: "9"
    })).toEqual({
      p_available_from: null,
      p_available_until: null,
      p_contact_preference: "in_app",
      p_equipment: [{ configurationKey: "log_truck", count: 2 }],
      p_hauler_org_id: HAULER_ID,
      p_job_id: JOB_ID,
      p_message: "Two trucks",
      p_trucks_offered: null
    })
  })

  it("refuses malformed input with the contract's own message before reaching the store", () => {
    expect(() => expressInterestArguments(HAULER_ID, { loadPostingId: JOB_ID })).toThrow(MarketplaceRefusalError)
    expect(() => respondArguments({ decision: "replied", interestId: INTEREST_ID, replyId: USER_ID })).toThrow("A reply needs a message")
    expect(respondArguments({ body: "Call us", decision: "replied", interestId: INTEREST_ID, replyId: USER_ID }))
      .toEqual({ p_body: "Call us", p_interest_id: INTEREST_ID, p_reply_id: USER_ID, p_status: "replied" })
  })
})

describe("equipment codes (#185)", () => {
  it("reads a configuration's codes from its generated key, keeping only taxonomy codes", () => {
    expect(configurationEquipmentCodes("log_truck")).toEqual(["log_truck"])
    expect(configurationEquipmentCodes("self_loader|pole_trailer")).toEqual(["self_loader", "pole_trailer"])
    expect(configurationEquipmentCodes("log_truck|flatbed")).toEqual(["log_truck"])
    expect(equipmentOptionFromRow({ configuration_key: "chip_truck|chip_van", label: "Chip truck + Chip van", units_listed: 3 }))
      .toEqual({ configurationKey: "chip_truck|chip_van", equipmentCodes: ["chip_truck", "chip_van"], label: "Chip truck + Chip van", unitsListed: 3 })
  })
})

describe("refineDiscovery (#185 filters the function does not take yet)", () => {
  const near = jobViewFromRow(jobRow({ job_id: "11111111-aaaa-4aaa-8aaa-aaaaaaaaaaa1", origin_lat: 44.2, origin_lng: -122.5, pay_amount_cents: 9100, pay_unit: "per_ton", product: "Saw logs", starts_on: "2026-12-01", title: "Near saw logs" }))
  const far = jobViewFromRow(jobRow({ job_id: "11111111-aaaa-4aaa-8aaa-aaaaaaaaaaa2", origin_lat: 45.5, origin_lng: -122.7, pay_amount_cents: 52500, pay_unit: "per_load", product: "Pulpwood", starts_on: "2026-12-20", title: "Far pulpwood", equipment_codes: ["self_loader"] }))
  const jobs = [near, far]
  const ids = (list: Array<{ id: string }>) => list.map((job) => job.id)

  it("filters by product, start date, distance from a typed place and the viewer's setups", () => {
    expect(ids(refineDiscovery(jobs, { product: "Pulpwood" }))).toEqual([far.id])
    expect(ids(refineDiscovery(jobs, { startsBy: "2026-12-05" }))).toEqual([near.id])
    expect(ids(refineDiscovery(jobs, { near: { lat: 44.16, lng: -122.48 }, radiusMiles: 10 }))).toEqual([near.id])
    expect(ids(refineDiscovery(jobs, { equipmentSetups: [["log_truck"]] }))).toEqual([near.id])
  })

  it("orders by the chosen sort, with pay compared only within a basis", () => {
    expect(ids(refineDiscovery(jobs, { near: { lat: 45.5, lng: -122.7 }, sort: "nearest" }))).toEqual([far.id, near.id])
    expect(ids(refineDiscovery(jobs, { sort: "pay" }))).toEqual([far.id, near.id])
  })
})

describe("listing reports (#130)", () => {
  it("stores the spec's reasons under the schema's codes, keeping the person's words", () => {
    expect(listingReportRow({ details: "Pay is $70 a ton at the scale", jobId: JOB_ID, reason: "inaccurate_pay" })).toEqual({
      details: "Pay is $70 a ton at the scale",
      jobId: JOB_ID,
      reason: "inaccurate_pay"
    })
    expect(listingReportRow({ jobId: JOB_ID, reason: "fake_work" }).reason).toBe("nonexistent_job")
    expect(listingReportRow({ jobId: JOB_ID, reason: "abusive_language" }).reason).toBe("abuse")
    expect(listingReportRow({ jobId: JOB_ID, reason: "privacy_risk" }).reason).toBe("unsafe_disclosure")
    expect(listingReportRow({ jobId: JOB_ID, reason: "other" })).toEqual({ details: null, jobId: JOB_ID, reason: "other" })
  })

  it("writes the chosen reason first when the schema has no code for it", () => {
    expect(listingReportRow({ details: "Filled last week", jobId: JOB_ID, reason: "stale" })).toEqual({
      details: "Reason: No longer available.\nFilled last week",
      jobId: JOB_ID,
      reason: "other"
    })
    expect(listingReportRow({ jobId: JOB_ID, reason: "wrong_equipment" }).details).toBe("Reason: Wrong equipment listed.")
    expect(listingReportRow({ jobId: JOB_ID, reason: "suspicious_contact" }).details).toBe("Reason: Suspicious contact request.")
  })

  it("refuses input the contract does not accept", () => {
    expect(() => listingReportRow({ jobId: JOB_ID, reason: "spam" })).toThrow(MarketplaceRefusalError)
    expect(() => listingReportRow({ jobId: "nope", reason: "stale" })).toThrow("Listing not found")
  })

  it("acknowledges the stored report with an ISO time, and refuses a malformed id", () => {
    expect(listingReportReceipt({ createdAt: "2026-11-03 12:00:00+00", id: INTEREST_ID }, false)).toEqual({
      alreadyReported: false,
      reportId: INTEREST_ID,
      reportedAt: "2026-11-03T12:00:00.000Z"
    })
    expect(() => listingReportReceipt({ createdAt: "2026-11-03T12:00:00Z", id: "1" }, true)).toThrow(MarketplaceStoreError)
  })
})
