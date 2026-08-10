import { organizationRoleCan } from "@logloads/contracts"

import { BillingPage } from "@/components/v3"
import { getHostBillingView } from "@/lib/host-billing-data"
import { getBillingView } from "@/lib/plans"
import { getHostSubscriptionBillingView } from "@/lib/subscription-billing-data"
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
      billing={getBillingView(context.network)}
      canManageBilling={canManageBilling}
      checkoutNotice={null}
      hostBilling={getHostBillingView(context.network.activeOrganization.id, {
        canManageBilling
      })}
      hostSubscriptionBilling={getHostSubscriptionBillingView(
        context.network.activeOrganization.id
      )}
      role="host"
    />
  )
}
