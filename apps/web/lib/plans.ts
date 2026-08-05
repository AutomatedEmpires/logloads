import type {
  AssignmentStatus,
  Entitlement,
  OrganizationMembership,
  OrganizationRole
} from "@logloads/contracts"
import type { LogLoadsDatabaseState } from "@logloads/db"

import type { NetworkView } from "./network"
import { services } from "./services"

/**
 * The human plan layer: everything billing and settings surfaces render comes
 * through here so machine keys and raw statuses never reach the UI.
 */

export type PlanProduct = Entitlement["product"]
export type PlanTone = "success" | "warning" | "critical" | "info" | "neutral"

interface PlanDefinition {
  name: string
  priceLine: string
  summary: string
  defaultFeatures: string[]
}

const PLAN_DEFINITIONS: Record<PlanProduct, PlanDefinition> = {
  driver_core: {
    defaultFeatures: ["Load matching for your truck", "Route Pack access after assignment", "Trip documents and delivery proof"],
    name: "Driver",
    priceLine: "Free",
    summary: "The field cockpit for owner-operators and company drivers."
  },
  enterprise: {
    defaultFeatures: ["Private regions", "Verification workflows", "Dedicated support"],
    name: "Enterprise",
    priceLine: "Custom pricing",
    summary: "Multi-region timber operations with dedicated support."
  },
  fleet_operations: {
    defaultFeatures: ["Dispatch board", "Truck planning", "Free driver seats", "Private partner work"],
    name: "Fleet Free",
    priceLine: "Free",
    summary: "Run dispatch, equipment, drivers, and private partner work at no cost."
  },
  landing_operations: {
    defaultFeatures: ["Load publishing", "Live landing board", "Preferred carrier tools", "Drivers always free"],
    name: "Legacy host terms",
    priceLine: "Recorded legacy 5%",
    summary: "Preserved only to explain work and obligations frozen under a grandfathered percentage agreement."
  }
}

const HISTORICAL_FLEET_DEFINITION: PlanDefinition = {
  defaultFeatures: ["Dispatch board", "Truck planning", "Driver seats", "Private partner work"],
  name: "Dispatch Pro — historical",
  priceLine: "Recorded monthly amount: $499",
  summary: "A preserved software-subscription record. It does not control current Fleet Free access or authorize new billing."
}

const HISTORICAL_FLEET_CUSTOMER_DEFINITION: PlanDefinition = {
  defaultFeatures: ["Dispatch board", "Truck planning", "Driver seats", "Private partner work"],
  name: "Dispatch Pro enrollment — historical",
  priceLine: "No subscription created",
  summary: "A preserved provider customer or enrollment record with no subscription reference. It does not authorize billing."
}

const FEATURE_NAMES: Record<string, string> = {
  advanced_availability: "Advanced availability planning",
  api_access: "API access",
  capacity_planning: "Capacity planning",
  fleet_dispatch: "Dispatch board",
  landing_control: "Live landing board",
  private_loads: "Private load publishing",
  private_network: "Private partner network",
  route_pack_publishing: "Route Pack publishing",
  route_packs: "Route Packs",
  team_seats: "Team seats",
  trip_documents: "Trip documents and delivery proof",
  verified_access: "Verified network access"
}

