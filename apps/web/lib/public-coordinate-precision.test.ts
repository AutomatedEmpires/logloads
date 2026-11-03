import { createInMemoryDatabase } from "@logloads/db"
import { createLogLoadsServices } from "@logloads/services"
import { NextRequest } from "next/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * V2-DEC-01 (founder-confirmed 2026-11-02): public responses carry landing and destination
 * coordinates rounded to 0.1°, and authorized exact-location access is unchanged. These tests read
 * the bytes the public API routes and the V2 read port actually return, not what a map draws.
 */

type Services = ReturnType<typeof createLogLoadsServices>

const runtime = vi.hoisted(() => ({
  current: undefined as unknown as Services,
  getSessionActor: vi.fn()
}))

vi.mock("server-only", () => ({}))
vi.mock("@/lib/services", () => ({
  mutateState: () => Promise.reject(new Error("These tests only read")),
  readState: async <T>(read: (current: Services) => T) => read(runtime.current),
  services: {
    get state() {
      return runtime.current.state
    }
  }
}))
vi.mock("@/lib/session", () => ({ getSessionActor: runtime.getSessionActor }))
vi.mock("@/lib/api-actor", () => ({
  apiErrorResponse: (error: unknown) => {
    throw error
  },
  requireApiActor: () => Promise.reject(new Error("Public reads never resolve an API actor"))
}))

import { GET as getLoad } from "../app/api/loads/[loadId]/route"
import { GET as listLoads } from "../app/api/loads/route"
import { pilotMarketplaceV2 } from "./marketplace-v2/pilot-adapter"

const AT = new Date("2026-06-05T12:00:00.000Z")
const COORDINATE_KEY = /^(lat|lng|latitude|longitude)$|(Lat|Lng|Latitude|Longitude)$/
const ONE_DECIMAL = /^-?\d+(\.\d)?$/
// The decision's own examples, placed on the seeded public landing.
const EXACT_EXAMPLE = { lat: 47.654, lng: -117.457 }
const PUBLIC_EXAMPLE = { lat: 47.7, lng: -117.5 }

function seeded<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`Seed fixture missing: ${what}`)
  return value
}

/** Every numeric coordinate in a JSON payload, as its serialized text. */
function coordinatesIn(body: string): Array<{ path: string; text: string }> {
  const found: Array<{ path: string; text: string }> = []
  const walk = (value: unknown, path: string): void => {
    if (Array.isArray(value)) {
      value.forEach((entry, index) => walk(entry, `${path}[${index}]`))
    } else if (value && typeof value === "object") {
      for (const [key, entry] of Object.entries(value)) {
        if (typeof entry === "number" && COORDINATE_KEY.test(key)) {
          found.push({ path: `${path}.${key}`, text: JSON.stringify(entry) })
        } else {
          walk(entry, `${path}.${key}`)
        }
      }
    }
  }

  walk(JSON.parse(body), "$")
  return found
}

function exactCoordinateTexts(state: Services["state"]): string[] {
  return [
    ...state.landings.flatMap((site) => [site.coordinates.lat, site.coordinates.lng]),
    ...state.mills.flatMap((site) => [site.coordinates.lat, site.coordinates.lng]),
    ...state.richLandingDetails.flatMap((detail) => [detail.entranceLat, detail.entranceLng])
  ]
    .map((value) => String(value))
    .filter((text) => !ONE_DECIMAL.test(text))
}

function expectPublicPrecision(body: string): void {
  const coordinates = coordinatesIn(body)

  expect(coordinates.length).toBeGreaterThan(0)
  expect(coordinates.filter((coordinate) => !ONE_DECIMAL.test(coordinate.text))).toEqual([])
  for (const exact of exactCoordinateTexts(runtime.current.state)) {
    expect(body).not.toContain(exact)
  }
}

function loadRequest(loadId: string) {
  return getLoad(new NextRequest(`http://localhost/api/loads/${loadId}`), { params: Promise.resolve({ loadId }) })
}

let publicLoadId: string

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(AT)
  runtime.current = createLogLoadsServices(createInMemoryDatabase())
  runtime.getSessionActor.mockReset()
  runtime.getSessionActor.mockResolvedValue(null)

  const state = runtime.current.state
  const load = seeded(state.loadPostings.find((posting) => posting.title === "Oak saw-log morning run"), "public load")
  const landing = seeded(state.landings.find((site) => site.id === load.pickupLandingId), "public landing")

  landing.coordinates = { ...EXACT_EXAMPLE }
  publicLoadId = load.id
})

afterEach(() => {
  vi.useRealTimers()
})

