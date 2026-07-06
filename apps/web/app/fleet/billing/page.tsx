import { BillingPage } from "@/components/v3"
import { getFleetNetwork } from "@/lib/v3"

export const dynamic = "force-dynamic"

export default async function Page() {
  return <BillingPage network={await getFleetNetwork()} role="fleet" />
}
