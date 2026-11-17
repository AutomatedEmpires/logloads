import {
  marketplaceJobDraftSchema,
  type MarketplaceInterestView,
  type MarketplaceJobDetailView,
  type MarketplaceJobDraft,
  type MarketplaceOwnJobView
} from "@logloads/contracts"
import { describe, expect, it } from "vitest"

import { DomainRefusalError } from "../../utils"
import { JOB_EXPIRED_REFUSAL } from "./lifecycle"
import {
  duplicateJobDraft,
  JOB_LANDING_CHANGE_REFUSAL,
  jobMaterialChanges,
  jobTermsUnchanged,
  ownJobInquiryCounts,
  ownJobLifecycleState,
  ownJobMatches,
  planJobTermsEdit
} from "./terms"

const NOW = new Date("2026-11-10T12:00:00.000Z")
const OURS = "11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const THEIRS = "22222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const LANDING = "33333333-cccc-4ccc-8ccc-cccccccccccc"
const OTHER_LANDING = "44444444-dddd-4ddd-8ddd-dddddddddddd"
const JOB = "55555555-eeee-4eee-8eee-eeeeeeeeeeee"
const OTHER_JOB = "66666666-ffff-4fff-8fff-ffffffffffff"

const draft: MarketplaceJobDraft = marketplaceJobDraftSchema.parse({
  description: "Fir and hemlock off the Mill Creek unit.",
  endsOn: "2026-12-20",
  equipment: ["log_truck", "pole_trailer"],
  landingId: LANDING,
  payAmount: "525",
  payUnit: "per_load",
  product: "Saw logs",
  startsOn: "2026-11-16",
  title: "Mill Creek saw logs",
  trucksPerDay: "4",
  trucksRequested: "6"
})

/** The same job as `previewMarketplaceJob` would show it: what haulers see now. */
const published: MarketplaceJobDetailView = {
  acceptingInterest: true,
  destinationLabel: null,
  endsOn: "2026-12-20",
  equipment: ["pole_trailer", "log_truck"],
  estimatedDailyLoads: null,
  estimatedLoadsPerTruckPerDay: null,
  estimatedTonsPerLoad: null,
  expiresAt: null,
  haulDistance: null,
  id: JOB,
  lastConfirmedAt: "2026-11-09T12:00:00.000Z",
  lastModifiedAt: "2026-11-09T12:00:00.000Z",
  origin: { approximatePoint: null, label: "Oakridge, OR", stateCode: "OR" },
  pay: { amountCents: 52_500, note: null, unit: "per_load" },
  posterName: "Mill Creek Timber",
  posterOrganizationId: OURS,
  posterVerification: null,
  product: "Saw logs",
  publicAccessRequirements: [],
  publicRoadNotes: null,
  scheduleNote: null,
  slug: JOB,
  sponsored: false,
  startsOn: "2026-11-16",
  status: "active",
  title: "Mill Creek saw logs",
  trucks: { perDay: 4, total: 6 }
}

const edit = (changes: Record<string, unknown>): MarketplaceJobDraft =>
  marketplaceJobDraftSchema.parse({ ...draft, ...changes })

describe("duplicateJobDraft", () => {
  it("copies the terms, landing and equipment, and clears the dates", () => {
    const copy = duplicateJobDraft(draft)

    expect(copy).toMatchObject({ equipment: ["log_truck", "pole_trailer"], landingId: LANDING, payAmount: 525, title: draft.title, trucksRequested: 6 })
    expect(copy.startsOn).toBeUndefined()
    expect(copy.endsOn).toBeUndefined()
    expect(copy.durationDays).toBeUndefined()
    expect(copy.equipment).not.toBe(draft.equipment)
  })

  it("is still a valid draft, so the editor opens it without errors", () => {
    expect(marketplaceJobDraftSchema.safeParse(duplicateJobDraft(edit({ durationDays: "30", endsOn: undefined }))).success).toBe(true)
    expect(marketplaceJobDraftSchema.safeParse(duplicateJobDraft(edit({ endsOn: undefined, ongoing: "on" }))).success).toBe(true)
  })

  it("keeps an ongoing job ongoing: that is not a date", () => {
    expect(duplicateJobDraft(edit({ endsOn: undefined, ongoing: "on" })).ongoing).toBe(true)
  })

  it("leaves the original untouched", () => {
    duplicateJobDraft(draft)
    expect(draft.startsOn).toBe("2026-11-16")
  })
})

