import { AdminBillingPage } from "@/components/v3"
import { getAdminBilling, getAdminShellAccount } from "@/lib/admin-data"

export const dynamic = "force-dynamic"

export default async function Page() {
  const [account, billing] = await Promise.all([getAdminShellAccount(), getAdminBilling()])

  return <AdminBillingPage account={account} billing={billing} />
}
