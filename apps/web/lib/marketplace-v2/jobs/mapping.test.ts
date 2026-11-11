import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { draftEndsOn, marketplaceJobDraftSchema, type MarketplaceJobDraft } from "@logloads/contracts"

import { publishArguments } from "../normalized-mapping"
import { MarketplaceStoreError } from "../port"
import { storedJobDraft, storedOwnJob } from "./mapping"

/**
 * Store rows → the jobs group's records (#247). The terms are read back from the same `list_marketplace_jobs` row as
 * the public view, so a draft round-trips through `publish_job_posting`'s arguments and back unchanged.
 */

const ORG = "11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const LANDING = "33333333-cccc-4ccc-8ccc-cccccccccccc"
const JOB = "66666666-0000-4000-8000-000000000001"

/** A `list_marketplace_jobs` row as stage 06 returns it for a job published with these arguments. */
function storedRow(args: ReturnType<typeof publishArguments>, overrides: Record<string, unknown> = {}) {
  const endsOn = args.p_work_starts_on && args.p_duration_days
    ? draftEndsOn({ durationDays: args.p_duration_days, startsOn: args.p_work_starts_on })
    : null

  return {
    accepting_interest: true,
    description: args.p_description,
    destination_label: args.p_destination_label,
    distance_miles: null,
    duration_days: args.p_duration_days,
    ends_on: endsOn,
    equipment_codes: args.p_equipment_codes,
    equipment_labels: [],
    est_one_way_miles: args.p_est_one_way_miles,
    estimated_daily_loads: args.p_est_daily_loads,
    estimated_loads_per_truck_per_day: args.p_est_loads_per_truck_per_day,
    estimated_tons_per_load: args.p_est_tons_per_load,
    expires_at: null,
    job_id: JOB,
    last_confirmed_at: "2026-11-09T12:00:00+00:00",
    last_modified_at: "2026-11-09T12:00:00+00:00",
    origin_label: "Oakridge, OR",
    origin_lat: 43.7,
    origin_lng: -122.5,
    origin_state_code: "OR",
    pay_amount_cents: args.p_pay_amount_cents,
    pay_note: args.p_pay_note,
    pay_unit: args.p_pay_unit,
    poster_name: "Mill Creek Timber",
    poster_organization_id: ORG,
    poster_verified: false,
    product: args.p_product,
    public_access_requirements: [],
    public_road_notes: args.p_public_road_notes,
    schedule_note: null,
    slug: JOB,
    sponsored: false,
    starts_on: args.p_work_starts_on,
    status: "active",
    title: args.p_title,
    trucks_per_day: args.p_trucks_per_day,
    trucks_total: args.p_trucks_requested,
    ...overrides
  }
}

const facts = (overrides: Record<string, unknown> = {}) => ({
  boost_active: null,
  boost_ends_at: null,
  boost_starts_at: null,
  created_at: "2026-11-01T08:00:00+00:00",
  invitations_delivered: 3,
  job_id: JOB,
  landing_id: LANDING,
  landing_name: "North landing",
  ...overrides
})

const draftOf = (input: Record<string, unknown>): MarketplaceJobDraft =>
  marketplaceJobDraftSchema.parse({ equipment: ["log_truck", "pole_trailer"], landingId: LANDING, title: "North unit saw logs", trucksRequested: "6", ...input })

