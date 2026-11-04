import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getSessionActor: vi.fn(),
  listHaulerInterests: vi.fn(),
  listLandingInterests: vi.fn()
}))

vi.mock("server-only", () => ({}))
vi.mock("../session", () => ({ getSessionActor: mocks.getSessionActor }))
vi.mock("./pilot-adapter", () => ({
  pilotMarketplaceV2: { listHaulerInterests: mocks.listHaulerInterests, listLandingInterests: mocks.listLandingInterests }
}))

import type { MarketplaceInterestStatus, MarketplaceInterestView } from "@logloads/contracts"

import {
  chooseInquiryTab,
  HAULER_INQUIRY_TABS,
  haulerQueueOf,
  inquiryTabCounts,
  LANDING_INQUIRY_TABS,
  landingInquiryFilters,
  landingQueueOf,
  v2InquiryNavCounts
} from "./inquiries"

/**
 * UX-09 (#132): the hauler's tabs, the landing's queues and filters, and the navigation's unread counts, over the
 * contracts' queue rules (UX-DEC-01).
 */

const ORG = "33333333-bbbb-4bbb-8bbb-333333333333"
const USER = "55555555-dddd-4ddd-8ddd-555555555555"
const JOB_A = "11111111-1111-4111-8111-111111111111"
const JOB_B = "12121212-1212-4121-8121-121212121212"
const LANDING_1 = "77777777-7777-4777-8777-777777777777"

let sequence = 0

function reply(authorSide: "hauler" | "landing", minute: number): MarketplaceInterestView["replies"][number] {
  return {
    authorName: authorSide,
    authorSide,
    authorUserId: USER,
    body: "message",
    createdAt: new Date(Date.UTC(2026, 10, 1, 12, minute)).toISOString(),
    id: `00000000-0000-4000-8000-${String(minute).padStart(12, "0")}`
  }
}

function interest(status: MarketplaceInterestStatus, overrides: Partial<MarketplaceInterestView> = {}): MarketplaceInterestView {
  sequence += 1
  return {
    availableFrom: null,
    availableUntil: null,
    contactPreference: "in_app",
    createdAt: "2026-11-01T12:00:00.000Z",
    equipment: [],
    haulerOrganization: { id: ORG, name: "Example Hauling", type: "carrier" },
    id: `44444444-cccc-4ccc-8ccc-${String(sequence).padStart(12, "0")}`,
    job: { acceptingInterest: true, id: JOB_A, slug: JOB_A, status: "active", title: "Saw logs to the mill" },
    landingOrganization: { id: "66666666-eeee-4eee-8eee-666666666666", name: "Example Timber" },
    message: null,
    replies: [],
    status,
    submittedBy: { name: "Sam", userId: USER },
    trucksOffered: 1,
    updatedAt: "2026-11-01T12:00:00.000Z",
    ...overrides
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  sequence = 0
})

describe("the queue mapping on both sides", () => {
  const all = [
    interest("submitted"),
    interest("viewed"),
    interest("replied", { replies: [reply("landing", 1)] }),
    interest("replied", { replies: [reply("landing", 1), reply("hauler", 2)] }),
    interest("declined"),
    interest("withdrawn")
  ]

  it("puts the hauler's inquiries on Active until the landing replies, then Replied, then Closed", () => {
    expect(all.map(haulerQueueOf)).toEqual(["active", "active", "replied", "replied", "closed", "closed"])
    expect(inquiryTabCounts(all, HAULER_INQUIRY_TABS, haulerQueueOf)).toEqual({ active: 2, closed: 2, replied: 2 })
  })

  it("keeps a reviewed inquiry and a hauler's answer in the landing's New queue (UX-DEC-01)", () => {
    expect(all.map(landingQueueOf)).toEqual(["new", "new", "responded", "new", "closed", "closed"])
    expect(inquiryTabCounts(all, LANDING_INQUIRY_TABS, landingQueueOf)).toEqual({ closed: 2, new: 3, responded: 1 })
    expect(inquiryTabCounts([], LANDING_INQUIRY_TABS, landingQueueOf)).toEqual({ closed: 0, new: 0, responded: 0 })
    expect(LANDING_INQUIRY_TABS.map((tab) => tab.label)).toEqual(["New", "Replied", "Closed"])
  })

  it("opens the tab asked for, else the selected inquiry's, else the first with inquiries", () => {
    const counts = { closed: 1, new: 0, responded: 2 }

    expect(chooseInquiryTab("closed", "responded", counts, LANDING_INQUIRY_TABS)).toBe("closed")
    expect(chooseInquiryTab("", "closed", counts, LANDING_INQUIRY_TABS)).toBe("closed")
    expect(chooseInquiryTab("nonsense", null, counts, LANDING_INQUIRY_TABS)).toBe("responded")
    expect(chooseInquiryTab("", null, { closed: 0, new: 0, responded: 0 }, LANDING_INQUIRY_TABS)).toBe("new")
  })
})

