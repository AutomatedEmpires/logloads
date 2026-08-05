import { createHash } from "node:crypto"

import type { User } from "@logloads/contracts"
import type { LogLoadsDatabaseState } from "@logloads/db"
import {
  PLATFORM_ADMIN_CLAIM_ACTION,
  PLATFORM_ADMIN_SEED_PROFILE_ID
} from "@logloads/services"

export const PLATFORM_ADMIN_SCOPE_VERSION = "logloads-platform-admin-scope-v1"

const CLERK_USER_ID_PATTERN = /^user_[A-Za-z0-9]+$/
const SHA256_PATTERN = /^[0-9a-f]{64}$/

type Environment = Readonly<Record<string, string | undefined>>

export type PlatformAdminPersistentState =
  | "configured"
  | "disabled"
  | "misconfigured"

export type PlatformAdminBootstrapState =
  | "disabled"
  | "enabled"
  | "expired"
  | "misconfigured"

export interface PlatformAdminStatus {
  bootstrap: PlatformAdminBootstrapState
  expiresAt: string | null
  persistent: PlatformAdminPersistentState
  scopeSha256: string | null
  scopeVerified: boolean
}

function canonicalClerkUserIds(env: Environment): {
  entryCount: number
  ids: string[]
  invalidEntryCount: number
} {
  const raw = env.LOGLOADS_PLATFORM_ADMIN_CLERK_IDS ?? ""
  const entries = raw === "" ? [] : raw.split(",")
  const invalidEntryCount = entries.filter(
    (entry) => entry !== entry.trim() || !CLERK_USER_ID_PATTERN.test(entry)
  ).length
  const ids = [...new Set(entries.filter((entry) => CLERK_USER_ID_PATTERN.test(entry)))].sort()

  return { entryCount: entries.length, ids, invalidEntryCount }
}

export function platformAdminScopeMaterial(clerkUserId: string): string {
  return `${PLATFORM_ADMIN_SCOPE_VERSION}\n${clerkUserId}`
}

export function platformAdminScopeSha256(clerkUserId: string): string {
  return createHash("sha256")
    .update(platformAdminScopeMaterial(clerkUserId))
    .digest("hex")
}

function parsedExpiry(value: string | undefined): Date | null {
  if (!value || value.trim() !== value) {
    return null
  }

  const parsed = new Date(value)

  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString() !== value) {
    return null
  }

  return parsed
}

export function platformAdminStatus(
  env: Environment = process.env,
  at = new Date()
): PlatformAdminStatus {
  const { entryCount, ids, invalidEntryCount } = canonicalClerkUserIds(env)
  const expectedScopeSha256 =
    env.LOGLOADS_PLATFORM_ADMIN_EXPECTED_SCOPE_SHA256 ?? ""
  const configuredId = ids.length === 1 ? ids[0] : null
  const scopeSha256 = configuredId
    ? platformAdminScopeSha256(configuredId)
    : null
  const scopeVerified = Boolean(
    configuredId &&
      entryCount === 1 &&
      invalidEntryCount === 0 &&
      SHA256_PATTERN.test(expectedScopeSha256) &&
      expectedScopeSha256 === scopeSha256
  )
  const anyPersistentConfig =
    Boolean(env.LOGLOADS_PLATFORM_ADMIN_CLERK_IDS) ||
    expectedScopeSha256.length > 0
  const persistent: PlatformAdminPersistentState = scopeVerified
    ? "configured"
    : anyPersistentConfig
      ? "misconfigured"
      : "disabled"
  const rawBootstrap = env.LOGLOADS_PLATFORM_ADMIN_BOOTSTRAP ?? ""
  const expiresAt = parsedExpiry(
    env.LOGLOADS_PLATFORM_ADMIN_BOOTSTRAP_EXPIRES_AT
  )
  let bootstrap: PlatformAdminBootstrapState

  if (rawBootstrap === "" || rawBootstrap === "disabled") {
    bootstrap = "disabled"
  } else if (rawBootstrap !== "enabled" || !scopeVerified || !expiresAt) {
    bootstrap = "misconfigured"
  } else if (expiresAt.valueOf() <= at.valueOf()) {
    bootstrap = "expired"
  } else {
    bootstrap = "enabled"
  }

  return {
    bootstrap,
    expiresAt: expiresAt?.toISOString() ?? null,
    persistent,
    scopeSha256,
    scopeVerified
  }
}

