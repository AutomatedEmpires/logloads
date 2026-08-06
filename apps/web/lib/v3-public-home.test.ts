import { createInMemoryDatabase } from "@logloads/db"
import { createLogLoadsServices } from "@logloads/services"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { publicAvailableEquipmentCount } from "./network"

const mocks = vi.hoisted(() => ({
  readState: vi.fn()
}))

vi.mock("server-only", () => ({}))

vi.mock("./services", () => ({
  readState: mocks.readState,
  services: { state: {} }
}))

vi.mock("./session", () => ({
  requireCockpitActor: vi.fn()
}))

import { getPublicHomeSnapshot } from "./v3"

describe("public home capacity snapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("uses the operational organization gate for available truck totals", async () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const availableCombination = services.state.equipmentCombinations.find(
      (combination) => combination.status === "available"
    )
    const organization = services.state.organizations.find(
      (candidate) => candidate.id === availableCombination?.organizationId
    )

    if (!availableCombination || !organization) {
      throw new Error("The public home capacity fixture is incomplete")
    }

    organization.verificationStatus = "suspended"
    const rawAvailableCount = services.state.equipmentCombinations.filter(
      (combination) => combination.status === "available"
    ).length
    const operationalAvailableCount = publicAvailableEquipmentCount(
      services.state
    )

    expect(rawAvailableCount).toBeGreaterThan(operationalAvailableCount)
    mocks.readState.mockImplementation(
      async (
        read: (current: ReturnType<typeof createLogLoadsServices>) => unknown
      ) => read(services)
    )

    await expect(getPublicHomeSnapshot()).resolves.toMatchObject({
      trucksAvailable: operationalAvailableCount
    })
  })
})
