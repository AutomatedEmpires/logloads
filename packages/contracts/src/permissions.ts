export const ORGANIZATION_TYPES = [
  "carrier",
  "fleet",
  "landing_source",
  "destination",
  "platform"
] as const

export type OrganizationType = (typeof ORGANIZATION_TYPES)[number]

export const ORGANIZATION_ROLES = [
  "owner",
  "admin",
  "dispatcher",
  "driver",
  "fleet_manager",
  "landing_manager",
  "destination_manager",
  "billing",
  "viewer"
] as const

export type OrganizationRole = (typeof ORGANIZATION_ROLES)[number]

export const ORGANIZATION_ACTIONS = [
  "view_network",
  "manage_members",
  "manage_billing",
  "manage_trucks",
  "manage_drivers",
  "publish_load",
  "assign_capacity",
  "manage_landing",
  "manage_destination",
  "request_assignment",
  "progress_trip",
  "send_operational_notice",
  "view_private_location",
  "view_audit_log"
] as const

export type OrganizationAction = (typeof ORGANIZATION_ACTIONS)[number]

export const ORGANIZATION_ROLE_ACTIONS = {
  owner: ORGANIZATION_ACTIONS,
  admin: [
    "view_network",
    "manage_members",
    "manage_trucks",
    "manage_drivers",
    "publish_load",
    "assign_capacity",
    "manage_landing",
    "manage_destination",
    "request_assignment",
    "progress_trip",
    "send_operational_notice",
    "view_private_location",
    "view_audit_log"
  ],
  // Dispatchers are an operating role: they run their organization's work end
  // to end (publish, assign, coordinate, close). They deliberately hold no
  // manage_members or manage_billing — ownership and money stay with owners,
  // admins, and billing.
  dispatcher: [
    "view_network",
    "manage_trucks",
    "manage_drivers",
    "publish_load",
    "assign_capacity",
    "request_assignment",
    "progress_trip",
    "send_operational_notice",
    "view_private_location"
  ],
  driver: ["view_network", "request_assignment", "progress_trip", "view_private_location"],
  fleet_manager: [
    "view_network",
    "manage_trucks",
    "manage_drivers",
    "assign_capacity",
    "request_assignment",
    "progress_trip",
    "send_operational_notice",
    "view_private_location"
  ],
  landing_manager: [
    "view_network",
    "publish_load",
    "assign_capacity",
    "manage_landing",
    "send_operational_notice",
    "view_private_location"
  ],
  destination_manager: [
    "view_network",
    "manage_destination",
    "send_operational_notice",
    "view_private_location"
  ],
  billing: ["view_network", "manage_billing"],
  viewer: ["view_network"]
} as const satisfies Record<OrganizationRole, readonly OrganizationAction[]>

export function organizationRoleCan(role: OrganizationRole, action: OrganizationAction): boolean {
  return (ORGANIZATION_ROLE_ACTIONS[role] as readonly OrganizationAction[]).includes(action)
}
