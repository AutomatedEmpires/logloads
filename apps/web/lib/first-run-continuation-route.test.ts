import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  canAccessCockpit: vi.fn(),
  getSessionActor: vi.fn(),
  homePathFor: vi.fn()
}))

vi.mock("server-only", () => ({}))
vi.mock("./session", () => ({
  getSessionActor: mocks.getSessionActor,
  homePathFor: mocks.homePathFor
}))
vi.mock("./session-policy", () => ({ canAccessCockpit: mocks.canAccessCockpit }))

import {
  createFirstRunHandoffCookie,
  firstRunContinuationCookieName
} from "./entry-routing"
import { continueFirstRunRequest } from "./first-run-continuation-route"

function requestWithCookie(value?: string): NextRequest {
  return new NextRequest("https://logloads.test/driver/first-run/continue", {
    headers: value
      ? { cookie: `${firstRunContinuationCookieName("driver")}=${value}` }
      : undefined,
    method: "POST"
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.canAccessCockpit.mockReturnValue(true)
  mocks.getSessionActor.mockResolvedValue({ profile: { id: "user-1" } })
  mocks.homePathFor.mockReturnValue("/driver/map")
})

describe("first-run continuation route", () => {
  it("resumes the bound path and expires every scoped handoff cookie", async () => {
    const cookie = createFirstRunHandoffCookie(
      "driver",
      "/driver/loads/load-1?private=value",
      "created",
      "user-1"
    )
    const response = await continueFirstRunRequest(requestWithCookie(cookie), "driver")
    const setCookies = response.headers.get("set-cookie") ?? ""

    expect(response.status).toBe(303)
    expect(response.headers.get("location")).toBe("/driver/loads/load-1")
    expect(setCookies).toContain("ll_first_run_driver=")
    expect(setCookies).toContain("Path=/driver")
    expect(setCookies).toContain("Max-Age=0")
  })

  it("does not disclose a previous user's continuation on a shared browser", async () => {
    const previousUserCookie = createFirstRunHandoffCookie(
      "driver",
      "/driver/loads/private-load",
      "created",
      "user-1"
    )
    mocks.getSessionActor.mockResolvedValue({ profile: { id: "user-2" } })

    const response = await continueFirstRunRequest(
      requestWithCookie(previousUserCookie),
      "driver"
    )

    expect(response.headers.get("location")).toBe("/driver/map")
    expect(response.headers.get("location")).not.toContain("private-load")
  })

  it("falls back safely for a wrong cockpit and sends signed-out requests to sign in", async () => {
    mocks.canAccessCockpit.mockReturnValue(false)
    expect(
      (
        await continueFirstRunRequest(
          requestWithCookie(
            createFirstRunHandoffCookie(
              "driver",
              "/driver/loads/private-load",
              "created",
              "user-1"
            )
          ),
          "driver"
        )
      ).headers.get("location")
    ).toBe("/driver/map")

    mocks.getSessionActor.mockResolvedValue(null)
    expect(
      (await continueFirstRunRequest(requestWithCookie(), "driver")).headers.get("location")
    ).toBe("/sign-in")
  })
})
