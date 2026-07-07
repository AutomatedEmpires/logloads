import { AdminOpportunitiesPage } from "@/components/v3"
import { getAdminOpportunities, getAdminShellAccount } from "@/lib/admin-data"

export const dynamic = "force-dynamic"

export default async function Page() {
  const [account, loads] = await Promise.all([getAdminShellAccount(), getAdminOpportunities()])

  return <AdminOpportunitiesPage account={account} loads={loads} />
}
