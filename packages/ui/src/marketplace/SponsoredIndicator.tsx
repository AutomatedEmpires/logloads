import { cx } from "../layout/cx"
import styles from "./SponsoredIndicator.module.css"
import type { Placement, SponsoredIndicatorProps } from "./types"

/** The one wording for a paid boost (AGENTS.md §8: a boost is always identified as Sponsored). A word, not a tint. */
export function SponsoredIndicator({ className }: SponsoredIndicatorProps & Placement) {
  return <span className={cx(styles.sponsored, className)}>Sponsored</span>
}
