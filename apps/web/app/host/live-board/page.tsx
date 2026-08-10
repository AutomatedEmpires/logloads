import { organizationRoleCan } from "@logloads/contracts"

import { HostLiveBoard } from "@/components/v3"
import { getCockpitContext, shellAccountFor } from "@/lib/v3"

export const dynamic = "force-dynamic"

export default async function Page() {
  const context = await getCockpitContext("host")
  const role = context.actor.activeMembership?.role

  return (
    <HostLiveBoard
      account={shellAccountFor(context)}
      canAssignCapacity={role !== undefined && organizationRoleCan(role, "assign_capacity")}
      canManageBilling={role !== undefined && organizationRoleCan(role, "manage_billing")}
      canPublish={role !== undefined && organizationRoleCan(role, "publish_load")}
      network={context.network}
    />
  )
}
