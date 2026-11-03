import { cx } from "../layout/cx"
import styles from "./AvailabilityStatus.module.css"
import type { AvailabilityStatusProps, Placement } from "./types"

/**
 * A freshness dot plus its words (status is never colour alone). Pass props from `jobAvailabilityStatus`, which
 * wraps contracts `postingFreshness`: "confirmed" and "aging" exist only when the poster explicitly confirmed the
 * listing (V2-DEC-03). The label is never "live".
 */
export function AvailabilityStatus({ state, label, className }: AvailabilityStatusProps & Placement) {
  return (
    <span className={cx(styles.status, className)} data-state={state}>
      {label}
    </span>
  )
}
