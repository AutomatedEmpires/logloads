import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * The pilot adapter's port v3 surface (#244) over the REAL service layer (in-memory seed). The pilot store keeps none
 * of the records the new groups need, so every new method must refuse before reading or writing anything, and the
 * adapter must say so through `supports`. Its feature capabilities come from the same translated membership as its
 * store-reported ones.
 */

const hoisted = vi.hoisted(() => ({ mutateState: vi.fn(), readState: vi.fn() }))

vi.mock("server-only", () => ({}))
vi.mock("../services", async () => {
  const { createInMemoryDatabase } = await import("@logloads/db")
  const { createLogLoadsServices } = await import("@logloads/services")
  const { shiftSeedDates } = await import("../seed-dates")
  const services = createLogLoadsServices(shiftSeedDates(createInMemoryDatabase()))

  hoisted.readState.mockImplementation(async <T,>(read: (current: typeof services) => T) => read(services))

  return {
    mutateState: hoisted.mutateState,
    readState: hoisted.readState,
    serializeError: (error: unknown) => ({ error: error instanceof Error ? error.message : "Unknown error" }),
    services
  }
})

import { MARKETPLACE_V2_FEATURES, marketplaceFeatureCapabilities, marketplaceV2FeatureSupport } from "@logloads/contracts"
import { resolveMarketplaceActor } from "@logloads/services"

import { services } from "../services"
import { operatingStateMarketplaceV2, pilotMarketplaceV2 } from "./pilot-adapter"
import {
  MARKETPLACE_V2_FEATURE_OPERATIONS,
  MarketplaceFeatureUnavailableError,
  MarketplaceOperationUnavailableError,
  marketplaceV2FeatureMethods
} from "./port"

const state = services.state
const loader = state.profiles.find((profile) => profile.email === "loader@northpine.example")!
const northPine = state.organizations.find((organization) => organization.displayName === "North Pine Logging")!
const viewer = { organizationId: northPine.id, userId: loader.id }

beforeEach(() => {
  hoisted.mutateState.mockClear()
  hoisted.readState.mockClear()
})

describe("pilot adapter: port v3 groups (#244)", () => {
  it("supports no group, directly or through the V2 port", () => {
    expect(operatingStateMarketplaceV2.supports).toEqual(marketplaceV2FeatureSupport())
    expect(pilotMarketplaceV2.supports).toEqual(marketplaceV2FeatureSupport())
  })

  it("refuses every new method as unavailable on the pilot store, naming the operation, before touching it", async () => {
    let refused = 0

    for (const feature of MARKETPLACE_V2_FEATURES) {
      const operations: Readonly<Record<string, string>> = MARKETPLACE_V2_FEATURE_OPERATIONS[feature]

      for (const method of marketplaceV2FeatureMethods(feature)) {
        const call = operatingStateMarketplaceV2[method] as (...values: unknown[]) => Promise<unknown>
        const outcome = await call(viewer, "11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa", {}).then(
          () => null,
          (error: unknown) => error
        )

        expect(outcome, method).toBeInstanceOf(MarketplaceOperationUnavailableError)
        expect(outcome, method).not.toBeInstanceOf(MarketplaceFeatureUnavailableError)
        expect((outcome as Error).message).toBe(`${operations[method]} is not available until the normalized marketplace store is connected`)
        refused += 1
      }
    }

    expect(refused).toBe(51)
    expect(hoisted.readState).not.toHaveBeenCalled()
    expect(hoisted.mutateState).not.toHaveBeenCalled()
  })

  it("refuses through the V2 port every page uses, too", async () => {
    await expect(pilotMarketplaceV2.planAllowance(viewer)).rejects.toBeInstanceOf(MarketplaceOperationUnavailableError)
    await expect(pilotMarketplaceV2.inviteTeamMember(viewer, { email: "new@example.test" })).rejects.toBeInstanceOf(MarketplaceOperationUnavailableError)
    await expect(pilotMarketplaceV2.adminQueue({ userId: loader.id })).rejects.toBeInstanceOf(MarketplaceOperationUnavailableError)
    expect(hoisted.mutateState).not.toHaveBeenCalled()
  })
})

describe("pilot adapter: feature capabilities (#244)", () => {
  it("derives them from the same translated membership as the store-reported capabilities, for every seeded member", async () => {
    let checked = 0

    for (const membership of state.organizationMemberships.filter((candidate) => candidate.status === "active")) {
      const actor = { actorUserId: membership.userId, organizationId: membership.organizationId }
      let expected: ReturnType<typeof marketplaceFeatureCapabilities>

      try {
        expected = marketplaceFeatureCapabilities(resolveMarketplaceActor(state, actor).marketplace)
      } catch {
        continue
      }

      const capabilities = await operatingStateMarketplaceV2.viewerFeatureCapabilities({ organizationId: membership.organizationId, userId: membership.userId })

      expect(capabilities).toEqual(expected)
      checked += 1
    }

    expect(checked).toBeGreaterThan(0)
  })

  it("leaves viewerAccess as it was, and gives the landing desk its own feature capabilities", async () => {
    expect(await operatingStateMarketplaceV2.viewerAccess(viewer)).toEqual({
      capabilities: expect.arrayContaining(["job.publish"]),
      organizationName: "North Pine Logging"
    })
    expect(Object.keys(await operatingStateMarketplaceV2.viewerAccess(viewer)).sort()).toEqual(["capabilities", "organizationName"])
    expect(await pilotMarketplaceV2.viewerFeatureCapabilities(viewer))
      .toEqual(expect.arrayContaining(["truck.search", "boost.estimate", "plan.view", "alert.manage"]))
  })

  it("still refuses a person outside the business", async () => {
    const stranger = state.organizations.find((organization) =>
      organization.id !== northPine.id &&
      !state.organizationMemberships.some((candidate) => candidate.organizationId === organization.id && candidate.userId === loader.id))!

    await expect(operatingStateMarketplaceV2.viewerFeatureCapabilities({ organizationId: stranger.id, userId: loader.id })).rejects.toThrow()
  })
})
