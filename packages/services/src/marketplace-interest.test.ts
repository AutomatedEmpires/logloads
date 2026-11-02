import { describe, expect, it } from "vitest"

import { createInMemoryDatabase, type LogLoadsDatabaseState } from "@logloads/db"

import {
  expressMarketplaceInterest,
  listMarketplaceInterestsForHauler,
  listMarketplaceInterestsForLanding,
  marketplaceJobStatus,
  postHaulerInterestReply,
  respondToMarketplaceInterest,
  withdrawMarketplaceInterest,
  type MarketplaceActor
} from "./marketplace-interest"

// Seed fixtures are dated June 2026; the clock is pinned inside that window.
const AT = "2026-06-05T18:00:00.000Z"
const REPLY_1 = "aaaaaaaa-0000-4000-8000-000000000001"
const REPLY_2 = "aaaaaaaa-0000-4000-8000-000000000002"

function fixture() {
  const state = createInMemoryDatabase()
  const user = (email: string) => {
    const profile = state.profiles.find((candidate) => candidate.email === email)
    if (!profile) throw new Error(`seed user ${email} missing`)
    return profile.id
  }
  const orgOf = (userId: string, type: string) => {
    const membership = state.organizationMemberships.find((candidate) =>
      candidate.userId === userId &&
      candidate.status === "active" &&
      state.organizations.find((organization) => organization.id === candidate.organizationId)?.type === type
    )
    if (!membership) throw new Error(`no ${type} membership`)
    return membership.organizationId
  }
  const loadNamed = (title: string) => {
    const load = state.loadPostings.find((candidate) => candidate.title === title)
    if (!load) throw new Error(`seed load ${title} missing`)
    return load
  }

  // The open-network job is published by North Pine Logging; New River Hauling (no private
  // relationships) is the hauler; North Pine's landing manager reviews; Summit and North Pine's
  // own driver are outsiders to the inquiry.
  const newRiverOwner = user("emptyfleet@logloads.example")
  const loaderManager = user("loader@northpine.example")
  const hank = user("hank@northpine.example")
  const cole = user("cole@summit.example")
  const hauler: MarketplaceActor = { actorUserId: newRiverOwner, organizationId: orgOf(newRiverOwner, "fleet") }
  const landing: MarketplaceActor = { actorUserId: loaderManager, organizationId: orgOf(loaderManager, "fleet") }
  const publisherDriver: MarketplaceActor = { actorUserId: hank, organizationId: orgOf(hank, "fleet") }
  const otherLanding: MarketplaceActor = { actorUserId: cole, organizationId: orgOf(cole, "landing_source") }
  const openJob = loadNamed("Oak saw-log morning run")

  return { hauler, landing, loadNamed, openJob, otherLanding, publisherDriver, state }
}

function operationalCounts(state: LogLoadsDatabaseState) {
  return {
    assignments: state.assignments.length,
    directOffers: state.directOffers.length,
    platformFeeEvents: state.platformFeeEvents.length,
    truckSlots: state.truckSlots.map((slot) => slot.reservedCount).join(","),
    trips: state.tripsV2.length
  }
}