export function planFeatureName(key: string): string {
  const known = FEATURE_NAMES[key]

  if (known) {
    return known
  }

  const spaced = key.replaceAll("_", " ").trim()

  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

export interface PlanView {
  id: string
  product: PlanProduct
  name: string
  priceLine: string
  summary: string
  statusLine: string
  statusDetail: string | null
  statusTone: PlanTone
  features: string[]
  limitLines: string[]
  recordMode: "current" | "historical"
}

interface PlanStatusView {
  statusDetail: string | null
  statusLine: string
  statusTone: PlanTone
}

function historicalPlanStatusView(status: Entitlement["status"]): PlanStatusView {
  if (status === "trialing") {
    return {
      statusDetail: "This preserved trial record does not authorize new work, enrollment, or billing.",
      statusLine: "Historical trial record",
      statusTone: "neutral"
    }
  }

  if (status === "active") {
    return {
      statusDetail: "Active was the recorded status. This history does not authorize new work, enrollment, or billing.",
      statusLine: "Recorded active",
      statusTone: "neutral"
    }
  }

  if (status === "past_due") {
    return {
      statusDetail: "The preserved record carries a payment issue that may still require reconciliation; it does not authorize new work.",
      statusLine: "Recorded payment issue",
      statusTone: "critical"
    }
  }

  if (status === "cancelled") {
    return {
      statusDetail: "This preserved record is cancelled and cannot be restarted from LogLoads.",
      statusLine: "Recorded cancelled",
      statusTone: "neutral"
    }
  }

  return {
    statusDetail: "Complimentary was the recorded status. This history does not authorize new work or enrollment.",
    statusLine: "Recorded complimentary",
    statusTone: "neutral"
  }
}

function historicalLimitLines(entitlement: Entitlement): string[] {
  const lines: string[] = []

  if (entitlement.activeTruckLimit) {
    lines.push(`Recorded limit: ${entitlement.activeTruckLimit} active trucks`)
  }

  if (entitlement.activeLandingLimit) {
    lines.push(`Recorded limit: ${entitlement.activeLandingLimit} active landings`)
  }

  return lines
}

export function planViewForEntitlement(entitlement: Entitlement): PlanView {
  const providerSubscriptionFleet =
    entitlement.product === "fleet_operations" &&
    Boolean(entitlement.stripeSubscriptionId)
  const providerCustomerOnlyFleet =
    entitlement.product === "fleet_operations" &&
    Boolean(entitlement.stripeCustomerId) &&
    !entitlement.stripeSubscriptionId

  if (entitlement.product === "driver_core") {
    const definition = PLAN_DEFINITIONS.driver_core

    return {
      features: entitlement.features.length > 0
        ? entitlement.features.map(planFeatureName)
        : definition.defaultFeatures,
      id: entitlement.id,
      limitLines: [],
      name: definition.name,
      priceLine: definition.priceLine,
      product: entitlement.product,
      recordMode: "current",
      statusDetail: "Driver access is included without a subscription.",
      statusLine: "Included",
      statusTone: "success",
      summary: definition.summary
    }
  }

  if (
    entitlement.product === "fleet_operations" &&
    !providerSubscriptionFleet &&
    !providerCustomerOnlyFleet
  ) {
    return fleetFreePlanView(entitlement.id)
  }

  const definition = providerSubscriptionFleet
    ? HISTORICAL_FLEET_DEFINITION
    : providerCustomerOnlyFleet
      ? HISTORICAL_FLEET_CUSTOMER_DEFINITION
      : PLAN_DEFINITIONS[entitlement.product]
  const status = entitlement.product === "landing_operations"
    ? {
        // This entitlement predates subscription_v1. It remains visible so a host
        // can explain historical assignments and bills, but it is never presented
        // as the commercial model for new activity.
        statusDetail: "This grandfathered record explains frozen work and obligations only. New commercial activity uses the current 5% completed-load agreement.",
        statusLine: "Historical legacy terms",
        statusTone: "neutral"
      } satisfies PlanStatusView
    : historicalPlanStatusView(entitlement.status)
  const features = entitlement.features.length > 0
    ? entitlement.features.map(planFeatureName)
    : definition.defaultFeatures

  return {
    features,
    id: entitlement.id,
    limitLines: historicalLimitLines(entitlement),
    name: definition.name,
    priceLine: definition.priceLine,
    product: entitlement.product,
    recordMode: "historical",
    statusDetail: status.statusDetail,
    statusLine: status.statusLine,
    statusTone: status.statusTone,
    summary: definition.summary
  }
}

export interface PlanUsageView {
  id: string
  label: string
  used: number
  limit: number | null
  detail: string
  tone: PlanTone
  percent: number | null
}

function usageRow(id: string, label: string, unit: string, used: number, limit: number | null): PlanUsageView {
  if (limit === null) {
    return {
      detail: `${used} ${unit}${used === 1 ? "" : "s"} in use — no current account limit`,
      id,
      label,
      limit,
      percent: null,
      tone: "info",
      used
    }
  }

  // A plan covering none of something is a real answer now that a lapsed plan
  // reports 0 rather than "no limit". Dividing by it yields NaN, which the page
  // would render as "NaN%".
  if (limit === 0) {
    return {
      detail: used === 0
        ? `Your plan does not cover ${unit}s`
        : `${used} ${unit}${used === 1 ? "" : "s"} in use, and your plan covers none`,
      id,
      label,
      limit,
      percent: 100,
      tone: "critical",
      used
    }
  }

  const percent = Math.min(100, Math.round((used / limit) * 100))
  let tone: PlanTone = "success"
  let detail = `${used} of ${limit} in use`

  if (used >= limit) {
    tone = "critical"
    detail = used > limit ? `${used} of ${limit} — over the plan limit` : `${used} of ${limit} — plan limit reached`
  } else if (used / limit >= 0.8) {
    tone = "warning"
    detail = `${used} of ${limit} in use — close to the plan limit`
  }

  return { detail, id, label, limit, percent, tone, used }
}

export interface BillingView {
  plans: PlanView[]
  usage: PlanUsageView[]
}

export function fleetFreePlanView(id = "fleet-free"): PlanView {
  const definition = PLAN_DEFINITIONS.fleet_operations

  return {
    features: definition.defaultFeatures,
    id,
    limitLines: [],
    name: definition.name,
    priceLine: definition.priceLine,
    product: "fleet_operations",
    recordMode: "current",
    statusDetail: "Fleet operations are included at no cost, with no LogLoads truck limit.",
    statusLine: "Included",
    statusTone: "success",
    summary: definition.summary
  }
}

/**
 * Server helper: reads the real plan records and current usage for the
 * viewer's organization. Never call from client components.
 */
export function getBillingView(network: NetworkView): BillingView {
  const organizationId = network.activeOrganization.id
  const state = services.state
  const entitlements = services.listEntitlements(organizationId)
  const billingAccount = state.organizationBillingAccounts.find(
    (account) => account.organizationId === organizationId
  )
  const visibleEntitlements =
    billingAccount && billingAccount.billingModel !== "legacy_percentage"
      ? entitlements.filter(
          (entitlement) => entitlement.product !== "landing_operations"
        )
      : entitlements

  const activeTrucks = state.equipmentCombinations.filter(
    (combination) => combination.organizationId === organizationId && combination.status !== "inactive"
  ).length
  // The same two numbers the service enforces, from the same functions. Billing
  // used to count `richLandingDetails` rows and take the first entitlement with
  // any stated limit, regardless of status — so it could read "1 of 3 in use"
  // at the moment a host was being refused for standing at 3 of 3. What the
  // plan page says you have left has to be what you actually have left.
  const activeLandings = services.countActiveLandings(organizationId)

  const fleetWorkspace = network.activeOrganization.type === "fleet"
  const truckLimit = fleetWorkspace
    ? null
    : entitlements.find((entitlement) => entitlement.activeTruckLimit)?.activeTruckLimit ?? null
  const landingLimit = services.activeLandingLimitFor(organizationId)

  const usage: PlanUsageView[] = []

  if (truckLimit !== null || activeTrucks > 0) {
    usage.push(usageRow("trucks", "Active trucks", "truck", activeTrucks, truckLimit))
  }

  if (landingLimit !== null || activeLandings > 0) {
    usage.push(usageRow("landings", "Active landings", "landing", activeLandings, landingLimit))
  }

  const projectedPlans = visibleEntitlements.map(planViewForEntitlement)
  const plans = fleetWorkspace
    ? [
        projectedPlans.find(
          (plan) =>
            plan.product === "fleet_operations" &&
            plan.recordMode === "current"
        ) ?? fleetFreePlanView(),
        ...projectedPlans.filter((plan) => plan.recordMode === "historical")
      ]
    : projectedPlans

  return {
    plans,
    usage
  }
}

const ORGANIZATION_TYPE_LABELS: Record<string, string> = {
  carrier: "Carrier",
  destination: "Destination facility",
  fleet: "Fleet",
  landing_source: "Landing organization",
  platform: "Platform"
}

export function isHostOrganizationType(type: string | null | undefined): boolean {
  return type === "landing_source" || type === "destination"
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
  tone: PlanTone
  meaning: string
}

function verificationView(status: string): VerificationView {
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
      meaning: "The last review was not approved. Submit updated organization details to start a new review.",
      tone: "critical"
    }
  }

  if (status === "suspended") {
    return {
      label: "Suspended",
      meaning: "Access is limited while the platform team reviews this organization. Reply to the review thread in Messages to resolve it.",
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
  verificationTone: PlanTone
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
  statusTone: PlanTone
  userId: string
}

export interface PlanSummaryView {
  id: string
  name: string
  priceLine: string
  recordMode: "current" | "historical"
  statusLine: string
  statusTone: PlanTone
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
  planSummaries: PlanSummaryView[]
}

function memberStatusView(status: string): { label: string; tone: PlanTone } {
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
        roleLabel: MEMBER_ROLE_LABELS[membership.role] ?? planFeatureName(membership.role),
        status: membership.status,
        statusLabel: status.label,
        statusTone: status.tone,
        userId: membership.userId
      }
    })
    .sort((left, right) => left.name.localeCompare(right.name) || left.userId.localeCompare(right.userId))
}

