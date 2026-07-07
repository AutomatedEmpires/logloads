import type { Metadata } from "next"

import { PricingPage } from "@/components/v3"

export const metadata: Metadata = {
  title: "Pricing",
  description: "Drivers ride free. Fleet plans from $149/mo and host plans from $249/mo cover dispatch, publishing, private networks, and the live board."
}

export default function Page() {
  return <PricingPage />
}
