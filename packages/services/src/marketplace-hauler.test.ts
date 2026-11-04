import { HAULER_PUBLIC_PROFILE_KEYS, type HaulerProfileInput, type HaulerProfileView } from "@logloads/contracts"
import { describe, expect, it } from "vitest"

import {
  HAULER_IDENTITY_EDIT_REFUSED,
  HAULER_PROFILE_EDIT_REFUSED,
  HAULER_PROFILE_NOT_HAULING,
  haulerSetupChecklist,
  pilotHaulerProfile,
  planHaulerProfileSave,
  publicHaulerProfile
} from "./marketplace-hauler"
import { createInMemoryDatabase } from "@logloads/db"

const PRIVATE = { acceptsInvitations: true, legalName: "Ridgeline Hauling Holdings LLC (private)", listed: true }

function profile(overrides: Partial<HaulerProfileView> = {}): HaulerProfileView {
  return {
    about: "Two log trucks out of Sweet Home.",
    businessName: "Ridgeline Hauling",
    canEditIdentity: true,
    canEditProfile: true,
    homeBase: "Sweet Home, OR",
    organizationId: "33333333-bbbb-4bbb-8bbb-333333333333",
    serviceRadiusMiles: 100,
    updatedAt: "2026-11-03T12:00:00.000Z",
    verification: { reviewedOn: "2026-10-12", scope: "business_identity" },
    ...PRIVATE,
    ...overrides
  }
}

function input(overrides: Partial<HaulerProfileInput> = {}): HaulerProfileInput {
  const current = profile()
  return {
    about: current.about,
    acceptsInvitations: current.acceptsInvitations,
    businessName: current.businessName,
    homeBase: current.homeBase,
    legalName: current.legalName,
    listed: current.listed,
    serviceRadiusMiles: current.serviceRadiusMiles,
    ...overrides
  }
}

describe("publicHaulerProfile", () => {
  it("copies exactly the public fields; private fields and settings never reach it", () => {
    const view = publicHaulerProfile(profile(), [
      { configurationKey: "log_truck|pole_trailer", label: "Log truck + Pole trailer", unitsListed: 2 },
      { configurationKey: "chip_truck", label: "Chip truck", unitsListed: 0 }
    ])

    expect(Object.keys(view).sort()).toEqual([...HAULER_PUBLIC_PROFILE_KEYS].sort())
    expect(view.equipment).toEqual([{ label: "Log truck + Pole trailer", units: 2 }])
    expect(JSON.stringify(view)).not.toContain(PRIVATE.legalName)
    for (const key of ["legalName", "listed", "acceptsInvitations", "canEditProfile", "canEditIdentity", "updatedAt"]) {
      expect(view).not.toHaveProperty(key)
    }
  })
})

describe("planHaulerProfileSave", () => {
  it("lets an owner change everything, and says when a verified business's legal name re-opens review", () => {
    expect(planHaulerProfileSave(profile(), input({ about: "New" }))).toEqual({ identityChanged: false, reopensVerification: false })
    expect(planHaulerProfileSave(profile(), input({ legalName: "Ridgeline LLC" }))).toEqual({ identityChanged: true, reopensVerification: true })
    expect(planHaulerProfileSave(profile({ verification: null }), input({ businessName: "Ridgeline" }))).toEqual({
      identityChanged: true,
      reopensVerification: false
    })
  })

  it("lets a manager change the profile but not the business name or legal name", () => {
    const manager = profile({ canEditIdentity: false })

    expect(planHaulerProfileSave(manager, input({ homeBase: "97386" })).identityChanged).toBe(false)
    expect(() => planHaulerProfileSave(manager, input({ businessName: "Renamed" }))).toThrow(HAULER_IDENTITY_EDIT_REFUSED)
    expect(() => planHaulerProfileSave(manager, input({ legalName: null }))).toThrow(HAULER_IDENTITY_EDIT_REFUSED)
  })

  it("refuses staff and drivers, who can read the profile but not change it", () => {
    expect(() => planHaulerProfileSave(profile({ canEditIdentity: false, canEditProfile: false }), input())).toThrow(HAULER_PROFILE_EDIT_REFUSED)
  })
})

describe("haulerSetupChecklist", () => {
  it("lists the business step until a home base and a travel distance are set, and never blocks anything", () => {
    expect(haulerSetupChecklist({ profile: profile({ homeBase: null }) })).toEqual([
      expect.objectContaining({ done: false, href: "/v2/hauler/profile?setup=1", id: "business" })
    ])
    expect(haulerSetupChecklist({ profile: profile() })[0]?.done).toBe(true)
    expect(haulerSetupChecklist({ profile: null })).toEqual([])
  })
})

describe("pilotHaulerProfile", () => {
  it("reads the pilot's business name for a hauling business, with nothing else invented", () => {
    const state = createInMemoryDatabase()
    const membership = state.organizationMemberships.find((candidate) => {
      const organization = state.organizations.find((org) => org.id === candidate.organizationId)
      return candidate.status === "active" && candidate.role === "owner" && (organization?.type === "carrier" || organization?.type === "fleet")
    })

    expect(membership).toBeDefined()
    const view = pilotHaulerProfile(state, { actorUserId: membership!.userId, organizationId: membership!.organizationId }, null)

    expect(view).toMatchObject({ about: null, acceptsInvitations: false, canEditProfile: true, homeBase: null, listed: false, serviceRadiusMiles: null })
    expect(view.businessName).toBe(state.organizations.find((org) => org.id === membership!.organizationId)?.displayName)
  })

  it("refuses a landing-only business and a non-member", () => {
    const state = createInMemoryDatabase()
    const landing = state.organizationMemberships.find((candidate) =>
      candidate.status === "active" && state.organizations.find((org) => org.id === candidate.organizationId)?.type === "landing_source")
    const hauling = state.organizations.find((org) => org.type === "carrier" || org.type === "fleet")

    expect(landing && hauling).toBeTruthy()
    expect(() => pilotHaulerProfile(state, { actorUserId: landing!.userId, organizationId: landing!.organizationId }, null)).toThrow(HAULER_PROFILE_NOT_HAULING)
    expect(() => pilotHaulerProfile(state, { actorUserId: landing!.userId, organizationId: hauling!.id }, null)).toThrow()
  })
})
