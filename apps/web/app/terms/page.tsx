import type { Metadata } from "next"

import { LegalPage } from "@/components/v3"
import { legalPages } from "@/lib/v3"

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "The terms that govern LogLoads: coordination software for timber hauling, with no freight brokering and no freight payment handling."
}

export default function Page() {
  return <LegalPage content={legalPages["terms"]!} />
}
