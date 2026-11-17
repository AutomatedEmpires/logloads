import { LANDING_PLANS } from "@logloads/contracts"
import { describe, expect, it } from "vitest"

import {
  orderTeamInvitations,
  orderTeamMembers,
  planTeamInvite,
  planTeamRemoval,
  planTeamResend,
  planTeamScope,
  teamSeatSituation
} from "./seats"

const NOW = new Date("2026-11-17T18:00:00.000Z")
const LANDING = "11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const MEMBER = "22222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb"

const empty = {
  pendingEmails: [] as string[],
  pendingInvitations: 0,
  pendingSeatedInvitations: 0,
  planCode: "basic" as const,
  seatedMembers: 1
}

describe("planTeamInvite", () => {
  it("uses the plan's seat limit, including the owner, and holds a seat for a pending invitation", () => {
    expect(LANDING_PLANS.basic.teamSeatLimit).toBe(2)
    expect(LANDING_PLANS.pro.teamSeatLimit).toBe(5)
    expect(LANDING_PLANS.regional.teamSeatLimit).toBe(10)

    const held = planTeamInvite(
      { email: "rae@example.test", landingWorkspaceSeat: true, role: "staff" },
      { ...empty, pendingSeatedInvitations: 1 }
    )

    expect(held.ok).toBe(false)
    if (!held.ok) {
      expect(held.code).toBe("23514")
      expect(held.message).toMatch(/Basic allows 2 people/)
      expect(held.message).toMatch(/pending invitation holds a seat/)
    }

    const room = planTeamInvite(
      { email: "rae@example.test", landingWorkspaceSeat: true, role: "manager", validForDays: 1 },
      empty
    )

    expect(room).toMatchObject({ ok: true, value: { email: "rae@example.test", validFor: "1 day" } })
  })

  it("lets a fleet-only driver in when the landing seats are full, and applies no cap without a plan", () => {
    const full = { ...empty, seatedMembers: 2 }

    expect(planTeamInvite({ email: "rae@example.test", landingWorkspaceSeat: false, role: "driver" }, full)).toMatchObject({
      ok: true,
      value: { landingWorkspaceSeat: false, validFor: "14 days" }
    })
    expect(planTeamInvite(
      { email: "rae@example.test", landingWorkspaceSeat: true, role: "staff" },
      { ...full, planCode: null }
    )).toMatchObject({ ok: true })
  })

  it("refuses a second open invitation to the same address and a 51st open invitation", () => {
    expect(planTeamInvite(
      { email: "rae@example.test", landingWorkspaceSeat: false, role: "driver" },
      { ...empty, pendingEmails: ["rae@example.test"], pendingInvitations: 1 }
    )).toMatchObject({ code: "23505", ok: false })
    expect(planTeamInvite(
      { email: "rae@example.test", landingWorkspaceSeat: false, role: "driver" },
      { ...empty, pendingInvitations: 50, planCode: null, seatedMembers: 0 }
    )).toMatchObject({ code: "23514", ok: false })
  })

  it("counts seats from members and open invitations the way the store does", () => {
    expect(teamSeatSituation(
      [
        { landingWorkspaceSeat: true, status: "active" },
        { landingWorkspaceSeat: true, status: "suspended" },
        { landingWorkspaceSeat: false, status: "active" }
      ],
      [
        { email: "rae@example.test", landingWorkspaceSeat: true, status: "pending" },
        { email: "old@example.test", landingWorkspaceSeat: true, status: "expired" }
      ]
    )).toEqual({
      pendingEmails: ["rae@example.test"],
      pendingInvitations: 1,
      pendingSeatedInvitations: 1,
      seatedMembers: 1
    })
  })
})

describe("planTeamResend, removal and scope", () => {
  it("allows a fourth resend and refuses the fifth", () => {
    const open = { expiresAt: "2026-11-20T00:00:00.000Z", sendCount: 4, status: "pending" }

    expect(planTeamResend(open, NOW)).toEqual({ ok: true, value: { validFor: null } })
    expect(planTeamResend({ ...open, sendCount: 5 }, NOW)).toMatchObject({ code: "23514", ok: false })
    expect(planTeamResend({ ...open, expiresAt: "2026-11-17T18:00:00.000Z" }, NOW)).toMatchObject({ code: "55000", ok: false })
    expect(planTeamResend(null, NOW)).toMatchObject({ code: "42501", ok: false })
  })

  it("keeps the last active owner and lets any other member be removed", () => {
    const owner = { landingWorkspaceSeat: true, role: "owner", status: "active" }

    expect(planTeamRemoval(owner, 1)).toMatchObject({ code: "23514", message: expect.stringMatching(/at least one owner/), ok: false })
    expect(planTeamRemoval(owner, 2)).toEqual({ ok: true, value: { remove: true } })
    expect(planTeamRemoval({ landingWorkspaceSeat: false, role: "driver", status: "active" }, 1)).toEqual({ ok: true, value: { remove: true } })
    expect(planTeamRemoval(null, 1)).toEqual({ ok: true, value: { remove: true } })
  })

  it("limits landing scope to a seated manager or staff member", () => {
    const staff = { landingWorkspaceSeat: true, role: "staff", status: "active" }

    expect(planTeamScope({ landingIds: [LANDING, LANDING], membershipId: MEMBER }, staff)).toEqual({
      ok: true,
      value: { landingIds: [LANDING], membershipId: MEMBER }
    })
    expect(planTeamScope({ landingIds: [LANDING], membershipId: MEMBER }, { ...staff, role: "owner" })).toMatchObject({ code: "22023", ok: false })
    expect(planTeamScope({ landingIds: [], membershipId: MEMBER }, { ...staff, role: "owner" })).toMatchObject({ ok: true })
    expect(planTeamScope({ landingIds: [], membershipId: MEMBER }, { ...staff, status: "removed" })).toMatchObject({ code: "55000", ok: false })
  })
})

describe("team ordering", () => {
  it("lists owners first, then names, and pending invitations before older closed ones", () => {
    expect(orderTeamMembers([
      { membershipId: "b", name: "Ana", role: "staff" },
      { membershipId: "a", name: "Zoe", role: "owner" }
    ]).map((member) => member.name)).toEqual(["Zoe", "Ana"])

    expect(orderTeamInvitations([
      { createdAt: "2026-11-01T00:00:00.000Z", id: "old", status: "revoked" },
      { createdAt: "2026-11-02T00:00:00.000Z", id: "newer", status: "pending" },
      { createdAt: "2026-11-03T00:00:00.000Z", id: "newest-closed", status: "declined" }
    ]).map((invitation) => invitation.id)).toEqual(["newer", "newest-closed", "old"])
  })
})
