import { BillingPage } from "@/components/v3"
import { getBillingView } from "@/lib/plans"
import { getHostSubscriptionBillingView } from "@/lib/subscription-billing-data"
import { getCockpitContext, shellAccountFor } from "@/lib/v3"

export const dynamic = "force-dynamic"

export default async function Page() {
  const context = await getCockpitContext("fleet")

  return (
    <BillingPage
      account={shellAccountFor(context)}
      billing={getBillingView(context.network)}
      checkoutNotice={null}
      hostSubscriptionBilling={getHostSubscriptionBillingView(
        context.network.activeOrganization.id
      )}
      role="fleet"
    />
  )
}
