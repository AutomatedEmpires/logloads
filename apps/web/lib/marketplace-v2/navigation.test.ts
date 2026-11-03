import { describe, expect, it } from "vitest"

import type { MarketplaceCapability } from "@logloads/contracts"

import { activeV2NavId, V2_NAVIGATION, v2HomePathFor, v2NavigationFor, v2WorkspaceFor, v2WorkspaceForContext } from "./navigation"

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

const HAULER: MarketplaceCapability[] = ["interest.express", "interest.withdraw", "interest.reply", "equipment.manage"]
const LANDING_DESK: MarketplaceCapability[] = ["job.publish", "inquiry.respond"]
const DRIVER: MarketplaceCapability[] = ["interest.express", "interest.withdraw", "interest.reply"]

describe("capability-scoped V2 navigation (#124)", () => {
  const ids = (capabilities: MarketplaceCapability[] | null) => v2NavigationFor(capabilities).map((item) => item.id)

  it("shows a visitor, or an account without a usable business, only the public job board", () => {
    expect(ids(null)).toEqual(["work"])
    expect(ids([])).toEqual(["work"])
  })

  it("gives a hauling business the hauler set and a landing business the landing set", () => {
    expect(ids(HAULER)).toEqual(["work", "inquiries"])
    expect(ids(DRIVER)).toEqual(["work", "inquiries"])
    expect(ids(LANDING_DESK)).toEqual(["landing-inquiries", "landing-jobs"])
  })

  it("hides each landing item the role lacks", () => {
    expect(ids(["inquiry.respond"])).toEqual(["landing-inquiries"])
    expect(ids(["job.publish"])).toEqual(["landing-jobs"])
  })

  it("gives a business that is both sides both sets, in display order", () => {
    expect(ids([...HAULER, ...LANDING_DESK])).toEqual(["work", "inquiries", "landing-inquiries", "landing-jobs"])
  })

  it("never offers more than the five bottom tabs allowed", () => {
    expect(v2NavigationFor([...HAULER, ...LANDING_DESK]).length).toBeLessThanOrEqual(5)
  })

  it("homes a landing-only business on /v2/landing and everyone else on /v2/work", () => {
    expect(v2HomePathFor(LANDING_DESK)).toBe("/v2/landing")
    expect(v2HomePathFor(HAULER)).toBe("/v2/work")
    expect(v2HomePathFor([...HAULER, ...LANDING_DESK])).toBe("/v2/work")
    expect(v2HomePathFor([])).toBe("/v2/work")
  })

  it("keeps a one-sided business in its own workspace kind wherever it is", () => {
    expect(v2WorkspaceForContext(LANDING_DESK, "/v2/work")).toBe("landing")
    expect(v2WorkspaceForContext(HAULER, "/v2/landing/jobs")).toBe("hauler")
    expect(v2WorkspaceForContext([...HAULER, ...LANDING_DESK], "/v2/landing/jobs")).toBe("landing")
    expect(v2WorkspaceForContext(null, "/v2/work")).toBe("hauler")
  })
})

