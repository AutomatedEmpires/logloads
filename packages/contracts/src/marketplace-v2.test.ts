import { describe, expect, it } from "vitest"

import {
  containsSensitiveAccessText,
  draftEndsOn,
  previewMarketplaceJob,
  validateMarketplaceJobDraft
} from "./marketplace-job-draft"
import { MARKETPLACE_CAPABILITIES, marketplaceCan, marketplaceCapabilities, type MarketplaceMembership } from "./marketplace-permissions"
import {
  describeMarketplaceVerification,
  expressInterestInputSchema,
  filterMarketplaceJobs,
  formatMarketplacePay,
  haulerInterestQueue,
  LANDING_INTEREST_QUEUE_LABELS,
  landingInterestQueue,
  landingInterestQueueFor,
  lastMarketplaceInterestReplySide,
  MARKETPLACE_EQUIPMENT_TYPES,
  MARKETPLACE_RADIUS_BUFFER_MILES,
  marketplaceComparablePayUnits,
  marketplaceDistanceMiles,
  marketplaceEquipmentFit,
  marketplaceInquiryUnread,
  marketplaceInterestSchema,
  marketplaceJobAcceptsInterest,
  postingFreshness,
  configurationEquipmentCodes,
  offeredEquipmentFit,
  respondToInterestInputSchema,
  snapToPublicGrid,
  sortMarketplaceJobs,
  withdrawInterestInputSchema,
  type MarketplaceInterestStatus,
  type MarketplaceInterestView,
  type MarketplaceJobCardView
} from "./marketplace-v2"

const job = (overrides: Partial<MarketplaceJobCardView>): MarketplaceJobCardView => ({
  acceptingInterest: true,
  destinationLabel: "Cascade Mill",
  endsOn: null,
  equipment: ["Log trailer"],
  estimatedDailyLoads: null,
  estimatedLoadsPerTruckPerDay: null,
  estimatedTonsPerLoad: 28,
  expiresAt: null,
  haulDistance: { basis: "poster_route_estimate", miles: 54 },
  id: "job-1",
  lastConfirmedAt: null,
  lastModifiedAt: "2026-11-01T12:00:00.000Z",
  origin: { approximatePoint: null, label: "Oakridge, OR", stateCode: "OR" },
  pay: { amountCents: 52_500, note: null, unit: "per_load" },
  posterName: "Summit Ridge Timber",
  posterOrganizationId: "11111111-1111-4111-8111-111111111111",
  posterVerification: { reviewedOn: "2026-10-14", scope: "business_identity" },
  product: "Saw logs",
  scheduleNote: null,
  slug: "oak-run",
  sponsored: false,
  startsOn: "2026-11-03",
  status: "active",
  title: "Oakridge to Cascade Mill",
  trucks: { perDay: 3, total: null },
  ...overrides
})

describe("pay transparency (UX §8.4)", () => {
  it("shows the poster's amount with its basis", () => {
    expect(formatMarketplacePay({ amountCents: 52_500, note: null, unit: "per_load" })).toBe("$525.00 per load")
    expect(formatMarketplacePay({ amountCents: 1_250, note: null, unit: "per_ton" })).toBe("$12.50 per ton")
    expect(formatMarketplacePay({ amountCents: 300_000, note: null, unit: "flat_rate" })).toBe("$3,000.00 flat rate")
  })

  it("shows negotiable pay in the poster's words and never as a number", () => {
    expect(formatMarketplacePay({ amountCents: null, note: "depends on haul length", unit: "negotiable" })).toBe("Negotiable — depends on haul length")
    expect(formatMarketplacePay({ amountCents: 99_999, note: null, unit: "negotiable" })).toBe("Negotiable")
  })

  it("never invents a figure when pay or its basis is missing", () => {
    expect(formatMarketplacePay({ amountCents: null, note: null, unit: null })).toBe("Pay not stated")
    expect(formatMarketplacePay({ amountCents: 52_500, note: null, unit: null })).toBe("Pay not stated")
    expect(formatMarketplacePay({ amountCents: null, note: null, unit: "per_load" })).toBe("Pay not stated")
  })
})

