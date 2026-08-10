import { NextRequest, NextResponse } from "next/server"
import { describe, expect, it } from "vitest"

import {
  config,
  pilotCaptureNoIndexRoutePatterns,
  privateIndexingRoutePatterns,
  protectFromIndexing,
  protectedRoutePatterns
} from "../middleware"
import {
  isKnownPilotPath,
  pilotSurfaceSlugs
} from "./pilot-route-contract"

describe("middleware matcher", () => {
  it("always runs Clerk's frontend API proxy path", () => {
    expect(config.matcher).toContain("/__clerk/(.*)")
  })

  it("runs every Pilot path through the exact public catalog guard", () => {
    expect(config.matcher).toContain("/pilot/:path*")
  })

  it("keeps raw synthetic Pilot captures out of search indexes", () => {
    expect(pilotCaptureNoIndexRoutePatterns).toEqual(["/pilot/(.*).jpg"])
    const response = protectFromIndexing(
      new NextRequest("https://logloads.test/pilot/host-command.jpg"),
      NextResponse.next()
    )

    expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow")
  })

  it("protects product feedback for every authenticated role", () => {
    expect(protectedRoutePatterns).toContain("/support(.*)")
  })

  it("marks every private and account-state HTML surface as non-indexable", () => {
    expect(privateIndexingRoutePatterns).toEqual(
      expect.arrayContaining([
        "/admin(.*)",
        "/driver(.*)",
        "/fleet(.*)",
        "/host(.*)",
        "/support(.*)",
        "/access-restricted(.*)",
        "/onboarding(.*)",
        "/sign-in(.*)",
        "/sign-up(.*)",
        "/workspace(.*)"
      ])
    )
  })

  it("fails closed around the exact public Pilot route catalog", () => {
    expect(isKnownPilotPath("/pilot")).toBe(true)
    expect(isKnownPilotPath("/pilot/host")).toBe(true)
    expect(isKnownPilotPath("/pilot/fleet/")).toBe(true)
    expect(isKnownPilotPath("/pilot/capture/host-command")).toBe(true)
    expect(isKnownPilotPath("/pilot/capture/" + pilotSurfaceSlugs.at(-1))).toBe(true)
    expect(isKnownPilotPath("/pilot/host-command.jpg")).toBe(true)
    expect(isKnownPilotPath("/pilot/not-a-role")).toBe(false)
    expect(isKnownPilotPath("/pilot/not.a-role")).toBe(false)
    expect(isKnownPilotPath("/pilot/capture/not-a-capture")).toBe(false)
    expect(isKnownPilotPath("/pilot/capture/not.a-capture")).toBe(false)
    expect(isKnownPilotPath("/pilot/not-a-capture.jpg")).toBe(false)
    expect(isKnownPilotPath("/pilot/host/extra")).toBe(false)
    expect(isKnownPilotPath("/pricing")).toBe(true)
  })
})
