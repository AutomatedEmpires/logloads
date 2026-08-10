import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => {
  class TestDomainRefusalError extends Error {
    constructor(message: string) {
      super(message)
      this.name = "DomainRefusalError"
    }
  }

  return {
    DomainRefusalError: TestDomainRefusalError,
    driverCredentialGate: vi.fn(),
    equipmentProfileUnitNumberIsUnambiguous: vi.fn(),
    evaluateLoadCompatibility: vi.fn(),
    getCockpitContext: vi.fn(),
    selectDriverEquipmentCombination: vi.fn(),
    shellAccountFor: vi.fn(),
    state: null as unknown
  }
})

vi.mock("server-only", () => ({}))
vi.mock("@logloads/contracts", () => ({
  evaluateLoadCompatibility: mocks.evaluateLoadCompatibility,
  selectDriverEquipmentCombination: mocks.selectDriverEquipmentCombination
}))
vi.mock("@logloads/services", () => ({
  DomainRefusalError: mocks.DomainRefusalError,
  driverCredentialGate: mocks.driverCredentialGate,
  equipmentProfileUnitNumberIsUnambiguous:
    mocks.equipmentProfileUnitNumberIsUnambiguous
}))
vi.mock("./services", () => ({
  services: {
    get state() {
      return mocks.state
    }
  }
}))
vi.mock("./v3", () => ({
  getCockpitContext: mocks.getCockpitContext,
  shellAccountFor: mocks.shellAccountFor
}))

import { DomainRefusalError } from "@logloads/services"

import { getFleetCockpitData, getFleetOpportunityData } from "./fleet-data"

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111"
const LOAD_ID = "29292929-2929-4929-8929-292929292929"
const ROUTE_ID = "33333333-3333-4333-8333-333333333333"
const VALID_COMBINATION_ID = "44444444-4444-4444-8444-444444444441"
const REJECTED_COMBINATION_ID = "44444444-4444-4444-8444-444444444442"
const VALID_DRIVER_ID = "55555555-5555-4555-8555-555555555551"
const REJECTED_DRIVER_ID = "55555555-5555-4555-8555-555555555552"
const VALID_TRUCK_ID = "66666666-6666-4666-8666-666666666661"
const REJECTED_TRUCK_ID = "66666666-6666-4666-8666-666666666662"

function combination(
  id: string,
  driverProfileId: string,
  truckProfileId: string,
  label: string,
  status: "available" | "committed" | "maintenance" | "inactive" = "available"
) {
  return {
    assignedDriverProfileId: driverProfileId,
    homeRegion: "Test Valley",
    id,
    label,
    maxPayloadTons: 32,
    organizationId: ORGANIZATION_ID,
    status,
    trailerProfileId: null,
    truckProfileId,
    truckTypes: ["log_truck"]
  }
}

describe("fleet driver presentation rig", () => {
  it("aligns an available rig's roster label, dispatch state, and featured-photo badge", async () => {
    const driverUserId = "77777777-7777-4777-8777-777777777779"
    const driverProfileId = "55555555-5555-4555-8555-555555555559"
    const maintenanceCombinationId = "44444444-4444-4444-8444-444444444449"
    const availableCombinationId = "44444444-4444-4444-8444-444444444450"
    const maintenanceTruckId = "66666666-6666-4666-8666-666666666669"
    const availableTruckId = "66666666-6666-4666-8666-666666666670"

    mocks.state = {
      assignments: [],
      availabilityWindows: [],
      driverProfiles: [{
        availabilityStatus: "available",
        companyId: ORGANIZATION_ID,
        featureTruckPhoto: true,
        homeBase: "Test Valley",
        id: driverProfileId,
        userId: driverUserId,
        yearsExperience: 9
      }],
      equipmentCombinations: [
        combination(
          maintenanceCombinationId,
          driverProfileId,
          maintenanceTruckId,
          "Maintenance Unit 4",
          "maintenance"
        ),
        combination(
          availableCombinationId,
          driverProfileId,
          availableTruckId,
          "Current Unit 9",
          "available"
        )
      ],
      haulRoutes: [],
      loadPostings: [],
      organizationMemberships: [],
      profiles: [{
        fullName: "Riley Woods",
        id: driverUserId,
        phone: "+15035550110"
      }],
      trailerProfiles: [],
      tripsV2: [],
      truckProfiles: [
        { id: maintenanceTruckId },
        {
          id: availableTruckId,
          photo: {
            bytes: 500_000,
            format: "jpg",
            height: 900,
            provider: "supabase",
            publicId: "logloads/test/truck/current-unit-9",
            uploadedAt: "2026-08-08T12:00:00.000Z",
            version: 1,
            width: 1200
          }
        }
      ]
    }
    mocks.getCockpitContext.mockResolvedValue({
      actor: { profile: { id: "actor-1" } },
      network: {
        activeOrganization: { id: ORGANIZATION_ID, name: "Test Fleet" },
        loads: [],
        trips: [],
        trucks: []
      }
    })

    const result = await getFleetCockpitData()

    expect(result.drivers).toEqual([
      expect.objectContaining({
        equipmentLabel: "Current Unit 9",
        equipmentStatus: "available",
        hasFeaturedTruckPhoto: true,
        id: driverProfileId
      })
    ])
    expect(result.dispatchPlan).toEqual([
      expect.objectContaining({
        combinationId: availableCombinationId,
        driverProfileId,
        label: "Current Unit 9"
      })
    ])
    expect(result.drivers[0]?.equipmentLabel).toBe(result.dispatchPlan[0]?.label)
  })
})

