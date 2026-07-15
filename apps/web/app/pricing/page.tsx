import type { Metadata } from "next"

import { PricingPage } from "@/components/v3"

export const metadata: Metadata = {
  title: "Pricing",
  description: "Drivers are free forever. Dispatch Pro is $499/month. Hosts are free during the launch pilot."
}

export default function Page() {
  return <PricingPage />
}
