import { cx } from "../layout/cx"
import styles from "./EquipmentCapacity.module.css"
import type { EquipmentCapacityProps, Placement } from "./types"

/** Marks drawn for a setup; larger fleets still show the full count in words. */
export const MAX_CAPACITY_MARKS = 12

/**
 * How many units of one setup are available, as the hauler last reported (self-reported, not tracking). Unknown
 * availability (the state, or a missing count) shows dashed marks and "not recently confirmed", never "0 available".
 */
export function EquipmentCapacity({ units, available, state, className }: EquipmentCapacityProps & Placement) {
  const total = Math.max(0, Math.floor(units))
  const known = state === "known" && available !== null && Number.isFinite(available)
  const count = known ? Math.min(total, Math.max(0, Math.floor(available as number))) : null
  const marks = Math.min(total, MAX_CAPACITY_MARKS)
  const unitWord = total === 1 ? "unit" : "units"

  return (
    <div className={cx(styles.capacity, className)} data-state={known ? "known" : "unknown"}>
      {marks > 0 ? (
        <span aria-hidden="true" className={styles.marks}>
          {Array.from({ length: marks }, (_, index) => (
            <span className={styles.mark} data-on={count !== null && index < count ? "" : undefined} key={index} />
          ))}
        </span>
      ) : null}
      <span className={styles.text}>
        {count !== null ? `${count} of ${total} available` : `${total} ${unitWord} · availability not recently confirmed`}
      </span>
    </div>
  )
}
