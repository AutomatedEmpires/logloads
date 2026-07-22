import { describe, expect, it } from "vitest"

import { config, protectedRoutePatterns } from "../middleware"

describe("middleware matcher", () => {
  it("always runs Clerk's frontend API proxy path", () => {
    expect(config.matcher).toContain("/__clerk/(.*)")
  })

  it("protects product feedback for every authenticated role", () => {
    expect(protectedRoutePatterns).toContain("/support(.*)")
  })
})