describe("listing currency: modified vs confirmed vs expired", () => {
  const now = "2026-11-20T12:00:00.000Z"

  it("never calls an edit a confirmation", () => {
    const edited = postingFreshness({ expiresAt: null, lastConfirmedAt: null, lastModifiedAt: "2026-11-20T08:00:00.000Z" }, now)
    expect(edited.band).toBe("unconfirmed")
    expect(edited.label).toBe("Not confirmed by poster · edited today")
    expect(edited.label).not.toMatch(/confirmed available/)
  })

  it("reports an explicit confirmation, and its age, only when one exists", () => {
    expect(postingFreshness({ expiresAt: null, lastConfirmedAt: "2026-11-19T08:00:00.000Z", lastModifiedAt: "2026-11-01T00:00:00.000Z" }, now))
      .toEqual({ band: "confirmed_recently", label: "Poster confirmed available 1 day ago" })
    expect(postingFreshness({ expiresAt: null, lastConfirmedAt: "2026-11-01T08:00:00.000Z", lastModifiedAt: "2026-11-20T00:00:00.000Z" }, now).band)
      .toBe("confirmed_aging")
  })

  it("expiry overrides any confirmation", () => {
    expect(postingFreshness({ expiresAt: "2026-11-20T00:00:00.000Z", lastConfirmedAt: "2026-11-20T08:00:00.000Z", lastModifiedAt: "2026-11-20T08:00:00.000Z" }, now))
      .toEqual({ band: "expired", label: "Listing expired" })
  })

  it("rejects malformed instants", () => {
    expect(() => postingFreshness({ expiresAt: null, lastConfirmedAt: null, lastModifiedAt: "yesterday" }, now)).toThrow(RangeError)
  })
})

describe("discovery filters and ordering", () => {
  const jobs = [
    job({ id: "a", lastModifiedAt: "2026-11-05T00:00:00.000Z", title: "Oakridge saw logs" }),
    job({ acceptingInterest: false, id: "b", lastModifiedAt: "2026-10-20T00:00:00.000Z", status: "filled", title: "Filled pulp" }),
    job({ equipment: ["Chip van"], id: "c", lastConfirmedAt: "2026-11-02T00:00:00.000Z", pay: { amountCents: 900, note: null, unit: "per_ton" }, title: "Chip shuttle" })
  ]

  it("hides jobs that no longer accept interest unless asked", () => {
    expect(filterMarketplaceJobs(jobs).map((j) => j.id)).toEqual(["a", "c"])
    expect(filterMarketplaceJobs(jobs, { acceptingOnly: false }).map((j) => j.id)).toEqual(["a", "b", "c"])
  })

  it("filters by text, exact equipment and pay basis without comparing unlike rates", () => {
    expect(filterMarketplaceJobs(jobs, { query: "chip" }).map((j) => j.id)).toEqual(["c"])
    expect(filterMarketplaceJobs(jobs, { equipment: "log trailer" }).map((j) => j.id)).toEqual(["a"])
    expect(filterMarketplaceJobs(jobs, { payUnit: "per_ton" }).map((j) => j.id)).toEqual(["c"])
  })

  it("puts confirmed listings ahead of more recently edited unconfirmed ones", () => {
    expect(sortMarketplaceJobs(jobs).map((j) => j.id)).toEqual(["c", "a", "b"])
    expect(sortMarketplaceJobs(jobs, { sort: "newest" }).map((j) => j.id)).toEqual(["c", "a", "b"])
  })

  it("matches equipment labels in text search, not only codes", () => {
    const coded = [job({ equipment: ["pole_trailer"], id: "p" }), job({ equipment: ["chip_van"], id: "q" })]
    expect(filterMarketplaceJobs(coded, { query: "pole trailer" }).map((j) => j.id)).toEqual(["p"])
  })
})

