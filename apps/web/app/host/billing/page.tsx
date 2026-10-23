import { organizationRoleCan } from "@logloads/contracts"

import { BillingPage } from "@/components/v3"
import { getHostBillingView } from "@/lib/host-billing-data"
import { getCockpitContext, shellAccountFor } from "@/lib/v3"

export const dynamic = "force-dynamic"

export default async function Page() {
  const context = await getCockpitContext("host")
  const activeRole = context.actor.activeMembership?.role
  const canManageBilling =
    activeRole !== undefined && organizationRoleCan(activeRole, "manage_billing")

  return (
    <BillingPage
      account={shellAccountFor(context)}
      hostBilling={getHostBillingView(context.network.activeOrganization.id, {
        canManageBilling
      })}
    />
  )
}
