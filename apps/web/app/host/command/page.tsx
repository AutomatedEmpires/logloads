import { organizationRoleCan } from "@logloads/contracts"

import { HostCommand } from "@/components/v3"
import { getHostPublishingOptions, getHostWorkspaceSetup } from "@/lib/host-data"
import { getCockpitContext, shellAccountFor } from "@/lib/v3"

export const dynamic = "force-dynamic"

export default async function Page() {
  const context = await getCockpitContext("host")
  const organizationId = context.network.activeOrganization.id
  const role = context.actor.activeMembership?.role
  const canManageLandings =
    role !== undefined && organizationRoleCan(role, "manage_landing")
  const canPublish =
    role !== undefined && organizationRoleCan(role, "publish_load")

  return (
    <HostCommand
      account={shellAccountFor(context)}
      canManageLandings={canManageLandings}
      canPublish={canPublish}
      network={context.network}
      options={getHostPublishingOptions(organizationId)}
      setup={getHostWorkspaceSetup(organizationId)}
    />
  )
}