describe("discovery by place, product, start and fit (#129)", () => {
  // Public points are already on the 0.1° grid. Sweet Home, OR is about 44.4, -122.7.
  const sweetHome = { lat: 44.397, lng: -122.736 }
  const at = (lat: number, lng: number) => ({ approximatePoint: { lat, lng }, label: "Somewhere, OR", stateCode: "OR" })
  const near = job({ id: "near", origin: at(44.4, -122.7) }) // about 2 mi
  const mid = job({ id: "mid", origin: at(44.1, -123.1) }) // about 29 mi (Eugene)
  const far = job({ id: "far", origin: at(42.3, -122.9) }) // about 145 mi (Medford)
  const nowhere = job({ id: "nowhere", origin: { approximatePoint: null, label: "Location shared on request", stateCode: null } })
  const all = [far, nowhere, mid, near]

  it("measures whole miles from the snapped search origin to the public point only", () => {
    expect(snapToPublicGrid(sweetHome)).toEqual({ lat: 44.4, lng: -122.7 })
    expect(snapToPublicGrid({ lat: -0.05, lng: 0.04 })).toEqual({ lat: -0.1, lng: 0 })
    expect(marketplaceDistanceMiles(sweetHome, near)).toBe(0)
    expect(marketplaceDistanceMiles(sweetHome, mid)).toBe(29)
    expect(marketplaceDistanceMiles(sweetHome, far)).toBe(145)
    expect(marketplaceDistanceMiles(sweetHome, nowhere)).toBeNull()
    // Moving the origin inside one grid cell never changes a distance: nothing finer than the cell can be learned.
    expect(marketplaceDistanceMiles({ lat: 44.43, lng: -122.66 }, mid)).toBe(marketplaceDistanceMiles(sweetHome, mid))
  })

  it("keeps jobs within the radius plus the grid buffer, and drops jobs it cannot place", () => {
    expect(filterMarketplaceJobs(all, { near: sweetHome, radiusMiles: 50 }).map((j) => j.id)).toEqual(["mid", "near"])
    expect(filterMarketplaceJobs(all, { near: sweetHome, radiusMiles: 25 }).map((j) => j.id)).toEqual(["mid", "near"]) // 28.7 ≤ 25 + 5
    expect(filterMarketplaceJobs(all, { near: sweetHome, radiusMiles: 20 }).map((j) => j.id)).toEqual(["near"])
    expect(filterMarketplaceJobs(all, { near: sweetHome, radiusMiles: 150 }).map((j) => j.id)).toEqual(["far", "mid", "near"])
    // Any distance, or no place: nothing is dropped for distance.
    expect(filterMarketplaceJobs(all, { near: sweetHome, radiusMiles: null })).toHaveLength(4)
    expect(filterMarketplaceJobs(all, { radiusMiles: 20 })).toHaveLength(4)
    expect(MARKETPLACE_RADIUS_BUFFER_MILES).toBeCloseTo(4.97, 2)
  })

  it("sorts nearest first from a place, unplaceable jobs last, and is newest without one", () => {
    expect(sortMarketplaceJobs(all, { near: sweetHome, sort: "nearest" }).map((j) => j.id)).toEqual(["near", "mid", "far", "nowhere"])
    expect(sortMarketplaceJobs(all, { sort: "nearest" }).map((j) => j.id)).toEqual(sortMarketplaceJobs(all).map((j) => j.id))
  })

  it("filters products from the controlled list; Other is anything stated outside it", () => {
    const products = [
      job({ id: "saw", product: "Saw logs" }),
      job({ id: "mixed", product: "Mixed products" }),
      job({ id: "unknown", product: null }),
      job({ id: "biomass", product: "Hog fuel and biomass" })
    ]
    expect(filterMarketplaceJobs(products, { product: "saw logs" }).map((j) => j.id)).toEqual(["saw"])
    expect(filterMarketplaceJobs(products, { product: "Other" }).map((j) => j.id)).toEqual(["mixed"])
    expect(filterMarketplaceJobs(products, { product: "Hog fuel and biomass" }).map((j) => j.id)).toEqual(["biomass"])
  })

  it("keeps jobs that start by the date, including work under way, and hides jobs with no stated start", () => {
    const starts = [
      job({ id: "under-way", startsOn: "2026-10-01" }),
      job({ id: "soon", startsOn: "2026-11-09" }),
      job({ id: "later", startsOn: "2026-12-01" }),
      job({ id: "unstated", startsOn: null })
    ]
    expect(filterMarketplaceJobs(starts, { startsBy: "2026-11-10" }).map((j) => j.id)).toEqual(["under-way", "soon"])
    expect(filterMarketplaceJobs(starts, {})).toHaveLength(4)
  })

  it("calls a job a fit only when one setup has all of its equipment, and claims nothing without data", () => {
    const setups = [["log_truck", "pole_trailer"], ["chip_truck", "chip_van"]]
    expect(marketplaceEquipmentFit(["pole_trailer"], setups)).toBe("fits")
    expect(marketplaceEquipmentFit(["log_truck", "pole_trailer"], setups)).toBe("fits")
    // Each piece is in some setup, but no single setup has both.
    expect(marketplaceEquipmentFit(["pole_trailer", "chip_van"], setups)).toBe("not_in_setups")
    expect(marketplaceEquipmentFit(["lowboy_trailer"], setups)).toBe("not_in_setups")
    expect(marketplaceEquipmentFit([], setups)).toBeNull()
    expect(marketplaceEquipmentFit(["pole_trailer"], [])).toBeNull()
    expect(marketplaceEquipmentFit(["pole_trailer"], [[]])).toBeNull()
  })

  it("'My trucks' hides only jobs that need equipment the setups lack", () => {
    const fleet = [
      job({ equipment: ["pole_trailer"], id: "fits" }),
      job({ equipment: ["chip_van"], id: "misfit" }),
      job({ equipment: [], id: "unstated" })
    ]
    expect(filterMarketplaceJobs(fleet, { equipmentSetups: [["log_truck", "pole_trailer"]] }).map((j) => j.id)).toEqual(["fits", "unstated"])
    expect(filterMarketplaceJobs(fleet, { equipmentSetups: [] })).toHaveLength(3)
  })
})

