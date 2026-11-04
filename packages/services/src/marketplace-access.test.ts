import { randomUUID } from "node:crypto"

import { describe, expect, it } from "vitest"

import type { EquipmentCombination, OrganizationRole } from "@logloads/contracts"
import { createInMemoryDatabase } from "@logloads/db"

import {
  haulerEquipmentOptions,
  marketplaceAuthoringLandings,
  marketplaceHaulerEquipment,
  marketplaceViewerAccess,
  pilotMarketplaceMembership
} from "./marketplace-access"
import { expressMarketplaceInterest, listMarketplaceInterestsForHauler, type MarketplaceActor } from "./marketplace-interest"

const AT = "2026-06-05T18:00:00.000Z"
const NEW_RIVER = "33333333-3333-4333-8333-333333333334"

function fixture() {
  const state = createInMemoryDatabase()
  const user = (email: string) => {
    const profile = state.profiles.find((candidate) => candidate.email === email)
    if (!profile) throw new Error(`seed user ${email} missing`)
    return profile.id
  }
  const actorFor = (email: string, organizationId?: string): MarketplaceActor => {
    const userId = user(email)
    const membership = state.organizationMemberships.find((candidate) =>
      candidate.userId === userId && candidate.status === "active" && (!organizationId || candidate.organizationId === organizationId))
    if (!membership) throw new Error(`no membership for ${email}`)
    return { actorUserId: userId, organizationId: membership.organizationId }
  }
  const addCombination = (overrides: Partial<EquipmentCombination>) => {
    const template = state.equipmentCombinations[0]
    if (!template) throw new Error("seed equipment missing")
    state.equipmentCombinations.push({ ...template, id: randomUUID(), organizationId: NEW_RIVER, ...overrides })
  }
  const openJob = state.loadPostings.find((load) => load.title === "Oak saw-log morning run")
  if (!openJob) throw new Error("seed job missing")

  return {
    addCombination,
    hauler: actorFor("emptyfleet@logloads.example", NEW_RIVER),
    landingManager: actorFor("loader@northpine.example"),
    northPineDriver: actorFor("hank@northpine.example"),
    openJob,
    state,
    summit: actorFor("cole@summit.example")
  }
}

describe("pilot role translation (side-limited, no new authority)", () => {
  const organization = (type: "carrier" | "fleet" | "landing_source" | "destination" | "platform") =>
    ({ ...createInMemoryDatabase().organizations[0]!, id: "00000000-0000-4000-8000-000000000000", type })

  it("gives no marketplace role to billing, viewer, destination managers or platform organizations", () => {
    const state = createInMemoryDatabase()
    for (const role of ["billing", "viewer", "destination_manager"] satisfies OrganizationRole[]) {
      expect(pilotMarketplaceMembership(state, organization("fleet"), { role })).toBeNull()
    }
    expect(pilotMarketplaceMembership(state, organization("platform"), { role: "owner" })).toBeNull()
  })

  it("never gives a driver or fleet manager a landing seat, and never gives a landing manager hauler authority", () => {
    const { state } = fixture()
    const northPine = state.organizations.find((candidate) => candidate.displayName === "North Pine Logging")!
    expect(pilotMarketplaceMembership(state, northPine, { role: "driver" })).toEqual({ haulerProfile: true, landingWorkspaceSeat: false, role: "driver" })
    expect(pilotMarketplaceMembership(state, northPine, { role: "fleet_manager" })).toMatchObject({ landingWorkspaceSeat: false })
    expect(pilotMarketplaceMembership(state, northPine, { role: "landing_manager" })).toEqual({ haulerProfile: false, landingWorkspaceSeat: true, role: "manager" })
  })

  it("grants a landing seat only to organizations that operate a landing", () => {
    const { state } = fixture()
    const newRiver = state.organizations.find((candidate) => candidate.id === NEW_RIVER)!
    expect(pilotMarketplaceMembership(state, newRiver, { role: "owner" })).toEqual({ haulerProfile: true, landingWorkspaceSeat: false, role: "owner" })
  })
})

describe("viewer capabilities", () => {
  it("separates the landing desk from the hauling business", () => {
    const { hauler, landingManager, northPineDriver, state } = fixture()
    expect(marketplaceViewerAccess(state, landingManager).capabilities).toEqual(["job.publish", "landing.manage", "inquiry.respond"])
    expect(marketplaceViewerAccess(state, northPineDriver).capabilities).toEqual(["interest.express", "interest.withdraw", "interest.reply"])
    expect(marketplaceViewerAccess(state, hauler).capabilities).toEqual(["interest.express", "interest.withdraw", "interest.reply", "equipment.manage"])
  })

  it("lets a landing manager express no interest on the hauling side", () => {
    const { landingManager, openJob, state } = fixture()
    const summitJob = state.loadPostings.find((load) => load.companyId !== openJob.companyId)
    expect(() => expressMarketplaceInterest(state, landingManager, { loadPostingId: summitJob?.id ?? openJob.id, trucksOffered: 1 }, AT))
      .toThrow("Switch to a hauling business")
  })

  it("refuses a workspace the actor does not belong to", () => {
    const { hauler, landingManager, state } = fixture()
    expect(() => marketplaceViewerAccess(state, { ...hauler, organizationId: landingManager.organizationId })).toThrow("Organization operations are not available")
  })
})

describe("landing authoring context", () => {
  it("lists only the organization's own landings with public labels", () => {
    const { landingManager, northPineDriver, state } = fixture()
    const landings = marketplaceAuthoringLandings(state, landingManager)
    expect(landings.length).toBeGreaterThan(0)
    for (const landing of landings) {
      expect(Object.keys(landing).sort()).toEqual(["areaLabel", "id", "name", "stateCode"])
      expect(state.landings.find((candidate) => candidate.id === landing.id)?.companyId).toBe(landingManager.organizationId)
    }
    expect(() => marketplaceAuthoringLandings(state, northPineDriver)).toThrow("cannot publish")
  })
})

