import { describe, expect, it } from "vitest"

import { activeV2NavId, V2_NAVIGATION, v2WorkspaceFor } from "./navigation"

describe("V2 navigation", () => {
  it("keeps the four preview destinations, in order", () => {
    expect(V2_NAVIGATION.map((item) => [item.label, item.href])).toEqual([
      ["Find work", "/v2/work"],
      ["My inquiries", "/v2/inquiries"],
      ["Landing inbox", "/v2/landing/inquiries"],
      ["Post jobs", "/v2/landing/jobs"]
    ])
  })

  it.each([
    ["/v2/work", "work"],
    ["/v2/work/0f8b2c1e-1d4b-4f0a-9a52-3c5e2f8d6b71", "work"],
    ["/v2/inquiries", "inquiries"],
    ["/v2/landing/inquiries", "landing-inquiries"],
    ["/v2/landing/jobs", "landing-jobs"],
    ["/v2/landing/jobs/new", "landing-jobs"],
    ["/v2/landing/jobs/preview", "landing-jobs"]
  ])("marks %s as %s", (pathname, id) => {
    expect(activeV2NavId(pathname)).toBe(id)
  })

  it("marks nothing for paths outside the destinations or partial segment matches", () => {
    expect(activeV2NavId(null)).toBe("")
    expect(activeV2NavId("/v2")).toBe("")
    expect(activeV2NavId("/v2/workshop")).toBe("")
    expect(activeV2NavId("/v2/landing")).toBe("")
  })

  it("treats /v2/landing pages as the landing workspace and the rest as hauler", () => {
    expect(v2WorkspaceFor("/v2/landing/jobs/new")).toBe("landing")
    expect(v2WorkspaceFor("/v2/landing")).toBe("landing")
    expect(v2WorkspaceFor("/v2/landingpage")).toBe("hauler")
    expect(v2WorkspaceFor("/v2/work")).toBe("hauler")
    expect(v2WorkspaceFor(null)).toBe("hauler")
  })
})