describe("pay is compared within one basis only (spec §10.5)", () => {
  const pay = (id: string, amountCents: number | null, unit: MarketplaceJobCardView["pay"]["unit"]) =>
    job({ id, pay: { amountCents, note: unit === "negotiable" ? "depends on haul" : null, unit } })
  const jobs = [
    pay("ton-low", 900, "per_ton"),
    pay("negotiable", null, "negotiable"),
    pay("load-high", 60_000, "per_load"),
    pay("ton-high", 1_200, "per_ton"),
    pay("unstated", null, null),
    pay("load-low", 45_000, "per_load")
  ]

  it("groups by basis and orders each basis by amount, with no comparable amount last", () => {
    expect(sortMarketplaceJobs(jobs, { sort: "pay" }).map((j) => j.id)).toEqual(["load-high", "load-low", "ton-high", "ton-low", "negotiable", "unstated"])
  })

  it("reports which bases a list mixes", () => {
    expect(marketplaceComparablePayUnits(jobs)).toEqual(["per_load", "per_ton"])
    expect(marketplaceComparablePayUnits(jobs.filter((j) => j.pay.unit === "per_load"))).toEqual(["per_load"])
    expect(marketplaceComparablePayUnits([pay("n", null, "negotiable")])).toEqual([])
  })
})

