import { AdminDashboard } from "@/components/v3"
import { getAdminOverview, getAdminShellAccount } from "@/lib/admin-data"

export const dynamic = "force-dynamic"

export default async function Page() {
  const [account, overview] = await Promise.all([getAdminShellAccount(), getAdminOverview()])

  return <AdminDashboard account={account} overview={overview} />
}
