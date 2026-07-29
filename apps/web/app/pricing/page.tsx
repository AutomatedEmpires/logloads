import type { Metadata } from "next"

import { PricingPage } from "@/components/v3"

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Drivers are free. Dispatch Pro is $499/month, and LogLoads Network plans combine a monthly commitment with completed Network-load usage."
}

export default function Page() {
  return <PricingPage />
}
