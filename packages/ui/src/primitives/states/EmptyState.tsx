import type { HTMLAttributes, ReactNode } from "react"

import { cx } from "../internal"
import styles from "./EmptyState.module.css"

/** component-api.ts EmptyStateProps. */
export interface EmptyStateProps extends Omit<HTMLAttributes<HTMLDivElement>, "children" | "className" | "style" | "title"> {
  title: string
  body: string
  /** Ways out of the empty result, e.g. "Widen to 150 mi" and "Any start date" buttons. */
  actions?: ReactNode
  /** Layout placement only. */
  className?: string
}

/**
 * Nothing to show. Copy rules (06_DESIGN_SYSTEM.md §6): the title names the active constraint ("No jobs match
 * within 100 miles"), the body says what would widen it, and nothing implies jobs or businesses that don't exist.
 * The component renders only the text it is given.
 */
export function EmptyState({ title, body, actions, className, ...rest }: EmptyStateProps) {
  return (
    <div {...rest} className={cx(styles.state, className)} data-kind="empty">
      <h3 className={styles.title}>{title}</h3>
      <p className={styles.body}>{body}</p>
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </div>
  )
}
