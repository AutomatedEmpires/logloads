import { AdminOrganizationsPage } from "@/components/v3"
import { getAdminOrganizations, getAdminShellAccount } from "@/lib/admin-data"

export const dynamic = "force-dynamic"

export default async function Page() {
  const [account, organizations] = await Promise.all([getAdminShellAccount(), getAdminOrganizations()])

  return <AdminOrganizationsPage account={account} organizations={organizations} />
}
