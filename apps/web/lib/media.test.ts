import { createInMemoryDatabase } from "@logloads/db"
import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { ApiError } from "./api-actor"
import { mediaTarget } from "./media"
import type { SessionActor } from "./session"

function fixture() {
  const state = createInMemoryDatabase()
  const profile = state.profiles.find((candidate) => candidate.email === "hank@northpine.example")
  const driver = state.driverProfiles.find((candidate) => candidate.userId === profile?.id)
  const membership = state.organizationMemberships.find((candidate) =>
    candidate.userId === profile?.id && candidate.status === "active"
  )
  const organization = state.organizations.find((candidate) => candidate.id === membership?.organizationId)

  if (!profile || !driver || !membership || !organization) {
    throw new Error("The media authorization fixture is incomplete")
  }

  const actor: SessionActor = {
    activeMembership: membership,
    activeOrganization: organization,
    driverProfileId: driver.id,
    isPlatformAdmin: false,
    memberships: [{ membership, organization }],
    profile
  }

  return { actor, driver, organization, state }
}

describe("driver media authorization", () => {
  it("uses an organization-scoped target for the authenticated driver's profile and equipment", () => {
    const { actor, driver, organization, state } = fixture()
    const profile = mediaTarget(state, actor, organization.id, "profile")
    const truck = mediaTarget(state, actor, organization.id, "truck")
    const trailer = mediaTarget(state, actor, organization.id, "trailer")

    expect(profile.id).toBe(driver.id)
    expect(profile.publicIdPrefix).toBe(`logloads/${organization.id}/profile/${driver.id}`)
    expect(truck.publicIdPrefix).toMatch(new RegExp(`^logloads/${organization.id}/truck/`))
    expect(trailer.publicIdPrefix).toMatch(new RegExp(`^logloads/${organization.id}/trailer/`))
  })

  it("rejects media targets outside the actor's active memberships", () => {
    const { actor, state } = fixture()
    const otherOrganization = state.organizations.find((candidate) =>
      !actor.memberships.some((entry) => entry.organization.id === candidate.id)
    )

    expect(otherOrganization).toBeDefined()
    expect(() => mediaTarget(state, actor, otherOrganization!.id, "profile")).toThrow(ApiError)
  })
})
