import { createInMemoryDatabase } from "@logloads/db"
import { describe, expect, it } from "vitest"

import { DEMO_EMAIL_SIGN_IN_ALLOWLIST, DEMO_PERSONAS, isDemoSignInEmail } from "./demo-personas"
import {
  canAccessCockpit,
  homePathFor,
  homePathForMembership,
  restrictedAccessRecoveryPath,
  selectedSessionMembership,
  type SessionActor
} from "./session-policy"

const state = createInMemoryDatabase()

function actorFor(email: string, organizationId?: string): SessionActor {
  const profile = state.profiles.find((candidate) => candidate.email === email)

  if (!profile) throw new Error(`Missing seeded profile: ${email}`)

  const memberships = state.organizationMemberships
    .filter((membership) => membership.userId === profile.id && membership.status === "active")
    .flatMap((membership) => {
      const organization = state.organizations.find((candidate) => candidate.id === membership.organizationId)

      const driverProfileId = state.driverProfiles.find(
        (candidate) =>
          candidate.userId === profile.id &&
          candidate.companyId === membership.organizationId
      )?.id ?? null

      return organization ? [{ driverProfileId, membership, organization }] : []
    })
  const active = memberships.find((entry) => entry.organization.id === organizationId) ?? memberships[0] ?? null

  return {
    activeMembership: active?.membership ?? null,
    activeOrganization: active?.organization ?? null,
    driverProfileId: active?.driverProfileId ?? null,
    isPlatformAdmin: profile.role === "admin",
    memberships,
    profile
  }
}

describe("membership-driven cockpit routing", () => {
  it("does not fall through to another workspace when an exact signed selection is unavailable", () => {
    const actor = actorFor("hank@northpine.example")
    const selected = actor.memberships[0]

    expect(selected).toBeDefined()
    expect(
      selectedSessionMembership(actor.memberships, selected!.organization.id)
    ).toBe(selected)
    expect(
      selectedSessionMembership(
        actor.memberships,
        "99999999-9999-4999-8999-999999999999"
      )
    ).toBeNull()
    expect(selectedSessionMembership(actor.memberships, null)).toBe(selected)
  })

  it("does not loop or silently switch when a selected workspace was revoked", () => {
    const multiWorkspaceActor = actorFor("dispatch@northpine.example")

    expect(multiWorkspaceActor.memberships.length).toBeGreaterThan(1)

    const revokedSelection: SessionActor = {
      ...multiWorkspaceActor,
      activeMembership: null,
      activeOrganization: null,
      driverProfileId: null
    }

    expect(homePathFor(revokedSelection)).toBe("/access-restricted")
    expect(restrictedAccessRecoveryPath(revokedSelection)).toBeNull()
    expect(restrictedAccessRecoveryPath(multiWorkspaceActor)).toBe(
      "/fleet/command"
    )
  })

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

  it("routes a newly accepted invitation from its persisted membership facts", () => {
    expect(homePathForMembership("landing_source", "landing_manager")).toBe("/host/command")
    expect(homePathForMembership("destination", "billing")).toBe("/host/command")
    expect(homePathForMembership("fleet", "dispatcher")).toBe("/fleet/command")
    expect(homePathForMembership("carrier", "driver")).toBe("/driver/map")
    expect(homePathForMembership("fleet", "landing_manager")).toBe("/")
  })

  it("recovers an incompatible legacy landing-manager membership without a redirect loop", () => {
    const lee = actorFor("loader@northpine.example")

    expect(canAccessCockpit(lee, "fleet")).toBe(false)
    expect(canAccessCockpit(lee, "host")).toBe(false)
    expect(homePathFor(lee)).toBe("/access-restricted")
  })

  it("never revives Driver from a historical profile after membership revocation", () => {
    const hank = actorFor("hank@northpine.example")
    const revoked = {
      ...hank,
      activeMembership: null,
      activeOrganization: null,
      driverProfileId: null,
      memberships: []
    }

    expect(canAccessCockpit(revoked, "driver")).toBe(false)
    expect(homePathFor(revoked)).toBe("/access-restricted")
  })

  it("keeps demo email sign-in limited to identities with a valid cockpit recovery path", () => {
    expect(new Set(DEMO_EMAIL_SIGN_IN_ALLOWLIST).size).toBe(DEMO_EMAIL_SIGN_IN_ALLOWLIST.length)
    expect(DEMO_PERSONAS.every((persona) => isDemoSignInEmail(persona.email))).toBe(true)
    expect(isDemoSignInEmail("MAYA@NORTHPINE.EXAMPLE")).toBe(true)
    expect(isDemoSignInEmail("loader@northpine.example")).toBe(false)

    for (const email of DEMO_EMAIL_SIGN_IN_ALLOWLIST) {
      expect(["/admin", "/driver/map", "/fleet/command", "/host/command"], email)
        .toContain(homePathFor(actorFor(email)))
    }
  })
})
