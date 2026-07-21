import { createInMemoryDatabase } from "@logloads/db"
import { describe, expect, it } from "vitest"

import { canAccessCockpit, homePathFor, type SessionActor } from "./session-policy"

const state = createInMemoryDatabase()

function actorFor(email: string, organizationId?: string): SessionActor {
  const profile = state.profiles.find((candidate) => candidate.email === email)

  if (!profile) throw new Error(`Missing seeded profile: ${email}`)

  const memberships = state.organizationMemberships
    .filter((membership) => membership.userId === profile.id && membership.status === "active")
    .flatMap((membership) => {
      const organization = state.organizations.find((candidate) => candidate.id === membership.organizationId)

      return organization ? [{ membership, organization }] : []
    })
  const active = memberships.find((entry) => entry.organization.id === organizationId) ?? memberships[0] ?? null
  const driverProfile = state.driverProfiles.find((candidate) => candidate.userId === profile.id)

  return {
    activeMembership: active?.membership ?? null,
    activeOrganization: active?.organization ?? null,
    driverProfileId: driverProfile?.id ?? null,
    isPlatformAdmin: profile.role === "admin",
    memberships,
    profile
  }
}

describe("membership-driven cockpit routing", () => {
  it("opens Cole in Host even though he also has a driver profile", () => {
    const cole = actorFor("cole@summit.example")

    expect(canAccessCockpit(cole, "host")).toBe(true)
    expect(canAccessCockpit(cole, "driver")).toBe(true)
    expect(homePathFor(cole)).toBe("/host/command")
  })

  it("opens canonical driver, fleet, and admin personas in their granted cockpits", () => {
    expect(homePathFor(actorFor("hank@northpine.example"))).toBe("/driver/map")
    expect(homePathFor(actorFor("dispatch@northpine.example"))).toBe("/fleet/command")
    expect(homePathFor(actorFor("admin@logloads.example"))).toBe("/admin")
    expect(homePathFor(actorFor("emptyfleet@logloads.example"))).toBe("/fleet/command")
  })

  it("recovers an incompatible legacy landing-manager membership without a redirect loop", () => {
    const lee = actorFor("loader@northpine.example")

    expect(canAccessCockpit(lee, "fleet")).toBe(false)
    expect(canAccessCockpit(lee, "host")).toBe(false)
    expect(homePathFor(lee)).toBe("/")
  })
})
