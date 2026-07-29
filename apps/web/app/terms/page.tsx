import type { Metadata } from "next"

import { LegalPage } from "@/components/v3"
import { legalPages } from "@/lib/v3"

export const metadata: Metadata = {
  title: "Terms of Service",
  description:
    "The terms governing LogLoads private-capacity software, sales-assisted Network access, and non-custodial transportation compensation."
}

export default function Page() {
  return <LegalPage content={legalPages["terms"]!} />
}
