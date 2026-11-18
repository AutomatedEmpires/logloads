import { describeMarketplaceVerification } from "@logloads/contracts"

import { Icon } from "../icons"
import { cx } from "../layout/cx"
import type { Placement, VerificationIndicatorProps } from "./types"
import styles from "./VerificationIndicator.module.css"

/**
 * What LogLoads reviewed about a business, as the whole dated sentence from `describeMarketplaceVerification`
 * ("Business identity reviewed by LogLoads on Oct 14, 2026"), never shortened to a word such as "Verified" (legal
 * review 2026-11 §7.3). The title carries the "what this means" text until the sheet is built (#336), and
 * `data-state` tells a current review from a lapsed one. Renders nothing for `null`: no record, no mark.
 */
export function VerificationIndicator({ verification, now, className }: VerificationIndicatorProps & Placement) {
  if (!verification) return null

  const { label, meaning, state } = describeMarketplaceVerification(verification, now)

  return (
    <span className={cx(styles.verified, className)} data-state={state} title={meaning}>
      <Icon aria-hidden className={styles.mark} name="status.verified" size={16} />
      <span>{label}</span>
    </span>
  )
}
