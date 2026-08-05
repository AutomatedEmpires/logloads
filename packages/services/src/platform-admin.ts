import { randomUUID } from "node:crypto"

import { auditEventSchema } from "@logloads/contracts"
import type { LogLoadsDatabaseState } from "@logloads/db"
import { z } from "zod"

import { DomainRefusalError } from "./utils"

export const PLATFORM_ADMIN_SEED_PROFILE_ID =
  "11111111-1111-4111-8111-111111111111"
export const PLATFORM_ADMIN_SEED_CLERK_PLACEHOLDER = "clerk-admin-1"
export const PLATFORM_ADMIN_CLAIM_ACTION = "platform_admin_claimed"

const claimFounderPlatformAdminInputSchema = z
  .object({
    clerkUserId: z.string().regex(/^user_[A-Za-z0-9]+$/),
    scopeSha256: z.string().regex(/^[0-9a-f]{64}$/),
    verifiedPrimaryEmail: z.string().trim().toLowerCase().email()
  })
  .strict()

/**
 * Binds the one pre-existing platform-admin profile to the authenticated founder.
 *
 * The route establishes Clerk identity, verified-email status, the temporary
 * bootstrap gate, and the persistent scope assertion. This service owns the
 * canonical-state invariants and runs inside the operating-state CAS:
 *
 * - only the fixed seed profile can be claimed;
 * - a second admin is never created or promoted;
 * - a Clerk identity already linked elsewhere cannot be reused; and
 * - a successful claim writes exactly one non-sensitive audit event.
 */
export function claimFounderPlatformAdmin(
  state: LogLoadsDatabaseState,
  rawInput: unknown,
  at = new Date().toISOString()
) {
  const input = claimFounderPlatformAdminInputSchema.parse(rawInput)
  const before = new Date(at)

  if (!Number.isFinite(before.valueOf())) {
    throw new DomainRefusalError("The platform-admin claim time is invalid")
  }

  const admins = state.profiles.filter((profile) => profile.role === "admin")
  const seed = state.profiles.find(
    (profile) => profile.id === PLATFORM_ADMIN_SEED_PROFILE_ID
  )

  if (
    !seed ||
    admins.length !== 1 ||
    admins[0]?.id !== PLATFORM_ADMIN_SEED_PROFILE_ID ||
    !seed.isActive ||
    seed.companyId !== null ||
    state.organizationMemberships.some(
      (membership) => membership.userId === PLATFORM_ADMIN_SEED_PROFILE_ID
    )
  ) {
    throw new DomainRefusalError(
      "The canonical platform-admin seed profile is not uniquely claimable"
    )
  }

  const allClaimAudits = state.auditEvents.filter(
    (event) => event.action === PLATFORM_ADMIN_CLAIM_ACTION
  )
  const existingClaimAudits = allClaimAudits.filter(
    (event) =>
      event.entityType === "user" &&
      event.entityId === PLATFORM_ADMIN_SEED_PROFILE_ID
  )

  if (allClaimAudits.length !== existingClaimAudits.length) {
    throw new DomainRefusalError(
      "A platform-admin claim record targets an unexpected entity"
    )
  }

  if (seed.clerkUserId === input.clerkUserId) {
    const [claimAudit] = existingClaimAudits

    if (
      existingClaimAudits.length !== 1 ||
      claimAudit?.actorUserId !== PLATFORM_ADMIN_SEED_PROFILE_ID ||
      claimAudit.metadata.scopeSha256 !== input.scopeSha256
    ) {
      throw new DomainRefusalError(
        "The existing platform-admin identity does not have one matching claim record"
      )
    }

    return { changed: false, profile: seed }
  }

  if (
    seed.clerkUserId !== PLATFORM_ADMIN_SEED_CLERK_PLACEHOLDER ||
    existingClaimAudits.length > 0
  ) {
    throw new DomainRefusalError(
      "The platform-admin seed profile is already bound to another identity"
    )
  }

  if (
    state.profiles.some(
      (profile) =>
        profile.id !== PLATFORM_ADMIN_SEED_PROFILE_ID &&
        (profile.clerkUserId === input.clerkUserId ||
          profile.email?.trim().toLowerCase() === input.verifiedPrimaryEmail)
    )
  ) {
    throw new DomainRefusalError(
      "The authorized Clerk identity or verified email is already linked to another profile"
    )
  }

  seed.clerkUserId = input.clerkUserId
  seed.email = input.verifiedPrimaryEmail
  seed.updatedAt = before.toISOString()

  state.auditEvents.push(
    auditEventSchema.parse({
      action: PLATFORM_ADMIN_CLAIM_ACTION,
      actorUserId: seed.id,
      createdAt: before.toISOString(),
      entityId: seed.id,
      entityType: "user",
      id: randomUUID(),
      metadata: {
        source: "founder_bootstrap_v1",
        scopeSha256: input.scopeSha256
      }
    })
  )

  return { changed: true, profile: seed }
}
