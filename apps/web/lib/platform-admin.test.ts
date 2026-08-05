import { createInMemoryDatabase, type LogLoadsDatabaseState } from "@logloads/db"
import {
  claimFounderPlatformAdmin,
  PLATFORM_ADMIN_CLAIM_ACTION,
  PLATFORM_ADMIN_SEED_PROFILE_ID
} from "@logloads/services"
import { describe, expect, it } from "vitest"

import {
  isPlatformAdminAllowed,
  platformAdminBootstrapAllowed,
  platformAdminScopeMaterial,
  platformAdminScopeSha256,
  platformAdminStatus
} from "./platform-admin"

const CLERK_USER_ID = "user_2zFounderAdmin123"
const NOW = new Date("2026-08-05T17:00:00.000Z")
const EXPIRES = "2026-08-05T18:00:00.000Z"

function environment(overrides: Record<string, string | undefined> = {}) {
  return {
    LOGLOADS_PLATFORM_ADMIN_BOOTSTRAP: "enabled",
    LOGLOADS_PLATFORM_ADMIN_BOOTSTRAP_EXPIRES_AT: EXPIRES,
    LOGLOADS_PLATFORM_ADMIN_CLERK_IDS: CLERK_USER_ID,
    LOGLOADS_PLATFORM_ADMIN_EXPECTED_SCOPE_SHA256:
      platformAdminScopeSha256(CLERK_USER_ID),
    ...overrides
  }
}

function seedProfile(state: LogLoadsDatabaseState) {
  const seed = state.profiles.find(
    (profile) => profile.id === PLATFORM_ADMIN_SEED_PROFILE_ID
  )

  if (!seed) {
    throw new Error("Platform-admin seed fixture missing")
  }

  return seed
}

function claimedState(): LogLoadsDatabaseState {
  const state = createInMemoryDatabase()

  claimFounderPlatformAdmin(
    state,
    {
      clerkUserId: CLERK_USER_ID,
      scopeSha256: platformAdminScopeSha256(CLERK_USER_ID),
      verifiedPrimaryEmail: "founder@logloads.com"
    },
    NOW.toISOString()
  )

  return state
}

describe("platform-admin scope", () => {
  it("uses the fixed v1 material and a lower-case SHA-256 digest", () => {
    expect(platformAdminScopeMaterial(CLERK_USER_ID)).toBe(
      `logloads-platform-admin-scope-v1\n${CLERK_USER_ID}`
    )
    expect(platformAdminScopeSha256(CLERK_USER_ID)).toMatch(/^[0-9a-f]{64}$/)
  })

  it("requires exactly one canonical real Clerk user id", () => {
    expect(platformAdminStatus(environment(), NOW)).toMatchObject({
      bootstrap: "enabled",
      expiresAt: EXPIRES,
      persistent: "configured",
      scopeVerified: true
    })

    for (const configuredIds of [
      "",
      "clerk-admin-1",
      "user_first,user_second",
      `${CLERK_USER_ID},*`,
      `${CLERK_USER_ID},${CLERK_USER_ID}`,
      ` ${CLERK_USER_ID}`,
      `${CLERK_USER_ID} `
    ]) {
      expect(
        platformAdminStatus(
          environment({ LOGLOADS_PLATFORM_ADMIN_CLERK_IDS: configuredIds }),
          NOW
        ).persistent
      ).not.toBe("configured")
    }
  })

  it("fails closed on a missing, upper-case, padded, or drifting digest", () => {
    const digest = platformAdminScopeSha256(CLERK_USER_ID)

    for (const expected of [
      "",
      digest.toUpperCase(),
      ` ${digest}`,
      `${digest} `,
      "b".repeat(64)
    ]) {
      expect(
        platformAdminStatus(
          environment({
            LOGLOADS_PLATFORM_ADMIN_EXPECTED_SCOPE_SHA256: expected
          }),
          NOW
        )
      ).toMatchObject({
        bootstrap: "misconfigured",
        persistent: "misconfigured",
        scopeVerified: false
      })
    }
  })
})

