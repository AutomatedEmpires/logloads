import { AdminReportsPage } from "@/components/v3"
import { getAdminReports, getAdminShellAccount } from "@/lib/admin-data"
import { loadRevealPauses, type RevealPausesResult } from "@/lib/marketplace-v2/disclosure/load"
import { getSessionActor } from "@/lib/session"

import { RevealPauses } from "./_lib/RevealPauses"
import { StaffPausesPage } from "./_lib/StaffPausesPage"

export const dynamic = "force-dynamic"

type SearchParams = Promise<Record<string, string | string[] | undefined>>

/** A V2 store that is misconfigured or down never takes the moderation screen with it (#403). */
function readPauses(): Promise<RevealPausesResult> {
  return loadRevealPauses().catch((): RevealPausesResult => ({ kind: "failed", requestId: null }))
}

/**
 * The moderation screen (#255) with the phone-reveal pauses (#403).
 *
 * A pilot platform admin gets the whole screen. On the normalized store, LogLoads moderators and support staff are
 * `platform_admins` rows there, which the pilot session does not know about, so for anyone else the normalized
 * database decides: a person it lets read the pauses gets the pause section on its own. Anyone it refuses (and
 * everyone on the pilot store) meets the screen's usual pilot-admin check, which sends them away as before.
 */
export default async function Page({ searchParams }: { searchParams: SearchParams }) {
  const query = await searchParams
  const actor = await getSessionActor()

  if (!actor?.isPlatformAdmin) {
    const pauses = await readPauses()

    if (pauses.kind === "ready" || pauses.kind === "failed") {
      return <StaffPausesPage notice={query.pause} result={pauses} />
    }
  }

  const [account, reports] = await Promise.all([getAdminShellAccount(), getAdminReports()])
  // Read only once the admin check above has passed.
  const pauses = await readPauses()

  return (
    <AdminReportsPage account={account} reports={reports}>
      <RevealPauses notice={query.pause} result={pauses} />
    </AdminReportsPage>
  )
}
