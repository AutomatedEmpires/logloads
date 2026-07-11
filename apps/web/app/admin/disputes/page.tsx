import { AdminDisputesPage } from "@/components/v3"
import { getAdminDisputes, getAdminShellAccount } from "@/lib/admin-data"

export const dynamic = "force-dynamic"

export default async function Page() {
  const [account, disputes] = await Promise.all([getAdminShellAccount(), getAdminDisputes()])

  return <AdminDisputesPage account={account} disputes={disputes} />
}
