import { organizationRoleCan } from "@logloads/contracts"

import { HostCarriers } from "@/components/v3"
import { getCockpitContext, shellAccountFor } from "@/lib/v3"

export const dynamic = "force-dynamic"

export default async function Page() {
  const context = await getCockpitContext("host")
  const role = context.actor.activeMembership?.role

  return (
    <HostCarriers
      account={shellAccountFor(context)}
      canAssignCapacity={role !== undefined && organizationRoleCan(role, "assign_capacity")}
      canSendNotices={role !== undefined && organizationRoleCan(role, "send_operational_notice")}
      network={context.network}
    />
  )
}