describe("public API coordinate precision (V2-DEC-01)", () => {
  it("serves the public board with every coordinate rounded to 0.1°", async () => {
    const response = await listLoads()
    const body = await response.text()
    const { loads } = JSON.parse(body) as { loads: Array<{ id: string; landing: unknown }> }

    expect(response.status).toBe(200)
    expectPublicPrecision(body)
    expect(loads.find((load) => load.id === publicLoadId)?.landing).toMatchObject({ approximate: true, ...PUBLIC_EXAMPLE })
    expect(body).toContain('"lat":47.7,"lng":-117.5')
  })

  it("serves an anonymous load detail with the same rounded point", async () => {
    const response = await loadRequest(publicLoadId)
    const body = await response.text()

    expect(response.status).toBe(200)
    expectPublicPrecision(body)
    expect((JSON.parse(body) as { load: { landing: unknown } }).load.landing).toMatchObject({ approximate: true, ...PUBLIC_EXAMPLE })
  })

  it("returns V2 job cards and job detail with only the rounded approximate point", async () => {
    const cards = await pilotMarketplaceV2.listJobs({ acceptingOnly: false })
    const detail = await pilotMarketplaceV2.getJob(publicLoadId)

    expectPublicPrecision(JSON.stringify(cards))
    expectPublicPrecision(JSON.stringify(detail))
    expect(cards.find((job) => job.id === publicLoadId)?.origin.approximatePoint).toEqual(PUBLIC_EXAMPLE)
    expect(detail?.origin.approximatePoint).toEqual(PUBLIC_EXAMPLE)
  })

  it("still gives an approved hauler the exact entrance through the same detail route", async () => {
    const services = runtime.current
    const state = services.state
    const driverUser = seeded(state.profiles.find((profile) => profile.email === "hank@northpine.example"), "driver user")
    const driver = seeded(state.driverProfiles.find((profile) => profile.userId === driverUser.id), "driver profile")
    const equipment = seeded(state.equipmentCombinations.find((item) => item.assignedDriverProfileId === driver.id), "driver equipment")
    const load = seeded(state.loadPostings.find((posting) => posting.title === "Blue River high-grade campaign"), "private load")
    const slot = seeded(state.truckSlots.find((item) => item.loadPostingId === load.id && item.reservedCount < item.capacity), "open slot")
    const capacity = seeded(state.opportunityCapacities.find((item) => item.loadPostingId === load.id), "capacity")
    const details = seeded(state.richLandingDetails.find((item) => item.landingId === load.pickupLandingId), "landing details")
    const host = seeded(state.organizationMemberships.find((membership) =>
      membership.organizationId === load.companyId &&
      membership.status === "active" &&
      ["owner", "admin", "dispatcher", "fleet_manager"].includes(membership.role)
    ), "host staff")

    // List it on the open network so the anonymous and authorized requests read the same load.
    capacity.visibilityMode = "open_network"
    const anonymousResponse = await loadRequest(load.id)
    const anonymousBody = await anonymousResponse.text()

    // Approval stamps the wall clock, and the seeded host's billing enrollment postdates the June
    // fixture window, so the booking runs on real time (as network.test.ts does) and reads on AT.
    vi.useRealTimers()
    const assignment = services.requestCapacityWithPolicy({
      actorUserId: driverUser.id,
      driverProfileId: driver.id,
      loadPostingId: load.id,
      organizationId: equipment.organizationId,
      trailerProfileId: equipment.trailerProfileId,
      truckProfileId: equipment.truckProfileId,
      truckSlotId: slot.id
    }, { at: AT.toISOString() })
    services.approveCapacityRequest({ actorUserId: host.userId, assignmentId: assignment.id, organizationId: load.companyId })
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(AT)

    runtime.getSessionActor.mockResolvedValue({ activeOrganization: { id: equipment.organizationId }, profile: { id: driverUser.id } })
    const assignedResponse = await loadRequest(load.id)
    const assignedBody = await assignedResponse.text()
    const assigned = (JSON.parse(assignedBody) as { load: { landing: { approximate: boolean; lat: number; lng: number } } }).load

    expect(String(details.entranceLat)).not.toMatch(ONE_DECIMAL)
    expect(anonymousResponse.status).toBe(200)
    expectPublicPrecision(anonymousBody)
    expect(assignedResponse.status).toBe(200)
    expect(assigned.landing).toMatchObject({ approximate: false, lat: details.entranceLat, lng: details.entranceLng })
    expect(assignedBody).toContain(String(details.entranceLat))
  })
})
