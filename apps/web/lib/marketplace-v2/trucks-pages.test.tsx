import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * #126: My trucks (`/v2/hauler/trucks`) and its actions, rendered on the server as a visit without JavaScript receives
 * them. The port and the session are stubbed; identity is the session's.
 */

const mocks = vi.hoisted(() => ({
  port: { supportsHaulerFleet: false } as Record<string, unknown> & { supportsHaulerFleet: boolean },
  addHaulerEquipment: vi.fn(),
  checkRateLimit: vi.fn(),
  confirmHaulerAvailability: vi.fn(),
  getSessionActor: vi.fn(),
  haulerFleet: vi.fn(),
  reportHaulerAvailability: vi.fn(),
  resolveV2Viewer: vi.fn(),
  revalidatePath: vi.fn(),
  setHaulerEquipmentCount: vi.fn()
}))

vi.mock("server-only", () => ({}))
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND")
  },
  redirect: (href: string) => {
    throw new Error(`NEXT_REDIRECT ${href}`)
  }
}))
vi.mock("@/lib/marketplace-v2/flag", () => ({ marketplaceV2Enabled: () => true }))
vi.mock("./flag", () => ({ marketplaceV2Enabled: () => true }))
vi.mock("./v2-session", () => ({ getV2SessionActor: mocks.getSessionActor }))
vi.mock("../rate-limit", () => ({ checkRateLimit: mocks.checkRateLimit }))
vi.mock("@/lib/marketplace-v2/viewer", () => ({ resolveV2Viewer: mocks.resolveV2Viewer, withBusinessSwitchNote: (text: string) => text }))
vi.mock("@/lib/marketplace-v2/pilot-adapter", () => ({ pilotMarketplaceV2: mocks.port }))
vi.mock("./pilot-adapter", () => ({ pilotMarketplaceV2: mocks.port }))
Object.assign(mocks.port, {
  addHaulerEquipment: mocks.addHaulerEquipment,
  confirmHaulerAvailability: mocks.confirmHaulerAvailability,
  haulerFleet: mocks.haulerFleet,
  reportHaulerAvailability: mocks.reportHaulerAvailability,
  setHaulerEquipmentCount: mocks.setHaulerEquipmentCount
})

import { MARKETPLACE_EQUIPMENT_TYPES, type HaulerFleetView } from "@logloads/contracts"

import HaulerTrucksPage from "@/app/v2/hauler/trucks/page"

import { addHaulerEquipmentAction, reportHaulerAvailabilityAction } from "./fleet-actions"
import { MarketplaceOperationUnavailableError, MarketplaceRefusalError } from "./port"

const ORG = "33333333-bbbb-4bbb-8bbb-333333333333"
const USER = "55555555-dddd-4ddd-8ddd-555555555555"
const UNIT = "44444444-cccc-4ccc-8ccc-444444444444"
const viewer = { organizationId: ORG, userId: USER }
const FORBIDDEN = /\bGPS\b|driver name|\btrips?\b|maintenance|schedule|dispatch|subscription|\bfees?\b/i

function fleet(overrides: Partial<HaulerFleetView> = {}): HaulerFleetView {
  return {
    availability: [],
    canEdit: true,
    organizationId: ORG,
    placed: true,
    units: [
      { category: "truck", equipmentCode: "log_truck", id: UNIT, label: "Log truck + Pole trailer", otherTrailer: null, trailerCode: "pole_trailer", units: 2 }
    ],
    ...overrides
  }
}

const textOf = (html: string) =>
  html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim()

async function render(query: Record<string, string | string[]> = {}) {
  return renderToStaticMarkup(await HaulerTrucksPage({ searchParams: Promise.resolve(query) }))
}

function post(fields: Record<string, string | string[]>): FormData {
  const form = new FormData()
  for (const [name, value] of Object.entries(fields)) for (const item of Array.isArray(value) ? value : [value]) form.append(name, item)
  return form
}

async function redirected(promise: Promise<unknown>): Promise<URL> {
  const error = await promise.then(() => null, (thrown: unknown) => thrown as Error)
  expect(error?.message).toMatch(/^NEXT_REDIRECT /)
  return new URL(error!.message.replace("NEXT_REDIRECT ", ""), "http://localhost")
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal("React", React)
  mocks.port.supportsHaulerFleet = false
  mocks.getSessionActor.mockResolvedValue({ activeOrganization: { id: ORG }, profile: { id: USER }, workspaceSelectionInvalid: false })
  mocks.resolveV2Viewer.mockResolvedValue({ access: { capabilities: ["interest.express", "equipment.manage"], organizationName: "Ridgeline" }, ok: true, viewer })
  mocks.haulerFleet.mockResolvedValue(fleet())
})

