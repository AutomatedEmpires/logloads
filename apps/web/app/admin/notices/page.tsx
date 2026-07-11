import { AdminNoticesPage } from "@/components/v3"
import { getAdminNotices, getAdminShellAccount } from "@/lib/admin-data"

export const dynamic = "force-dynamic"

export default async function Page() {
  const [account, notices] = await Promise.all([getAdminShellAccount(), getAdminNotices()])

  return <AdminNoticesPage account={account} notices={notices} />
}
