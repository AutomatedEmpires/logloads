import { invitableRolesForOrganizationType, organizationRoleCan } from "@logloads/contracts"

import { SettingsPage } from "@/components/v3"
import { getSettingsView, MEMBER_ROLE_LABELS } from "@/lib/plans"
import { getCockpitContext, shellAccountFor } from "@/lib/v3"
import { listSubjectVerifications } from "@/lib/verification-data"

export const dynamic = "force-dynamic"

export default async function Page() {
  const context = await getCockpitContext("fleet")
  const orgId = context.actor.activeOrganization?.id ?? ""
  const membershipRole = context.actor.activeMembership?.role
  const organizationType = context.actor.activeOrganization?.type

  return (
    <SettingsPage
      account={shellAccountFor(context)}
      canManageMembers={membershipRole ? organizationRoleCan(membershipRole, "manage_members") : false}
      inviteRoleOptions={
        organizationType
          ? invitableRolesForOrganizationType(organizationType).map((role) => ({
              label: MEMBER_ROLE_LABELS[role],
              value: role
            }))
          : []
      }
      role="fleet"
      settings={getSettingsView(context.network)}
      verifications={orgId ? listSubjectVerifications("organization", orgId) : []}
    />
  )
}