/**
 * Ongoing production authority. The temporary claim switch is deliberately not
 * consulted: operators remove it immediately after the one-time claim, while
 * the exact persistent identity and scope assertion remain.
 */
export function isPlatformAdminAllowed(
  profile: Pick<User, "clerkUserId" | "companyId" | "id" | "isActive" | "role">,
  state: Pick<
    LogLoadsDatabaseState,
    "auditEvents" | "organizationMemberships" | "profiles"
  >,
  persistentScopeRequired: boolean,
  env: Environment = process.env
): boolean {
  const seedProfiles = state.profiles.filter(
    (candidate) => candidate.id === PLATFORM_ADMIN_SEED_PROFILE_ID
  )
  const seed = seedProfiles.length === 1 ? seedProfiles[0]! : null
  const admins = state.profiles.filter((candidate) => candidate.role === "admin")
  const identityMappings = state.profiles.filter(
    (candidate) => candidate.clerkUserId === profile.clerkUserId
  )
  const seedIsIntact = Boolean(
    profile.id === PLATFORM_ADMIN_SEED_PROFILE_ID &&
      profile.isActive &&
      profile.role === "admin" &&
      profile.companyId === null &&
      seed &&
      seed.id === profile.id &&
      seed.clerkUserId === profile.clerkUserId &&
      seed.isActive &&
      seed.role === "admin" &&
      seed.companyId === null &&
      seedProfiles.length === 1 &&
      admins.length === 1 &&
      admins[0]?.id === PLATFORM_ADMIN_SEED_PROFILE_ID &&
      identityMappings.length === 1 &&
      identityMappings[0]?.id === PLATFORM_ADMIN_SEED_PROFILE_ID &&
      !state.organizationMemberships.some(
        (membership) => membership.userId === PLATFORM_ADMIN_SEED_PROFILE_ID
      )
  )

  if (!seedIsIntact) {
    return false
  }

  // The seeded admin persona exists only behind the loopback-restricted local
  // dev-session policy. Every real Clerk session requires persistent scope,
  // even when Clerk variables also happen to be present in local development.
  if (!persistentScopeRequired) {
    return true
  }

  const { entryCount, ids, invalidEntryCount } = canonicalClerkUserIds(env)
  const status = platformAdminStatus(env)
  const claimAudits = state.auditEvents.filter(
    (event) => event.action === PLATFORM_ADMIN_CLAIM_ACTION
  )
  const claimAudit = claimAudits.length === 1 ? claimAudits[0]! : null

  return (
    invalidEntryCount === 0 &&
    entryCount === 1 &&
    ids.length === 1 &&
    status.persistent === "configured" &&
    profile.clerkUserId === ids[0] &&
    claimAudit?.entityType === "user" &&
    claimAudit.entityId === PLATFORM_ADMIN_SEED_PROFILE_ID &&
    claimAudit.actorUserId === PLATFORM_ADMIN_SEED_PROFILE_ID &&
    claimAudit.metadata.scopeSha256 === status.scopeSha256
  )
}

export function platformAdminBootstrapAllowed(
  identity: {
    clerkUserId: string
    primaryEmailVerified: boolean
  },
  env: Environment = process.env,
  at = new Date()
): boolean {
  const { entryCount, ids, invalidEntryCount } = canonicalClerkUserIds(env)
  const status = platformAdminStatus(env, at)

  return (
    identity.primaryEmailVerified &&
    invalidEntryCount === 0 &&
    entryCount === 1 &&
    ids.length === 1 &&
    identity.clerkUserId === ids[0] &&
    status.bootstrap === "enabled"
  )
}
