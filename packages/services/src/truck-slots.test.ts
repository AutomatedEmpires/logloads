import { describe, expect, it } from "vitest"

import type { OpportunityCapacity } from "@logloads/contracts"
import { seedDatabaseState } from "@logloads/db"

import { createTruckSlot, listTruckSlotsForDate } from "./truck-slots"

function freshState() {
  return structuredClone(seedDatabaseState)
}

/**
 * A seeded posting offered under the given visibility mode. Typing the mode
 * against the contract keeps this selector honest if the schema's modes change.
 */
function postingOffered(
  state: ReturnType<typeof freshState>,
  visibilityMode: OpportunityCapacity["visibilityMode"]
) {
  const capacity = state.opportunityCapacities.find((entry) => entry.visibilityMode === visibilityMode)

  if (!capacity) {
    throw new Error(`seed has no ${visibilityMode} capacity to test against`)
  }

  const posting = state.loadPostings.find((entry) => entry.id === capacity.loadPostingId)

  if (!posting) {
    throw new Error(`seed capacity ${capacity.id} names a posting that does not exist`)
  }

  return posting
}

/**
 * Turns another organization into a stranger of the host by removing every
 * connection the operating record could grant it. The fixture is the point of
 * the test: with no relationship and no offer, nothing but the platform's open
 * work may reach this caller.
 */
function unrelatedOrganizationId(state: ReturnType<typeof freshState>, hostOrganizationId: string) {
  const outsider = state.organizations.find((organization) => organization.id !== hostOrganizationId)

  if (!outsider) {
    throw new Error("seed has no second organization to test against")
  }

  state.privateNetworkRelationships = state.privateNetworkRelationships.filter(
    (relationship) =>
      relationship.ownerOrganizationId !== outsider.id && relationship.partnerOrganizationId !== outsider.id
  )
  state.directOffers = state.directOffers.filter((offer) => offer.offeredToOrganizationId !== outsider.id)

  return outsider.id
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

describe("listTruckSlotsForDate scope", () => {
  it("returns nothing to an organization the host has no relationship with", () => {
    const state = freshState()
    const posting = postingOffered(state, "private_network")
    const outsiderId = unrelatedOrganizationId(state, posting.companyId)
    const actorUserId = memberWithRole(state, posting.companyId, "owner")

    const slot = createTruckSlot(state, slotInput(posting.id, posting.pickupLandingId), {
      actorUserId,
      organizationId: posting.companyId
    })

    // Same state, same date: the host's own day is populated, so an empty result
    // for the stranger is the scope working rather than the date being wrong.
    expect(listTruckSlotsForDate(state, slot.slotDate, posting.companyId).map((entry) => entry.id)).toEqual([
      slot.id
    ])
    expect(listTruckSlotsForDate(state, slot.slotDate, outsiderId)).toEqual([])
  })

  it("still returns slots on work the host opened to the whole network", () => {
    const state = freshState()
    const posting = postingOffered(state, "open_network")
    const outsiderId = unrelatedOrganizationId(state, posting.companyId)
    const openSlot = state.truckSlots.find((slot) => slot.loadPostingId === posting.id)

    expect(openSlot).toBeDefined()

    // A scope that returned nothing to everyone would pass the test above and
    // silently break hauling, so the open case has to keep working.
    expect(listTruckSlotsForDate(state, openSlot!.slotDate, outsiderId).map((entry) => entry.id)).toContain(
      openSlot!.id
    )
  })

  it("reads at the public scope when no organization is named", () => {
    const state = freshState()
    const openPosting = postingOffered(state, "open_network")
    const privatePosting = postingOffered(state, "private_network")
    const openSlot = state.truckSlots.find((slot) => slot.loadPostingId === openPosting.id)
    const privateSlot = state.truckSlots.find((slot) => slot.loadPostingId === privatePosting.id)

    expect(openSlot).toBeDefined()
    expect(privateSlot).toBeDefined()

    // The services facade binds this function with a date alone. Such a caller
    // has named no membership, so it must see open work and nothing else — a
    // default of "the demo organization" would leak that organization's private
    // loading windows to every unscoped caller.
    const publicIds = listTruckSlotsForDate(state, openSlot!.slotDate).map((entry) => entry.id)

    expect(publicIds).toContain(openSlot!.id)
    expect(listTruckSlotsForDate(state, privateSlot!.slotDate).map((entry) => entry.id)).not.toContain(
      privateSlot!.id
    )
  })
})
