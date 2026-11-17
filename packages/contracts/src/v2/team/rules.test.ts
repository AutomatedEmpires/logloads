import { describe, expect, it } from "vitest"

import { MARKETPLACE_INVITABLE_ROLES, TEAM_INVITE_DEFAULT_DAYS, marketplaceTeamInviteInputSchema, marketplaceTeamScopeInputSchema } from "./rules"

const LANDING = "11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa"

describe("marketplace team invite input", () => {
  it("trims and lower-cases the address and fills an empty landing list", () => {
    expect(marketplaceTeamInviteInputSchema.parse({
      email: "  Rae@Example.test ",
      landingWorkspaceSeat: true,
      role: "manager"
    })).toEqual({
      email: "rae@example.test",
      landingIds: [],
      landingWorkspaceSeat: true,
      role: "manager"
    })
    expect(TEAM_INVITE_DEFAULT_DAYS).toBe(14)
    expect([...MARKETPLACE_INVITABLE_ROLES]).toEqual(["manager", "staff", "driver"])
  })

  it("refuses an owner, a driver with a landing seat, and a landing limit without a seat", () => {
    expect(marketplaceTeamInviteInputSchema.safeParse({ email: "rae@example.test", landingWorkspaceSeat: false, role: "owner" }).success).toBe(false)
    expect(marketplaceTeamInviteInputSchema.safeParse({
      email: "rae@example.test",
      landingWorkspaceSeat: true,
      role: "driver"
    }).error?.issues[0]?.message).toBe("A driver never holds a Landing Operator seat")
    expect(marketplaceTeamInviteInputSchema.safeParse({
      email: "rae@example.test",
      landingIds: [LANDING],
      landingWorkspaceSeat: false,
      role: "staff"
    }).error?.issues[0]?.message).toMatch(/Landing Operator seat/)
  })

  it("accepts a seated manager limited to one landing, and refuses a day count outside 1–30", () => {
    expect(marketplaceTeamInviteInputSchema.parse({
      email: "rae@example.test",
      landingIds: [LANDING, LANDING],
      landingWorkspaceSeat: true,
      role: "staff",
      validForDays: 30
    }).validForDays).toBe(30)
    expect(marketplaceTeamInviteInputSchema.safeParse({
      email: "rae@example.test",
      landingWorkspaceSeat: false,
      role: "driver",
      validForDays: 0
    }).success).toBe(false)
    expect(marketplaceTeamInviteInputSchema.safeParse({
      email: "not-an-email",
      landingWorkspaceSeat: false,
      role: "driver"
    }).success).toBe(false)
  })

  it("parses a scope change", () => {
    expect(marketplaceTeamScopeInputSchema.parse({ landingIds: [], membershipId: LANDING })).toEqual({
      landingIds: [],
      membershipId: LANDING
    })
    expect(marketplaceTeamScopeInputSchema.safeParse({ landingIds: ["north-pine"], membershipId: LANDING }).success).toBe(false)
  })
})