describe("jobMaterialChanges", () => {
  it("finds nothing when the terms haulers see are the same, in any equipment order", () => {
    expect(jobMaterialChanges(published, draft)).toEqual([])
  })

  it("names each advertised term that changed, in a fixed order", () => {
    expect(jobMaterialChanges(published, edit({ payAmount: "550" }))).toEqual(["pay"])
    expect(jobMaterialChanges(published, edit({ payUnit: "per_ton" }))).toEqual(["pay"])
    expect(jobMaterialChanges(published, edit({ startsOn: "2026-11-17" }))).toEqual(["dates"])
    expect(jobMaterialChanges(published, edit({ endsOn: undefined, ongoing: "on" }))).toEqual(["dates"])
    expect(jobMaterialChanges(published, edit({ equipment: ["log_truck"] }))).toEqual(["equipment"])
    expect(jobMaterialChanges(published, edit({ trucksRequested: "8" }))).toEqual(["trucks"])
    expect(jobMaterialChanges(published, edit({ trucksPerDay: undefined }))).toEqual(["trucks"])
    expect(jobMaterialChanges(published, edit({ equipment: ["chip_truck"], payAmount: "600", trucksRequested: "9" }))).toEqual(["pay", "equipment", "trucks"])
  })

  it("reads the same period stated as a duration as the same dates", () => {
    // 2026-11-16 to 2026-12-20 is 35 days, counting both.
    expect(jobMaterialChanges(published, edit({ durationDays: "35", endsOn: undefined }))).toEqual([])
    expect(jobMaterialChanges(published, edit({ durationDays: "36", endsOn: undefined }))).toEqual(["dates"])
  })

  it("compares amounts in whole cents, as they are stored", () => {
    expect(jobMaterialChanges({ ...published, pay: { amountCents: 425, note: null, unit: "per_ton" } }, edit({ payAmount: "4.25", payUnit: "per_ton" }))).toEqual([])
  })

  it("counts the note as pay only where it is the pay: Negotiable and Other", () => {
    const negotiable = { ...published, pay: { amountCents: null, note: "Depends on haul length", unit: "negotiable" as const } }
    const asNegotiable = (payNote: string) => edit({ payAmount: undefined, payNote, payUnit: "negotiable" })

    expect(jobMaterialChanges(negotiable, asNegotiable("Depends on haul length"))).toEqual([])
    expect(jobMaterialChanges(negotiable, asNegotiable("Set per mile after the first 40"))).toEqual(["pay"])
    expect(jobMaterialChanges(published, edit({ payNote: "Paid weekly" }))).toEqual([])
  })

  it("leaves descriptions, road notes and estimates out", () => {
    expect(jobMaterialChanges(published, edit({ description: "New words", estDailyLoads: "12", publicRoadNotes: "Gravel, 4 miles" }))).toEqual([])
  })
})

describe("jobTermsUnchanged", () => {
  it("is true for the same terms, however the period and equipment are stated", () => {
    expect(jobTermsUnchanged(draft, edit({}))).toBe(true)
    expect(jobTermsUnchanged(draft, edit({ equipment: ["pole_trailer", "log_truck"] }))).toBe(true)
    expect(jobTermsUnchanged(draft, edit({ durationDays: "35", endsOn: undefined }))).toBe(true)
    // "Other product" text is ignored for a listed product, so it changes nothing stored.
    expect(jobTermsUnchanged(draft, edit({ productOther: "ignored" }))).toBe(true)
  })

  it("is false for any stored change, material or not", () => {
    expect(jobTermsUnchanged(draft, edit({ description: "Fir only." }))).toBe(false)
    expect(jobTermsUnchanged(draft, edit({ title: "Mill Creek saw logs, phase 2" }))).toBe(false)
    expect(jobTermsUnchanged(draft, edit({ payAmount: "525.01" }))).toBe(false)
  })

  it("is never true when the stored terms could not be read back", () => {
    expect(jobTermsUnchanged(null, draft)).toBe(false)
  })
})