describe("interest rules", () => {
  const base = {
    availableFrom: null, contactPreference: "in_app", createdAt: "2026-11-01T00:00:00.000Z",
    haulerOrganizationId: "11111111-1111-4111-8111-111111111111", id: "22222222-2222-4222-8222-222222222222",
    jobOrganizationId: "55555555-5555-4555-8555-555555555555", loadPostingId: "33333333-3333-4333-8333-333333333333",
    message: null, replies: [], respondedAt: null, status: "submitted", submittedByUserId: "44444444-4444-4444-8444-444444444444",
    trucksOffered: 1, updatedAt: "2026-11-01T00:00:00.000Z", withdrawnAt: null
  }

  it("only active jobs accept interest", () => {
    expect(marketplaceJobAcceptsInterest("active")).toBe(true)
    for (const status of ["paused", "filled", "closed", "expired"] as const) {
      expect(marketplaceJobAcceptsInterest(status)).toBe(false)
    }
  })

  it("maps statuses onto the landing inbox queues", () => {
    expect(landingInterestQueue("submitted")).toBe("new")
    expect(landingInterestQueue("viewed")).toBe("responded")
    expect(landingInterestQueue("replied")).toBe("responded")
    expect(landingInterestQueue("declined")).toBe("closed")
    expect(landingInterestQueue("withdrawn")).toBe("closed")
  })

  it("rejects a landing organization expressing interest in its own job", () => {
    expect(() => marketplaceInterestSchema.parse({ ...base, jobOrganizationId: base.haulerOrganizationId })).toThrow(/own job/)
  })

  it("keeps stored rows from before equipment lines valid", () => {
    expect(marketplaceInterestSchema.parse(base)).toMatchObject({ availableUntil: null, equipment: [] })
  })

  it("requires the truck count to equal the equipment lines it summarises", () => {
    const equipment = [{ configurationKey: "log_truck|pole_trailer", count: 2, label: "Log truck + Pole trailer" }]
    expect(marketplaceInterestSchema.parse({ ...base, equipment, trucksOffered: 2 }).equipment).toHaveLength(1)
    expect(() => marketplaceInterestSchema.parse({ ...base, equipment, trucksOffered: 5 })).toThrow(/equal/)
  })

  it("accepts either a count or equipment lines, drops zero lines, and checks dates", () => {
    const id = "33333333-3333-4333-8333-333333333333"
    expect(expressInterestInputSchema.parse({ loadPostingId: id, message: "  ", trucksOffered: "2" }))
      .toMatchObject({ contactPreference: "in_app", equipment: [], message: null, trucksOffered: 2 })
    expect(expressInterestInputSchema.parse({ equipment: [{ configurationKey: "a", count: "2" }, { configurationKey: "b", count: "0" }], loadPostingId: id, trucksOffered: "" }))
      .toMatchObject({ equipment: [{ configurationKey: "a", count: 2 }] })
    expect(() => expressInterestInputSchema.parse({ loadPostingId: id, trucksOffered: "" })).toThrow(/how many trucks/)
    expect(() => expressInterestInputSchema.parse({ equipment: [{ configurationKey: "a", count: 1 }, { configurationKey: "a", count: 1 }], loadPostingId: id })).toThrow(/once/)
    expect(() => expressInterestInputSchema.parse({ availableFrom: "2026-11-10", availableUntil: "2026-11-01", loadPostingId: id, trucksOffered: 1 })).toThrow(/before/)
  })

  it("requires a message to reply", () => {
    expect(() => respondToInterestInputSchema.parse({ decision: "replied", interestId: "33333333-3333-4333-8333-333333333333" })).toThrow()
    expect(respondToInterestInputSchema.parse({ decision: "declined", interestId: "33333333-3333-4333-8333-333333333333" }))
      .toMatchObject({ body: null, decision: "declined" })
  })
})

describe("marketplace capabilities mirror the normalized-v2 RLS policies", () => {
  const member = (role: MarketplaceMembership["role"], landingWorkspaceSeat: boolean, haulerProfile: boolean): MarketplaceMembership =>
    ({ haulerProfile, landingWorkspaceSeat, role })

  it("landing desk (owner/manager/staff with a seat) publishes and answers inquiries; only owner/manager manage landings", () => {
    expect(marketplaceCapabilities(member("staff", true, false))).toEqual(["job.publish", "inquiry.respond"])
    expect(marketplaceCapabilities(member("manager", true, false))).toEqual(["job.publish", "landing.manage", "inquiry.respond"])
    expect(marketplaceCan(member("owner", true, false), "landing.manage")).toBe(true)
  })

  it("no seat, no landing capability", () => {
    for (const role of ["owner", "manager", "staff"] as const) {
      expect(marketplaceCapabilities(member(role, false, false))).toEqual([])
    }
  })

  it("a driver can never gain landing privileges, even with a seat claimed", () => {
    const driver = member("driver", true, true)
    expect(marketplaceCan(driver, "landing.manage")).toBe(false)
    expect(marketplaceCan(driver, "job.publish")).toBe(false)
    expect(marketplaceCan(driver, "inquiry.respond")).toBe(false)
    expect(marketplaceCapabilities(driver)).toEqual(["interest.express", "interest.withdraw", "interest.reply"])
  })

  it("every hauling-business member may express, withdraw and reply; only the desk manages equipment", () => {
    expect(marketplaceCan(member("staff", false, true), "equipment.manage")).toBe(true)
    expect(marketplaceCan(member("driver", false, true), "equipment.manage")).toBe(false)
    expect(marketplaceCan(member("manager", false, false), "interest.express")).toBe(false)
  })

  it("no membership grants nothing", () => {
    for (const capability of MARKETPLACE_CAPABILITIES) {
      expect(marketplaceCan(null, capability)).toBe(false)
    }
  })
})

