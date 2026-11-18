import type { Metadata } from "next"

import { LegalPage } from "@/components/v3"
import { legalDocuments, legalMetadata } from "@/lib/legal"

export const metadata: Metadata = legalMetadata(legalDocuments["acceptable-use"])

export default function Page() {
  return <LegalPage document={legalDocuments["acceptable-use"]} />
}
