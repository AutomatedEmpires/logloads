import { AdminSectionPage } from "@/components/v3"
import { getAdminSummary } from "@/lib/v3"

export const dynamic = "force-dynamic"

export default function Page() {
  return <AdminSectionPage summary={getAdminSummary()} title="Organizations" />
}
