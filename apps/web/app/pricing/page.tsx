import type { Metadata } from "next"

import { PricingPage } from "@/components/v3"

export const metadata: Metadata = {
  title: "Pricing — Free for drivers and fleets",
  description:
    "Landing memberships are Basic $149, Pro $299, and Regional $499 per month. They are not available for purchase yet. Drivers and fleets use LogLoads free of charge."
}

export default function Page() {
  return <PricingPage />
}
