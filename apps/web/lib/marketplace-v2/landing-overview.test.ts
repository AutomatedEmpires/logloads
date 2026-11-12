import { describe, expect, it, vi } from "vitest"

import { filterMarketplaceJobs, type MarketplaceInterestView, type MarketplaceJobCardView } from "@logloads/contracts"

import {
  checklistIncomplete,
  newInquiryCount,
  newInquiryItems,
  overviewChecklist,
  ownJobFilters,
  readOwnJobs,
  reconfirmableJob,
  unconfirmedJobItems,
  unconfirmedLabel
} from "./landing-overview"
import { MarketplaceOperationUnavailableError, MarketplaceRefusalError } from "./port"

const ORG = "22222222-aaaa-4aaa-8aaa-222222222222"
const OTHER = "88888888-cccc-4ccc-8ccc-cccccccccccc"
const NOW = "2026-11-03T12:00:00.000Z"

function interest(id: string, jobId: string, title: string, status: MarketplaceInterestView["status"], landingOrg = ORG, createdAt = "2026-11-02T12:00:00.000Z"): MarketplaceInterestView {
  return {
    availableFrom: null, availableUntil: null, contactPreference: "in_app", createdAt, equipment: [], haulerOrganization: { id: OTHER, name: "Ridgeline Hauling", type: "Hauling business" },
    id, job: { acceptingInterest: true, id: jobId, slug: jobId, status: "active", title }, landingOrganization: { id: landingOrg, name: "Cedar Fork Logging" }, message: null,
    replies: [], status, submittedBy: { name: "Haul Owner", userId: OTHER }, trucksOffered: 2, updatedAt: createdAt
  }
}

function job(id: string, title: string, overrides: Partial<MarketplaceJobCardView> = {}): MarketplaceJobCardView {
  return {
    acceptingInterest: true, destinationLabel: null, endsOn: null, equipment: [], estimatedDailyLoads: null, estimatedLoadsPerTruckPerDay: null,
    estimatedTonsPerLoad: null, expiresAt: null, haulDistance: null, id, lastConfirmedAt: "2026-11-03T08:00:00.000Z", lastModifiedAt: "2026-11-03T08:00:00.000Z",
    origin: { approximatePoint: null, label: "Oakridge, OR", stateCode: "OR" }, pay: { amountCents: 52500, note: null, unit: "per_load" }, posterName: "Cedar Fork Logging",
    posterOrganizationId: ORG, posterVerification: null, product: "Saw logs", scheduleNote: null, slug: id, sponsored: false, startsOn: null, status: "active",
    title, trucks: { perDay: null, total: 3 },
    ...overrides
  }
}

describe("the business's own jobs (#209)", () => {
  it("asks the store for this business's listings in every status, before its row limit", () => {
    expect(ownJobFilters(ORG)).toEqual({ acceptingOnly: false, posterOrganizationId: ORG })

    const jobs = [
      job("own-active", "Saw logs"),
      job("own-paused", "Paused pulp", { acceptingInterest: false, status: "paused" }),
      job("rival", "Rival run", { posterOrganizationId: OTHER })
    ]
    expect(filterMarketplaceJobs(jobs, ownJobFilters(ORG)).map((j) => j.id)).toEqual(["own-active", "own-paused"])
  })
})