/**
 * Server helper: organization identity, team roster, and plan summary for
 * the settings surfaces. Never call from client components.
 */
export function getSettingsView(network: NetworkView, currentProfileId: string): SettingsView {
  const organizationId = network.activeOrganization.id
  const state = services.state
  const organization = state.organizations.find((candidate) => candidate.id === organizationId)
  const verification = verificationView(organization?.verificationStatus ?? network.activeOrganization.verificationStatus)
  const team = buildTeamRosterView(state, organizationId, currentProfileId)

  const entitlementPlans = services
    .listEntitlements(organizationId)
    .map(planViewForEntitlement)
  const settingsPlans = organization?.type === "fleet"
    ? [
        entitlementPlans.find(
          (plan) =>
            plan.product === "fleet_operations" &&
            plan.recordMode === "current"
        ) ?? fleetFreePlanView(),
        ...entitlementPlans.filter((plan) => plan.recordMode === "historical")
      ]
    : entitlementPlans
  const entitlementSummaries = settingsPlans.map((view) => ({
    id: view.id,
    name: view.name,
    priceLine: view.priceLine,
    recordMode: view.recordMode,
    statusLine: view.statusLine,
    statusTone: view.statusTone
  }))
  const percentageAccount = [...state.organizationBillingAccounts]
    .filter(
      (account) =>
        account.organizationId === organizationId &&
        account.billingModel === "percentage_v1" &&
        account.activationState === "percentage_active"
    )
    .sort(
      (left, right) =>
        Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
    )[0]
  const planSummaries: PlanSummaryView[] =
    isHostOrganizationType(organization?.type) && percentageAccount
      ? [
          {
            id: percentageAccount.id,
            name: "Host 5% agreement",
            priceLine: "5% per completed load",
            recordMode: "current",
            statusLine: "Accepted",
            statusTone: "success"
          },
          ...entitlementSummaries.filter(
            (summary) => summary.recordMode === "historical"
          )
        ]
      : entitlementSummaries

  const pendingInvitations = services
    .listPendingInvitationsForOrganization(organizationId)
    .map((invitation) => ({
      expiresAt: invitation.expiresAt,
      id: invitation.id,
      invitedEmail: invitation.invitedEmail,
      roleLabel: MEMBER_ROLE_LABELS[invitation.invitedRole] ?? planFeatureName(String(invitation.invitedRole))
    }))
    .sort((left, right) => left.invitedEmail.localeCompare(right.invitedEmail))

  return {
    identity: {
      legalName: organization?.legalName ?? network.activeOrganization.name,
      name: network.activeOrganization.name,
      region: organization?.primaryRegion ?? "Not set",
      typeLabel: ORGANIZATION_TYPE_LABELS[network.activeOrganization.type] ?? planFeatureName(network.activeOrganization.type),
      verificationLabel: verification.label,
      verificationMeaning: verification.meaning,
      verificationTone: verification.tone
    },
    pendingInvitations,
    planSummaries,
    team
  }
}
