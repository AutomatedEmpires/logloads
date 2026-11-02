import { describe, expect, it } from "vitest"

import {
  BOOST_AUTO_RENEWS,
  BOOST_PACKAGES,
  BOOST_RADIUS_MILES,
  FOUNDING_HAULER_BADGE_LIMIT,
  FOUNDING_OPERATOR_OFFER,
  HAULER_MEMBERSHIP,
  LANDING_PLANS,
  boostWindow,
  canActivateLanding,
  canAddTeamMember,
  evaluateTargetedInvitation,
  foundingOperatorCyclePriceCents,
  invitationsUsedInCycle,
  planIncludesFeature,
  remainingTargetedInvitations,
  sendableTargetedInvitations,
  type CommittedTargetedInvitation
} from "./membership"

const cycle = { endsAt: "2026-12-01T00:00:00.000Z", startsAt: "2026-11-01T00:00:00.000Z" }
const WEEK = 7 * 24 * 60 * 60 * 1000
const recipient = { matchesCriteria: true, optedIn: true, organizationId: "hauler-1" }
const delivered = (recipientOrganizationId: string, jobPostingId: string, committedAt: string): CommittedTargetedInvitation =>
  ({ committedAt, jobPostingId, recipientOrganizationId })

describe("Blueprint v1.0 landing plans (§3.1)", () => {
  it("matches the adopted commercial matrix exactly", () => {
    expect(Object.values(LANDING_PLANS).map((plan) => [
      plan.code, plan.monthlyPriceCents, plan.activeLandingLimit, plan.teamSeatLimit, plan.targetedInvitationsPerCycle
    ])).toEqual([
      ["basic", 14_900, 1, 2, 3],
      ["pro", 29_900, 3, 5, 10],
      ["regional", 49_900, null, 10, 30]
    ])
  })

  it("gates advanced tools by tier with no feature on Basic beyond the shared core", () => {
    expect(LANDING_PLANS.basic.features).toEqual([])
    expect(planIncludesFeature("pro", "advanced_hauler_search")).toBe(true)
    expect(planIncludesFeature("pro", "multi_landing_inbox")).toBe(true)
    expect(planIncludesFeature("pro", "regional_capacity_overview")).toBe(false)
    expect(planIncludesFeature("regional", "regional_capacity_overview")).toBe(true)
    expect(planIncludesFeature("regional", "priority_support")).toBe(true)
  })

  it("keeps haulers free forever with no paid hauler tier (§2.1)", () => {
    expect(HAULER_MEMBERSHIP.monthlyPriceCents).toBe(0)
    expect(HAULER_MEMBERSHIP.paidTiers).toEqual([])
  })

  it("limits active landings 1 / 3 / unlimited and seats 2 / 5 / 10", () => {
    expect(canActivateLanding("basic", 0)).toBe(true)
    expect(canActivateLanding("basic", 1)).toBe(false)
    expect(canActivateLanding("pro", 2)).toBe(true)
    expect(canActivateLanding("pro", 3)).toBe(false)
    expect(canActivateLanding("regional", 500)).toBe(true)
    expect(canAddTeamMember("basic", 1)).toBe(true)
    expect(canAddTeamMember("basic", 2)).toBe(false)
    expect(canAddTeamMember("pro", 5)).toBe(false)
    expect(canAddTeamMember("regional", 9)).toBe(true)
    expect(canAddTeamMember("regional", 10)).toBe(false)
    expect(() => canActivateLanding("basic", -1)).toThrow(RangeError)
    expect(() => canAddTeamMember("basic", 1.5)).toThrow(RangeError)
  })
})

