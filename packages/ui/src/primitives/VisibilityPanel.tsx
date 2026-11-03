import type { HTMLAttributes, ReactNode } from "react"

import { Icon } from "../icons"
import { cx } from "./internal"
import styles from "./VisibilityPanel.module.css"

export type VisibilityAudience = "public" | "private"

/** component-api.ts VisibilityPanelProps. */
export interface VisibilityPanelProps extends Omit<HTMLAttributes<HTMLElement>, "children" | "className" | "style" | "title"> {
  audience: VisibilityAudience
  /** Names who sees the fields, e.g. "Seen by landing operators" or "Private · only you and your team". */
  title: string
  children: ReactNode
  /** Layout placement only. */
  className?: string
}

/**
 * Groups form fields by who will see them. Private panels are dashed and carry a lock. This labels the audience
 * only: server-side redaction is still required for every private field.
 */
export function VisibilityPanel({ audience, title, children, className, ...rest }: VisibilityPanelProps) {
  return (
    <section aria-label={title} {...rest} className={cx(styles.panel, className)} data-audience={audience}>
      <h3 className={styles.head}>
        {audience === "private" ? <Icon aria-hidden name="status.lock" size={16} /> : null}
        {title}
      </h3>
      <div className={styles.body}>{children}</div>
    </section>
  )
}
