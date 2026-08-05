import type { Metadata } from "next"

import { PricingPage } from "@/components/v3"

export const metadata: Metadata = {
  title: "Pricing — Free for drivers and fleets",
  description:
    "Drivers and fleet workspaces use LogLoads free. Hosts pay 5% of stated driver pay for each completed load, added on top—with no posting fee, subscription, monthly minimum, tier, allowance, or overage."
}

export default function Page() {
  return <PricingPage />
}
