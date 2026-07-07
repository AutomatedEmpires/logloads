import type { Metadata } from "next"

import { LegalPage } from "@/components/v3"
import { legalPages } from "@/lib/v3"

export const metadata: Metadata = {
  title: "Marketplace Rules",
  description: "How commitments work on LogLoads: record platform-sourced work on the assignment, keep calling like normal, respect private access."
}

export default function Page() {
  return <LegalPage content={legalPages["marketplace-rules"]!} />
}
