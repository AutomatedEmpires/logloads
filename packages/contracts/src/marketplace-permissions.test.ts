import { describe, expect, it } from "vitest"

import {
  MARKETPLACE_CAPABILITIES,
  MARKETPLACE_FEATURE_CAPABILITIES,
  MARKETPLACE_MEMBER_ROLES,
  marketplaceCapabilities,
  marketplaceFeatureCan,
  marketplaceFeatureCapabilities,
  type MarketplaceFeatureCapability,
  type MarketplaceMemberRole,
  type MarketplaceMembership
} from "./marketplace-permissions"
import { MARKETPLACE_V2_FEATURES, marketplaceV2FeatureSupport } from "./marketplace-port-v3"

/**
 * Port v3 feature capabilities (#244). Each rule restates the check inside the stage 03–26 functions it names, from
 * the same membership the store-reported capabilities use. The store-reported set must stay exactly the seven
 * `get_viewer_marketplace_access` returns, which CI compares against PostgreSQL.
 */

const member = (role: MarketplaceMemberRole, landingWorkspaceSeat: boolean, haulerProfile: boolean): MarketplaceMembership => ({
  haulerProfile,
  landingWorkspaceSeat,
  role
})

/** Every membership shape: four roles, with and without a seat and a hauler profile. */
const EVERY_MEMBERSHIP = MARKETPLACE_MEMBER_ROLES.flatMap((role) =>
  [false, true].flatMap((seat) => [false, true].map((hauler) => member(role, seat, hauler))))

function holders(capability: MarketplaceFeatureCapability): string[] {
  return EVERY_MEMBERSHIP
    .filter((membership) => marketplaceFeatureCan(membership, capability))
    .map((membership) => `${membership.role}${membership.landingWorkspaceSeat ? "+seat" : ""}${membership.haulerProfile ? "+hauler" : ""}`)
}

describe("store-reported capabilities", () => {
  it("stay the seven get_viewer_marketplace_access reports, with no feature capability among them", () => {
    expect([...MARKETPLACE_CAPABILITIES]).toEqual([
      "job.publish",
      "landing.manage",
      "inquiry.respond",
      "interest.express",
      "interest.withdraw",
      "interest.reply",
      "equipment.manage"
    ])

    for (const capability of MARKETPLACE_FEATURE_CAPABILITIES) {
      expect(MARKETPLACE_CAPABILITIES as readonly string[]).not.toContain(capability)
    }

    for (const membership of EVERY_MEMBERSHIP) {
      for (const capability of marketplaceCapabilities(membership)) {
        expect(MARKETPLACE_FEATURE_CAPABILITIES as readonly string[]).not.toContain(capability)
      }
    }
  })
})

describe("feature capabilities (#244)", () => {
  it("lets only an owner manage the team, of a landing or a hauling business (invite_team_member, 26-A)", () => {
    expect(holders("team.manage")).toEqual(["owner", "owner+hauler", "owner+seat", "owner+seat+hauler"])
  })

  it("lets owners and managers with a seat send targeted invitations (reserve_targeted_invitation)", () => {
    expect(holders("invitation.send")).toEqual(["owner+seat", "owner+seat+hauler", "manager+seat", "manager+seat+hauler"])
  })

  it("lets the landing desk estimate boosts and search trucks, never a driver even with a seat flag", () => {
    const desk = ["owner+seat", "owner+seat+hauler", "manager+seat", "manager+seat+hauler", "staff+seat", "staff+seat+hauler"]

    expect(holders("boost.estimate")).toEqual(desk)
    expect(holders("truck.search")).toEqual(desk)
    expect(marketplaceFeatureCan(member("driver", true, false), "truck.search")).toBe(false)
  })

  it("lets every member of a hauling business answer invitations and save jobs (respond_to_invitation, 26-C)", () => {
    const hauling = ["owner+hauler", "owner+seat+hauler", "manager+hauler", "manager+seat+hauler", "staff+hauler", "staff+seat+hauler", "driver+hauler", "driver+seat+hauler"]

    expect(holders("invitation.respond")).toEqual(hauling)
    expect(holders("saved_job.manage")).toEqual(hauling)
  })

  it("lets every member keep their own alerts and read the plan (saved_searches_own, get_org_entitlement_state)", () => {
    expect(holders("alert.manage")).toHaveLength(EVERY_MEMBERSHIP.length)
    expect(holders("plan.view")).toHaveLength(EVERY_MEMBERSHIP.length)
  })

  it("grants nothing without a membership", () => {
    expect(marketplaceFeatureCapabilities(null)).toEqual([])

    for (const capability of MARKETPLACE_FEATURE_CAPABILITIES) {
      expect(marketplaceFeatureCan(null, capability)).toBe(false)
    }
  })

  it("lists a membership's capabilities in the vocabulary's order", () => {
    expect(marketplaceFeatureCapabilities(member("owner", true, true))).toEqual([...MARKETPLACE_FEATURE_CAPABILITIES])
    expect(marketplaceFeatureCapabilities(member("staff", true, false))).toEqual(["boost.estimate", "truck.search", "alert.manage", "plan.view"])
    expect(marketplaceFeatureCapabilities(member("driver", false, true))).toEqual(["invitation.respond", "saved_job.manage", "alert.manage", "plan.view"])
  })
})

describe("port v3 feature groups (#244)", () => {
  it("names one group per task folder", () => {
    expect([...MARKETPLACE_V2_FEATURES]).toEqual(["jobs", "billing", "team", "invites", "trucks", "alerts", "notify", "boosts", "admin"])
  })

  it("builds a frozen support record that is false unless a group is named", () => {
    const none = marketplaceV2FeatureSupport()
    const some = marketplaceV2FeatureSupport(["team", "billing"])

    expect(Object.keys(none)).toEqual([...MARKETPLACE_V2_FEATURES])
    expect(Object.values(none).every((supported) => supported === false)).toBe(true)
    expect(MARKETPLACE_V2_FEATURES.filter((feature) => some[feature])).toEqual(["billing", "team"])
    expect(Object.isFrozen(some)).toBe(true)
  })
})