describe("native job authoring draft", () => {
  const landingId = "66666666-6666-4666-8666-666666666666"
  const valid = {
    equipment: ["log_truck", "pole_trailer"], landingId, payAmount: "525", payUnit: "per_load", startsOn: "2026-11-10",
    title: "Oak saw logs to Cascade Mill", trucksPerDay: "3", trucksRequested: "6"
  }

  it("uses the normalized schema's equipment codes", () => {
    expect(MARKETPLACE_EQUIPMENT_TYPES.map((type) => type.code)).toContain("self_loader")
  })

  it("accepts a minimal valid draft and keeps optional estimates unknown", () => {
    const result = validateMarketplaceJobDraft(valid)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.draft).toMatchObject({ payAmount: 525, trucksPerDay: 3, trucksRequested: 6 })
    expect(result.draft.estDailyLoads).toBeUndefined()
    expect(result.draft.estLoadsPerTruckPerDay).toBeUndefined()
  })

  it("enforces the job_postings pay rule", () => {
    const issues = (input: Record<string, unknown>) => {
      const result = validateMarketplaceJobDraft({ ...valid, ...input })
      return result.ok ? [] : result.issues.map((issue) => issue.field)
    }
    expect(issues({ payAmount: "" })).toEqual(["payAmount"])
    expect(issues({ payUnit: "" })).toEqual(["payUnit"])
    expect(issues({ payAmount: "", payNote: "", payUnit: "negotiable" })).toEqual(["payNote"])
    expect(issues({ payAmount: "500", payNote: "by haul length", payUnit: "negotiable" })).toEqual(["payAmount"])
    // C1 (#114): pay is required. The database allows none; the draft does not (marketplace-job-draft.test.ts).
    expect(issues({ payAmount: "", payUnit: "" })).toEqual(["payUnit"])
  })

  it("keeps trucks per day within the total and needs a start for a duration", () => {
    const result = validateMarketplaceJobDraft({ ...valid, durationDays: "5", startsOn: "", trucksPerDay: "9" })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues.map((issue) => issue.field).sort()).toEqual(["startsOn", "trucksPerDay"])
  })

  it("refuses coordinates and gate codes in public text (mirrors contains_sensitive_access_pattern)", () => {
    expect(containsSensitiveAccessText("Gate code 4471 at the spur")).toBe(true)
    expect(containsSensitiveAccessText("Meet at 44.12345, -122.45678")).toBe(true)
    expect(containsSensitiveAccessText("Gravel road, chains advised after Nov 15")).toBe(false)
    const result = validateMarketplaceJobDraft({ ...valid, publicRoadNotes: "lock combo: 12-34" })
    expect(result.ok ? [] : result.issues.map((issue) => issue.field)).toEqual(["publicRoadNotes"])
  })

  it("previews through the hauler read model without claiming confirmation or acceptance", () => {
    const result = validateMarketplaceJobDraft({ ...valid, durationDays: "3" })
    if (!result.ok) throw new Error("expected valid draft")
    expect(draftEndsOn(result.draft)).toBe("2026-11-12")
    const preview = previewMarketplaceJob(result.draft, {
      landing: { areaLabel: "Oakridge, OR", id: landingId, name: "Landing 7", stateCode: "OR" },
      now: "2026-11-01T00:00:00.000Z", posterName: "North Pine", posterOrganizationId: "77777777-7777-4777-8777-777777777777", posterVerification: null
    })
    expect(preview).toMatchObject({ acceptingInterest: false, lastConfirmedAt: null, pay: { amountCents: 52_500, unit: "per_load" }, trucks: { perDay: 3, total: 6 } })
    expect(preview.equipment).toEqual(["Log truck", "Pole trailer"])
  })
})

