import { AdminActivityPage } from "@/components/v3"
import { getAdminActivityHistory, getAdminShellAccount } from "@/lib/admin-data"

export const dynamic = "force-dynamic"

export default async function Page() {
  const [account, history] = await Promise.all([getAdminShellAccount(), getAdminActivityHistory()])

  return <AdminActivityPage account={account} history={history} />
}
