import { describe, expect, it } from "vitest"

import { LANDING_PLANS } from "../../membership"
import {
  MARKETPLACE_INVITATION_ANSWER_LABELS,
  MARKETPLACE_INVITATION_ANSWERS,
  MARKETPLACE_INVITATION_MAX_RECIPIENTS,
  MARKETPLACE_INVITATION_RESPONSES,
  marketplaceInvitationIdSchema,
  marketplaceInvitationReplyInputSchema,
  marketplaceInvitationSendInputSchema
} from "./index"

const JOB = "11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const HAULER_A = "22222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const HAULER_B = "33333333-cccc-4ccc-8ccc-cccccccccccc"
const INVITATION = "44444444-dddd-4ddd-8ddd-dddddddddddd"

function send(overrides: Record<string, unknown> = {}) {
  return { jobId: JOB, note: "Two trucks Monday", recipientOrganizationIds: [HAULER_A], requestId: "req-2026-11-11-0001", ...overrides }
}

describe("targeted invitation answers", () => {
  it("are Interested or Not now, never a hire", () => {
    expect(MARKETPLACE_INVITATION_ANSWERS).toEqual(["interested", "declined"])
    expect(MARKETPLACE_INVITATION_ANSWER_LABELS).toEqual({ declined: "Not now", interested: "Interested" })
    expect(MARKETPLACE_INVITATION_RESPONSES).toEqual(["none", "viewed", "interested", "declined"])
  })
})

describe("marketplaceInvitationSendInputSchema", () => {
  it("caps recipients at the largest plan allowance in LANDING_PLANS, never a number of its own", () => {
    expect(MARKETPLACE_INVITATION_MAX_RECIPIENTS).toBe(Math.max(...Object.values(LANDING_PLANS).map((plan) => plan.targetedInvitationsPerCycle)))
  })

  it("keeps each business once, in the order chosen, whatever the case of its id", () => {
    const parsed = marketplaceInvitationSendInputSchema.parse(send({
      recipientOrganizationIds: [HAULER_A, HAULER_B.toUpperCase(), HAULER_A.toUpperCase(), HAULER_B]
    }))

    expect(parsed.recipientOrganizationIds).toEqual([HAULER_A, HAULER_B])
  })

  it("trims the note and stores a blank one as none", () => {
    expect(marketplaceInvitationSendInputSchema.parse(send({ note: "  Fir haul  " })).note).toBe("Fir haul")
    expect(marketplaceInvitationSendInputSchema.parse(send({ note: "   " })).note).toBeNull()
    expect(marketplaceInvitationSendInputSchema.parse(send({ note: null })).note).toBeNull()
    expect(marketplaceInvitationSendInputSchema.safeParse(send({ note: "x".repeat(501) })).success).toBe(false)
    expect(marketplaceInvitationSendInputSchema.safeParse(send({ note: "x".repeat(500) })).success).toBe(true)
  })

  it("refuses an empty or oversized selection, a bad id, a missing request id and unknown fields", () => {
    const refused = [
      send({ recipientOrganizationIds: [] }),
      send({ recipientOrganizationIds: Array.from({ length: MARKETPLACE_INVITATION_MAX_RECIPIENTS + 1 }, (_, index) =>
        `22222222-bbbb-4bbb-8bbb-${String(index).padStart(12, "0")}`) }),
      send({ recipientOrganizationIds: ["not-a-uuid"] }),
      send({ jobId: "job-1" }),
      send({ requestId: "" }),
      send({ requestId: "short" }),
      send({ requestId: "has spaces in it" }),
      send({ requestId: "x".repeat(101) }),
      send({ sendAs: "another-business" })
    ]

    for (const input of refused) {
      expect(marketplaceInvitationSendInputSchema.safeParse(input).success).toBe(false)
    }

    const withoutRequestId: Record<string, unknown> = send()
    delete withoutRequestId.requestId
    expect(marketplaceInvitationSendInputSchema.safeParse(withoutRequestId).success).toBe(false)
  })

  it("accepts a UUID or a slug-like request id", () => {
    expect(marketplaceInvitationSendInputSchema.parse(send({ requestId: INVITATION })).requestId).toBe(INVITATION)
    expect(marketplaceInvitationSendInputSchema.parse(send({ requestId: "compose_7f3a-01" })).requestId).toBe("compose_7f3a-01")
  })

  it("explains a bad selection in words a person can act on", () => {
    const parsed = marketplaceInvitationSendInputSchema.safeParse(send({ recipientOrganizationIds: [] }))

    expect(parsed.success).toBe(false)
    expect(parsed.success ? "" : parsed.error.issues[0]?.message).toBe("Choose at least one business to invite.")
  })
})

describe("marketplaceInvitationReplyInputSchema", () => {
  it("takes viewed, interested or declined for one invitation", () => {
    for (const response of ["viewed", "interested", "declined"] as const) {
      expect(marketplaceInvitationReplyInputSchema.parse({ invitationId: INVITATION, response })).toEqual({ invitationId: INVITATION, response })
    }
  })

  it("refuses none, a hire, a bad id and unknown fields", () => {
    for (const input of [
      { invitationId: INVITATION, response: "none" },
      { invitationId: INVITATION, response: "hired" },
      { invitationId: "inv-1", response: "interested" },
      { invitationId: INVITATION, response: "interested", shareContact: true }
    ]) {
      expect(marketplaceInvitationReplyInputSchema.safeParse(input).success).toBe(false)
    }
  })

  it("normalizes the invitation id", () => {
    expect(marketplaceInvitationIdSchema.parse(INVITATION.toUpperCase())).toBe(INVITATION)
  })
})
