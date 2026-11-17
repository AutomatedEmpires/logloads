import { describe, expect, it } from "vitest"

import { LANDING_PLANS, type MarketplacePlanAllowanceView } from "@logloads/contracts"

import { marketplaceBillingOverview } from "../billing"
import {
  INVITATION_REPLAY_WINDOW_MS,
  INVITE_ALREADY_INVITED,
  INVITE_NOT_ELIGIBLE,
  INVITE_NO_ALLOWANCE_LEFT,
  INVITE_NO_PLAN,
  INVITE_OWN_BUSINESS,
  classifyInvitationStoreRefusal,
  invitationAllowanceUse,
  invitationSendRefusal,
  planInvitationReply,
  planInvitationSend,
  type InvitationOnRecord
} from "./index"

const SENDER = "99999999-9999-4999-8999-999999999999"
const HAULER_A = "22222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const HAULER_B = "33333333-cccc-4ccc-8ccc-cccccccccccc"
const HAULER_C = "55555555-eeee-4eee-8eee-eeeeeeeeeeee"
const INV_1 = "44444444-dddd-4ddd-8ddd-000000000001"
const INV_2 = "44444444-dddd-4ddd-8ddd-000000000002"
const NOW = new Date("2026-11-11T18:00:00.000Z")

/** A Basic business within every cap, with `remaining` of its 3 invitations left. */
function allowance(remaining: number | null, overrides: Partial<MarketplacePlanAllowanceView> = {}): MarketplacePlanAllowanceView {
  return {
    activeLandings: 1,
    cycleEndsAt: "2026-12-01T00:00:00.000Z",
    fleetOnlyMembers: 0,
    graceEndsAt: null,
    invitationsRemaining: remaining,
    landingsOverCap: false,
    planCode: "basic",
    seatsOverCap: false,
    subscriptionStatus: "active",
    teamMembers: 2,
    ...overrides
  }
}

function overview(remaining: number | null, overrides: Partial<MarketplacePlanAllowanceView> = {}) {
  return marketplaceBillingOverview(allowance(remaining, overrides))
}

function onRecord(overrides: Partial<InvitationOnRecord> = {}): InvitationOnRecord {
  return {
    createdAt: new Date(NOW.getTime() - 60_000).toISOString(),
    invitationId: INV_1,
    recipientOrganizationId: HAULER_A,
    sentByViewer: true,
    status: "reserved",
    ...overrides
  }
}

describe("invitationSendRefusal: the billing read model decides, nothing is re-derived", () => {
  const basic = LANDING_PLANS.basic.targetedInvitationsPerCycle

  it("refuses with no plan", () => {
    const none = overview(null, { cycleEndsAt: null, planCode: null, subscriptionStatus: null })

    expect(none.invitations.state).toBe("no_plan")
    expect(invitationSendRefusal(none, 1)).toBe(INVITE_NO_PLAN)
  })

  it("refuses at 0 left, which is the cap fully used, naming the plan's allowance and the reset date", () => {
    const spent = overview(0)

    expect(spent.invitations.state).toBe("exhausted")
    expect(invitationSendRefusal(spent, 1)).toBe(
      `You've used all ${basic} targeted invitations this cycle. They reset on Dec 1, 2026. Replies and job posts stay unlimited.`
    )
  })

  it("refuses while over a cap with the read model's own resolution sentence", () => {
    const blocked = overview(2, { activeLandings: 2, landingsOverCap: true })

    expect(blocked.invitations.state).toBe("blocked")
    expect(invitationSendRefusal(blocked, 1)).toBe(blocked.overCap.resolutions.join(" "))
    expect(invitationSendRefusal(blocked, 1)).toContain("Pause 1 of them to publish jobs and send invitations again.")
  })

  it("allows 1 of 1 left and refuses 2", () => {
    expect(invitationSendRefusal(overview(1), 1)).toBeNull()
    expect(invitationSendRefusal(overview(1), 2)).toBe("You have 1 targeted invitation left this cycle. Choose 1 business or fewer.")
  })

  it("allows the whole allowance at once and refuses one more", () => {
    expect(invitationSendRefusal(overview(basic), basic)).toBeNull()
    expect(invitationSendRefusal(overview(basic), basic + 1))
      .toBe(`You have ${basic} targeted invitations left this cycle. Choose ${basic} businesses or fewer.`)
  })

  it("asks nothing of the balance when nothing new is sent (a retry that only replays)", () => {
    expect(invitationSendRefusal(overview(0), 0)).toBeNull()
    expect(invitationSendRefusal(overview(null, { planCode: null }), 0)).toBeNull()
  })
})

