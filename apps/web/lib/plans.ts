import type { Entitlement } from "@logloads/contracts"

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
    name: "Dispatch Pro",
    priceLine: "$499/mo",
    summary: "One operating account for the trucks and drivers you dispatch."
  },
  landing_operations: {
    defaultFeatures: ["Load publishing", "Live landing board", "Preferred carrier tools"],
    name: "Host",
    priceLine: "5% per completed load",
    summary: "Post without a monthly fee and pay when completed loads settle through LogLoads."
  }
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

function formatDay(value: string): string {
  return new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", timeZone: "UTC", year: "numeric" }).format(new Date(value))
}

function daysUntil(value: string): number {
  return Math.ceil((new Date(value).getTime() - Date.now()) / 86_400_000)
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
  actionLabel: string | null
  actionKind: "checkout" | "portal" | null
}

interface PlanStatusView {
  actionLabel: string | null
  actionKind: "checkout" | "portal" | null
  statusDetail: string | null
  statusLine: string
  statusTone: PlanTone
}

function planStatusView(status: Entitlement["status"], periodEndsAt: string | null | undefined): PlanStatusView {
  const endsAt = periodEndsAt ?? null

  if (status === "trialing") {
    if (!endsAt) {
      return {
        actionKind: "checkout",
        actionLabel: "Start subscription",
        statusDetail: "Start your subscription anytime to keep plan features without interruption.",
        statusLine: "Trial",
        statusTone: "info"
      }
    }

    const days = daysUntil(endsAt)

    if (days > 0) {
      return {
        actionKind: "checkout",
        actionLabel: "Start subscription",
        statusDetail: `Trial ends ${formatDay(endsAt)}. Start your subscription to keep plan features without interruption.`,
        statusLine: `Trial — ${days} day${days === 1 ? "" : "s"} left`,
        statusTone: days <= 3 ? "warning" : "info"
      }
    }

    return {
      actionKind: "checkout",
      actionLabel: "Start subscription",
      statusDetail: `Your trial ended ${formatDay(endsAt)}. Start your subscription to keep plan features.`,
      statusLine: "Trial ended",
      statusTone: "critical"
    }
  }

  if (status === "active") {
    return {
      actionKind: "portal",
      actionLabel: "Manage billing",
      statusDetail: endsAt ? `Renews ${formatDay(endsAt)}.` : null,
      statusLine: "Active",
      statusTone: "success"
    }
  }

  if (status === "past_due") {
    return {
      actionKind: "portal",
      actionLabel: "Update payment",
      statusDetail: "The last payment did not go through. Update billing to keep plan features active.",
      statusLine: "Payment issue — update billing",
      statusTone: "critical"
    }
  }

  if (status === "cancelled") {
    const stillCovered = endsAt !== null && daysUntil(endsAt) > 0

    return {
      actionKind: "checkout",
      actionLabel: "Restart subscription",
      statusDetail: stillCovered && endsAt
        ? `Plan features stay available until ${formatDay(endsAt)}.`
        : "This plan is no longer active. Restart the subscription to bring plan features back.",
      statusLine: "Cancelled",
      statusTone: "neutral"
    }
  }

  return {
    actionKind: null,
    actionLabel: null,
    statusDetail: "This workspace has complimentary access. No billing is needed.",
    statusLine: "Included",
    statusTone: "success"
  }
}

function planLimitLines(entitlement: Entitlement): string[] {
  const lines: string[] = []

  if (entitlement.activeTruckLimit) {
    lines.push(`Up to ${entitlement.activeTruckLimit} active trucks`)
  }

  if (entitlement.activeLandingLimit) {
    lines.push(`Up to ${entitlement.activeLandingLimit} active landings`)
  }

  return lines
}

