import { LegalPage } from "@/components/v3"
import { legalPages } from "@/lib/v3"

export default function Page() {
  return <LegalPage content={legalPages["privacy"]!} />
}