describe("verification marks name what was checked (#150)", () => {
  it("says business identity and the review date, and nothing broader", () => {
    const mark = describeMarketplaceVerification({ reviewedOn: "2026-10-14", scope: "business_identity" })

    expect(mark).toEqual({
      label: "Business identity verified",
      statement: "Business identity reviewed by LogLoads on Oct 14, 2026."
    })
    expect(`${mark.label} ${mark.statement}`).not.toMatch(/insur|authority|licen|safety|equipment|employ/i)
  })

  it("does not invent a date when none is on record", () => {
    expect(describeMarketplaceVerification({ reviewedOn: null, scope: "business_identity" }).statement)
      .toBe("Business identity reviewed by LogLoads.")
  })
})

// ---------------------------------------------------------------------------------------------------------------
// Inquiry conversations (UX-09, #132)
// ---------------------------------------------------------------------------------------------------------------

/** A thread message from one side, `minute` minutes after 12:00 on Nov 1, 2026. */
function reply(authorSide: "hauler" | "landing", minute: number): MarketplaceInterestView["replies"][number] {
  return {
    authorName: authorSide === "hauler" ? "Sam Hauler" : "Dana Dispatch",
    authorSide,
    authorUserId: "55555555-dddd-4ddd-8ddd-555555555555",
    body: `Message ${minute}`,
    createdAt: new Date(Date.UTC(2026, 10, 1, 12, minute)).toISOString(),
    id: `00000000-0000-4000-8000-${String(minute).padStart(12, "0")}`
  }
}

