import type { Metadata } from "next"

import { LegalPage } from "@/components/v3"
import { legalPages } from "@/lib/v3"

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "What LogLoads collects, how it is used, and how sensitive operational information like landing access and driver location is limited."
}

export default function Page() {
  return <LegalPage content={legalPages["privacy"]!} />
}
