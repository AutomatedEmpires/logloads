import type { Metadata } from "next"

import { PricingPage } from "@/components/v3"

export const metadata: Metadata = {
  title: "Pricing — Free for drivers and fleets",
  description:
    "LogLoads is a timber-hauling load board. Drivers and hauling businesses use it free. Pricing for landing organizations has not been published, and nothing is offered for sale yet."
}

export default function Page() {
  return <PricingPage />
}
