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
  it("lets the owning organization add a slot to its own posting", () => {
    const state = freshState()
    const posting = anyPosting(state)
    const before = state.truckSlots.length

    const slot = createTruckSlot(state, slotInput(posting.id, posting.pickupLandingId), {
      organizationId: posting.companyId
    })

    expect(slot.loadPostingId).toBe(posting.id)
    expect(state.truckSlots.length).toBe(before + 1)
  })

  it("refuses a caller whose organization does not own the posting", () => {
    // The gap this closes: the route only verified membership in the org the
    // CALLER named, never that the posting belonged to it — so naming your own
    // organization while passing a stranger's loadPostingId was accepted.
    const state = freshState()
    const posting = anyPosting(state)
    const outsider = state.organizations.find((org) => org.id !== posting.companyId)

    expect(outsider).toBeDefined()

    const before = state.truckSlots.length

    expect(() =>
      createTruckSlot(state, slotInput(posting.id, posting.pickupLandingId), {
        organizationId: outsider!.id
      })
    ).toThrow(/another organization/i)

    // A refusal that still wrote would be worse than no check at all.
    expect(state.truckSlots.length).toBe(before)
  })

  it("refuses a posting that does not exist rather than creating an orphan slot", () => {
    const state = freshState()
    const posting = anyPosting(state)
    const before = state.truckSlots.length

    expect(() =>
      createTruckSlot(state, slotInput("00000000-0000-4000-8000-000000000000", posting.pickupLandingId), {
        organizationId: posting.companyId
      })
    ).toThrow(/not found/i)

    expect(state.truckSlots.length).toBe(before)
  })
})