describe("the overview's attention list (#133 criterion 2)", () => {
  it("counts new inquiries per job, most first, for the active business only", () => {
    const items = newInquiryItems([
      interest("i1", "j1", "Oak saw-log morning run", "submitted", ORG, "2026-11-02T10:00:00.000Z"),
      interest("i2", "j1", "Oak saw-log morning run", "submitted", ORG, "2026-11-01T10:00:00.000Z"),
      interest("i3", "j2", "Pulp to Eugene", "submitted"),
      interest("i4", "j2", "Pulp to Eugene", "replied"),
      interest("i5", "j9", "Rival job", "submitted", OTHER),
      // Seen but not answered stays New; a hauler's follow-up after a reply puts the inquiry back in New.
      interest("i6", "j3", "Cedar poles", "viewed", ORG, "2026-11-01T08:00:00.000Z"),
      {
        ...interest("i7", "j3", "Cedar poles", "replied"),
        replies: [
          { authorName: "Desk", authorSide: "landing", authorUserId: ORG, body: "Can you start Tuesday?", createdAt: "2026-11-02T13:00:00.000Z", id: "r1" },
          { authorName: "Haul Owner", authorSide: "hauler", authorUserId: OTHER, body: "Yes, two trucks.", createdAt: "2026-11-02T14:00:00.000Z", id: "r2" }
        ]
      }
    ], ORG)

    expect(items).toEqual([
      { count: 2, firstInterestId: "i6", jobId: "j3", jobTitle: "Cedar poles", kind: "new_inquiries" },
      { count: 2, firstInterestId: "i2", jobId: "j1", jobTitle: "Oak saw-log morning run", kind: "new_inquiries" },
      { count: 1, firstInterestId: "i3", jobId: "j2", jobTitle: "Pulp to Eugene", kind: "new_inquiries" }
    ])
    expect(newInquiryCount([interest("i1", "j1", "A", "submitted"), interest("i5", "j9", "B", "submitted", OTHER)], ORG)).toBe(1)
  })

  it("lists the business's accepting listings not confirmed within the interval, never confirmed first", () => {
    const items = unconfirmedJobItems([
      job("recent", "Confirmed today"),
      job("aging", "Pulp to Eugene", { lastConfirmedAt: "2026-10-25T12:00:00.000Z" }),
      job("never", "Never confirmed", { lastConfirmedAt: null }),
      job("paused", "Paused job", { acceptingInterest: false, lastConfirmedAt: null, status: "paused" }),
      job("rival", "Rival job", { lastConfirmedAt: null, posterOrganizationId: OTHER })
    ], ORG, NOW)

    expect(items.map((item) => [item.jobId, item.days])).toEqual([["never", null], ["aging", 9]])
    expect(unconfirmedLabel(items[1]!)).toBe("“Pulp to Eugene” not confirmed for 9 days")
    expect(unconfirmedLabel(items[0]!)).toBe("“Never confirmed” has never been confirmed as still available")
  })

  it("lists a day-14 job, which the store reports as not accepting interest, because it is the one most in need (#374)", () => {
    const items = unconfirmedJobItems([
      job("day14", "Off Find Work", { acceptingInterest: false, lastConfirmedAt: "2026-10-19T12:00:00.000Z" }),
      job("never14", "Never confirmed", { acceptingInterest: false, lastConfirmedAt: null }),
      job("lapsed", "Lapsed", { acceptingInterest: false, expiresAt: "2026-11-01T00:00:00.000Z", lastConfirmedAt: null }),
      job("filled", "Filled", { acceptingInterest: false, lastConfirmedAt: null, status: "filled" })
    ], ORG, NOW)

    expect(items.map((item) => [item.jobId, item.days])).toEqual([["never14", null], ["day14", 15]])
  })

  it("never counts an edit as a confirmation", () => {
    expect(unconfirmedJobItems([job("edited", "Edited today", { lastConfirmedAt: "2026-10-01T00:00:00.000Z", lastModifiedAt: NOW })], ORG, NOW)).toHaveLength(1)
  })
})

describe("the new subscriber's checklist (#133 criterion 6)", () => {
  it("has three steps: add a landing, post a job, set the contact route", () => {
    const steps = overviewChecklist({ jobs: [], landings: [], organizationId: ORG })

    expect(steps.map((step) => [step.label, step.done, step.href])).toEqual([
      ["Add a landing", false, "/v2/landing/landings/new"],
      ["Post a job", false, "/v2/landing/jobs/new"],
      ["Set how haulers reach you", true, null]
    ])
    expect(checklistIncomplete(steps)).toBe(true)
  })

  const landing = (activeJobs: number | null) => ({
    activeJobs, approximatePoint: null, areaLabel: "Oakridge, OR", county: null, id: "l1", name: "Hills Creek",
    privateDetails: { exactLocation: null, gateInstructions: null, siteContactName: null, siteContactPhone: null }, stateCode: "OR", status: "active" as const, updatedAt: null
  })

  it("is complete once the business has a landing and a job of its own", () => {
    expect(checklistIncomplete(overviewChecklist({ jobs: [job("j1", "Mine")], landings: [landing(0)], organizationId: ORG }))).toBe(false)
    expect(checklistIncomplete(overviewChecklist({ jobs: [job("j9", "Theirs", { posterOrganizationId: OTHER })], landings: [landing(0)], organizationId: ORG }))).toBe(true)
  })

  it("counts a job the public cannot see when the business's own reads show it posted one (#209 review)", () => {
    const posted = (input: Partial<Parameters<typeof overviewChecklist>[0]>) =>
      !checklistIncomplete(overviewChecklist({ jobs: [], landings: [landing(0)], organizationId: ORG, ...input }))

    // An inquiry on one of its jobs, in any status, means it posted, even if every listing is now paused or closed.
    expect(posted({ interests: [interest("i1", "j1", "Closed pulp", "declined")] })).toBe(true)
    // Another business's inquiry proves nothing about this one.
    expect(posted({ interests: [interest("i9", "j9", "Theirs", "submitted", OTHER)] })).toBe(false)
    // An active job counted on its own landing, such as a listing that expired, also means it posted.
    expect(posted({ landings: [landing(1)] })).toBe(true)
    expect(posted({ landings: [landing(null)] })).toBe(false)
    expect(posted({ interests: null })).toBe(false)
  })
})

