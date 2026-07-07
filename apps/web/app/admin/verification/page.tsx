import { AdminVerificationPage } from "@/components/v3"
import { getAdminShellAccount, getAdminVerificationQueue } from "@/lib/admin-data"

export const dynamic = "force-dynamic"

export default async function Page() {
  const [account, items] = await Promise.all([getAdminShellAccount(), getAdminVerificationQueue()])

  return <AdminVerificationPage account={account} items={items} />
}