describe("planJobTermsEdit", () => {
  const listed = { expiresAt: null, lastConfirmedAt: null, moderationHold: false, status: "active" as const }

  it("keeps the job at its landing", () => {
    expect(() => planJobTermsEdit(listed, LANDING, draft, NOW)).not.toThrow()
    expect(() => planJobTermsEdit(listed, OTHER_LANDING, draft, NOW)).toThrow(new DomainRefusalError(JOB_LANDING_CHANGE_REFUSAL))
  })

  it("refuses an expired listing", () => {
    expect(() => planJobTermsEdit({ ...listed, status: "expired" }, LANDING, draft, NOW)).toThrow(JOB_EXPIRED_REFUSAL)
  })
})

let sequence = 0
/** A fresh, well-formed id for each fixture row. */
const nextId = () => `99999999-0000-4000-8000-${String(++sequence).padStart(12, "0")}`

function interest(overrides: { jobId?: string; landingOrganizationId?: string; status?: MarketplaceInterestView["status"]; lastSide?: "hauler" | "landing" }): MarketplaceInterestView {
  return {
    availableFrom: null,
    availableUntil: null,
    contactPreference: "in_app",
    createdAt: "2026-11-09T12:00:00.000Z",
    equipment: [],
    haulerOrganization: { id: "77777777-1111-4111-8111-111111111111", name: "Ridge Hauling", type: "hauler" },
    id: nextId(),
    job: { acceptingInterest: true, id: overrides.jobId ?? JOB, slug: JOB, status: "active", title: "Mill Creek saw logs" },
    landingOrganization: { id: overrides.landingOrganizationId ?? OURS, name: "Mill Creek Timber" },
    message: null,
    replies: overrides.lastSide
      ? [{ authorName: "Sam", authorSide: overrides.lastSide, authorUserId: "88888888-2222-4222-8222-222222222222", body: "Hi", createdAt: "2026-11-09T13:00:00.000Z", id: nextId() }]
      : [],
    status: overrides.status ?? "submitted",
    submittedBy: { name: "Sam", userId: "88888888-2222-4222-8222-222222222222" },
    trucksOffered: 2,
    updatedAt: "2026-11-09T12:00:00.000Z"
  }
}

describe("ownJobInquiryCounts", () => {
  it("counts every inquiry on the job and those waiting on the desk", () => {
    const interests = [
      interest({}),
      interest({ status: "viewed" }),
      interest({ lastSide: "landing", status: "replied" }),
      interest({ lastSide: "hauler", status: "replied" }),
      interest({ status: "withdrawn" })
    ]

    expect(ownJobInquiryCounts(interests, JOB, OURS)).toEqual({ awaitingReply: 3, total: 5 })
  })

  it("never counts another job's or another business's inquiries", () => {
    expect(ownJobInquiryCounts([interest({ jobId: OTHER_JOB }), interest({ landingOrganizationId: THEIRS })], JOB, OURS)).toEqual({ awaitingReply: 0, total: 0 })
  })
})

describe("ownJobMatches and ownJobLifecycleState", () => {
  const view: Pick<MarketplaceOwnJobView, "job" | "landing" | "moderationHold"> = {
    job: published,
    landing: { id: LANDING, name: "Mill Creek landing" },
    moderationHold: null
  }

  it("filters by status, landing and a title search without case", () => {
    expect(ownJobMatches(view, {}, NOW)).toBe(true)
    expect(ownJobMatches(view, { landingId: null, query: null, status: null }, NOW)).toBe(true)
    expect(ownJobMatches(view, { status: "active" }, NOW)).toBe(true)
    expect(ownJobMatches(view, { status: "paused" }, NOW)).toBe(false)
    expect(ownJobMatches(view, { landingId: LANDING }, NOW)).toBe(true)
    expect(ownJobMatches(view, { landingId: OTHER_LANDING }, NOW)).toBe(false)
    expect(ownJobMatches(view, { query: "  CREEK saw " }, NOW)).toBe(true)
    expect(ownJobMatches(view, { query: "pulp" }, NOW)).toBe(false)
  })

  it("files a job past its expiry under expired", () => {
    const lapsed = { ...view, job: { ...published, expiresAt: "2026-11-01T00:00:00.000Z", status: "paused" as const } }

    expect(ownJobMatches(lapsed, { status: "expired" }, NOW)).toBe(true)
    expect(ownJobMatches(lapsed, { status: "paused" }, NOW)).toBe(false)
  })

  it("states the lifecycle facts the rules read", () => {
    expect(ownJobLifecycleState(view)).toEqual({ expiresAt: null, lastConfirmedAt: published.lastConfirmedAt, moderationHold: null, status: "active" })
  })
})
