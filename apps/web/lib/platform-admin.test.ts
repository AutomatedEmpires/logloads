import { describe, expect, it } from "vitest"

import { isPlatformAdminAllowed, platformAdminClerkAllowlist } from "./platform-admin"

const admin = { clerkUserId: "user_real", role: "admin" as const }

describe("platform admin allowlist", () => {
  it("parses a comma-separated list, trimming padding and dropping blanks", () => {
    const list = platformAdminClerkAllowlist({
      LOGLOADS_PLATFORM_ADMIN_CLERK_IDS: " user_a , user_b,,  "
    })

    expect([...list].sort()).toEqual(["user_a", "user_b"])
  })

  it("grants admin only when the stored role AND the allowlist agree under Clerk", () => {
    const env = { LOGLOADS_PLATFORM_ADMIN_CLERK_IDS: "user_real" }

    expect(isPlatformAdminAllowed(admin, true, env)).toBe(true)
    expect(isPlatformAdminAllowed({ ...admin, clerkUserId: "user_other" }, true, env)).toBe(false)
    expect(isPlatformAdminAllowed({ clerkUserId: "user_real", role: "driver" }, true, env)).toBe(false)
  })

  it("revokes when the id leaves the environment, with no data change", () => {
    expect(isPlatformAdminAllowed(admin, true, {})).toBe(false)
  })

  it("never grants the seed admin under real Clerk identity", () => {
    const seed = { clerkUserId: "clerk-admin-1", role: "admin" as const }

    expect(isPlatformAdminAllowed(seed, true, {
      LOGLOADS_PLATFORM_ADMIN_CLERK_IDS: "user_real"
    })).toBe(false)
  })

  it("lets the stored role stand alone when Clerk is not configured (bench, demo)", () => {
    const seed = { clerkUserId: "clerk-admin-1", role: "admin" as const }

    expect(isPlatformAdminAllowed(seed, false, {})).toBe(true)
  })
})