import type { Organization, OrganizationMembership, User } from "@logloads/contracts"

export type Cockpit = "driver" | "fleet" | "host" | "admin"

export interface SessionActor {
  profile: User
  memberships: Array<{ membership: OrganizationMembership; organization: Organization }>
  activeOrganization: Organization | null
  activeMembership: OrganizationMembership | null
  driverProfileId: string | null
  isPlatformAdmin: boolean
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

  if (actor.driverProfileId || actor.activeMembership?.role === "driver") {
    return "/driver/map"
  }

  // A malformed or legacy membership must never bounce between a protected
  // cockpit and onboarding. The public root is a safe recovery surface.
  return "/"
}

export function canAccessCockpit(actor: SessionActor, cockpit: Cockpit): boolean {
  if (cockpit === "admin") {
    return actor.isPlatformAdmin
  }

  if (actor.isPlatformAdmin) {
    return true
  }

  if (cockpit === "driver") {
    return Boolean(actor.driverProfileId) || actor.activeMembership?.role === "driver"
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
  return actor.memberships.find(({ membership, organization }) => {
    if (cockpit === "driver") {
      return membership.role === "driver"
    }

    return organizationCockpitFor(organization.type, membership.role) === cockpit
  }) ?? null
}