describe("inquiry queues, turn and unread (UX-09, #132)", () => {
  const STATUSES: MarketplaceInterestStatus[] = ["submitted", "viewed", "replied", "declined", "withdrawn"]

  it("names the side that spoke last, whatever the order the replies arrive in", () => {
    expect(lastMarketplaceInterestReplySide({ replies: [] })).toBeNull()
    expect(lastMarketplaceInterestReplySide({ replies: [reply("landing", 5), reply("hauler", 2)] })).toBe("landing")
    expect(lastMarketplaceInterestReplySide({ replies: [reply("landing", 1), reply("hauler", 2)] })).toBe("hauler")
  })

  it("maps every status onto the landing's New, Replied and Closed queues with the turn (UX-DEC-01)", () => {
    expect(landingInterestQueueFor({ replies: [], status: "submitted" })).toBe("new")
    // "Mark reviewed" keeps an inquiry in New (it is shown with a "Seen" marker), even after a hauler follow-up.
    expect(landingInterestQueueFor({ replies: [], status: "viewed" })).toBe("new")
    expect(landingInterestQueueFor({ replies: [reply("hauler", 1)], status: "viewed" })).toBe("new")
    expect(landingInterestQueueFor({ replies: [reply("hauler", 1), reply("landing", 2)], status: "replied" })).toBe("responded")
    // The hauler answered the landing's reply: the inquiry is back in New.
    expect(landingInterestQueueFor({ replies: [reply("landing", 1), reply("hauler", 2)], status: "replied" })).toBe("new")
    expect(landingInterestQueueFor({ replies: [reply("landing", 1)], status: "declined" })).toBe("closed")
    expect(landingInterestQueueFor({ replies: [], status: "withdrawn" })).toBe("closed")
    expect(LANDING_INTEREST_QUEUE_LABELS).toEqual({ closed: "Closed", new: "New", responded: "Replied" })
  })

  it("maps every status onto the hauler's Active, Replied and Closed tabs", () => {
    expect(STATUSES.map((status) => haulerInterestQueue(status))).toEqual(["active", "active", "replied", "closed", "closed"])
  })

  it("counts as unread only what the status and the thread prove", () => {
    const landing = (status: MarketplaceInterestStatus, replies: MarketplaceInterestView["replies"] = []) =>
      marketplaceInquiryUnread({ replies, status }, "landing")
    const hauler = (status: MarketplaceInterestStatus, replies: MarketplaceInterestView["replies"] = []) =>
      marketplaceInquiryUnread({ replies, status }, "hauler")

    expect(landing("submitted")).toBe(true)
    expect(landing("viewed")).toBe(false)
    expect(landing("replied", [reply("landing", 1)])).toBe(false)
    expect(landing("replied", [reply("landing", 1), reply("hauler", 2)])).toBe(true)
    expect(landing("declined")).toBe(false)
    expect(landing("withdrawn")).toBe(false)

    expect(hauler("submitted")).toBe(false)
    expect(hauler("viewed")).toBe(false)
    expect(hauler("replied", [reply("landing", 1)])).toBe(true)
    expect(hauler("replied", [reply("landing", 1), reply("hauler", 2)])).toBe(false)
    // A decline's reason is the landing's last message, but a closed inquiry is nobody's turn.
    expect(hauler("declined", [reply("landing", 1)])).toBe(false)
  })

  it("accepts an optional withdrawal reason, which needs a reply id", () => {
    const interestId = "44444444-cccc-4ccc-8ccc-444444444444"
    const replyId = "66666666-eeee-4eee-8eee-666666666666"

    expect(withdrawInterestInputSchema.parse({ interestId })).toEqual({ interestId, reason: null })
    expect(withdrawInterestInputSchema.parse({ interestId, reason: "   ", replyId })).toEqual({ interestId, reason: null, replyId })
    expect(withdrawInterestInputSchema.parse({ interestId, reason: " Booked elsewhere ", replyId }).reason).toBe("Booked elsewhere")
    expect(withdrawInterestInputSchema.safeParse({ interestId, reason: "Booked elsewhere" }).success).toBe(false)
    expect(withdrawInterestInputSchema.safeParse({ interestId, reason: "x".repeat(2001), replyId }).success).toBe(false)
    expect(withdrawInterestInputSchema.safeParse({ interestId: "not-an-id" }).success).toBe(false)
  })
})

describe("offered equipment against the job's equipment (UX-09 criterion 4)", () => {
  it("matches a configuration that has every piece of equipment the job lists, as the hauler's own fit does", () => {
    expect(offeredEquipmentFit("log_truck", ["log_truck"])).toBe("matches")
    expect(offeredEquipmentFit("log_truck|pole_trailer", ["log_truck", "pole_trailer"])).toBe("matches")
    expect(offeredEquipmentFit("log_truck|pole_trailer", ["log_truck"])).toBe("matches")
    // The pilot store's key joins several types of a kind with "+".
    expect(offeredEquipmentFit("log_truck+self_loader|bunk_trailer", ["self_loader", "bunk_trailer"])).toBe("matches")
    expect(configurationEquipmentCodes("log_truck+self_loader|bunk_trailer")).toEqual(["log_truck", "self_loader", "bunk_trailer"])
    // One rule on both sides of the inquiry.
    expect(marketplaceEquipmentFit(["log_truck", "pole_trailer"], [configurationEquipmentCodes("log_truck|pole_trailer")])).toBe("fits")
  })

  it("says not requested when the configuration lacks something the job lists, and compares nothing without a list", () => {
    expect(offeredEquipmentFit("chip_truck|chip_van", ["log_truck", "pole_trailer"])).toBe("not_requested")
    expect(offeredEquipmentFit("log_truck|bunk_trailer", ["log_truck", "pole_trailer"])).toBe("not_requested")
    expect(offeredEquipmentFit("log_truck", ["log_truck", "pole_trailer"])).toBe("not_requested")
    expect(offeredEquipmentFit("", ["log_truck"])).toBe("not_requested")
    expect(offeredEquipmentFit("log_truck", [])).toBeNull()
  })
})
