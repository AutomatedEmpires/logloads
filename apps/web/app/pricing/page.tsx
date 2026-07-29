import type { Metadata } from "next"

import { PricingPage } from "@/components/v3"

export const metadata: Metadata = {
  title: "Pricing",
  description: "Drivers are free forever. Hosts pay 5% of driver pay on completed loads. Dispatch Pro is $499/month."
}

export default function Page() {
  return <PricingPage />
}
