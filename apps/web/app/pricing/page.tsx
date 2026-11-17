import type { Metadata } from "next"

import { PricingPage } from "@/components/v3"
import { pricingPageCopy } from "@/lib/v3-shared"

const pricing = pricingPageCopy()

export const metadata: Metadata = {
  title: "Pricing — Haulers and fleets are free",
  description: pricing.description
}

export default function Page() {
  return <PricingPage />
}
