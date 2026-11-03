import { cx } from "../layout/cx"
import { payParts } from "./format"
import styles from "./PayFigure.module.css"
import type { PayFigureProps, Placement } from "./types"

/**
 * Pay as the poster stated it (V2-DEC-02): a rate with its basis ("$525.00" "per load"), or "Negotiable" with the
 * poster's note as the basis, or an honest "Pay not stated". Never an estimate. The wording is
 * `formatMarketplacePay`'s; `data-part` marks the figure and the basis for compositions that restyle them.
 */
export function PayFigure({ pay, size = "md", className }: PayFigureProps & Placement) {
  const parts = payParts(pay)

  return (
    <span className={cx(styles.pay, className)} data-kind={parts.kind} data-size={size}>
      <span className={styles.amount} data-part="amount">{parts.amount}</span>
      {parts.basis ? (
        <>
          {" "}
          <span className={styles.basis} data-part="basis">{parts.basis}</span>
        </>
      ) : null}
    </span>
  )
}