describe("self-reported equipment in an inquiry", () => {
  it("shows an empty list when the business has listed no equipment", () => {
    const { hauler, state } = fixture()
    expect(marketplaceHaulerEquipment(state, hauler)).toEqual([])
  })

  it("groups configurations, excludes maintenance and inactive units", () => {
    const { addCombination, state } = fixture()
    addCombination({ status: "available", trailerTypes: ["pole_trailer"], truckTypes: ["log_truck"] })
    addCombination({ status: "committed", trailerTypes: ["pole_trailer"], truckTypes: ["log_truck"] })
    addCombination({ status: "maintenance", trailerTypes: ["chip_van"], truckTypes: ["chip_truck"] })
    addCombination({ status: "inactive", trailerTypes: ["bunk_trailer"], truckTypes: ["log_truck"] })
    expect(haulerEquipmentOptions(state, NEW_RIVER)).toEqual([
      { configurationKey: "log_truck|pole_trailer", label: "Log truck + Pole trailer", unitsListed: 2 }
    ])
  })

  it("records equipment lines with snapshotted labels and derives the truck total from them", () => {
    const { addCombination, hauler, openJob, state } = fixture()
    addCombination({ status: "available", trailerTypes: ["pole_trailer"], truckTypes: ["log_truck"] })
    addCombination({ status: "available", trailerTypes: ["pole_trailer"], truckTypes: ["log_truck"] })

    const { interest } = expressMarketplaceInterest(state, hauler, {
      equipment: [{ configurationKey: "log_truck|pole_trailer", count: 2 }],
      loadPostingId: openJob.id,
      trucksOffered: 9
    }, AT)

    expect(interest.trucksOffered).toBe(2)
    expect(interest.equipment).toEqual([{ configurationKey: "log_truck|pole_trailer", count: 2, label: "Log truck + Pole trailer" }])
    expect(listMarketplaceInterestsForHauler(state, hauler)[0]?.equipment).toHaveLength(1)
  })

  it("refuses equipment the business does not list, or more units than it lists", () => {
    const { addCombination, hauler, openJob, state } = fixture()
    addCombination({ status: "available", trailerTypes: ["pole_trailer"], truckTypes: ["log_truck"] })
    expect(() => expressMarketplaceInterest(state, hauler, { equipment: [{ configurationKey: "chip_truck|chip_van", count: 1 }], loadPostingId: openJob.id }, AT))
      .toThrow("Choose equipment from your business profile")
    expect(() => expressMarketplaceInterest(state, hauler, { equipment: [{ configurationKey: "log_truck|pole_trailer", count: 3 }], loadPostingId: openJob.id }, AT))
      .toThrow(/profile lists 1/)
    expect(state.marketplaceInterests).toHaveLength(0)
  })

  it("never uses another organization's equipment", () => {
    const { hauler, openJob, state } = fixture()
    const northPineKey = haulerEquipmentOptions(state, openJob.companyId)[0]?.configurationKey
    expect(northPineKey).toBeDefined()
    expect(() => expressMarketplaceInterest(state, hauler, { equipment: [{ configurationKey: northPineKey!, count: 1 }], loadPostingId: openJob.id }, AT))
      .toThrow("Choose equipment from your business profile")
  })
})

// #178: the DS-05 browser case signs in as this seeded hauler, so its shape is pinned here.
describe("the seeded hauler with listed equipment (Granite Creek Hauling)", () => {
  const GRANITE_CREEK = "33333333-3333-4333-8333-333333333335"
  const graniteFixture = () => {
    const { openJob, state } = fixture()
    const avery = state.profiles.find((profile) => profile.email === "avery@granitecreek.example")
    if (!avery) throw new Error("seed user avery@granitecreek.example missing")
    const granite: MarketplaceActor = { actorUserId: avery.id, organizationId: GRANITE_CREEK }
    return { granite, openJob, state }
  }

  it("is a hauling business with two setups, capped at their units, and no landing of its own", () => {
    const { granite, state } = graniteFixture()
    const access = marketplaceViewerAccess(state, granite)

    expect(access.organizationName).toBe("Granite Creek Hauling")
    expect(access.capabilities).toContain("interest.express")
    expect(access.capabilities).not.toContain("job.publish")
    expect(marketplaceHaulerEquipment(state, granite)).toEqual([
      { configurationKey: "log_truck|bunk_trailer", label: "Log truck + Bunk / short-log", unitsListed: 2 },
      { configurationKey: "log_truck|pole_trailer", label: "Log truck + Pole trailer", unitsListed: 1 }
    ])
    expect(state.landings.some((landing) => landing.companyId === GRANITE_CREEK)).toBe(false)
  })

  it("can offer North Pine's open job up to the listed units, and no more", () => {
    const { granite, openJob, state } = graniteFixture()

    expect(openJob.companyId).not.toBe(GRANITE_CREEK)
    expect(() => expressMarketplaceInterest(state, granite, { equipment: [{ configurationKey: "log_truck|bunk_trailer", count: 3 }], loadPostingId: openJob.id }, AT))
      .toThrow(/profile lists 2/)

    const { interest } = expressMarketplaceInterest(state, granite, {
      equipment: [
        { configurationKey: "log_truck|bunk_trailer", count: 2 },
        { configurationKey: "log_truck|pole_trailer", count: 1 }
      ],
      loadPostingId: openJob.id
    }, AT)
    expect(interest.trucksOffered).toBe(3)
    expect(interest.jobOrganizationId).toBe(openJob.companyId)
  })
})
