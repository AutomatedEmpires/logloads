import type { User } from "@logloads/contracts"

type EnvShape = Record<string, string | undefined>

/** Comma-separated Clerk user ids granted platform-admin authority. */
export function platformAdminClerkAllowlist(env: EnvShape = process.env): Set<string> {
  return new Set(
    (env.LOGLOADS_PLATFORM_ADMIN_CLERK_IDS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  )
}

/**
 * Admin authority requires BOTH the stored role and, whenever real Clerk
 * identity is configured, current membership in the environment allowlist.
 * Removing an id from the environment therefore revokes admin at the next
 * session build with no data surgery, and the seed admin profile can never
 * hold production authority because its placeholder Clerk id is never
 * allowlisted. Without Clerk (local bench, demo mode) the stored role stands
 * alone, so the seeded admin persona keeps working.
 */
export function isPlatformAdminAllowed(
  profile: Pick<User, "role" | "clerkUserId">,
  clerkConfigured: boolean,
  env: EnvShape = process.env
): boolean {
  if (profile.role !== "admin") {
    return false
  }

  if (!clerkConfigured) {
    return true
  }

  return platformAdminClerkAllowlist(env).has(profile.clerkUserId)
}