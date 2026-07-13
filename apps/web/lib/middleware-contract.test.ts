import { describe, expect, it } from "vitest"

import { config } from "../middleware"

describe("middleware matcher", () => {
  it("always runs Clerk's frontend API proxy path", () => {
    expect(config.matcher).toContain("/__clerk/(.*)")
  })
})
