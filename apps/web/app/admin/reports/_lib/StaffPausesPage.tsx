import type { RevealPausesResult } from "@/lib/marketplace-v2/disclosure/load"

import { RevealPauses } from "./RevealPauses"
import styles from "./StaffPausesPage.module.css"

/**
 * The moderation screen for LogLoads staff known only to the normalized store (#403): the phone-reveal pauses alone,
 * without the pilot cockpit's shell, its notifications or its other queues, which read the pilot store.
 */
export function StaffPausesPage({ notice, result }: { notice: string | string[] | undefined; result: RevealPausesResult }) {
  return (
    <main className={styles.page} id="main-content">
      <p className="eyebrow">Platform operations</p>
      <h1 className={styles.title}>Moderation</h1>
      <RevealPauses notice={notice} result={result} />
    </main>
  )
}
