import { describe, expect, it } from "vitest"

import {
  containsSensitiveAccessText,
  draftEndsOn,
  previewMarketplaceJob,
  validateMarketplaceJobDraft
} from "./marketplace-job-draft"
import { MARKETPLACE_CAPABILITIES, marketplaceCan, marketplaceCapabilities, type MarketplaceMembership } from "./marketplace-permissions"
import {
  describeMarketplaceInterestStatus,
  describeMarketplaceVerification,
  expressInterestInputSchema,
  filterMarketplaceJobs,
  formatMarketplacePay,
  LANDING_INTEREST_QUEUE_LABELS,
  landingInterestQueue,
  landingInterestQueueFor,
  lastMarketplaceInterestReplySide,
  MARKETPLACE_EQUIPMENT_TYPES,
  MARKETPLACE_INTEREST_STATUS_LABELS,
  MARKETPLACE_JOB_STATUS_LABELS,
  MARKETPLACE_RADIUS_BUFFER_MILES,
  marketplaceComparablePayUnits,
  marketplaceDistanceMiles,
  marketplaceEquipmentFit,
  marketplaceInterestIsFinal,
  marketplaceInterestIsOpen,
  marketplaceInterestSchema,
  marketplaceInterestStatusSchema,
  marketplaceJobAcceptsInterest,
  marketplaceJobClosedReason,
  marketplaceJobStatusSchema,
  postingFreshness,
  respondToInterestInputSchema,
  snapToPublicGrid,
  sortMarketplaceJobs,
  type MarketplaceInterestSide,
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

describe("status vocabulary (UX-DEC-01, #135)", () => {
  const reply = (authorSide: MarketplaceInterestSide, createdAt: string) => ({ authorSide, createdAt })
  const LANDING_LAST = [reply("hauler", "2026-11-01T13:00:00.000Z"), reply("landing", "2026-11-01T14:00:00.000Z")]
  const HAULER_LAST = [reply("landing", "2026-11-01T13:00:00.000Z"), reply("hauler", "2026-11-01T14:00:00.000Z")]
  const TURNS = [[], LANDING_LAST, HAULER_LAST]

  // The decision's table, one row per stored status and turn: hauler wording, landing queue, landing wording.
  const TABLE = [
    { hauler: "Sent · waiting for the landing", haulerTone: "waiting", landing: "New", landingTone: "attention", queue: "new", replies: [], status: "submitted", turn: "no replies" },
    { hauler: "Seen by the landing", haulerTone: "waiting", landing: "Seen · not answered", landingTone: "attention", queue: "new", replies: [], status: "viewed", turn: "no replies" },
    { hauler: "Your turn", haulerTone: "attention", landing: "Waiting for the hauler", landingTone: "waiting", queue: "responded", replies: LANDING_LAST, status: "replied", turn: "landing spoke last" },
    { hauler: "Waiting for the landing", haulerTone: "waiting", landing: "Hauler replied", landingTone: "attention", queue: "new", replies: HAULER_LAST, status: "replied", turn: "hauler spoke last" },
    { hauler: "Declined by the landing", haulerTone: "closed", landing: "Declined", landingTone: "closed", queue: "closed", replies: [], status: "declined", turn: "no replies" },
    { hauler: "Withdrawn by you", haulerTone: "closed", landing: "Withdrawn by the hauler", landingTone: "closed", queue: "closed", replies: [], status: "withdrawn", turn: "no replies" }
  ] as const

  it("has a row for every stored interest status", () => {
    expect(new Set(TABLE.map((row) => row.status))).toEqual(new Set(marketplaceInterestStatusSchema.options))
  })

  it.each(TABLE)("$status ($turn): hauler wording, landing queue and landing wording match the table", (row) => {
    const interest = { replies: row.replies, status: row.status }

    expect(describeMarketplaceInterestStatus(interest, "hauler")).toEqual({ label: row.hauler, tone: row.haulerTone })
    expect(describeMarketplaceInterestStatus(interest, "landing")).toEqual({ label: row.landing, tone: row.landingTone })
    expect(landingInterestQueueFor(interest)).toBe(row.queue)
  })

  it("files a viewed inquiry under New: seen is not answered", () => {
    expect(landingInterestQueue("viewed")).toBe("new")
    for (const replies of TURNS) expect(landingInterestQueueFor({ replies, status: "viewed" })).toBe("new")
  })

  it("queues from the status alone when the replies are not at hand, reading replied as the landing's reply", () => {
    expect(landingInterestQueue("submitted")).toBe("new")
    expect(landingInterestQueue("viewed")).toBe("new")
    expect(landingInterestQueue("replied")).toBe("responded")
    expect(landingInterestQueue("declined")).toBe("closed")
    expect(landingInterestQueue("withdrawn")).toBe("closed")
    for (const status of marketplaceInterestStatusSchema.options) {
      expect(landingInterestQueueFor({ replies: [], status })).toBe(landingInterestQueue(status))
    }
  })

  it("files each inquiry by the landing's move: New needs an answer, Replied waits for the hauler", () => {
    const TONE_OF_QUEUE = { closed: "closed", new: "attention", responded: "waiting" } as const
    for (const status of marketplaceInterestStatusSchema.options) {
      for (const replies of TURNS) {
        const interest = { replies, status }
        expect(describeMarketplaceInterestStatus(interest, "landing").tone).toBe(TONE_OF_QUEUE[landingInterestQueueFor(interest)])
      }
    }
  })

  it("names the queues New, Replied and Closed", () => {
    expect(LANDING_INTEREST_QUEUE_LABELS).toEqual({ closed: "Closed", new: "New", responded: "Replied" })
  })

  it("takes the turn from the latest reply, not the order of the list", () => {
    expect(lastMarketplaceInterestReplySide({ replies: [] })).toBeNull()
    expect(lastMarketplaceInterestReplySide({ replies: HAULER_LAST })).toBe("hauler")
    expect(lastMarketplaceInterestReplySide({ replies: [...HAULER_LAST].reverse() })).toBe("hauler")
    expect(describeMarketplaceInterestStatus({ replies: [], status: "replied" }, "hauler").label).toBe("Your turn")
  })

  it("keeps a decline final: closed for both sides and in the landing's queue, whoever spoke last", () => {
    for (const replies of TURNS) {
      const declined = { replies, status: "declined" } as const
      expect(describeMarketplaceInterestStatus(declined, "hauler")).toEqual({ label: "Declined by the landing", tone: "closed" })
      expect(describeMarketplaceInterestStatus(declined, "landing")).toEqual({ label: "Declined", tone: "closed" })
      expect(landingInterestQueueFor(declined)).toBe("closed")
    }
    expect(marketplaceInterestIsFinal("declined")).toBe(true)
    expect(marketplaceInterestIsOpen("declined")).toBe(false)
  })

  it("closes a withdrawal without making it final: the hauler can send interest again", () => {
    expect(marketplaceInterestIsOpen("withdrawn")).toBe(false)
    expect(marketplaceInterestIsFinal("withdrawn")).toBe(false)
    for (const status of ["submitted", "viewed", "replied"] as const) {
      expect(marketplaceInterestIsOpen(status)).toBe(true)
      expect(marketplaceInterestIsFinal(status)).toBe(false)
    }
  })

  it("keeps the status-only labels on the hauler's wording", () => {
    expect(MARKETPLACE_INTEREST_STATUS_LABELS).toEqual({
      declined: "Declined by the landing",
      replied: "Your turn",
      submitted: "Sent · waiting for the landing",
      viewed: "Seen by the landing",
      withdrawn: "Withdrawn by you"
    })
  })

  it.each([
    ["active", "Accepting interest", null],
    ["paused", "Paused by the poster", "The poster paused this listing."],
    ["filled", "Marked filled by the poster", "The poster marked this job filled."],
    ["closed", "Closed by the poster", "The poster closed this listing."],
    ["expired", "Listing expired", "This listing expired."]
  ] as const)("labels the %s job status, with a reason whenever it takes no interest", (status, label, reason) => {
    expect(MARKETPLACE_JOB_STATUS_LABELS[status]).toBe(label)
    expect(marketplaceJobClosedReason(status)).toBe(reason)
    expect(reason === null).toBe(marketplaceJobAcceptsInterest(status))
  })

  it("labels every job status, and says filled only as the poster's claim", () => {
    expect(Object.keys(MARKETPLACE_JOB_STATUS_LABELS).sort()).toEqual([...marketplaceJobStatusSchema.options].sort())
    const wording = [...Object.values(MARKETPLACE_JOB_STATUS_LABELS), ...marketplaceJobStatusSchema.options.map((status) => marketplaceJobClosedReason(status) ?? "")]
    expect(wording.filter((text) => /fill/i.test(text))).toEqual(["Marked filled by the poster", "The poster marked this job filled."])
  })

  it("never says hired, booked or assigned", () => {
    const sides: MarketplaceInterestSide[] = ["hauler", "landing"]
    const wording = [
      ...marketplaceInterestStatusSchema.options.flatMap((status) =>
        TURNS.flatMap((replies) => sides.map((side) => describeMarketplaceInterestStatus({ replies, status }, side).label))
      ),
      ...Object.values(MARKETPLACE_INTEREST_STATUS_LABELS),
      ...Object.values(LANDING_INTEREST_QUEUE_LABELS),
      ...Object.values(MARKETPLACE_JOB_STATUS_LABELS),
      ...marketplaceJobStatusSchema.options.map((status) => marketplaceJobClosedReason(status) ?? "")
    ]

    expect(wording.filter((text) => /\b(hire[sd]?|hiring|book(ed|ing)?|assign(ed|ment)?)\b/i.test(text))).toEqual([])
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
