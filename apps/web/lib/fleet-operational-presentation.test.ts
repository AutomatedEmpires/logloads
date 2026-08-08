import { readFileSync } from "node:fs"

import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import type { DispatchTruckPlan, FleetDriverRow } from "./fleet-data"
import type { NetworkLoadView, NetworkView } from "./network"
import {
  getFleetDispatchEmptyState,
  getFleetDispatchSummary,
  getFleetDispatchWorkItems,
  getFleetDriverPresentation,
  getFleetDriverSummary,
  isStalledTrip,
  loadHasCurrentFleetWarning
} from "@/components/v3/FleetPages"

function dispatchPlan(
  combinationId: string,
  label: string,
  overrides: Partial<DispatchTruckPlan> = {}
): DispatchTruckPlan {
  return {
    blocked: null,
    combinationId,
    driverName: "Riley Woods",
    driverProfileId: `driver-${combinationId}`,
    label,
    payload: "32 tons",
    region: "Western Oregon",
    suggestion: null,
    ...overrides
  }
}

function suggestion(loadPostingId: string): NonNullable<DispatchTruckPlan["suggestion"]> {
  return {
    fit: "Strong fit",
    lane: "Tillamook to Forest Grove",
    loadPostingId,
    partnerLoad: false,
    payLabel: "$1,000 driver pay",
    reason: "Equipment and region fit.",
    remaining: 2,
    requestableSlotId: `slot-${loadPostingId}`,
    scheduleLabel: "Tomorrow, 7:00 AM",
    title: "Douglas fir to mill"
  }
}

function driver(overrides: Partial<FleetDriverRow> = {}): FleetDriverRow {
  return {
    activeTrip: null,
    availabilityLabel: "Available today",
    availabilityStatus: "available",
    equipmentLabel: "Unit 12 / Log trailer",
    equipmentStatus: "available",
    hasFeaturedTruckPhoto: false,
    homeBase: "Tillamook, OR",
    id: "driver-1",
    name: "Riley Woods",
    phone: "+15035550110",
    yearsExperience: 12,
    ...overrides
  }
}

function assignment(
  status: NetworkLoadView["assignments"][number]["status"]
): NetworkLoadView["assignments"][number] {
  return {
    driverName: "Riley Woods",
    driverProfileId: "driver-1",
    id: `assignment-${status}`,
    requestedByOrganizationId: "fleet-1",
    status,
    truckUnit: "Unit 12"
  }
}

function trip(
  status: NetworkView["trips"][number]["status"],
  occurredAt: string
): NetworkView["trips"][number] {
  return {
    events: [{ occurredAt }],
    lastSyncedAt: occurredAt,
    status
  } as NetworkView["trips"][number]
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("fleet dispatch presentation", () => {
  it("projects every truck into one prioritized next move", () => {
    const plans = [
      dispatchPlan("moving", "Unit 4", { blocked: "driver_on_trip" }),
      dispatchPlan("no-match", "Unit 3"),
      dispatchPlan("ready", "Unit 1", { suggestion: suggestion("load-1") }),
      dispatchPlan("closed-slot", "Unit 5", {
        suggestion: { ...suggestion("load-2"), requestableSlotId: null }
      }),
      dispatchPlan("unassigned", "Unit 2", {
        blocked: "no_driver",
        driverName: null,
        driverProfileId: null
      })
    ]

    const workItems = getFleetDispatchWorkItems(plans)

    expect(workItems.map(({ plan, state }) => [plan.combinationId, state])).toEqual([
      ["ready", "ready"],
      ["unassigned", "needs_driver"],
      ["no-match", "no_match"],
      ["closed-slot", "no_match"],
      ["moving", "moving"]
    ])
    expect(new Set(workItems.map(({ plan }) => plan.combinationId)).size).toBe(plans.length)
    expect(getFleetDispatchSummary(workItems)).toEqual({
      moving: 1,
      needsDriver: 1,
      noMatch: 2,
      ready: 1
    })
  })

  it("keeps the removed lane board from duplicating the dispatch queue", () => {
    const source = readFileSync(
      new URL("../components/v3/FleetPages.tsx", import.meta.url),
      "utf8"
    )
    const dispatchSection = source.slice(
      source.indexOf("// --- Dispatch"),
      source.indexOf("// --- Trucks")
    )

    expect(dispatchSection).toContain('className="fleet-dispatch-queue"')
    expect(dispatchSection).not.toContain('className="dispatch-board"')
    expect(dispatchSection).toContain('truck.combinationStatus === "maintenance"')
    expect(dispatchSection).toContain("formatHuman(truck.combinationStatus)")
  })

  it("routes an empty queue to the condition that can restore capacity", () => {
    expect(getFleetDispatchEmptyState([])).toMatchObject({
      actionHref: "/fleet/trucks",
      actionLabel: "Add equipment"
    })
    expect(getFleetDispatchEmptyState([{ combinationStatus: "maintenance" }])).toMatchObject({
      actionHref: "/fleet/trucks",
      actionLabel: "Review equipment"
    })
    expect(getFleetDispatchEmptyState([{ combinationStatus: "inactive" }])).toMatchObject({
      actionHref: "/fleet/trucks",
      actionLabel: "Review equipment"
    })
    expect(getFleetDispatchEmptyState([{ combinationStatus: "committed" }])).toMatchObject({
      actionHref: "/fleet/trips",
      actionLabel: "Review committed work"
    })
    expect(getFleetDispatchEmptyState([{ combinationStatus: "available" }])).toMatchObject({
      actionHref: "/fleet/availability",
      actionLabel: "Review availability"
    })
  })
})

describe("fleet live exception truth", () => {
  it("does not call old assigned work stalled without a due-time fact", () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-08-08T18:00:00.000Z"))
    const oldActivity = "2026-08-07T08:00:00.000Z"

    expect(isStalledTrip(trip("assigned", oldActivity))).toBe(false)
    expect(isStalledTrip(trip("en_route_to_landing", oldActivity))).toBe(true)
    expect(isStalledTrip(trip("completed", oldActivity))).toBe(false)
  })

  it("shows load warnings only for active committed assignments", () => {
    const load = (
      status: NetworkLoadView["assignments"][number]["status"],
      warnings = ["Road restricted"],
      loadStatus: NetworkLoadView["status"] = "in_transit"
    ): Pick<NetworkLoadView, "assignments" | "status" | "warnings"> => ({
      assignments: [assignment(status)],
      status: loadStatus,
      warnings
    })

    for (const status of ["accepted", "checked_in", "loading", "hauled"] as const) {
      expect(loadHasCurrentFleetWarning(load(status)), status).toBe(true)
    }

    for (const status of ["requested", "offered", "completed", "cancelled", "declined"] as const) {
      expect(loadHasCurrentFleetWarning(load(status)), status).toBe(false)
    }
    expect(loadHasCurrentFleetWarning(load("accepted", []))).toBe(false)
    expect(loadHasCurrentFleetWarning(load("accepted", ["Old warning"], "completed"))).toBe(false)
    expect(loadHasCurrentFleetWarning(load("accepted", ["Old warning"], "archived"))).toBe(false)
  })
})

