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

function organizationCockpit(actor: SessionActor): "fleet" | "host" | null {
  const orgType = actor.activeOrganization?.type
  const role = actor.activeMembership?.role

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
