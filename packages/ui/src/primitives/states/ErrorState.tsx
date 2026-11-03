import type { HTMLAttributes } from "react"

import { Button } from "../Button"
import { cx } from "../internal"
import styles from "./ErrorState.module.css"

/** component-api.ts ErrorStateProps. */
export interface ErrorStateProps extends Omit<HTMLAttributes<HTMLDivElement>, "children" | "className" | "style" | "title"> {
  title: string
  body: string
  /** Shows a "Try again" button. */
  retry?: () => void
  /** Layout placement only. */
  className?: string
}

/**
 * Something failed to load. Copy rules (06_DESIGN_SYSTEM.md §6): say what failed ("Jobs couldn't load"), say the
 * user's filters are kept, and never fill the gap with cached or invented results. Announced with role="alert".
 */
export function ErrorState({ title, body, retry, className, ...rest }: ErrorStateProps) {
  return (
    <div {...rest} className={cx(styles.state, className)} data-kind="error" role="alert">
      <h3 className={styles.title}>{title}</h3>
      <p className={styles.body}>{body}</p>
      {retry ? (
        <div className={styles.actions}>
          <Button label="Try again" onClick={retry} size="sm" variant="secondary" />
        </div>
      ) : null}
    </div>
  )
}
