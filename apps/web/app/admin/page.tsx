import { AdminDashboard } from "@/components/v3"
import { getAdminSummary } from "@/lib/v3"

export const dynamic = "force-dynamic"

export default async function Page() {
  return <AdminDashboard summary={await getAdminSummary()} />
}
