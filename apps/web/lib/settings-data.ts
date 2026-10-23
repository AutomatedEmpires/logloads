import type {
  AssignmentStatus,
  OrganizationMembership,
  OrganizationRole
} from "@logloads/contracts"
import type { LogLoadsDatabaseState } from "@logloads/db"

import type { NetworkView } from "./network"
import { services } from "./services"

/**
 * The settings layer: organization identity, verification and the team roster,
 * shaped for the settings surfaces so machine keys and raw statuses never reach
 * the UI.
 */

export type StatusTone = "success" | "warning" | "critical" | "info" | "neutral"

/** A readable label for a machine key that has no label of its own. */
function labelFromKey(key: string): string {
  const spaced = key.replaceAll("_", " ").trim()

  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

const ORGANIZATION_TYPE_LABELS: Record<string, string> = {
  carrier: "Carrier",
  destination: "Destination facility",
  fleet: "Fleet",
  landing_source: "Landing organization",
  platform: "Platform"
}

// `satisfies` forces coverage: adding a role to ORGANIZATION_ROLES without a
// label is a compile error here, not a silently hand-rolled string somewhere.
export const MEMBER_ROLE_LABELS = {
  admin: "Administrator",
  billing: "Billing",
  destination_manager: "Destination manager",
  dispatcher: "Dispatcher",
  driver: "Driver",
  fleet_manager: "Fleet manager",
  landing_manager: "Landing manager",
  owner: "Owner",
  viewer: "Viewer"
} satisfies Record<OrganizationRole, string>

interface VerificationView {
  label: string
  tone: StatusTone
  meaning: string
}

export function verificationView(status: string): VerificationView {
  if (status === "verified") {
    return {
      label: "Verified",
      meaning: "LogLoads reviewed this organization's identity and operating details. Partners see the verified badge on your work.",
      tone: "success"
    }
  }

  if (status === "rejected") {
    return {
      label: "Not approved",
      meaning: "Operations and network visibility are locked. Contact LogLoads support to correct the organization details and request a new review.",
      tone: "critical"
    }
  }

  if (status === "suspended") {
    return {
      label: "Suspended",
      meaning: "Operations and network visibility are locked. Contact LogLoads support for the suspension reason and the steps required for reinstatement.",
      tone: "critical"
    }
  }

  return {
    label: "Review pending",
    meaning: "Verification review is in progress. Some network visibility stays limited until it completes.",
    tone: "warning"
  }
}

export interface OrganizationIdentityView {
  name: string
  legalName: string
  region: string
  typeLabel: string
  verificationLabel: string
  verificationTone: StatusTone
  verificationMeaning: string
}

export interface TeamMemberView {
  activeOrUpcomingAssignmentCount: number
  id: string
  isSelf: boolean
  name: string
  role: OrganizationMembership["role"]
  roleLabel: string
  status: OrganizationMembership["status"]
  statusLabel: string
  statusTone: StatusTone
  userId: string
}

export interface PendingInvitationView {
  id: string
  invitedEmail: string
  roleLabel: string
  expiresAt: string
}

export interface SettingsView {
  identity: OrganizationIdentityView
  team: TeamMemberView[]
  pendingInvitations: PendingInvitationView[]
}

function memberStatusView(status: string): { label: string; tone: StatusTone } {
  if (status === "active") {
    return { label: "Active", tone: "success" }
  }

  if (status === "invited") {
    return { label: "Invited", tone: "info" }
  }

  return { label: "Suspended", tone: "critical" }
}

const TERMINAL_ASSIGNMENT_STATUSES = new Set<AssignmentStatus>(["cancelled", "completed", "declined"])

/** Keep assignment impact tied to the one driver identity owned by this workspace. */
export function buildTeamRosterView(
  state: LogLoadsDatabaseState,
  organizationId: string,
  currentProfileId: string
): TeamMemberView[] {
  const profilesById = new Map(
    state.profiles.map((profile) => [profile.id, profile] as const)
  )
  const driverProfileIdsByUserId = new Map<string, string[]>()
  const assignmentCountsByDriverProfileId = new Map<string, number>()

  for (const driverProfile of state.driverProfiles) {
    if (driverProfile.companyId !== organizationId) {
      continue
    }

    const existing = driverProfileIdsByUserId.get(driverProfile.userId) ?? []
    existing.push(driverProfile.id)
    driverProfileIdsByUserId.set(driverProfile.userId, existing)
  }

  for (const assignment of state.assignments) {
    if (TERMINAL_ASSIGNMENT_STATUSES.has(assignment.status)) {
      continue
    }

    assignmentCountsByDriverProfileId.set(
      assignment.driverProfileId,
      (assignmentCountsByDriverProfileId.get(assignment.driverProfileId) ?? 0) + 1
    )
  }

  return state.organizationMemberships
    .filter((membership) => membership.organizationId === organizationId && membership.status !== "removed")
    .map((membership) => {
      const profile = profilesById.get(membership.userId)
      const driverProfileIds = driverProfileIdsByUserId.get(membership.userId) ?? []

      if (driverProfileIds.length > 1) {
        throw new Error("Organization driver profile identity is ambiguous")
      }

      const driverProfileId = driverProfileIds[0] ?? null
      const activeOrUpcomingAssignmentCount = driverProfileId
        ? assignmentCountsByDriverProfileId.get(driverProfileId) ?? 0
        : 0
      const status = memberStatusView(membership.status)

      return {
        activeOrUpcomingAssignmentCount,
        id: membership.id,
        isSelf: membership.userId === currentProfileId,
        name: profile?.fullName ?? "Pending member",
        role: membership.role,
        roleLabel: MEMBER_ROLE_LABELS[membership.role] ?? labelFromKey(membership.role),
        status: membership.status,
        statusLabel: status.label,
        statusTone: status.tone,
        userId: membership.userId
      }
    })
    .sort((left, right) => left.name.localeCompare(right.name) || left.userId.localeCompare(right.userId))
}

/**
 * Server helper: organization identity and team roster for the settings
 * surfaces. Never call from client components.
 */
export function getSettingsView(network: NetworkView, currentProfileId: string): SettingsView {
  const organizationId = network.activeOrganization.id
  const state = services.state
  const organization = state.organizations.find((candidate) => candidate.id === organizationId)
  const verification = verificationView(organization?.verificationStatus ?? network.activeOrganization.verificationStatus)
  const team = buildTeamRosterView(state, organizationId, currentProfileId)

  const pendingInvitations = services
    .listPendingInvitationsForOrganization(organizationId)
    .map((invitation) => ({
      expiresAt: invitation.expiresAt,
      id: invitation.id,
      invitedEmail: invitation.invitedEmail,
      roleLabel: MEMBER_ROLE_LABELS[invitation.invitedRole] ?? labelFromKey(String(invitation.invitedRole))
    }))
    .sort((left, right) => left.invitedEmail.localeCompare(right.invitedEmail))

  return {
    identity: {
      legalName: organization?.legalName ?? network.activeOrganization.name,
      name: network.activeOrganization.name,
      region: organization?.primaryRegion ?? "Not set",
      typeLabel: ORGANIZATION_TYPE_LABELS[network.activeOrganization.type] ?? labelFromKey(network.activeOrganization.type),
      verificationLabel: verification.label,
      verificationMeaning: verification.meaning,
      verificationTone: verification.tone
    },
    pendingInvitations,
    team
  }
}
