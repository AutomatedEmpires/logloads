import { organizationRoleCan } from "@logloads/contracts"

import { BillingPage } from "@/components/v3"
import { getBillingView } from "@/lib/plans"
import { getHostSubscriptionBillingView } from "@/lib/subscription-billing-data"
import { getCockpitContext, shellAccountFor } from "@/lib/v3"

export const dynamic = "force-dynamic"

export default async function Page() {
  const context = await getCockpitContext("fleet")
  const activeRole = context.actor.activeMembership?.role
  const canManageBilling =
    activeRole !== undefined && organizationRoleCan(activeRole, "manage_billing")

  return (
    <BillingPage
      account={shellAccountFor(context)}
      billing={getBillingView(context.network)}
      canManageBilling={canManageBilling}
      checkoutNotice={null}
      hostSubscriptionBilling={getHostSubscriptionBillingView(
        context.network.activeOrganization.id
      )}
      role="fleet"
    />
  )
}