describe("/v2/hauler/trucks", () => {
  it("offers presets only from MARKETPLACE_EQUIPMENT_TYPES, grouped truck, trailer and extras, with Other (describe)", async () => {
    const html = await render()
    const options = [...html.matchAll(/<option value="([^"]+)"/g)].map((match) => match[1])

    for (const type of MARKETPLACE_EQUIPMENT_TYPES.filter((candidate) => candidate.category !== "attachment")) expect(options).toContain(type.code)
    expect(options.filter((value) => !MARKETPLACE_EQUIPMENT_TYPES.some((type) => type.code === value))).toEqual(["none", "other"])
    for (const type of MARKETPLACE_EQUIPMENT_TYPES.filter((candidate) => candidate.category === "attachment")) expect(html).toContain(`value="${type.code}"`)
    expect(textOf(html)).toContain("Other (describe)")
    expect(html).toContain('data-ds-page="hauler-trucks"')
    expect(textOf(html)).not.toMatch(FORBIDDEN)
  })

  it("caps the available count at the units listed, says so, and never shows an unknown state as zero", async () => {
    const html = await render()

    expect(html).toMatch(/<input[^>]*name="count"[^>]*max="2"|<input[^>]*max="2"[^>]*name="count"/)
    expect(textOf(html)).toContain("You have 2 listed, so at most 2 can be available.")
    expect(textOf(html)).toContain("Not recently confirmed")
    expect(textOf(html)).not.toMatch(/0 of 2 available/)
  })

  it("shows the capacity board and Confirm all as shown from two trucks, with each row's source and date", async () => {
    mocks.haulerFleet.mockResolvedValue(fleet({
      availability: [{ availableCount: 1, availableFrom: new Date().toISOString().slice(0, 10), availableUntil: "2099-01-01", equipmentCode: "log_truck", reportedAt: new Date().toISOString(), state: "available" }]
    }))
    const html = await render()

    expect(html).toContain("<table")
    expect(textOf(html)).toContain("Confirm all as shown")
    expect(textOf(html)).toContain("Updated today by the hauler")

    mocks.haulerFleet.mockResolvedValue(fleet({ units: [{ ...fleet().units[0]!, units: 1 }] }))
    expect(await render()).not.toContain("<table")
  })

  it("says before anything is typed that the pilot store cannot save, and shows a driver no forms to submit", async () => {
    expect(textOf(await render())).toContain("Saving trucks and availability isn't available in this preview yet")

    mocks.haulerFleet.mockResolvedValue(fleet({ canEdit: false }))
    const html = await render()
    expect(html).not.toMatch(/<button[^>]*type="submit"/)
    expect(textOf(html)).toContain("Only an owner, manager or staff member")
  })

  it("keeps what was posted when a save was refused or not available", async () => {
    const html = await render({ count: "3", equipmentCode: "log_truck", form: "availability", fromDate: "2026-12-01", message: "You have 2 Log trucks listed, so at most 2 can be available.", outcome: "refused", state: "from" })

    expect(html).toMatch(/role="alert"[^>]*>[^<]*You have 2 Log trucks listed/)
    expect(html).toContain('value="2026-12-01"')
  })
})

describe("fleet actions", () => {
  it("say plainly when saving is not available and carry the posted values back", async () => {
    mocks.addHaulerEquipment.mockRejectedValue(new MarketplaceOperationUnavailableError("Adding equipment"))
    const url = await redirected(addHaulerEquipmentAction(post({ attachments: ["onboard_scales"], count: "2", otherTrailer: "", trailer: "pole_trailer", truckCode: "log_truck" })))

    expect(url.pathname).toBe("/v2/hauler/trucks")
    expect(url.searchParams.get("outcome")).toBe("unavailable")
    expect(url.searchParams.get("truckCode")).toBe("log_truck")
    expect(url.searchParams.getAll("attachments")).toEqual(["onboard_scales"])
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it("validate on the server before the store, and pass the store's refusal through", async () => {
    let url = await redirected(reportHaulerAvailabilityAction(post({ count: "", equipmentCode: "log_truck", fromDate: "", state: "from" })))
    expect(url.searchParams.get("outcome")).toBe("invalid")
    expect(mocks.reportHaulerAvailability).not.toHaveBeenCalled()

    mocks.reportHaulerAvailability.mockRejectedValue(new MarketplaceRefusalError("You have 2 Log trucks listed, so at most 2 can be available."))
    url = await redirected(reportHaulerAvailabilityAction(post({ count: "3", equipmentCode: "log_truck", fromDate: "", state: "now" })))
    expect(url.searchParams.get("outcome")).toBe("refused")
    expect(url.searchParams.get("message")).toContain("at most 2")
    expect(mocks.reportHaulerAvailability).toHaveBeenCalledWith(viewer, { count: 3, equipmentCode: "log_truck", fromDate: null, state: "now" })
  })
})
