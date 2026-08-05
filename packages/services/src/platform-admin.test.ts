import { createInMemoryDatabase } from "@logloads/db"
import { describe, expect, it } from "vitest"

import {
  claimFounderPlatformAdmin,
  PLATFORM_ADMIN_CLAIM_ACTION,
  PLATFORM_ADMIN_SEED_CLERK_PLACEHOLDER,
  PLATFORM_ADMIN_SEED_PROFILE_ID
} from "./platform-admin"

const CLERK_USER_ID = "user_2zFounderAdmin123"
const OTHER_CLERK_USER_ID = "user_2zOtherAdmin456"
const SCOPE_SHA256 = "a".repeat(64)
const CLAIMED_AT = "2026-08-05T17:00:00.000Z"

function claimInput(overrides: Record<string, unknown> = {}) {
  return {
    clerkUserId: CLERK_USER_ID,
    scopeSha256: SCOPE_SHA256,
    verifiedPrimaryEmail: "Founder@LogLoads.com",
    ...overrides
  }
}

describe("claimFounderPlatformAdmin", () => {
  it("claims only the fixed seed admin and records one scope-only audit", () => {
    const state = createInMemoryDatabase()
    const profileCount = state.profiles.length

    const result = claimFounderPlatformAdmin(state, claimInput(), CLAIMED_AT)

    expect(result.changed).toBe(true)
    expect(state.profiles).toHaveLength(profileCount)
    expect(state.profiles.filter((profile) => profile.role === "admin")).toHaveLength(1)
    expect(result.profile).toMatchObject({
      clerkUserId: CLERK_USER_ID,
      email: "founder@logloads.com",
      id: PLATFORM_ADMIN_SEED_PROFILE_ID,
      role: "admin",
      updatedAt: CLAIMED_AT
    })

    const audits = state.auditEvents.filter(
      (event) => event.action === PLATFORM_ADMIN_CLAIM_ACTION
    )

    expect(audits).toHaveLength(1)
    expect(audits[0]).toMatchObject({
      actorUserId: PLATFORM_ADMIN_SEED_PROFILE_ID,
      createdAt: CLAIMED_AT,
      entityId: PLATFORM_ADMIN_SEED_PROFILE_ID,
      entityType: "user",
      metadata: {
        scopeSha256: SCOPE_SHA256,
        source: "founder_bootstrap_v1"
      }
    })
    expect(JSON.stringify(audits[0])).not.toContain(CLERK_USER_ID)
    expect(JSON.stringify(audits[0])).not.toContain("founder@logloads.com")
  })

  it("is idempotent for the same identity, scope, and existing claim audit", () => {
    const state = createInMemoryDatabase()

    claimFounderPlatformAdmin(state, claimInput(), CLAIMED_AT)
    const beforeReplay = structuredClone(state)
    const replay = claimFounderPlatformAdmin(
      state,
      claimInput({ verifiedPrimaryEmail: "new-primary@logloads.com" }),
      "2026-08-05T17:05:00.000Z"
    )

    expect(replay.changed).toBe(false)
    expect(state).toEqual(beforeReplay)
    expect(
      state.auditEvents.filter(
        (event) => event.action === PLATFORM_ADMIN_CLAIM_ACTION
      )
    ).toHaveLength(1)
  })

  it("refuses a replay whose persistent scope no longer matches", () => {
    const state = createInMemoryDatabase()

    claimFounderPlatformAdmin(state, claimInput(), CLAIMED_AT)
    const beforeReplay = structuredClone(state)

    expect(() =>
      claimFounderPlatformAdmin(
        state,
        claimInput({ scopeSha256: "b".repeat(64) }),
        "2026-08-05T17:05:00.000Z"
      )
    ).toThrow("matching claim record")
    expect(state).toEqual(beforeReplay)
  })

  it("refuses an identity already linked to another profile", () => {
    const state = createInMemoryDatabase()
    state.profiles[1]!.clerkUserId = CLERK_USER_ID
    const before = structuredClone(state)

    expect(() =>
      claimFounderPlatformAdmin(state, claimInput(), CLAIMED_AT)
    ).toThrow("already linked to another profile")
    expect(state).toEqual(before)
  })

  it("refuses a verified primary email already linked to another profile", () => {
    const state = createInMemoryDatabase()
    state.profiles[1]!.email = "founder@logloads.com"
    const before = structuredClone(state)

    expect(() =>
      claimFounderPlatformAdmin(state, claimInput(), CLAIMED_AT)
    ).toThrow("verified email is already linked")
    expect(state).toEqual(before)
  })

  it("refuses a seed admin that has joined an organization", () => {
    const state = createInMemoryDatabase()
    state.organizationMemberships.push({
      ...state.organizationMemberships[0]!,
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      userId: PLATFORM_ADMIN_SEED_PROFILE_ID
    })
    const before = structuredClone(state)

    expect(() =>
      claimFounderPlatformAdmin(state, claimInput(), CLAIMED_AT)
    ).toThrow("not uniquely claimable")
    expect(state).toEqual(before)
  })

  it("refuses a replaced seed identity instead of taking it over", () => {
    const state = createInMemoryDatabase()
    const seed = state.profiles.find(
      (profile) => profile.id === PLATFORM_ADMIN_SEED_PROFILE_ID
    )!
    seed.clerkUserId = OTHER_CLERK_USER_ID
    const before = structuredClone(state)

    expect(() =>
      claimFounderPlatformAdmin(state, claimInput(), CLAIMED_AT)
    ).toThrow("already bound to another identity")
    expect(state).toEqual(before)
  })

  it("refuses to operate when any second admin profile exists", () => {
    const state = createInMemoryDatabase()
    state.profiles[1]!.role = "admin"
    const before = structuredClone(state)

    expect(() =>
      claimFounderPlatformAdmin(state, claimInput(), CLAIMED_AT)
    ).toThrow("not uniquely claimable")
    expect(state).toEqual(before)
  })

  it("refuses a pre-existing claim audit for any other entity", () => {
    const state = createInMemoryDatabase()
    state.auditEvents.push({
      action: PLATFORM_ADMIN_CLAIM_ACTION,
      actorUserId: null,
      createdAt: CLAIMED_AT,
      entityId: "22222222-2222-4222-8222-222222222221",
      entityType: "user",
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      metadata: { scopeSha256: SCOPE_SHA256 }
    })
    const before = structuredClone(state)

    expect(() =>
      claimFounderPlatformAdmin(state, claimInput(), CLAIMED_AT)
    ).toThrow("unexpected entity")
    expect(state).toEqual(before)
  })

  it("rejects placeholder or malformed claim inputs before mutation", () => {
    const state = createInMemoryDatabase()
    const before = structuredClone(state)

    expect(() =>
      claimFounderPlatformAdmin(
        state,
        claimInput({ clerkUserId: PLATFORM_ADMIN_SEED_CLERK_PLACEHOLDER }),
        CLAIMED_AT
      )
    ).toThrow()
    expect(() =>
      claimFounderPlatformAdmin(
        state,
        claimInput({ scopeSha256: SCOPE_SHA256.toUpperCase() }),
        CLAIMED_AT
      )
    ).toThrow()
    expect(state).toEqual(before)
  })
})
