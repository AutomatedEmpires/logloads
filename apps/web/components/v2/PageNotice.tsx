import type { ReactNode } from "react"

import styles from "./PageNotice.module.css"

export type PageNoticeTone = "info" | "positive" | "critical"

/**
 * A short notice on a V2 page: a refusal, a server error or a confirmation. The page chooses the live-region role:
 * `alert` for an error the visitor must notice, `status` for a confirmation, none for text that was always there.
 */
export function PageNotice({ children, role, tone = "info" }: { children: ReactNode; role?: "alert" | "status" | "note"; tone?: PageNoticeTone }) {
  return (
    <div className={styles.notice} data-tone={tone} role={role}>
      {children}
    </div>
  )
}
