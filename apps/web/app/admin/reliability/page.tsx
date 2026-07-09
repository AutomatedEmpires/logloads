import { PerformancePage } from "@/components/v3"
import { getAdminShellAccount } from "@/lib/admin-data"
import { getAdminReliability } from "@/lib/reliability-data"

export const dynamic = "force-dynamic"

export default async function Page() {
  const [account, view] = await Promise.all([getAdminShellAccount(), getAdminReliability()])

  return <PerformancePage account={account} role="admin" view={view} />
}
