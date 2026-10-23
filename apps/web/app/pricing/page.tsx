import type { Metadata } from "next"

import { PricingPage } from "@/components/v3"

export const metadata: Metadata = {
  title: "Pricing — Free for drivers and fleets",
  description:
    "Drivers and fleets use LogLoads for free. Hosts pay 2% of stated driver pay for each completed load, added on top—with no posting fee, monthly fee, or minimum."
}

export default function Page() {
  return <PricingPage />
}
