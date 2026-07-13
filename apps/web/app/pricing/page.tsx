import type { Metadata } from "next"

import { PricingPage } from "@/components/v3"

export const metadata: Metadata = {
  title: "Pricing",
  description: "Drivers are free forever. Dispatch Pro is $499/month, and host pricing is 5% per completed load when LogLoads Payments is active."
}

export default function Page() {
  return <PricingPage />
}
