import { describe, expect, it } from "vitest"

import {
  containsSensitiveAccessText,
  draftEndsOn,
  previewMarketplaceJob,
  validateMarketplaceJobDraft
} from "./marketplace-job-draft"
import { MARKETPLACE_CAPABILITIES, marketplaceCan, marketplaceCapabilities, type MarketplaceMembership } from "./marketplace-permissions"
import {
  expressInterestInputSchema,
  filterMarketplaceJobs,
  formatMarketplacePay,
  landingInterestQueue,
  MARKETPLACE_EQUIPMENT_TYPES,
  marketplaceInterestSchema,
  marketplaceJobAcceptsInterest,
  postingFreshness,
  respondToInterestInputSchema,
  sortMarketplaceJobs,
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
  posterVerified: true,
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
    expect(issues({ payAmount: "", payUnit: "" })).toEqual([])
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
      now: "2026-11-01T00:00:00.000Z", posterName: "North Pine", posterOrganizationId: "77777777-7777-4777-8777-777777777777", posterVerified: false
    })
    expect(preview).toMatchObject({ acceptingInterest: false, lastConfirmedAt: null, pay: { amountCents: 52_500, unit: "per_load" }, trucks: { perDay: 3, total: 6 } })
    expect(preview.equipment).toEqual(["Log truck", "Pole trailer"])
  })
})