function toPlanView(entitlement: Entitlement): PlanView {
  const definition = PLAN_DEFINITIONS[entitlement.product]
  const status = planStatusView(entitlement.status, entitlement.currentPeriodEndsAt)
  const features = entitlement.features.length > 0
    ? entitlement.features.map(planFeatureName)
    : definition.defaultFeatures

  return {
    actionKind: status.actionKind,
    actionLabel: status.actionLabel,
    features,
    id: entitlement.id,
    limitLines: planLimitLines(entitlement),
    name: definition.name,
    priceLine: definition.priceLine,
    product: entitlement.product,
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
      detail: `${used} ${unit}${used === 1 ? "" : "s"} in use — no limit on this plan`,
      id,
      label,
      limit,
      percent: null,
      tone: "info",
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
  billingReady: boolean
}

/**
 * Server helper: reads the real plan records and current usage for the
 * viewer's organization. Never call from client components.
 */
export function getBillingView(network: NetworkView): BillingView {
  const organizationId = network.activeOrganization.id
  const state = services.state
  const entitlements = services.listEntitlements(organizationId)

  const activeTrucks = state.equipmentCombinations.filter(
    (combination) => combination.organizationId === organizationId && combination.status !== "inactive"
  ).length
  const activeLandings = state.richLandingDetails.filter(
    (details) => details.controlledByOrganizationId === organizationId
  ).length

  const truckLimit = entitlements.find((entitlement) => entitlement.activeTruckLimit)?.activeTruckLimit ?? null
  const landingLimit = entitlements.find((entitlement) => entitlement.activeLandingLimit)?.activeLandingLimit ?? null

  const usage: PlanUsageView[] = []

  if (truckLimit !== null || activeTrucks > 0) {
    usage.push(usageRow("trucks", "Active trucks", "truck", activeTrucks, truckLimit))
  }

  if (landingLimit !== null || activeLandings > 0) {
    usage.push(usageRow("landings", "Active landings", "landing", activeLandings, landingLimit))
  }

  return {
    billingReady: Boolean(process.env.STRIPE_SECRET_KEY),
    plans: entitlements.map(toPlanView),
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

const MEMBER_ROLE_LABELS: Record<string, string> = {
  admin: "Administrator",
  billing: "Billing",
  destination_manager: "Destination manager",
  dispatcher: "Dispatcher",
  driver: "Driver",
  fleet_manager: "Fleet manager",
  landing_manager: "Landing manager",
  owner: "Owner",
  viewer: "Viewer"
}

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
  id: string
  name: string
  roleLabel: string
  statusLabel: string
  statusTone: PlanTone
}

export interface PlanSummaryView {
  id: string
  name: string
  priceLine: string
  statusLine: string
  statusTone: PlanTone
}

export interface SettingsView {
  identity: OrganizationIdentityView
  team: TeamMemberView[]
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

/**
 * Server helper: organization identity, team roster, and plan summary for
 * the settings surfaces. Never call from client components.
 */
export function getSettingsView(network: NetworkView): SettingsView {
  const organizationId = network.activeOrganization.id
  const state = services.state
  const organization = state.organizations.find((candidate) => candidate.id === organizationId)
  const verification = verificationView(organization?.verificationStatus ?? network.activeOrganization.verificationStatus)

  const team = state.organizationMemberships
    .filter((membership) => membership.organizationId === organizationId && membership.status !== "removed")
    .map((membership) => {
      const profile = state.profiles.find((candidate) => candidate.id === membership.userId)
      const status = memberStatusView(membership.status)

      return {
        id: membership.id,
        name: profile?.fullName ?? "Pending member",
        roleLabel: MEMBER_ROLE_LABELS[membership.role] ?? planFeatureName(membership.role),
        statusLabel: status.label,
        statusTone: status.tone
      }
    })
    .sort((left, right) => left.name.localeCompare(right.name))

  const planSummaries = services.listEntitlements(organizationId).map((entitlement) => {
    const view = toPlanView(entitlement)

    return {
      id: view.id,
      name: view.name,
      priceLine: view.priceLine,
      statusLine: view.statusLine,
      statusTone: view.statusTone
    }
  })

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
    planSummaries,
    team
  }
}
