import { AdminReportsPage } from "@/components/v3"
import { getAdminReports, getAdminShellAccount } from "@/lib/admin-data"

export const dynamic = "force-dynamic"

export default async function Page() {
  const [account, reports] = await Promise.all([getAdminShellAccount(), getAdminReports()])

  return <AdminReportsPage account={account} reports={reports} />
}