describe("the landing inbox's job and landing filter", () => {
  const a = interest("submitted")
  const b = interest("submitted", { job: { acceptingInterest: true, id: JOB_B, slug: JOB_B, status: "active", title: "Pulp run" } })
  const jobs = [
    { equipmentCodes: ["log_truck"], jobId: JOB_A, landing: { id: LANDING_1, name: "Upper Spur" } },
    { equipmentCodes: null, jobId: JOB_B, landing: null }
  ]

  it("offers only the inbox's own jobs and their landings, and filters by both", () => {
    const filters = landingInquiryFilters([a, b], jobs, { job: "", landing: "" })

    expect(filters.jobOptions).toEqual([{ id: JOB_B, label: "Pulp run" }, { id: JOB_A, label: "Saw logs to the mill · Upper Spur" }])
    expect(filters.landingOptions).toEqual([{ id: LANDING_1, label: "Upper Spur" }])
    expect(filters.interests).toEqual([a, b])

    expect(landingInquiryFilters([a, b], jobs, { job: JOB_B, landing: "" }).interests).toEqual([b])
    expect(landingInquiryFilters([a, b], jobs, { job: "", landing: LANDING_1 }).interests).toEqual([a])
    expect(landingInquiryFilters([a, b], jobs, { job: JOB_B, landing: LANDING_1 }).interests).toEqual([])
  })

  it("ignores an id the inbox does not hold, and offers no landing filter without landings", () => {
    const unknown = landingInquiryFilters([a, b], jobs, { job: "99999999-9999-4999-8999-999999999999", landing: "x" })
    expect(unknown).toMatchObject({ job: "", landing: "" })
    expect(unknown.interests).toEqual([a, b])

    const none = landingInquiryFilters([a, b], null, { job: "", landing: LANDING_1 })
    expect(none.landingOptions).toEqual([])
    expect(none.landing).toBe("")
    expect(none.jobOptions.map((option) => option.label)).toEqual(["Pulp run", "Saw logs to the mill"])
  })
})

describe("unread counts in the navigation", () => {
  const actor = { activeOrganization: { id: ORG }, profile: { id: USER }, workspaceSelectionInvalid: false }

  it("counts the hauler's turn and the landing's unreviewed New inquiries, for the sides the business has", async () => {
    mocks.getSessionActor.mockResolvedValue(actor)
    mocks.listHaulerInterests.mockResolvedValue([
      interest("replied", { replies: [reply("landing", 1)] }),
      interest("replied", { replies: [reply("landing", 1), reply("hauler", 2)] }),
      interest("submitted")
    ])
    mocks.listLandingInterests.mockResolvedValue([
      interest("submitted"),
      interest("viewed"),
      interest("replied", { replies: [reply("landing", 1), reply("hauler", 2)] }),
      interest("declined")
    ])

    expect(await v2InquiryNavCounts(["interest.express", "interest.reply", "inquiry.respond"])).toEqual({ inquiries: 1, "landing-inquiries": 2 })
    expect(mocks.listHaulerInterests).toHaveBeenCalledWith({ organizationId: ORG, userId: USER })

    vi.clearAllMocks()
    mocks.getSessionActor.mockResolvedValue(actor)
    mocks.listLandingInterests.mockResolvedValue([interest("submitted")])
    expect(await v2InquiryNavCounts(["job.publish", "inquiry.respond"])).toEqual({ "landing-inquiries": 1 })
    expect(mocks.listHaulerInterests).not.toHaveBeenCalled()
  })

  it("leaves out a count it cannot read, and counts nothing without a business", async () => {
    mocks.getSessionActor.mockResolvedValue(actor)
    mocks.listHaulerInterests.mockRejectedValue(new Error("Your role cannot act on inquiries for this business"))
    mocks.listLandingInterests.mockResolvedValue([])

    expect(await v2InquiryNavCounts(["interest.express", "inquiry.respond"])).toEqual({ "landing-inquiries": 0 })
    expect(await v2InquiryNavCounts(null)).toEqual({})

    mocks.getSessionActor.mockResolvedValue({ ...actor, workspaceSelectionInvalid: true })
    expect(await v2InquiryNavCounts(["interest.express"])).toEqual({})

    mocks.getSessionActor.mockRejectedValue(new Error("session store down"))
    expect(await v2InquiryNavCounts(["interest.express"])).toEqual({})
  })
})
