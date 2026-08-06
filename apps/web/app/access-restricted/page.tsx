import { cookies } from "next/headers"
import { redirect } from "next/navigation"

import { AccessRestrictedPage } from "@/components/v3"
import {
  getSessionActor,
  restrictedAccessRecoveryPath,
  SESSION_COOKIE,
  verifySessionCookieValue
} from "@/lib/session"
import { homePathForMembership } from "@/lib/session-policy"
import { residualSettlementItemsForOrganization } from "@/lib/residual-settlement-data"
import { services } from "@/lib/services"

export const dynamic = "force-dynamic"

export const metadata = {
  robots: { follow: false, index: false },
  title: "Workspace access restricted"
}

export default async function Page() {
  const actor = await getSessionActor()

  if (!actor) {
    redirect("/sign-in")
  }

  const accountMemberships = services.state.organizationMemberships.filter(
    (membership) => membership.userId === actor.profile.id
  )
  const activeMemberships = accountMemberships.filter(
    (membership) => membership.status === "active"
  )
  const unavailableOrganizations = Array.from(new Map(activeMemberships.flatMap((membership) => {
    const organization = services.state.organizations.find(
      (candidate) => candidate.id === membership.organizationId
    )

    return organization &&
      !organization.archivedAt &&
      ["rejected", "suspended"].includes(organization.verificationStatus)
      ? [[organization.id, organization] as const]
      : []
  })).values())
  const recoveryPath = restrictedAccessRecoveryPath(actor)

  // An operational workspace is a valid recovery destination, but it must not
  // hide another workspace's unfinished settlement obligations. Keep this
  // index reachable whenever the account has an exact locked workspace; the
  // ordinary account menu links here so a fresh mixed-workspace sign-in can
  // select it deliberately.
  if (recoveryPath && unavailableOrganizations.length === 0) {
    redirect(recoveryPath)
  }

  const cookieStore = await cookies()
  const signedSelection = verifySessionCookieValue(
    cookieStore.get(SESSION_COOKIE)?.value
  )
  const selectedOrganizationId = signedSelection?.userId === actor.profile.id
    ? signedSelection.organizationId
    : null

  const selectedMembership = selectedOrganizationId
    ? accountMemberships.find(
        (membership) => membership.organizationId === selectedOrganizationId
      ) ?? null
    : null
  const selectedOrganization = selectedMembership?.status === "active"
    ? services.state.organizations.find(
        (organization) => organization.id === selectedMembership.organizationId
      ) ?? null
    : null
  const selectedRestrictedOrganization = selectedOrganization &&
    ["rejected", "suspended"].includes(selectedOrganization.verificationStatus)
    ? selectedOrganization
    : null
  const restrictedOrganization = selectedRestrictedOrganization
    ?? (unavailableOrganizations.length === 1 ? unavailableOrganizations[0] : null)
  const reason = restrictedOrganization?.verificationStatus === "suspended"
    ? "organization_suspended"
    : restrictedOrganization?.verificationStatus === "rejected"
      ? "organization_rejected"
      : selectedMembership?.status === "suspended"
        ? "suspended"
        : selectedMembership?.status === "removed"
          ? "removed"
          : accountMemberships.some((membership) => membership.status === "suspended")
            ? "suspended"
            : accountMemberships.some((membership) => membership.status === "removed")
              ? "removed"
              : "unavailable"
  const availableWorkspaces = actor.memberships.flatMap((entry) => {
    const href = homePathForMembership(entry.organization.type, entry.membership.role)

    return href === "/"
      ? []
      : [{ href, id: entry.organization.id, name: entry.organization.displayName }]
  })
  const activeMembershipCounts = activeMemberships.reduce<Map<string, number>>(
    (counts, membership) => {
      counts.set(
        membership.organizationId,
        (counts.get(membership.organizationId) ?? 0) + 1
      )

      return counts
    },
    new Map()
  )
  const soleActiveOrganizationId = activeMemberships.length === 1
    ? activeMemberships[0]?.organizationId ?? null
    : null
  const settlementOrganizationId =
    selectedOrganization &&
    selectedMembership?.status === "active" &&
    activeMembershipCounts.get(selectedOrganization.id) === 1 &&
    ["rejected", "suspended"].includes(selectedOrganization.verificationStatus)
      ? selectedOrganization.id
      : soleActiveOrganizationId &&
          unavailableOrganizations.some(
            (organization) => organization.id === soleActiveOrganizationId
          )
        ? soleActiveOrganizationId
        : null
  const residualSettlements = settlementOrganizationId
    ? residualSettlementItemsForOrganization(
        actor.profile.id,
        settlementOrganizationId
      )
    : []
  const restrictedWorkspaces = unavailableOrganizations.flatMap((organization) =>
    activeMembershipCounts.get(organization.id) === 1 &&
    organization.id !== settlementOrganizationId
      ? [{ id: organization.id, name: organization.displayName }]
      : []
  )

  return (
    <AccessRestrictedPage
      availableWorkspaces={availableWorkspaces}
      displayName={actor.profile.fullName}
      email={actor.profile.email}
      organizationName={restrictedOrganization?.displayName ?? null}
      reason={reason}
      residualSettlements={residualSettlements}
      restrictedWorkspaces={restrictedWorkspaces}
    />
  )
}