describe("targeted invitations (§6)", () => {
  it("counts only deliveries inside the current cycle, so unused or past allowances never roll over", () => {
    const deliveries = [
      delivered("a", "job-1", "2026-10-30T12:00:00.000Z"),
      delivered("b", "job-1", "2026-11-02T12:00:00.000Z"),
      delivered("c", "job-2", "2026-11-30T23:59:59.999Z"),
      delivered("d", "job-2", "2026-12-01T00:00:00.000Z")
    ]

    expect(invitationsUsedInCycle(deliveries, cycle)).toBe(2)
    expect(remainingTargetedInvitations("basic", deliveries, cycle)).toBe(1)
    expect(remainingTargetedInvitations("pro", [], cycle)).toBe(10)
    expect(remainingTargetedInvitations("basic", [...deliveries, delivered("e", "job-3", "2026-11-05T00:00:00.000Z"), delivered("f", "job-3", "2026-11-06T00:00:00.000Z")], cycle)).toBe(0)
  })

  it("never offers more sends than the eligible opted-in audience (§6.4)", () => {
    expect(sendableTargetedInvitations(10, 2)).toBe(2)
    expect(sendableTargetedInvitations(3, 40)).toBe(3)
    expect(sendableTargetedInvitations(30, 0)).toBe(0)
  })

  it("allows a send to an opted-in matching recipient and reports the remaining allowance", () => {
    expect(evaluateTargetedInvitation({
      cycle, deliveries: [], dedupeWindowMs: WEEK, jobPostingId: "job-1", now: "2026-11-10T00:00:00.000Z", planCode: "basic", recipient
    })).toEqual({ allowed: true, remainingAfterSend: 2 })
  })

  it("refuses opted-out or non-matching recipients without consuming allowance", () => {
    const base = { cycle, deliveries: [], dedupeWindowMs: WEEK, jobPostingId: "job-1", now: "2026-11-10T00:00:00.000Z", planCode: "basic" as const }

    expect(evaluateTargetedInvitation({ ...base, recipient: { ...recipient, optedIn: false } }))
      .toEqual({ allowed: false, reason: "recipient_not_opted_in", remaining: 3 })
    expect(evaluateTargetedInvitation({ ...base, recipient: { ...recipient, matchesCriteria: false } }))
      .toEqual({ allowed: false, reason: "recipient_not_eligible", remaining: 3 })
  })

  it("refuses a repeat send of the same job to the same recipient inside the dedupe window", () => {
    const deliveries = [delivered("hauler-1", "job-1", "2026-11-09T00:00:00.000Z")]
    const input = { cycle, deliveries, jobPostingId: "job-1", now: "2026-11-10T00:00:00.000Z", planCode: "pro" as const, recipient }

    expect(evaluateTargetedInvitation({ ...input, dedupeWindowMs: WEEK }))
      .toEqual({ allowed: false, reason: "duplicate_recipient_and_job", remaining: 9 })
    expect(evaluateTargetedInvitation({ ...input, dedupeWindowMs: 60_000 }))
      .toEqual({ allowed: true, remainingAfterSend: 8 })
    expect(evaluateTargetedInvitation({ ...input, dedupeWindowMs: WEEK, jobPostingId: "job-2" }))
      .toEqual({ allowed: true, remainingAfterSend: 8 })
  })

  it("supports the schema prototype's rule of one live invitation per job and recipient", () => {
    const deliveries = [delivered("hauler-1", "job-1", "2026-11-02T00:00:00.000Z")]
    const input = { cycle, deliveries, jobPostingId: "job-1", now: "2026-11-29T00:00:00.000Z", planCode: "regional" as const, recipient }

    expect(evaluateTargetedInvitation({ ...input, dedupeWindowMs: Number.POSITIVE_INFINITY }))
      .toEqual({ allowed: false, reason: "duplicate_recipient_and_job", remaining: 29 })
  })

  it("refuses when the allowance is exhausted or the send falls outside the cycle", () => {
    const used = ["a", "b", "c"].map((id) => delivered(id, "job-9", "2026-11-03T00:00:00.000Z"))

    expect(evaluateTargetedInvitation({
      cycle, deliveries: used, dedupeWindowMs: WEEK, jobPostingId: "job-1", now: "2026-11-10T00:00:00.000Z", planCode: "basic", recipient
    })).toEqual({ allowed: false, reason: "allowance_exhausted", remaining: 0 })
    expect(evaluateTargetedInvitation({
      cycle, deliveries: [], dedupeWindowMs: WEEK, jobPostingId: "job-1", now: "2026-12-01T00:00:00.000Z", planCode: "basic", recipient
    })).toMatchObject({ allowed: false, reason: "outside_billing_cycle" })
  })

  it("requires an explicit dedupe window and valid instants", () => {
    expect(() => evaluateTargetedInvitation({
      cycle, deliveries: [], dedupeWindowMs: -1, jobPostingId: "job-1", now: "2026-11-10T00:00:00.000Z", planCode: "basic", recipient
    })).toThrow(RangeError)
    expect(() => invitationsUsedInCycle([], { endsAt: "later", startsAt: cycle.startsAt })).toThrow(RangeError)
  })
})

describe("job boosts (§7)", () => {
  it("prices one posting at $99 / $149 / $199 for 7 / 14 / 28 days within ~100 miles, never auto-renewing", () => {
    expect(Object.values(BOOST_PACKAGES).map((boost) => [boost.code, boost.durationDays, boost.priceCents])).toEqual([
      ["campaign", 28, 19_900],
      ["extended", 14, 14_900],
      ["quick", 7, 9_900]
    ])
    expect(BOOST_RADIUS_MILES).toBe(100)
    expect(BOOST_AUTO_RENEWS).toBe(false)
  })

  it("runs for consecutive days from activation", () => {
    expect(boostWindow("quick", "2026-11-10T15:30:00.000Z"))
      .toEqual({ endsAt: "2026-11-17T15:30:00.000Z", startsAt: "2026-11-10T15:30:00.000Z" })
    expect(boostWindow("campaign", "2026-11-10T15:30:00.000Z").endsAt).toBe("2026-12-08T15:30:00.000Z")
  })
})

describe("founding programme (§8)", () => {
  it("charges 50% for the first six paid cycles, then the full price", () => {
    expect([1, 6, 7].map((n) => foundingOperatorCyclePriceCents("basic", n))).toEqual([7_450, 7_450, 14_900])
    expect(foundingOperatorCyclePriceCents("pro", 3)).toBe(14_950)
    expect(foundingOperatorCyclePriceCents("regional", 6)).toBe(24_950)
    expect(foundingOperatorCyclePriceCents("regional", 7)).toBe(49_900)
    expect(() => foundingOperatorCyclePriceCents("basic", 0)).toThrow(RangeError)
  })

  it("limits the offer to ten organizations per launched state, excludes boosts, and caps founding haulers at 1,000", () => {
    expect(FOUNDING_OPERATOR_OFFER).toMatchObject({ discountsBoosts: false, organizationsPerLaunchedState: 10 })
    expect(FOUNDING_HAULER_BADGE_LIMIT).toBe(1000)
  })
})
