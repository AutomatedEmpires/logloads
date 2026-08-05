import { describe, expect, it } from "vitest"

import {
  config,
  privateIndexingRoutePatterns,
  protectedRoutePatterns
} from "../middleware"

describe("middleware matcher", () => {
  it("always runs Clerk's frontend API proxy path", () => {
    expect(config.matcher).toContain("/__clerk/(.*)")
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
})
