import { describe, expect, it } from "vitest"

import { seedDatabaseState } from "@logloads/db"

import { createTruckSlot } from "./truck-slots"

function freshState() {
  return structuredClone(seedDatabaseState)
}

function anyPosting(state: ReturnType<typeof freshState>) {
  const posting = state.loadPostings[0]

  if (!posting) {
    throw new Error("seed has no load posting to test against")
  }

  return posting
}

/** An active member of the posting's organization holding the given role. */
function memberWithRole(state: ReturnType<typeof freshState>, organizationId: string, role: string) {
  const membership = state.organizationMemberships.find(
    (entry) => entry.organizationId === organizationId && entry.status === "active"
  )

  if (!membership) {
    throw new Error(`seed has no active member of ${organizationId}`)
  }

  membership.role = role as typeof membership.role

  return membership.userId
}

function slotInput(loadPostingId: string, landingId: string) {
  return {
    capacity: 2,
    endAt: "2026-08-01T21:00:00.000Z",
    landingId,
    loadPostingId,
    slotDate: "2026-08-01",
    startAt: "2026-08-01T13:00:00.000Z",
    status: "open" as const
  }
}

describe("createTruckSlot authorization", () => {
  it("lets a member who may publish add a slot to their own posting", () => {
    const state = freshState()
    const posting = anyPosting(state)
    const actorUserId = memberWithRole(state, posting.companyId, "owner")
    const before = state.truckSlots.length

    const slot = createTruckSlot(state, slotInput(posting.id, posting.pickupLandingId), {
      actorUserId,
      organizationId: posting.companyId
    })

    expect(slot.loadPostingId).toBe(posting.id)
    expect(state.truckSlots.length).toBe(before + 1)
  })

  it("refuses a caller whose organization does not own the posting", () => {
    // The route only verified membership in the org the CALLER named, never
    // that the posting belonged to it — so naming your own organization while
    // passing a stranger's loadPostingId was accepted.
    const state = freshState()
    const posting = anyPosting(state)
    const outsider = state.organizations.find((org) => org.id !== posting.companyId)

    expect(outsider).toBeDefined()

    const actorUserId = memberWithRole(state, outsider!.id, "owner")
    const before = state.truckSlots.length

    expect(() =>
      createTruckSlot(state, slotInput(posting.id, posting.pickupLandingId), {
        actorUserId,
        organizationId: outsider!.id
      })
    ).toThrow(/another organization/i)

    // A refusal that still wrote would be worse than no check at all.
    expect(state.truckSlots.length).toBe(before)
  })

  it("refuses a viewer of the owning organization", () => {
    // Belonging is not permission. viewer holds only view_network and maps to
    // no cockpit anywhere, so it must not be able to publish capacity even on
    // its own organization's posting.
    const state = freshState()
    const posting = anyPosting(state)
    const actorUserId = memberWithRole(state, posting.companyId, "viewer")
    const before = state.truckSlots.length

    expect(() =>
      createTruckSlot(state, slotInput(posting.id, posting.pickupLandingId), {
        actorUserId,
        organizationId: posting.companyId
      })
    ).toThrow(/cannot publish load/i)

    expect(state.truckSlots.length).toBe(before)
  })

  it("refuses a posting that does not exist rather than creating an orphan slot", () => {
    const state = freshState()
    const posting = anyPosting(state)
    const actorUserId = memberWithRole(state, posting.companyId, "owner")
    const before = state.truckSlots.length

    expect(() =>
      createTruckSlot(state, slotInput("00000000-0000-4000-8000-000000000000", posting.pickupLandingId), {
        actorUserId,
        organizationId: posting.companyId
      })
    ).toThrow(/not found/i)

    expect(state.truckSlots.length).toBe(before)
  })
})
