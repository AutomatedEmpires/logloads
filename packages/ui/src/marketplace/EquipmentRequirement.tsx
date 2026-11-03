import { cx } from "../layout/cx"
import styles from "./EquipmentRequirement.module.css"
import { equipmentLabels } from "./format"
import type { EquipmentRequirementProps, Placement } from "./types"

const FIT_TEXT = { fits: "Fits your trucks", not_in_setups: "Not in your setups" } as const

/**
 * The truck and trailer a job asks for, named with contracts `marketplaceEquipmentLabel` (never raw codes), plus
 * an optional fit hint the page computed from the viewer's own equipment.
 */
export function EquipmentRequirement({ codes, fit, className }: EquipmentRequirementProps & Placement) {
  const labels = equipmentLabels(codes)

  return (
    <span className={cx(styles.equipment, className)}>
      <span className={styles.labels} data-part="labels">
        {labels.length > 0 ? labels.join(", ") : "Equipment not stated"}
      </span>
      {fit ? (
        <span className={styles.fit} data-fit={fit} data-part="fit">
          {FIT_TEXT[fit]}
        </span>
      ) : null}
    </span>
  )
}
