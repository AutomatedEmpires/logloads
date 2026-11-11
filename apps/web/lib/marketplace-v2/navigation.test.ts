import { describe, expect, it } from "vitest"

import {
  MARKETPLACE_FEATURE_CAPABILITIES,
  MARKETPLACE_V2_FEATURES,
  marketplaceCapabilities,
  marketplaceFeatureCapabilities,
  marketplaceV2FeatureSupport,
  type MarketplaceAdminAccess,
  type MarketplaceCapability,
  type MarketplaceFeatureCapability,
  type MarketplaceMembership,
  type MarketplaceV2Feature
} from "@logloads/contracts"

import {
  activeV2NavId,
  V2_FEATURE_NAVIGATION,
  V2_NAVIGATION,
  v2FeatureNavigationFor,
  type V2FeatureNavigationContext,
  v2HomePathFor,
  v2NavigationFor,
  v2WorkspaceFor,
  v2WorkspaceForContext
} from "./navigation"

describe("V2 navigation", () => {
  it("keeps the preview destinations, in order", () => {
    expect(V2_NAVIGATION.map((item) => [item.label, item.href])).toEqual([
      ["Find work", "/v2/work"],
      ["My inquiries", "/v2/inquiries"],
      ["My trucks", "/v2/hauler/trucks"],
      ["Profile", "/v2/hauler/profile"],
      ["Overview", "/v2/landing"],
      ["Landing inbox", "/v2/landing/inquiries"],
      ["Post jobs", "/v2/landing/jobs"],
      ["Landings", "/v2/landing/landings"]
    ])
  })

  it.each([
    ["/v2/work", "work"],
    ["/v2/work/0f8b2c1e-1d4b-4f0a-9a52-3c5e2f8d6b71", "work"],
    ["/v2/inquiries", "inquiries"],
    ["/v2/hauler/trucks", "hauler-trucks"],
    ["/v2/hauler/profile", "hauler-profile"],
    ["/v2/landing/inquiries", "landing-inquiries"],
    ["/v2/landing/jobs", "landing-jobs"],
    ["/v2/landing/jobs/new", "landing-jobs"],
    ["/v2/landing/jobs/preview", "landing-jobs"],
    ["/v2/landing", "landing-overview"],
    ["/v2/landing/landings", "landings"],
    ["/v2/landing/landings/new", "landings"]
  ])("marks %s as %s", (pathname, id) => {
    expect(activeV2NavId(pathname)).toBe(id)
  })

  it("marks nothing for paths outside the destinations or partial segment matches", () => {
    expect(activeV2NavId(null)).toBe("")
    expect(activeV2NavId("/v2")).toBe("")
    expect(activeV2NavId("/v2/workshop")).toBe("")
    expect(activeV2NavId("/v2/landingpage")).toBe("")
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
    expect(ids(HAULER)).toEqual(["work", "inquiries", "hauler-trucks", "hauler-profile"])
    expect(ids(DRIVER)).toEqual(["work", "inquiries", "hauler-trucks", "hauler-profile"])
    expect(ids(LANDING_DESK)).toEqual(["landing-overview", "landing-inquiries", "landing-jobs", "landings"])
  })

  it("hides each landing item the role lacks", () => {
    expect(ids(["inquiry.respond"])).toEqual(["landing-inquiries"])
    expect(ids(["job.publish"])).toEqual(["landing-overview", "landing-jobs", "landings"])
  })

  it("gives a business that is both sides both sets, in display order", () => {
    // A business on both sides keeps within the five bottom tabs (lead decision on #209, 2026-11-04): its profile is
    // linked from My trucks, and Post jobs and Landings from the landing overview.
    expect(ids([...HAULER, ...LANDING_DESK])).toEqual(["work", "inquiries", "hauler-trucks", "landing-overview", "landing-inquiries"])
  })

  it("shows unread inquiry counts on the destinations the business sees, and no badge for zero (UX-09)", () => {
    const counts = { inquiries: 2, "landing-inquiries": 0, "landing-jobs": 7 }
    const both = v2NavigationFor([...HAULER, ...LANDING_DESK], { ...counts, "landing-inquiries": 3 })

    expect(both.map((item) => [item.id, item.count])).toEqual([
      ["work", undefined],
      ["inquiries", 2],
      ["hauler-trucks", undefined],
      ["landing-overview", undefined],
      ["landing-inquiries", 3]
    ])
    expect(v2NavigationFor(LANDING_DESK, counts).map((item) => [item.id, item.count])).toEqual([["landing-overview", undefined], ["landing-inquiries", undefined], ["landing-jobs", 7], ["landings", undefined]])
    expect(v2NavigationFor(null, counts).map((item) => item.count)).toEqual([undefined])
    expect(V2_NAVIGATION.every((item) => item.count === undefined)).toBe(true)
  })

  it("never offers more than the five bottom tabs allowed", () => {
    expect(v2NavigationFor([...HAULER, ...LANDING_DESK]).length).toBeLessThanOrEqual(5)
  })

  it("marks Overview current on the landing pages a business on both sides reaches through it", () => {
    const both = v2NavigationFor([...HAULER, ...LANDING_DESK])

    for (const pathname of ["/v2/landing", "/v2/landing/jobs", "/v2/landing/jobs/new", "/v2/landing/landings", "/v2/landing/landings/new"]) {
      expect(activeV2NavId(pathname, both)).toBe("landing-overview")
    }
    expect(activeV2NavId("/v2/landing/inquiries", both)).toBe("landing-inquiries")
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

const ALL_GROUPS = marketplaceV2FeatureSupport(MARKETPLACE_V2_FEATURES)
const LOGLOADS_STAFF: MarketplaceAdminAccess = { roles: ["moderator"] }

function member(role: MarketplaceMembership["role"], landingWorkspaceSeat: boolean, haulerProfile: boolean): MarketplaceMembership {
  return { haulerProfile, landingWorkspaceSeat, role }
}

/** The context the server resolves: store capabilities, feature capabilities from the same membership, `supports`. */
function contextFor(membership: MarketplaceMembership | null, supports = ALL_GROUPS): V2FeatureNavigationContext {
  return {
    admin: null,
    capabilities: membership ? marketplaceCapabilities(membership) : null,
    features: marketplaceFeatureCapabilities(membership),
    supports
  }
}

/** Each port v3 entry: the group it needs in `supports`, and the feature capability it needs (`null`: LogLoads staff). */
const GATES: { id: string; feature: MarketplaceV2Feature; capability: MarketplaceFeatureCapability | null }[] = [
  { capability: "truck.search", feature: "trucks", id: "find-trucks" },
  { capability: "invitation.respond", feature: "invites", id: "invitations" },
  { capability: "saved_job.manage", feature: "alerts", id: "saved-jobs" },
  { capability: "alert.manage", feature: "alerts", id: "alerts" },
  { capability: "team.manage", feature: "team", id: "team" },
  { capability: "plan.view", feature: "billing", id: "billing" },
  { capability: "boost.estimate", feature: "boosts", id: "boosts" },
  { capability: null, feature: "admin", id: "admin" }
]

/** A LogLoads staff member who owns a business on both sides, with every group supported: every entry applies. */
const EVERYTHING: V2FeatureNavigationContext = { ...contextFor(member("owner", true, true)), admin: LOGLOADS_STAFF }

describe("port v3 navigation entries (#245)", () => {
  const ids = (context: V2FeatureNavigationContext) => v2FeatureNavigationFor(context).map((item) => item.id)

  it("lists the port v3 destinations in the spec's order, none of them one of the five tabs", () => {
    expect(V2_FEATURE_NAVIGATION.map((item) => [item.id, item.label, item.href])).toEqual([
      ["find-trucks", "Find Trucks", "/v2/landing/trucks"],
      ["invitations", "Invitations", "/v2/invitations"],
      ["saved-jobs", "Saved jobs", "/v2/saved"],
      ["alerts", "Alerts", "/v2/alerts"],
      ["team", "Team", "/v2/team"],
      ["billing", "Billing", "/v2/landing/billing"],
      ["boosts", "Boosts", "/v2/landing/boosts"],
      ["admin", "Admin", "/v2/admin"]
    ])

    const tabIds = new Set(V2_NAVIGATION.map((item) => item.id))
    const tabHrefs = new Set(V2_NAVIGATION.map((item) => item.href))
    expect(V2_FEATURE_NAVIGATION.filter((item) => tabIds.has(item.id) || tabHrefs.has(item.href))).toEqual([])
    expect(V2_FEATURE_NAVIGATION.every((item) => item.icon !== undefined && item.count === undefined)).toBe(true)
    expect(GATES.map((gate) => gate.id)).toEqual(V2_FEATURE_NAVIGATION.map((item) => item.id))
  })

  it("leaves the five tabs as they were for every kind of business", () => {
    const featureIds = new Set(V2_FEATURE_NAVIGATION.map((item) => item.id))

    for (const membership of [member("owner", true, true), member("owner", false, true), member("staff", true, false), member("driver", false, true)]) {
      const tabs = v2NavigationFor(marketplaceCapabilities(membership))
      expect(tabs.filter((item) => featureIds.has(item.id))).toEqual([])
      expect(tabs.length).toBeLessThanOrEqual(5)
    }
  })

  it("offers every entry once every group is supported and the person may use each one", () => {
    expect(ids(EVERYTHING)).toEqual(GATES.map((gate) => gate.id))
  })

  it("offers nothing while no group is supported, as with every adapter today", () => {
    expect(ids({ ...EVERYTHING, supports: marketplaceV2FeatureSupport() })).toEqual([])
  })

  it.each(GATES)("hides $id while the $feature group is unsupported", ({ feature }) => {
    const supports = marketplaceV2FeatureSupport(MARKETPLACE_V2_FEATURES.filter((group) => group !== feature))

    expect(ids({ ...EVERYTHING, supports })).toEqual(GATES.filter((gate) => gate.feature !== feature).map((gate) => gate.id))
  })

  it.each(GATES.filter((gate) => gate.capability !== null))("hides $id from a person without $capability", ({ capability }) => {
    const features = MARKETPLACE_FEATURE_CAPABILITIES.filter((held) => held !== capability)

    expect(ids({ ...EVERYTHING, features })).toEqual(GATES.filter((gate) => gate.capability !== capability).map((gate) => gate.id))
  })

  it("gives the admin console only to LogLoads staff, whatever their organization role", () => {
    expect(ids({ ...EVERYTHING, admin: null })).not.toContain("admin")
    expect(ids({ ...EVERYTHING, admin: { roles: [] } })).not.toContain("admin")
    expect(ids({ ...contextFor(null), admin: LOGLOADS_STAFF })).toEqual(["admin"])
    expect(ids({ ...contextFor(null, marketplaceV2FeatureSupport()), admin: LOGLOADS_STAFF })).toEqual([])
  })

  it("offers a visitor, or a business on neither side, no business entries", () => {
    expect(ids(contextFor(null))).toEqual([])
    expect(ids({ ...EVERYTHING, admin: null, capabilities: null })).toEqual([])
    // An owner with no hauler profile and no landing seat holds team.manage, alert.manage and plan.view, but has no
    // usable business, as in `v2NavigationFor`.
    expect(contextFor(member("owner", false, false)).features).toEqual(["team.manage", "alert.manage", "plan.view"])
    expect(ids(contextFor(member("owner", false, false)))).toEqual([])
  })

  it("never offers Billing to a hauling-only business, which is free forever", () => {
    const hauler = contextFor(member("owner", false, true))

    expect(hauler.features).toContain("plan.view")
    expect(ids(hauler)).not.toContain("billing")
  })

  it.each([
    ["a hauling business's owner", member("owner", false, true), ["invitations", "saved-jobs", "alerts", "team"]],
    ["a hauling business's manager", member("manager", false, true), ["invitations", "saved-jobs", "alerts"]],
    ["a driver", member("driver", false, true), ["invitations", "saved-jobs", "alerts"]],
    ["a landing business's owner", member("owner", true, false), ["find-trucks", "alerts", "team", "billing", "boosts"]],
    ["a landing desk's staff member", member("staff", true, false), ["find-trucks", "alerts", "billing", "boosts"]],
    ["the owner of a business on both sides", member("owner", true, true), ["find-trucks", "invitations", "saved-jobs", "alerts", "team", "billing", "boosts"]]
  ])("gives %s the entries its role allows", (_who, membership, expected) => {
    expect(ids(contextFor(membership))).toEqual(expected)
  })

  it("shows unread counts on the entries it offers, and no badge for zero", () => {
    const items = v2FeatureNavigationFor(contextFor(member("owner", false, true)), { alerts: 0, "find-trucks": 4, invitations: 3 })

    expect(items.map((item) => [item.id, item.count])).toEqual([
      ["invitations", 3],
      ["saved-jobs", undefined],
      ["alerts", undefined],
      ["team", undefined]
    ])
  })

  it("marks the entry current on its own pages, not the landing overview", () => {
    const both = member("owner", true, true)
    const items = [...v2NavigationFor(marketplaceCapabilities(both)), ...v2FeatureNavigationFor({ ...contextFor(both), admin: LOGLOADS_STAFF })]

    expect(activeV2NavId("/v2/landing/trucks", items)).toBe("find-trucks")
    expect(activeV2NavId("/v2/landing/billing", items)).toBe("billing")
    expect(activeV2NavId("/v2/landing/boosts", items)).toBe("boosts")
    expect(activeV2NavId("/v2/landing/jobs", items)).toBe("landing-overview")
    expect(activeV2NavId("/v2/invitations", items)).toBe("invitations")
    expect(activeV2NavId("/v2/saved", items)).toBe("saved-jobs")
    expect(activeV2NavId("/v2/admin", items)).toBe("admin")
  })

  it("keeps the landing entries in the landing workspace and the hauler entries in the hauler workspace", () => {
    for (const pathname of ["/v2/landing/trucks", "/v2/landing/billing", "/v2/landing/boosts"]) {
      expect(v2WorkspaceFor(pathname)).toBe("landing")
    }
    for (const pathname of ["/v2/invitations", "/v2/saved"]) {
      expect(v2WorkspaceFor(pathname)).toBe("hauler")
    }
  })
})