describe("platform-admin authority", () => {
  it("keeps the uniquely claimed seed authorized after the temporary bootstrap gate is removed", () => {
    const state = claimedState()
    const env = environment({
      LOGLOADS_PLATFORM_ADMIN_BOOTSTRAP: "disabled",
      LOGLOADS_PLATFORM_ADMIN_BOOTSTRAP_EXPIRES_AT: undefined
    })

    expect(
      isPlatformAdminAllowed(
        seedProfile(state),
        state,
        true,
        env
      )
    ).toBe(true)
    expect(platformAdminStatus(env, NOW).bootstrap).toBe("disabled")
  })

  it("requires both the stored admin role and the exact persistent identity", () => {
    const wrongRole = claimedState()
    seedProfile(wrongRole).role = "driver"

    expect(
      isPlatformAdminAllowed(
        seedProfile(wrongRole),
        wrongRole,
        true,
        environment()
      )
    ).toBe(false)

    const wrongIdentity = claimedState()
    expect(
      isPlatformAdminAllowed(
        seedProfile(wrongIdentity),
        wrongIdentity,
        true,
        environment({
          LOGLOADS_PLATFORM_ADMIN_CLERK_IDS: "user_2zOtherAdmin456",
          LOGLOADS_PLATFORM_ADMIN_EXPECTED_SCOPE_SHA256:
            platformAdminScopeSha256("user_2zOtherAdmin456")
        })
      )
    ).toBe(false)
  })

  it("never grants an inactive stored admin", () => {
    const state = claimedState()
    seedProfile(state).isActive = false

    expect(
      isPlatformAdminAllowed(
        seedProfile(state),
        state,
        true,
        environment()
      )
    ).toBe(false)
  })

  it("preserves the seed admin persona only on the provider-free local bench", () => {
    const state = createInMemoryDatabase()

    expect(
      isPlatformAdminAllowed(
        seedProfile(state),
        state,
        false,
        {}
      )
    ).toBe(true)

    const nonSeed = state.profiles[1]!
    seedProfile(state).role = "driver"
    nonSeed.role = "admin"

    expect(isPlatformAdminAllowed(nonSeed, state, false, {})).toBe(false)
  })

  it("refuses duplicate identity mappings and any second admin", () => {
    const duplicateMapping = claimedState()
    duplicateMapping.profiles[1]!.clerkUserId = CLERK_USER_ID

    expect(
      isPlatformAdminAllowed(
        seedProfile(duplicateMapping),
        duplicateMapping,
        true,
        environment()
      )
    ).toBe(false)

    const secondAdmin = claimedState()
    secondAdmin.profiles[1]!.role = "admin"

    expect(
      isPlatformAdminAllowed(
        seedProfile(secondAdmin),
        secondAdmin,
        true,
        environment()
      )
    ).toBe(false)
  })

  it("refuses a wrong or cross-wired canonical seed", () => {
    const wrongProfile = claimedState()
    const other = wrongProfile.profiles[1]!
    seedProfile(wrongProfile).role = "driver"
    other.role = "admin"
    other.clerkUserId = CLERK_USER_ID

    expect(
      isPlatformAdminAllowed(other, wrongProfile, true, environment())
    ).toBe(false)

    const joinedSeed = claimedState()
    joinedSeed.organizationMemberships.push({
      ...joinedSeed.organizationMemberships[0]!,
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      userId: PLATFORM_ADMIN_SEED_PROFILE_ID
    })

    expect(
      isPlatformAdminAllowed(
        seedProfile(joinedSeed),
        joinedSeed,
        true,
        environment()
      )
    ).toBe(false)
  })

  it("requires one matching claim audit and refuses missing, mismatched, or stray claims", () => {
    const missing = claimedState()
    missing.auditEvents = missing.auditEvents.filter(
      (event) => event.action !== PLATFORM_ADMIN_CLAIM_ACTION
    )

    expect(
      isPlatformAdminAllowed(seedProfile(missing), missing, true, environment())
    ).toBe(false)

    const mismatched = claimedState()
    const mismatchAudit = mismatched.auditEvents.find(
      (event) => event.action === PLATFORM_ADMIN_CLAIM_ACTION
    )!
    mismatchAudit.metadata.scopeSha256 = "b".repeat(64)

    expect(
      isPlatformAdminAllowed(
        seedProfile(mismatched),
        mismatched,
        true,
        environment()
      )
    ).toBe(false)

    const stray = claimedState()
    const matchingAudit = stray.auditEvents.find(
      (event) => event.action === PLATFORM_ADMIN_CLAIM_ACTION
    )!
    stray.auditEvents.push({
      ...matchingAudit,
      actorUserId: null,
      entityId: stray.profiles[1]!.id,
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
    })

    expect(
      isPlatformAdminAllowed(seedProfile(stray), stray, true, environment())
    ).toBe(false)
  })
})

describe("platform-admin bootstrap eligibility", () => {
  it("requires the exact configured identity and a verified primary email", () => {
    expect(
      platformAdminBootstrapAllowed(
        { clerkUserId: CLERK_USER_ID, primaryEmailVerified: true },
        environment(),
        NOW
      )
    ).toBe(true)
    expect(
      platformAdminBootstrapAllowed(
        { clerkUserId: CLERK_USER_ID, primaryEmailVerified: false },
        environment(),
        NOW
      )
    ).toBe(false)
    expect(
      platformAdminBootstrapAllowed(
        {
          clerkUserId: "user_2zOtherAdmin456",
          primaryEmailVerified: true
        },
        environment(),
        NOW
      )
    ).toBe(false)
  })

  it("requires an enabled gate with a strict future ISO expiry", () => {
    expect(
      platformAdminStatus(
        environment({ LOGLOADS_PLATFORM_ADMIN_BOOTSTRAP: "disabled" }),
        NOW
      ).bootstrap
    ).toBe("disabled")
    expect(
      platformAdminStatus(
        environment({ LOGLOADS_PLATFORM_ADMIN_BOOTSTRAP: " enabled " }),
        NOW
      ).bootstrap
    ).toBe("misconfigured")
    expect(
      platformAdminStatus(
        environment({ LOGLOADS_PLATFORM_ADMIN_BOOTSTRAP: "ENABLED" }),
        NOW
      ).bootstrap
    ).toBe("misconfigured")
    expect(
      platformAdminStatus(
        environment({
          LOGLOADS_PLATFORM_ADMIN_BOOTSTRAP_EXPIRES_AT:
            "2026-08-05T16:59:59.000Z"
        }),
        NOW
      ).bootstrap
    ).toBe("expired")

    for (const expiry of [
      "",
      "2026-08-05T18:00:00Z",
      " 2026-08-05T18:00:00.000Z",
      "tomorrow"
    ]) {
      expect(
        platformAdminStatus(
          environment({
            LOGLOADS_PLATFORM_ADMIN_BOOTSTRAP_EXPIRES_AT: expiry
          }),
          NOW
        ).bootstrap
      ).toBe("misconfigured")
    }
  })
})
