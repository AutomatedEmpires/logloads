import { cx } from "./cx"
import styles from "./PageActions.module.css"
import type { PageActionsProps, Placement } from "./types"

/** The PageHeader action row. Holds at most one primary Button; the rest are secondary or ghost. */
export function PageActions({ children, className }: PageActionsProps & Placement) {
  return <div className={cx(styles.actions, className)}>{children}</div>
}
