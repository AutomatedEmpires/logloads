/**
 * Marketplace V2 capabilities — the load-board permission vocabulary.
 *
 * This is NOT a second role system. Roles and the landing-seat flag are exactly those of
 * `marketplace.organization_memberships` in the normalized-v2 prototype
 * (architecture/normalized-v2/02_access.sql), and every rule below restates one of its RLS policies so the
 * application refuses the same things the database will:
 *
 *   ALL  = owner, manager, staff, driver     DESK = owner, manager, staff     MGR = owner, manager
 *
 *   job.publish        job_postings insert/update            DESK + landing workspace seat
 *   landing.manage     landings / landing_private_details    MGR  + landing workspace seat
 *   inquiry.respond    can_access_interest(…, 'landing')     DESK + landing workspace seat
 *   interest.express   interests_hauler_insert               ALL  + hauler profile
 *   interest.withdraw  interests_hauler_edit                 ALL  + hauler profile
 *   interest.reply     can_access_interest(…, 'hauler')      ALL  + hauler profile
 *   equipment.manage   equipment_units insert/update         DESK + hauler profile
 *
 * Drivers never hold a landing workspace seat (tg_membership_guard), so no driver can obtain a landing
 * capability even if a caller passes one. Legacy pilot roles are translated to these memberships by the
 * pilot adapter only (packages/services/src/marketplace-access.ts); legacy actions such as
 * `request_assignment` or `publish_load` grant nothing here.
 */

export const MARKETPLACE_MEMBER_ROLES = ["owner", "manager", "staff", "driver"] as const
export type MarketplaceMemberRole = (typeof MARKETPLACE_MEMBER_ROLES)[number]

export const MARKETPLACE_CAPABILITIES = [
  "job.publish",
  "landing.manage",
  "inquiry.respond",
  "interest.express",
  "interest.withdraw",
  "interest.reply",
  "equipment.manage"
] as const
export type MarketplaceCapability = (typeof MARKETPLACE_CAPABILITIES)[number]

/** One person's membership in one organization, as the normalized schema records it. */
export interface MarketplaceMembership {
  role: MarketplaceMemberRole
  /** `organization_memberships.landing_workspace_seat`: a paid Landing Operator desk seat. */
  landingWorkspaceSeat: boolean
  /** The organization operates as a hauling business (has a hauler profile). */
  haulerProfile: boolean
}

const DESK: readonly MarketplaceMemberRole[] = ["owner", "manager", "staff"]
const MGR: readonly MarketplaceMemberRole[] = ["owner", "manager"]

const RULES: Readonly<Record<MarketplaceCapability, { roles: readonly MarketplaceMemberRole[]; side: "landing" | "hauler" }>> = {
  "equipment.manage": { roles: DESK, side: "hauler" },
  "inquiry.respond": { roles: DESK, side: "landing" },
  "interest.express": { roles: MARKETPLACE_MEMBER_ROLES, side: "hauler" },
  "interest.reply": { roles: MARKETPLACE_MEMBER_ROLES, side: "hauler" },
  "interest.withdraw": { roles: MARKETPLACE_MEMBER_ROLES, side: "hauler" },
  "job.publish": { roles: DESK, side: "landing" },
  "landing.manage": { roles: MGR, side: "landing" }
}

export function marketplaceCan(membership: MarketplaceMembership | null, capability: MarketplaceCapability): boolean {
  if (!membership) {
    return false
  }

  const rule = RULES[capability]

  if (!rule.roles.includes(membership.role)) {
    return false
  }

  if (rule.side === "landing") {
    // A driver can never hold a landing seat, whatever the input claims.
    return membership.landingWorkspaceSeat && membership.role !== "driver"
  }

  return membership.haulerProfile
}

export function marketplaceCapabilities(membership: MarketplaceMembership | null): MarketplaceCapability[] {
  return MARKETPLACE_CAPABILITIES.filter((capability) => marketplaceCan(membership, capability))
}
