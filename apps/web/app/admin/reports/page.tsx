import { AdminReportsPage } from "@/components/v3"
import { getAdminReports, getAdminShellAccount } from "@/lib/admin-data"
import { loadRevealPauses, type RevealPausesResult } from "@/lib/marketplace-v2/disclosure/load"

import { RevealPauses } from "./_lib/RevealPauses"

export const dynamic = "force-dynamic"

type SearchParams = Promise<Record<string, string | string[] | undefined>>

export default async function Page({ searchParams }: { searchParams: SearchParams }) {
  const [account, reports] = await Promise.all([getAdminShellAccount(), getAdminReports()])
  // Read only once the admin check above has passed. A V2 store that is misconfigured or down never takes the rest
  // of the moderation screen with it (#403).
  const pauses: RevealPausesResult = await loadRevealPauses().catch(() => ({ kind: "failed", requestId: null }))
  const query = await searchParams

  return (
    <AdminReportsPage account={account} reports={reports}>
      <RevealPauses notice={query.pause} result={pauses} />
    </AdminReportsPage>
  )
}
