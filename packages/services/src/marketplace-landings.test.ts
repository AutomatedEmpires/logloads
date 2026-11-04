import { describe, expect, it } from "vitest"

import { createInMemoryDatabase } from "@logloads/db"

import { marketplaceLandingAllowance, marketplaceOwnLandings } from "./marketplace-landings"
import type { MarketplaceActor } from "./marketplace-interest"

const NORTH_PINE = "33333333-3333-4333-8333-333333333331"

function actorFor(state: ReturnType<typeof createInMemoryDatabase>, email: string, organizationId?: string): MarketplaceActor {
  const profile = state.profiles.find((candidate) => candidate.email === email)
  const membership = state.organizationMemberships.find((candidate) =>
    candidate.userId === profile?.id && candidate.status === "active" && (!organizationId || candidate.organizationId === organizationId))
  if (!profile || !membership) throw new Error(`no membership for ${email}`)
  return { actorUserId: profile.id, organizationId: membership.organizationId }
}

describe("pilot landing reads", () => {
  it("lists the organization's own landings with their private half, for its landing desk", () => {
    const state = createInMemoryDatabase()
    const landings = marketplaceOwnLandings(state, actorFor(state, "dispatch@northpine.example", NORTH_PINE))

    expect(landings.map((landing) => [landing.name, landing.status, landing.areaLabel])).toEqual([["Oak Landing", "active", "Oakridge, OR"]])
    expect(landings[0]?.privateDetails).toMatchObject({ exactLocation: { lat: 43.7463, lng: -122.4628 }, siteContactName: "Lee Loader" })
    expect(landings[0]?.approximatePoint).toBeNull()
  })

  it("refuses a hauler-only role and a business the person does not belong to", () => {
    const state = createInMemoryDatabase()

    expect(() => marketplaceOwnLandings(state, actorFor(state, "hank@northpine.example", NORTH_PINE))).toThrow()
    expect(() => marketplaceOwnLandings(state, { ...actorFor(state, "cole@summit.example"), organizationId: NORTH_PINE })).toThrow()
  })

  it("reports billing inactive: no Blueprint plan lives in the pilot store", () => {
    const state = createInMemoryDatabase()
    const allowance = marketplaceLandingAllowance(state, actorFor(state, "cole@summit.example"))

    expect(allowance).toMatchObject({ activeLandings: 1, cycleEndsAt: null, invitationsRemaining: null, planCode: null })
    expect(allowance.teamMembers).toBeGreaterThan(0)
  })
})