describe("planInvitationSend: one invitation per hauler per job, and a retry reserves nothing twice", () => {
  it("reserves each new business once, in the order chosen", () => {
    expect(planInvitationSend({ now: NOW, onRecord: [], recipients: [HAULER_A, HAULER_B, HAULER_A], senderOrganizationId: SENDER }))
      .toEqual({ refused: [], replayed: [], reserve: [HAULER_A, HAULER_B] })
  })

  it("never invites the sending business itself", () => {
    expect(planInvitationSend({ now: NOW, onRecord: [], recipients: [SENDER, HAULER_A], senderOrganizationId: SENDER }))
      .toEqual({ refused: [{ reason: INVITE_OWN_BUSINESS, recipientOrganizationId: SENDER }], replayed: [], reserve: [HAULER_A] })
  })

  it("gives a retry the invitation this person just reserved or delivered, instead of a second one", () => {
    const plan = planInvitationSend({
      now: NOW,
      onRecord: [onRecord(), onRecord({ invitationId: INV_2, recipientOrganizationId: HAULER_B, status: "delivered" })],
      recipients: [HAULER_A, HAULER_B, HAULER_C],
      senderOrganizationId: SENDER
    })

    expect(plan).toEqual({
      refused: [],
      replayed: [
        { invitationId: INV_1, recipientOrganizationId: HAULER_A },
        { invitationId: INV_2, recipientOrganizationId: HAULER_B }
      ],
      reserve: [HAULER_C]
    })
  })

  it("refuses a business a colleague's reservation still holds for this job", () => {
    expect(planInvitationSend({ now: NOW, onRecord: [onRecord({ sentByViewer: false })], recipients: [HAULER_A], senderOrganizationId: SENDER }))
      .toEqual({ refused: [{ reason: INVITE_ALREADY_INVITED, recipientOrganizationId: HAULER_A }], replayed: [], reserve: [] })
  })

  it("leaves older, failed and colleagues' delivered invitations to the store's own dedupe window", () => {
    const old = new Date(NOW.getTime() - INVITATION_REPLAY_WINDOW_MS - 1).toISOString()
    const plan = planInvitationSend({
      now: NOW,
      onRecord: [
        onRecord({ createdAt: old, status: "delivered" }),
        onRecord({ invitationId: INV_2, recipientOrganizationId: HAULER_B, status: "failed" }),
        onRecord({ recipientOrganizationId: HAULER_C, sentByViewer: false, status: "delivered" })
      ],
      recipients: [HAULER_A, HAULER_B, HAULER_C],
      senderOrganizationId: SENDER
    })

    expect(plan).toEqual({ refused: [], replayed: [], reserve: [HAULER_A, HAULER_B, HAULER_C] })
  })

  it("replays the newest of several of this person's live invitations", () => {
    const plan = planInvitationSend({
      now: NOW,
      onRecord: [
        onRecord({ createdAt: new Date(NOW.getTime() - 120_000).toISOString(), invitationId: INV_1, status: "failed" }),
        onRecord({ createdAt: new Date(NOW.getTime() - 30_000).toISOString(), invitationId: INV_2 })
      ],
      recipients: [HAULER_A],
      senderOrganizationId: SENDER
    })

    expect(plan.replayed).toEqual([{ invitationId: INV_2, recipientOrganizationId: HAULER_A }])
  })
})