function opportunityState() {
  return {
    assignments: [],
    availabilityWindows: [],
    driverProfiles: [
      { id: VALID_DRIVER_ID, userId: "77777777-7777-4777-8777-777777777771" },
      { id: REJECTED_DRIVER_ID, userId: "77777777-7777-4777-8777-777777777772" }
    ],
    equipmentCombinations: [
      combination(
        VALID_COMBINATION_ID,
        VALID_DRIVER_ID,
        VALID_TRUCK_ID,
        "Verified rig"
      ),
      combination(
        REJECTED_COMBINATION_ID,
        REJECTED_DRIVER_ID,
        REJECTED_TRUCK_ID,
        "Ambiguous rig"
      )
    ],
    haulRoutes: [{ id: ROUTE_ID }],
    loadPostings: [{ id: LOAD_ID, routeId: ROUTE_ID }],
    profiles: [
      {
        fullName: "Valid Driver",
        id: "77777777-7777-4777-8777-777777777771"
      },
      {
        fullName: "Rejected Driver",
        id: "77777777-7777-4777-8777-777777777772"
      }
    ],
    trailerProfiles: [],
    truckProfiles: [
      { id: VALID_TRUCK_ID },
      { id: REJECTED_TRUCK_ID }
    ],
    truckSlots: []
  }
}

function networkView() {
  return {
    activeOrganization: {
      id: ORGANIZATION_ID,
      name: "Test Fleet"
    },
    loads: [
      {
        assignments: [],
        id: LOAD_ID,
        slots: {
          claimableSlotId: null,
          requestableSlotId: null
        }
      }
    ]
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.state = opportunityState()
  mocks.getCockpitContext.mockResolvedValue({ network: networkView() })
  mocks.shellAccountFor.mockReturnValue({ id: "test-account" })
  mocks.evaluateLoadCompatibility.mockReturnValue({
    cautions: [],
    eligibility: "strong_match",
    hardFailures: [],
    positiveSignals: ["Equipment matches"],
    score: 100
  })
  mocks.equipmentProfileUnitNumberIsUnambiguous.mockImplementation(
    (_state, _organizationId: string, _kind: string, profileId: string) =>
      profileId !== REJECTED_TRUCK_ID
  )
  mocks.driverCredentialGate.mockReturnValue({ missing: [], satisfied: true })
  mocks.selectDriverEquipmentCombination.mockImplementation(
    (
      combinations: Array<ReturnType<typeof combination>>,
      input: {
        driverProfileId: string
        includeInactive?: boolean
        organizationId?: string
      }
    ) => {
      const priority = { available: 0, committed: 1, maintenance: 2, inactive: 3 }

      return combinations
        .filter(
          (candidate) =>
            candidate.assignedDriverProfileId === input.driverProfileId &&
            (!input.organizationId || candidate.organizationId === input.organizationId) &&
            (input.includeInactive || candidate.status !== "inactive")
        )
        .sort((left, right) => priority[left.status] - priority[right.status])[0] ?? null
    }
  )
})

describe("fleet opportunity options", () => {
  it("keeps a valid rig available when another rig has an ambiguous unit number", async () => {
    const result = await getFleetOpportunityData(LOAD_ID)

    expect(result.options).toHaveLength(2)
    expect(
      result.options.find(
        (option) => option.combinationId === VALID_COMBINATION_ID
      )
    ).toMatchObject({
      driverName: "Valid Driver",
      eligible: true,
      fit: "Strong fit",
      reasons: ["Equipment matches"]
    })
    expect(
      result.options.find(
        (option) => option.combinationId === REJECTED_COMBINATION_ID
      )
    ).toMatchObject({
      driverName: "Rejected Driver",
      eligible: false,
      fit: "Unable to verify",
      reasons: ["This rig cannot be verified."]
    })
  })

  it("propagates an unexpected option-evaluation failure", async () => {
    const internalFailure = new Error("credential index is unavailable")

    mocks.equipmentProfileUnitNumberIsUnambiguous.mockReturnValue(true)
    mocks.driverCredentialGate.mockImplementation(
      (_state, driverProfileId: string) => {
        if (driverProfileId === REJECTED_DRIVER_ID) {
          throw internalFailure
        }

        return { missing: [], satisfied: true }
      }
    )

    await expect(getFleetOpportunityData(LOAD_ID)).rejects.toBe(internalFailure)
  })

  it("degrades a typed per-rig refusal without hiding valid sibling rigs", async () => {
    mocks.equipmentProfileUnitNumberIsUnambiguous.mockReturnValue(true)
    mocks.driverCredentialGate.mockImplementation(
      (_state, driverProfileId: string) => {
        if (driverProfileId === REJECTED_DRIVER_ID) {
          throw new DomainRefusalError("The selected rig cannot be checked")
        }

        return { missing: [], satisfied: true }
      }
    )

    const result = await getFleetOpportunityData(LOAD_ID)

    expect(result.options).toHaveLength(2)
    expect(
      result.options.find(
        (option) => option.combinationId === REJECTED_COMBINATION_ID
      )
    ).toMatchObject({
      eligible: false,
      fit: "Unable to verify",
      reasons: ["This rig cannot be verified."]
    })
  })
})
