import { describeMarketplaceVerification, MARKETPLACE_VERIFICATION_LIMITS } from "@logloads/contracts"

import { Icon } from "../icons"
import { cx } from "../layout/cx"
import type { Placement, VerificationIndicatorProps } from "./types"
import styles from "./VerificationIndicator.module.css"

/**
 * What LogLoads reviewed about a business, as the whole dated sentence from `describeMarketplaceVerification`
 * ("Business identity reviewed by LogLoads on Oct 14, 2026"), never shortened to a word such as "Verified" (legal
 * review 2026-11 §7.3). With `limits`, what LogLoads did not check is text under the mark, which a phone or a keyboard
 * can reach (#412); the profile pages use it. Without it the "what this means" text is the title, and the job page
 * shows it in full, until the mark opens the sheet everywhere (#419). `data-state` tells a current review from a
 * lapsed one. Renders nothing for `null`: no record, no mark.
 */
export function VerificationIndicator({ verification, now, limits = false, className }: VerificationIndicatorProps & Placement) {
  if (!verification) return null

  const { label, meaning, state } = describeMarketplaceVerification(verification, now)

  return (
    <span className={cx(styles.verified, className)} data-limits={limits ? "" : undefined} data-state={state} title={limits ? undefined : meaning}>
      <Icon aria-hidden className={styles.mark} name="status.verified" size={16} />
      <span>{label}</span>
      {limits ? <span className={styles.limits}>{MARKETPLACE_VERIFICATION_LIMITS}</span> : null}
    </span>
  )
}