describe("storedJobDraft", () => {
  it.each([
    ["an end date, every optional term", draftOf({
      description: "Fir and hemlock.",
      destinationLabel: "Springfield mill",
      endsOn: "2026-12-20",
      estDailyLoads: "18",
      estLoadsPerTruckPerDay: "3",
      estOneWayMiles: "42",
      estTonsPerLoad: "27.5",
      payAmount: "4.25",
      payUnit: "per_ton",
      product: "Saw logs",
      publicRoadNotes: "Gravel for the last 4 miles.",
      startsOn: "2026-11-16",
      trucksPerDay: "4"
    })],
    ["negotiable pay, ongoing", draftOf({ ongoing: "on", payNote: "Set by haul length", payUnit: "negotiable", product: "Pulpwood", startsOn: "2026-11-16" })],
    ["another product described by the poster", draftOf({ endsOn: "2026-11-30", payAmount: "300", payUnit: "per_day", product: "Other", productOther: "Cedar shakes", startsOn: "2026-11-16" })]
  ])("reads back what was published: %s", (_label, draft) => {
    expect(storedJobDraft(storedRow(publishArguments(draft)), LANDING)).toEqual(draft)
  })

  it("reads a stated duration back as the end date the store keeps, which is the same period", () => {
    const published = draftOf({ durationDays: "35", payAmount: "525", payUnit: "per_load", product: "Saw logs", startsOn: "2026-11-16" })
    const read = storedJobDraft(storedRow(publishArguments(published)), LANDING)

    expect(read).toMatchObject({ endsOn: "2026-12-20", startsOn: "2026-11-16" })
    expect(read?.durationDays).toBeUndefined()
    expect(draftEndsOn(read!)).toBe(draftEndsOn(published))
  })

  it("gives a legacy posting without stated pay or truck demand no draft, rather than a guessed one", () => {
    const args = publishArguments(draftOf({ payAmount: "525", payUnit: "per_load", product: "Saw logs", startsOn: "2026-11-16", endsOn: "2026-11-30" }))

    expect(storedJobDraft(storedRow(args, { pay_amount_cents: null, pay_note: null, pay_unit: null }), LANDING)).toBeNull()
    expect(storedJobDraft(storedRow(args, { trucks_total: null }), LANDING)).toBeNull()
    expect(storedJobDraft(storedRow(args, { equipment_codes: ["horse_logging"] }), LANDING)).toBeNull()
  })

  it("fails loudly on a row that drifted from the SQL", () => {
    expect(() => storedJobDraft({ title: 7 }, LANDING)).toThrow(MarketplaceStoreError)
  })
})

describe("storedOwnJob", () => {
  const args = publishArguments(draftOf({ endsOn: "2026-12-20", payAmount: "525", payUnit: "per_load", product: "Saw logs", startsOn: "2026-11-16" }))

  it("joins the public view, the editable terms and the business's own facts", () => {
    const record = storedOwnJob(storedRow(args), facts({ boost_active: true, boost_ends_at: "2026-11-17T00:00:00+00:00", boost_starts_at: "2026-11-10T00:00:00+00:00" }))

    expect(record).toMatchObject({
      boost: { active: true, endsAt: "2026-11-17T00:00:00.000Z", startsAt: "2026-11-10T00:00:00.000Z" },
      createdAt: "2026-11-01T08:00:00.000Z",
      draft: { landingId: LANDING, payAmount: 525 },
      invitationsDelivered: 3,
      job: { id: JOB, posterOrganizationId: ORG, status: "active" },
      landing: { id: LANDING, name: "North landing" },
      moderationHold: null
    })
  })

  it("states a hold only when the store reports one, and no boost when there was none", () => {
    expect(storedOwnJob(storedRow(args), facts({ moderation_hold: true })).moderationHold).toBe(true)
    expect(storedOwnJob(storedRow(args), facts({ moderation_hold: false })).moderationHold).toBe(false)
    expect(storedOwnJob(storedRow(args), facts()).boost).toBeNull()
    expect(storedOwnJob(storedRow(args), facts({ boost_ends_at: null, boost_starts_at: "2026-11-10T00:00:00+00:00" })).boost).toBeNull()
  })

  it("keeps a store that keeps no invitation count as null, never zero", () => {
    expect(storedOwnJob(storedRow(args), facts({ invitations_delivered: null })).invitationsDelivered).toBeNull()
  })

  it("refuses facts of another job and rows that drifted from the SQL", () => {
    expect(() => storedOwnJob(storedRow(args), facts({ job_id: "66666666-0000-4000-8000-000000000002" }))).toThrow(MarketplaceStoreError)
    expect(() => storedOwnJob(storedRow(args), facts({ landing_id: "north" }))).toThrow(MarketplaceStoreError)
    expect(() => storedOwnJob(storedRow(args), facts({ invitations_delivered: -1 }))).toThrow(MarketplaceStoreError)
    expect(() => storedOwnJob(storedRow(args), facts({ created_at: "soon" }))).toThrow(MarketplaceStoreError)
  })
})