describe("classifyInvitationStoreRefusal", () => {
  it("keeps a recipient's refusal to that recipient", () => {
    expect(classifyInvitationStoreRefusal("recipient organization is not currently eligible or opted in for this job", "23514"))
      .toEqual({ reason: INVITE_NOT_ELIGIBLE, scope: "recipient" })
    expect(classifyInvitationStoreRefusal("recipient has no active delivery channels", "23514"))
      .toEqual({ reason: "This business can't receive invitations right now.", scope: "recipient" })
    expect(classifyInvitationStoreRefusal("This changed at the same time as another update. Reload and try again.", "23505"))
      .toEqual({ reason: INVITE_ALREADY_INVITED, scope: "recipient" })
  })

  it("stops the send when the allowance runs out under a concurrent sender", () => {
    expect(classifyInvitationStoreRefusal("monthly targeted invitation allowance exhausted (no overage or rollover)", "23514"))
      .toEqual({ reason: INVITE_NO_ALLOWANCE_LEFT, scope: "allowance" })
  })

  it("stops the send for a refusal about the sender or the job", () => {
    expect(classifyInvitationStoreRefusal("job posting must be active to send invitations", "23514").scope).toBe("send")
    expect(classifyInvitationStoreRefusal("no active billing-cycle entitlement period for organization", "23514"))
      .toEqual({ reason: INVITE_NO_PLAN, scope: "send" })
    expect(classifyInvitationStoreRefusal("only organization owners or managers with a Landing Operator seat may send targeted invitations", "42501"))
      .toEqual({ reason: "Only an owner or a manager with a Landing Operator seat can send targeted invitations.", scope: "send" })
    expect(classifyInvitationStoreRefusal("organization has 3 paid landing seats which exceeds plan Basic limit of 2; resolve seat conflict before sending invitations", "23514").scope)
      .toBe("send")
  })

  it("never echoes the store's wording for anything it does not recognise", () => {
    const unknown = classifyInvitationStoreRefusal("new row for relation \"targeted_invitations\" violates check constraint \"x\"", "23514")

    expect(unknown).toEqual({ reason: "This business couldn't be invited. Try again later.", scope: "recipient" })
  })
})

describe("planInvitationReply: an answer is recorded exactly once", () => {
  it("records the first Interested or Not now", () => {
    expect(planInvitationReply("none", "interested")).toEqual({ outcome: "record" })
    expect(planInvitationReply("viewed", "declined")).toEqual({ outcome: "record" })
  })

  it("treats the same answer again as already done (a retried tap)", () => {
    expect(planInvitationReply("interested", "interested")).toEqual({ outcome: "unchanged" })
    expect(planInvitationReply("declined", "declined")).toEqual({ outcome: "unchanged" })
  })

  it("refuses to change an answer", () => {
    expect(planInvitationReply("declined", "interested")).toEqual({
      message: "You already answered this invitation. You can still send interest from the job itself.",
      outcome: "refused"
    })
    expect(planInvitationReply("interested", "declined").outcome).toBe("refused")
  })

  it("marks viewed only once, and never over an answer", () => {
    expect(planInvitationReply("none", "viewed")).toEqual({ outcome: "record" })
    expect(planInvitationReply("viewed", "viewed")).toEqual({ outcome: "unchanged" })
    expect(planInvitationReply("interested", "viewed")).toEqual({ outcome: "unchanged" })
    expect(planInvitationReply("declined", "viewed")).toEqual({ outcome: "unchanged" })
  })
})

describe("invitationAllowanceUse: what one invitation does to the sender's allowance", () => {
  it("holds a unit while reserved, uses it once delivered, and returns it when delivery failed or was suppressed", () => {
    expect(invitationAllowanceUse("reserved")).toBe("held")
    expect(invitationAllowanceUse("delivered")).toBe("used")
    expect(invitationAllowanceUse("failed")).toBe("returned")
    expect(invitationAllowanceUse("suppressed")).toBe("returned")
  })
})
