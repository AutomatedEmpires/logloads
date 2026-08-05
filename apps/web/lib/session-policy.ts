import type { Organization, OrganizationMembership, User } from "@logloads/contracts"

export type Cockpit = "driver" | "fleet" | "host" | "admin"

export interface SessionActor {
  profile: User
  memberships: Array<{
    driverProfileId?: string | null
    membership: OrganizationMembership
    organization: Organization
  }>
  activeOrganization: Organization | null
  activeMembership: OrganizationMembership | null
  driverProfileId: string | null
  isPlatformAdmin: boolean
}

export function selectedSessionMembership(
  memberships: SessionActor["memberships"],
  requestedOrganizationId: string | null
): SessionActor["memberships"][number] | null {
  if (requestedOrganizationId) {
    // A signed workspace selection is exact intent. If that membership was
    // revoked, archived, or became ambiguous, never fall through to another
    // company's workspace on the same identity.
    return memberships.find(
      (entry) => entry.organization.id === requestedOrganizationId
    ) ?? null
  }

  return memberships[0] ?? null
}

const FLEET_ROLES = new Set(["owner", "admin", "dispatcher", "fleet_manager"])
const HOST_ROLES = new Set(["owner", "admin", "dispatcher", "landing_manager", "destination_manager", "billing"])

function organizationCockpitFor(
  orgType: Organization["type"] | null | undefined,
  role: OrganizationMembership["role"] | null | undefined
): "fleet" | "host" | null {
  if (!orgType || !role) {
    return null
  }

  if ((orgType === "fleet" || orgType === "carrier") && FLEET_ROLES.has(role)) {
    return "fleet"
  }

  if ((orgType === "landing_source" || orgType === "destination") && HOST_ROLES.has(role)) {
    return "host"
  }

  return null
}

function organizationCockpit(actor: SessionActor): "fleet" | "host" | null {
  return organizationCockpitFor(actor.activeOrganization?.type, actor.activeMembership?.role)
}

/**
 * Routes a just-created invited account without re-reading the request-cached
 * pre-creation session. The next request still verifies the signed cookie and
 * persisted membership before rendering the protected cockpit.
 */
export function homePathForMembership(
  organizationType: Organization["type"],
  role: OrganizationMembership["role"]
): string {
  const cockpit = organizationCockpitFor(organizationType, role)

  if (cockpit === "fleet") {
    return "/fleet/command"
  }

  if (cockpit === "host") {
    return "/host/command"
  }

  if (role === "driver") {
    return "/driver/map"
  }

  return "/"
}

export function homePathFor(actor: SessionActor): string {
  if (actor.isPlatformAdmin) {
    return "/admin"
  }

  const organizationHome = organizationCockpit(actor)

  if (organizationHome === "fleet") {
    return "/fleet/command"
  }

  if (organizationHome === "host") {
    return "/host/command"
  }

  if (actor.driverProfileId) {
    return "/driver/map"
  }

  // The profile exists, so onboarding would create an identity loop. Keep a
  // revoked or malformed account on a transparent, non-operational surface.
  return "/access-restricted"
}

/**
 * Returns a real recovery destination for the restricted-access surface.
 * An exact signed workspace selection can be revoked while the identity still
 * has another membership. In that state, silently selecting the other company
 * would cross the user's explicit workspace boundary, and redirecting to the
 * computed restricted home would loop back to the same page.
 */
export function restrictedAccessRecoveryPath(
  actor: SessionActor
): string | null {
  const homePath = homePathFor(actor)

  return homePath === "/access-restricted" ? null : homePath
}

export function canAccessCockpit(actor: SessionActor, cockpit: Cockpit): boolean {
  if (cockpit === "admin") {
    return actor.isPlatformAdmin
  }

  if (actor.isPlatformAdmin) {
    return true
  }

  if (cockpit === "driver") {
    return Boolean(actor.driverProfileId)
  }

  return organizationCockpit(actor) === cockpit
}

/**
 * Finds an authorized workspace even when it is not the organization currently
 * selected in the session. Callers must switch the session before opening that
 * cockpit; `canAccessCockpit` intentionally remains scoped to the active
 * organization so protected reads cannot cross workspace boundaries.
 */
export function membershipForCockpit(
  actor: SessionActor,
  cockpit: Exclude<Cockpit, "admin">
): SessionActor["memberships"][number] | null {
  return actor.memberships.find((entry) => {
    if (cockpit === "driver") {
      return Boolean(entry.driverProfileId)
    }

    return organizationCockpitFor(
      entry.organization.type,
      entry.membership.role
    ) === cockpit
  }) ?? null
}
