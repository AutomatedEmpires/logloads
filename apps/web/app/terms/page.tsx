import type { Metadata } from "next"

import { LegalPage } from "@/components/v3"
import { legalPages } from "@/lib/v3"

export const metadata: Metadata = {
  title: "Terms of Service",
  description:
    "The terms governing your use of LogLoads, full direct driver pay, and safe timber hauling coordination."
}

export default function Page() {
  return <LegalPage content={legalPages["terms"]!} />
}