describe("hauler expresses interest", () => {
  it("records one submitted interest without touching dispatch, trips or fees", () => {
    const { hauler, landing, openJob, state } = fixture()
    const before = operationalCounts(state)
    const { created, interest } = expressMarketplaceInterest(state, hauler, {
      availableFrom: "2026-11-03", loadPostingId: openJob.id, message: "Two log trucks, both with self-loaders.", trucksOffered: 2
    }, AT)

    expect(created).toBe(true)
    expect(interest).toMatchObject({
      haulerOrganizationId: hauler.organizationId, jobOrganizationId: landing.organizationId, status: "submitted", trucksOffered: 2
    })
    expect(state.marketplaceInterests).toHaveLength(1)
    expect(operationalCounts(state)).toEqual(before)
    expect(state.auditEvents.at(-1)).toMatchObject({ action: "marketplace_interest_submitted", entityType: "marketplace_interest" })
  })

  it("groups a repeat submission into the same live interest and updates changed terms", () => {
    const { hauler, openJob, state } = fixture()
    const first = expressMarketplaceInterest(state, hauler, { loadPostingId: openJob.id, trucksOffered: 1 }, AT).interest
    const replay = expressMarketplaceInterest(state, hauler, { loadPostingId: openJob.id, trucksOffered: 1 }, AT)
    const updated = expressMarketplaceInterest(state, hauler, { loadPostingId: openJob.id, trucksOffered: 3 }, AT)

    expect(replay).toEqual({ created: false, interest: first })
    expect(updated.created).toBe(false)
    expect(updated.interest.id).toBe(first.id)
    expect(updated.interest.trucksOffered).toBe(3)
    expect(state.marketplaceInterests).toHaveLength(1)
  })

  it("refuses a landing-type organization, its own job, a foreign workspace, and closed or invisible jobs", () => {
    const { hauler, landing, loadNamed, openJob, otherLanding, publisherDriver, state } = fixture()

    expect(() => expressMarketplaceInterest(state, otherLanding, { loadPostingId: openJob.id, trucksOffered: 1 }, AT))
      .toThrow("Switch to a hauling business")
    expect(() => expressMarketplaceInterest(state, publisherDriver, { loadPostingId: openJob.id, trucksOffered: 1 }, AT))
      .toThrow("own organization's job")
    expect(() => expressMarketplaceInterest(state, { ...hauler, organizationId: landing.organizationId }, { loadPostingId: openJob.id, trucksOffered: 1 }, AT))
      .toThrow("Organization operations are not available")
    expect(() => expressMarketplaceInterest(state, hauler, { loadPostingId: loadNamed("Oak recovery load").id, trucksOffered: 1 }, AT))
      .toThrow("no longer accepting")
    expect(() => expressMarketplaceInterest(state, hauler, { loadPostingId: loadNamed("Blue River high-grade campaign").id, trucksOffered: 1 }, AT))
      .toThrow("Job not found")
    expect(state.marketplaceInterests).toHaveLength(0)
  })
})

