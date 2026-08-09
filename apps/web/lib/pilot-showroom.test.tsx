import { readFileSync } from "node:fs"
import * as React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { imageSize } from "image-size"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("@/components/v3/Shells", async () => {
  const ReactModule = await import("react")

  return {
    PublicShell: ({ children }: { children: React.ReactNode }) =>
      ReactModule.createElement("div", { "data-testid": "public-shell" }, children)
  }
})

import {
  PilotCaptureViewer,
  PilotShowroom
} from "@/components/v3/PilotShowroom"
import {
  getPilotSurface,
  getPilotRole,
  isPilotRole,
  pilotCaptureDisclosure,
  pilotLifecycle,
  pilotRoles,
  pilotRoleSlugs,
  pilotSurfaceSlugs,
  pilotSuccessCriteria,
  pilotTourBoundary,
  type PilotRole
} from "./pilot-showroom"

const expectedSurfaces: Record<PilotRole, readonly string[]> = {
  driver: [
    "driver-map",
    "driver-loads",
    "driver-load-detail",
    "driver-schedule",
    "driver-profile",
    "driver-messages",
    "driver-equipment",
    "driver-assistant",
    "driver-network"
  ],
  fleet: [
    "fleet-command",
    "fleet-dispatch",
    "fleet-trips",
    "fleet-messages",
    "fleet-opportunities",
    "fleet-opportunity-detail",
    "fleet-network",
    "fleet-drivers",
    "fleet-trucks",
    "fleet-availability",
    "fleet-performance",
    "fleet-assistant",
    "fleet-workspace",
    "fleet-billing"
  ],
  host: [
    "host-command",
    "host-work",
    "host-live",
    "host-messages",
    "host-carriers",
    "host-landings",
    "host-schedule",
    "host-reliability",
    "host-assistant",
    "host-analytics",
    "host-workspace",
    "host-billing"
  ]
}

