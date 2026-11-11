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

/**
 * Port v3 feature capabilities (#244), for the groups in `marketplace-port-v3.ts`.
 *
 * `get_viewer_marketplace_access` reports only the seven capabilities above, and CI checks that it agrees with
 * `marketplaceCapabilities` exactly, so these are a separate set. The store does not report them: each restates the
 * check inside the functions it names (stages 03, 18 and 26), from the same membership, so a page can offer an
 * action only to a person the store will let take it. Every function checks again; this is never the authority.
 *
 *   ANY  = no seat or hauler profile needed     LANDING = landing workspace seat     HAULER = hauler profile
 *
 *   team.manage         OWNER, ANY      invite_team_member, resend/revoke_team_invitation, list_team_invitations,
 *                                       set_membership_landing_scope ("the owner invites", 26-A)
 *   invitation.send     MGR, LANDING    reserve_targeted_invitation
 *   invitation.respond  ALL, HAULER     respond_to_invitation (any member of the recipient business)
 *   boost.estimate      DESK, LANDING   estimate_boost_audience
 *   truck.search        DESK, LANDING   Find Trucks ("any paid landing member", §4.8); plan features gate the filters
 *   saved_job.manage    ALL, HAULER     saved_jobs, list_saved_jobs, tg_saved_job_guard (26-C)
 *   alert.manage        ALL, ANY        saved_searches_own, notification_preferences_self (the person's own rows)
 *   plan.view           ALL, ANY        get_org_entitlement_state (any active member)
 *
 * Platform administration is not here: it is `platform_admins`, never an organization role (UX spec §8.7).
 */
export const MARKETPLACE_FEATURE_CAPABILITIES = [
  "team.manage",
  "invitation.send",
  "invitation.respond",
  "boost.estimate",
  "truck.search",
  "saved_job.manage",
  "alert.manage",
  "plan.view"
] as const
export type MarketplaceFeatureCapability = (typeof MARKETPLACE_FEATURE_CAPABILITIES)[number]

const OWNER: readonly MarketplaceMemberRole[] = ["owner"]

const FEATURE_RULES: Readonly<Record<MarketplaceFeatureCapability, { roles: readonly MarketplaceMemberRole[]; side: "landing" | "hauler" | "any" }>> = {
  "alert.manage": { roles: MARKETPLACE_MEMBER_ROLES, side: "any" },
  "boost.estimate": { roles: DESK, side: "landing" },
  "invitation.respond": { roles: MARKETPLACE_MEMBER_ROLES, side: "hauler" },
  "invitation.send": { roles: MGR, side: "landing" },
  "plan.view": { roles: MARKETPLACE_MEMBER_ROLES, side: "any" },
  "saved_job.manage": { roles: MARKETPLACE_MEMBER_ROLES, side: "hauler" },
  "team.manage": { roles: OWNER, side: "any" },
  "truck.search": { roles: DESK, side: "landing" }
}

export function marketplaceFeatureCan(membership: MarketplaceMembership | null, capability: MarketplaceFeatureCapability): boolean {
  if (!membership) {
    return false
  }

  const rule = FEATURE_RULES[capability]

  if (!rule.roles.includes(membership.role)) {
    return false
  }

  if (rule.side === "landing") {
    // The same seat rule as the store-reported capabilities: a driver never holds a landing seat.
    return membership.landingWorkspaceSeat && membership.role !== "driver"
  }

  return rule.side === "hauler" ? membership.haulerProfile : true
}

export function marketplaceFeatureCapabilities(membership: MarketplaceMembership | null): MarketplaceFeatureCapability[] {
  return MARKETPLACE_FEATURE_CAPABILITIES.filter((capability) => marketplaceFeatureCan(membership, capability))
}
