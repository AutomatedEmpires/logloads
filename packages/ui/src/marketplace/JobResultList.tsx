import { cx } from "../layout/cx"
import styles from "./JobResultList.module.css"
import type { JobResultListProps, Placement } from "./types"

/** Column names of the compact header, in JobResultRow's compact cell order. */
export const JOB_RESULT_COLUMNS = ["Pay", "Job", "Area", "Truck and trailer", "Start", "Availability"] as const

/**
 * A semantic list of JobResultRows (`ul > li`; no listbox). It is the "ll-list" container the rows measure, so a
 * row's layout follows the list's width rather than the window's. The header row is visual only: it appears in
 * compact density from a 720 px list width, and each row still names its own facts for assistive technology.
 */
export function JobResultList({ label, children, footnote, className }: JobResultListProps & Placement) {
  return (
    <div className={cx(styles.results, className)}>
      <div aria-hidden="true" className={styles.head}>
        {JOB_RESULT_COLUMNS.map((column) => (
          <span key={column}>{column}</span>
        ))}
      </div>
      <ul aria-label={label} className={styles.list}>
        {children}
      </ul>
      {footnote ? <p className={styles.foot}>{footnote}</p> : null}
    </div>
  )
}