function renderShowroom(role?: PilotRole): string {
  vi.stubGlobal("React", React)

  return renderToStaticMarkup(
    React.createElement(PilotShowroom, role ? { role } : {})
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("pilot showroom product truth", () => {
  it("defines the complete role atlas with exact capture paths and dimensions", () => {
    expect(pilotRoleSlugs).toEqual(["host", "fleet", "driver"])

    for (const role of pilotRoleSlugs) {
      const surfaces = pilotRoles[role].surfaces

      expect(surfaces.map((surface) => surface.slug)).toEqual(expectedSurfaces[role])
      expect(new Set(surfaces.map((surface) => surface.slug)).size).toBe(surfaces.length)

      for (const surface of surfaces) {
        expect(surface.image).toBe("/pilot/" + surface.slug + ".jpg")
        expect(surface.alt).toContain("Synthetic")
        expect(surface.width).toBe(role === "driver" ? 390 : 1440)
        expect(surface.height).toBe(role === "driver" ? 844 : 900)

        const capture = readFileSync(
          new URL("../public" + surface.image, import.meta.url)
        )
        const dimensions = imageSize(capture)

        expect(dimensions.width).toBe(surface.width)
        expect(dimensions.height).toBe(surface.height)
      }
    }
  })

  it("keeps the authoritative operating loop and role validation stable", () => {
    expect(pilotLifecycle.map((stage) => stage.label)).toEqual([
      "Plan",
      "Publish",
      "Match",
      "Commit",
      "Coordinate",
      "Haul",
      "Confirm"
    ])
    expect(isPilotRole("host")).toBe(true)
    expect(isPilotRole("admin")).toBe(false)
    expect(getPilotRole("fleet")?.label).toBe("Fleet")
    expect(getPilotRole("unknown")).toBeNull()
    expect(pilotSurfaceSlugs).toHaveLength(35)
    expect(getPilotSurface("driver-load-detail")?.role).toBe("driver")
    expect(getPilotSurface("fleet-opportunity-detail")?.role).toBe("fleet")
    expect(getPilotSurface("unknown")).toBeNull()
    expect(
      pilotSuccessCriteria.some((criterion) =>
        criterion.includes("At least ten completed pilot movements")
      )
    ).toBe(true)
    expect(
      pilotSuccessCriteria.some((criterion) =>
        criterion.includes("At least four of five evaluators")
      )
    ).toBe(true)
  })

  it("makes the synthetic, read-only boundary explicit in shared content", () => {
    expect(pilotTourBoundary).toContain("does not create an account")
    expect(pilotTourBoundary).toContain("read or change operating state")
    expect(pilotTourBoundary).toContain("send a message")
    expect(pilotTourBoundary).toContain("upload a file")
    expect(pilotTourBoundary).toContain("enroll an organization")
    expect(pilotTourBoundary).toContain("create a charge")
    expect(pilotCaptureDisclosure).toContain("disposable synthetic workspace")
    expect(pilotCaptureDisclosure).toContain("No private real-world data")
  })
})

describe("pilot showroom rendering", () => {
  it("renders a public overview with all role tours, commercial truth, and pilot stages", () => {
    const markup = renderShowroom()

    expect(markup).toContain("See the operating day before you commit.")
    expect(markup).toContain("Fictional operation")
    expect(markup).toContain("synthetic people, loads, landings, routes, and messages")
    expect(markup).toContain('href="/pilot/host"')
    expect(markup).toContain('href="/pilot/fleet"')
    expect(markup).toContain('href="/pilot/driver"')
    expect(markup).toContain("/contact?topic=pilot&amp;role=host")
    expect(markup).toContain("/sign-up?path=host")
    expect(markup).toContain("/sign-up?path=fleet")
    expect(markup).toContain("/sign-up?path=driver")
    expect(markup).toContain("Public product tour")
    expect(markup).toContain("Assisted rehearsal")
    expect(markup).toContain("Approved live pilot")
    expect(markup).toContain("5% on top of stated driver pay")
    expect(markup).toContain('id="launch-readiness"')
    expect(markup).toContain("What success needs to prove.")
    expect(markup).not.toContain("Switch actor")
  })

  it("renders every host surface as a labeled current-product capture", () => {
    const markup = renderShowroom("host")
    const disclosureCount = markup.match(
      /Current-product capture · disposable synthetic workspace/g
    )?.length

    expect(markup).toContain("Run the landing from one shared operating picture.")
    expect(markup).toContain("/contact?topic=pilot&amp;role=host")
    expect(markup).toContain("/sign-up?path=host")
    expect(markup).toContain("host-command.jpg")
    expect(markup).toContain("host-billing.jpg")
    expect(markup).toContain("Open full-size Host Command capture")
    expect(markup).toContain("capture in a new tab")
    expect(markup).toContain('width="1440"')
    expect(markup).toContain('height="900"')
    expect(disclosureCount).toBe(expectedSurfaces.host.length)
    expect(markup).not.toContain("<button")
  })

  it("renders the phone-first driver atlas at the exact capture dimensions", () => {
    const markup = renderShowroom("driver")

    expect(markup).toContain("Know the work before you turn the key.")
    expect(markup).toContain("driver-map.jpg")
    expect(markup).toContain("driver-network.jpg")
    expect(markup).toContain("Open full-size Driver Map capture")
    expect(markup).toContain('width="390"')
    expect(markup).toContain('height="844"')
    expect(markup).toContain("Driver access is free forever")
    expect(markup).toContain("only person who can mark direct driver pay received")
  })

  it("keeps full-size inspection inside a disclosure-bearing viewer", () => {
    const selection = getPilotSurface("host-billing")

    expect(selection).not.toBeNull()
    if (!selection) return

    const atlas = renderShowroom("host")
    const viewer = renderToStaticMarkup(
      React.createElement(PilotCaptureViewer, selection)
    )

    expect(atlas).toContain('href="/pilot/capture/host-billing"')
    expect(atlas).not.toContain('href="/pilot/host-billing.jpg"')
    expect(viewer).toContain("Synthetic product capture · Not a live workspace")
    expect(viewer).toContain(pilotCaptureDisclosure)
    expect(viewer).toContain("host-billing.jpg")
    expect(viewer).toContain("Back to the Host atlas")
  })
})