describe("landing reviews and responds", () => {
  it("lists only its own jobs' inquiries, marks viewed, replies idempotently, and the hauler sees the reply", () => {
    const { hauler, landing, openJob, state } = fixture()
    const { interest } = expressMarketplaceInterest(state, hauler, { loadPostingId: openJob.id, trucksOffered: 2 }, AT)

    expect(listMarketplaceInterestsForLanding(state, landing).map((row) => row.id)).toEqual([interest.id])
    expect(respondToMarketplaceInterest(state, landing, { decision: "viewed", interestId: interest.id }, AT).status).toBe("viewed")

    const reply = { body: "Can you start Tuesday at 5 a.m.?", decision: "replied", interestId: interest.id, replyId: REPLY_1 }
    respondToMarketplaceInterest(state, landing, reply, AT)
    respondToMarketplaceInterest(state, landing, reply, AT)

    const seen = listMarketplaceInterestsForHauler(state, hauler)[0]
    expect(seen?.status).toBe("replied")
    expect(seen?.replies).toHaveLength(1)
    expect(seen?.replies[0]).toMatchObject({ authorSide: "landing", body: "Can you start Tuesday at 5 a.m.?" })

    postHaulerInterestReply(state, hauler, { body: "Yes, two trucks Tuesday.", interestId: interest.id, replyId: REPLY_2 }, AT)
    postHaulerInterestReply(state, hauler, { body: "Yes, two trucks Tuesday.", interestId: interest.id, replyId: REPLY_2 }, AT)
    expect(listMarketplaceInterestsForLanding(state, landing)[0]?.replies.map((r) => r.authorSide)).toEqual(["landing", "hauler"])
  })

  it("keeps inquiries private across tenants", () => {
    const { hauler, landing, openJob, otherLanding, publisherDriver, state } = fixture()
    const { interest } = expressMarketplaceInterest(state, hauler, { loadPostingId: openJob.id, trucksOffered: 1 }, AT)

    expect(() => respondToMarketplaceInterest(state, otherLanding, { decision: "viewed", interestId: interest.id }, AT)).toThrow("Inquiry not found")
    expect(() => respondToMarketplaceInterest(state, publisherDriver, { decision: "viewed", interestId: interest.id }, AT)).toThrow("Inquiry not found")
    expect(() => respondToMarketplaceInterest(state, hauler, { decision: "declined", interestId: interest.id }, AT)).toThrow("Inquiry not found")
    expect(listMarketplaceInterestsForHauler(state, publisherDriver)).toEqual([])
    expect(listMarketplaceInterestsForLanding(state, otherLanding)).toEqual([])
    expect(() => withdrawMarketplaceInterest(state, publisherDriver, interest.id, AT)).toThrow("Inquiry not found")
    expect(() => postHaulerInterestReply(state, publisherDriver, { body: "hi", interestId: interest.id, replyId: REPLY_1 }, AT)).toThrow("Inquiry not found")
    // New River operates no landing, so even its owner holds no landing seat and has no landing inbox.
    expect(() => listMarketplaceInterestsForLanding(state, hauler)).toThrow("Inquiry not found")
    expect(() => listMarketplaceInterestsForLanding(state, publisherDriver)).toThrow("Inquiry not found")
    expect(interest.status).toBe("submitted")
    expect(landing.organizationId).toBe(interest.jobOrganizationId)
  })

  it("closes the conversation when declined and blocks responses to a withdrawn inquiry", () => {
    const { hauler, landing, openJob, state } = fixture()
    const { interest } = expressMarketplaceInterest(state, hauler, { loadPostingId: openJob.id, trucksOffered: 1 }, AT)

    respondToMarketplaceInterest(state, landing, { body: "Fully booked this week.", decision: "declined", interestId: interest.id, replyId: REPLY_1 }, AT)
    expect(interest.status).toBe("declined")
    expect(() => postHaulerInterestReply(state, hauler, { body: "Next week?", interestId: interest.id, replyId: REPLY_2 }, AT)).toThrow("This inquiry is closed")
    expect(() => expressMarketplaceInterest(state, hauler, { loadPostingId: openJob.id, trucksOffered: 2 }, AT)).toThrow("closed this inquiry")
  })

  it("lets the hauler withdraw and later renew; the landing cannot act on a withdrawn inquiry", () => {
    const { hauler, landing, openJob, state } = fixture()
    const { interest } = expressMarketplaceInterest(state, hauler, { loadPostingId: openJob.id, trucksOffered: 1 }, AT)

    withdrawMarketplaceInterest(state, hauler, interest.id, AT)
    expect(withdrawMarketplaceInterest(state, hauler, interest.id, AT).status).toBe("withdrawn")
    expect(() => respondToMarketplaceInterest(state, landing, { decision: "viewed", interestId: interest.id }, AT)).toThrow("withdrew")

    const renewed = expressMarketplaceInterest(state, hauler, { loadPostingId: openJob.id, trucksOffered: 1 }, AT).interest
    expect(renewed).toMatchObject({ id: interest.id, status: "submitted", withdrawnAt: null })
  })
})

describe("load-board job status", () => {
  it("maps pilot load states onto advertisement states", () => {
    const { loadNamed, openJob } = fixture()

    expect(marketplaceJobStatus(openJob, AT)).toBe("active")
    expect(marketplaceJobStatus(openJob, "2026-06-07T00:00:00.000Z")).toBe("expired")
    expect(marketplaceJobStatus({ ...openJob, campaignEndDate: "2026-06-01", scheduleType: "campaign" }, AT)).toBe("expired")
    expect(marketplaceJobStatus(loadNamed("Blue River pulp contingency"), AT)).toBe("filled")
    expect(marketplaceJobStatus(loadNamed("Oak recovery load"), AT)).toBe("closed")
    expect(marketplaceJobStatus(loadNamed("Blue River standby swing shift"), AT)).toBe("paused")
    expect(marketplaceJobStatus({ ...openJob, archivedAt: AT }, AT)).toBe("closed")
  })
})
