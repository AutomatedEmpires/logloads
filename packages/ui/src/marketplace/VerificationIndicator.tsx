import { describeMarketplaceVerification } from "@logloads/contracts"

import { Icon } from "../icons"
import { cx } from "../layout/cx"
import { formatMonth } from "./format"
import type { Placement, VerificationIndicatorProps } from "./types"
import styles from "./VerificationIndicator.module.css"

/**
 * What LogLoads checked about a business, named by scope ("<scope> verified · <review month>"), from
 * `describeMarketplaceVerification`. Never a generic "Verified". Renders nothing for `null`: no record, no mark.
 */
export function VerificationIndicator({ verification, className }: VerificationIndicatorProps & Placement) {
  if (!verification) return null

  const { label, statement } = describeMarketplaceVerification(verification)
  const month = formatMonth(verification.reviewedOn)

  return (
    <span className={cx(styles.verified, className)} title={statement}>
      <Icon aria-hidden className={styles.mark} name="status.verified" size={16} />
      <span>{month ? `${label} · ${month}` : label}</span>
    </span>
  )
}