describe("fleet driver readiness presentation", () => {
  it("keeps capacity and credential truth separate", () => {
    const presentation = getFleetDriverPresentation(driver())

    expect(presentation).toMatchObject({
      actionHref: "/fleet/dispatch",
      bucket: "dispatch_ready",
      currentLabel: "Available",
      gateLabel: "Checked on request"
    })
    expect(presentation.gateDetail).toContain("checked before each new load request")
    expect(`${presentation.gateLabel} ${presentation.gateDetail}`).not.toMatch(/approved|verified|clear/i)
  })

  it("uses one exclusive bucket when an active driver has no current truck", () => {
    const presentations = [
      getFleetDriverPresentation(driver({
        activeTrip: { id: "trip-1", loadTitle: "Cedar to mill", statusLabel: "Loading" },
        equipmentLabel: null,
        id: "moving-no-rig"
      })),
      getFleetDriverPresentation(driver({ equipmentLabel: null, id: "needs-rig" })),
      getFleetDriverPresentation(driver({ id: "available" })),
      getFleetDriverPresentation(driver({
        availabilityLabel: "Limited this week",
        availabilityStatus: "limited",
        id: "limited"
      }))
    ]

    expect(presentations[0]).toMatchObject({
      actionHref: "/fleet/trips",
      bucket: "moving",
      gateLabel: "Blocked by truck assignment"
    })
    expect(getFleetDriverSummary(presentations)).toEqual({
      availabilityReview: 1,
      dispatchReady: 1,
      equipmentReview: 0,
      moving: 1,
      needsTruck: 1
    })
  })

  it.each([
    ["maintenance", "/fleet/trucks", "Review equipment"],
    ["inactive", "/fleet/trucks", "Review equipment"],
    ["committed", "/fleet/trips", "Open trips"]
  ] as const)(
    "does not call an assigned %s combination dispatch-ready",
    (equipmentStatus, actionHref, actionLabel) => {
      const presentation = getFleetDriverPresentation(driver({ equipmentStatus }))

      expect(presentation).toMatchObject({
        actionHref,
        actionLabel,
        bucket: "equipment_review"
      })
      expect(presentation.bucket).not.toBe("dispatch_ready")
      expect(presentation.gateLabel).toBe("Rig unavailable for new work")
    }
  )

  it("carries the exact assigned combination state into the driver projection", () => {
    const source = readFileSync(new URL("./fleet-data.ts", import.meta.url), "utf8")

    expect(source).toContain("equipmentStatus: equipment?.status ?? null")
  })

  it("keeps the fleet-specific touch controls on the shared field floor", () => {
    const css = readFileSync(
      new URL("../app/styles/fleet.css", import.meta.url),
      "utf8"
    )

    expect(css).toMatch(/\.fleet-publisher__segments button\s*\{[^}]*min-height: var\(--control-min\)/s)
    expect(css).toMatch(/\.fleet-trip-row__toggle\s*\{[^}]*min-height: var\(--control-min\)/s)
  })
})