describe("which of its own jobs a business can reconfirm (#374)", () => {
  it("is a listed job, including one the store reports as not accepting interest, and no stopped or expired job", () => {
    expect(reconfirmableJob(job("a", "Listed"), NOW)).toBe(true)
    expect(reconfirmableJob(job("b", "Day 14", { acceptingInterest: false, lastConfirmedAt: "2026-10-01T00:00:00.000Z" }), NOW)).toBe(true)

    for (const status of ["paused", "filled", "closed", "expired"] as const) {
      expect(reconfirmableJob(job("c", status, { acceptingInterest: false, status }), NOW), status).toBe(false)
    }

    expect(reconfirmableJob(job("d", "Lapsed", { expiresAt: "2026-11-02T00:00:00.000Z" }), NOW)).toBe(false)
  })
})

describe("reading the business's own jobs (#374)", () => {
  const view = (id: string, overrides: Partial<MarketplaceJobCardView> = {}) => ({ job: job(id, id, overrides) })

  it("reads them through listOwnJobs, so a day-14 job is not left out", async () => {
    const port = {
      listJobs: vi.fn(),
      listOwnJobs: vi.fn().mockResolvedValue([view("own"), view("day14", { acceptingInterest: false }), view("rival", { posterOrganizationId: OTHER })]),
      supportsPublishing: true
    }
    const viewer = { organizationId: ORG, userId: "u1" }

    expect((await readOwnJobs(port as never, viewer)).map((j) => j.id)).toEqual(["own", "day14"])
    expect(port.listOwnJobs).toHaveBeenCalledExactlyOnceWith(viewer)
    expect(port.listJobs).not.toHaveBeenCalled()
  })

  it("falls back to the public read for a role without the job desk, which only sees what is listed", async () => {
    const port = {
      listJobs: vi.fn().mockResolvedValue([job("own", "Mine")]),
      listOwnJobs: vi.fn().mockRejectedValue(new MarketplaceRefusalError("Your role cannot manage this business's jobs", "42501")),
      supportsPublishing: true
    }

    expect((await readOwnJobs(port as never, { organizationId: ORG, userId: "u1" })).map((j) => j.id)).toEqual(["own"])
    expect(port.listJobs).toHaveBeenCalledExactlyOnceWith(ownJobFilters(ORG))
  })

  it("uses the public read where the store has no job desk (the pilot), and lets any other failure through", async () => {
    const pilot = { listJobs: vi.fn().mockResolvedValue([job("own", "Mine")]), listOwnJobs: vi.fn(), supportsPublishing: false }
    expect((await readOwnJobs(pilot as never, { organizationId: ORG, userId: "u1" })).map((j) => j.id)).toEqual(["own"])
    expect(pilot.listOwnJobs).not.toHaveBeenCalled()

    const broken = { listJobs: vi.fn(), listOwnJobs: vi.fn().mockRejectedValue(new Error("store down")), supportsPublishing: true }
    await expect(readOwnJobs(broken as never, { organizationId: ORG, userId: "u1" })).rejects.toThrow("store down")
    expect(MarketplaceOperationUnavailableError).toBeDefined()
  })
})
