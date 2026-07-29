import { BillingPage, type CheckoutNotice } from "@/components/v3"
import { getBillingView } from "@/lib/plans"
import { getHostSubscriptionBillingView } from "@/lib/subscription-billing-data"
import { getCockpitContext, shellAccountFor } from "@/lib/v3"

export const dynamic = "force-dynamic"

function checkoutNotice(checkout: string | undefined): CheckoutNotice | null {
  if (checkout === "success") {
    return { message: "Checkout completed. Your plan updates here as soon as payment confirmation arrives.", tone: "success" }
  }

  if (checkout === "cancelled") {
    return { message: "Checkout was cancelled. No changes were made to your plan.", tone: "info" }
  }

  return null
}

export default async function Page({ searchParams }: { searchParams: Promise<{ checkout?: string }> }) {
  const [context, { checkout }] = await Promise.all([getCockpitContext("fleet"), searchParams])

  return (
    <BillingPage
      account={shellAccountFor(context)}
      billing={getBillingView(context.network)}
      checkoutNotice={checkoutNotice(checkout)}
      hostSubscriptionBilling={getHostSubscriptionBillingView(
        context.network.activeOrganization.id
      )}
      role="fleet"
    />
  )
}
