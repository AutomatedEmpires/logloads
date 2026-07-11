import type { Metadata } from "next"

import { LegalPage } from "@/components/v3"
import { legalPages } from "@/lib/v3"

export const metadata: Metadata = {
  title: "Acceptable Use Policy",
  description: "The floor for behavior on LogLoads: lawful timber hauling coordination, accurate safety information, and respectful communication."
}

export default function Page() {
  return <LegalPage content={legalPages["acceptable-use"]!} />
}
