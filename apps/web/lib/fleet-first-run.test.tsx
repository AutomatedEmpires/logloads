import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
vi.stubGlobal("React", React)

import type { NetworkView, TruckView } from "./network"
import {
  FleetFirstRunPanel,
  getFleetFirstRunReadiness
} from "@/components/v3/FleetPages"

function firstUnit(overrides: Partial<TruckView> = {}): TruckView {
  return {
    combinationStatus: "available",
    configuration: "log truck / standard",
    driverName: "Unassigned",
    driverProfileId: null,
    id: "combination-1",
    matchCount: 0,
    payload: "32 tons",
    region: "Western Oregon",
    reputation: null,
    status: "available",
    unitNumber: "Unit 1",
    verification: "pending",
    ...overrides
  }
}

function activationNetwork(
  verificationStatus: string,
  trucks: TruckView[]
): Pick<NetworkView, "activeOrganization" | "trucks"> {
  return {
    activeOrganization: {
      id: "fleet-1",
      name: "North Ridge Timber",
      reputation: null,
      role: "owner",
      type: "fleet",
      verificationStatus
    },
    trucks
  }
}

describe("Fleet Free first-run readiness", () => {
  it("renders Fleet Free truth and field-sized setup actions before the carried continuation", () => {
    const html = renderToStaticMarkup(
      React.createElement(FleetFirstRunPanel, {
        continuationHref: "/fleet/opportunities",
        credentialReadiness: null,
        network: activationNetwork("pending", [firstUnit()])
      })
    )

    const driversAction = html.indexOf('data-testid="fleet-first-run-drivers"')
    const trucksAction = html.indexOf('data-testid="fleet-first-run-trucks"')
    const continuation = html.indexOf('data-testid="fleet-first-run-continue"')

    expect(html).toContain("Fleet Free is active")
    expect(html).toContain("no checkout")
    expect(html).toContain('aria-labelledby="fleet-first-run-title"')
    expect(html).toContain(
      '<section aria-labelledby="fleet-first-run-readiness-title" class="first-run-panel__state">'
    )
    expect(driversAction).toBeGreaterThan(-1)
    expect(trucksAction).toBeGreaterThan(driversAction)
    expect(continuation).toBeGreaterThan(trucksAction)
    expect(html).toContain('action="/fleet/first-run/continue"')
    expect(html).not.toContain("/fleet/opportunities")
    expect(html).toContain(
      'class="action-link action-link--secondary" data-testid="fleet-first-run-continue"'
    )
    expect(html).not.toMatch(/trial|subscription|upgrade/i)
  })

  it("keeps missing setup facts visible without inventing readiness", () => {
    const facts = getFleetFirstRunReadiness(activationNetwork("pending", []), null)

    expect(facts).toMatchObject([
      { complete: false, id: "organization", label: "Organization verification: pending" },
      { complete: false, id: "unit", label: "First unit still needed" },
      { complete: false, id: "driver", label: "Driver assignment still needed" },
      {
        complete: false,
        id: "credentials",
        label: "Credential readiness follows driver assignment"
      }
    ])
  })

  it("marks the exact driver and rig gate complete only from the server gate result", () => {
    const facts = getFleetFirstRunReadiness(
      activationNetwork("verified", [
        firstUnit({ driverName: "Riley Woods", driverProfileId: "driver-1" })
      ]),
      { missingLabels: [], satisfied: true }
    )

    expect(facts.every((fact) => fact.complete)).toBe(true)
    expect(facts.at(-1)).toMatchObject({
      detail: "Riley Woods's approved, current records cover Unit 1.",
      id: "credentials",
      label: "Driver and exact-rig credential gate clear"
    })
  })

  it("names credential gaps without treating driver assignment as clearance", () => {
    const facts = getFleetFirstRunReadiness(
      activationNetwork("verified", [
        firstUnit({ driverName: "Riley Woods", driverProfileId: "driver-1" })
      ]),
      {
        missingLabels: ["Commercial driver license", "Truck photo"],
        satisfied: false
      }
    )

    expect(facts.find((fact) => fact.id === "driver")?.complete).toBe(true)
    expect(facts.find((fact) => fact.id === "credentials")).toMatchObject({
      complete: false,
      detail:
        "Before Riley Woods can request work with Unit 1, complete Commercial driver license and Truck photo.",
      label: "Driver and exact-rig records need attention"
    })
  })
})
