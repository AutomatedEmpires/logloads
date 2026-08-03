import type { Metadata } from "next"

import { LegalPage } from "@/components/v3"
import { legalPages } from "@/lib/v3"

export const metadata: Metadata = {
  title: "Terms of Service",
  description:
    "The terms governing the 5% host platform fee, full direct driver pay, monthly fee invoicing, and safe timber hauling coordination."
}

export default function Page() {
  return <LegalPage content={legalPages["terms"]!} />
}
