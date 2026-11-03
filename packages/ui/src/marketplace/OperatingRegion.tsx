import { cx } from "../layout/cx"
import styles from "./OperatingRegion.module.css"
import type { OperatingRegionProps, Placement } from "./types"

/**
 * Where a hauling business works, as it describes itself: a home town (never an address), the areas it names and
 * how far it travels. The figure beside the list is decorative, not a map.
 */
export function OperatingRegion({ homeBase, areas, radiusMiles, className }: OperatingRegionProps & Placement) {
  const radius = radiusMiles !== null && Number.isFinite(radiusMiles) && radiusMiles > 0 ? Math.round(radiusMiles) : null

  return (
    <div className={cx(styles.region, className)}>
      <span aria-hidden="true" className={styles.figure}>
        <span className={styles.ring} data-known={radius !== null ? "" : undefined} />
        <span className={styles.home} />
      </span>
      <ul className={styles.list}>
        <li>
          Home base: <b className={styles.strong}>{homeBase}</b>
        </li>
        {areas.length > 0 ? <li>{areas.join(", ")}</li> : null}
        <li>{radius !== null ? `Up to ${radius} miles` : "Travel distance not stated"}</li>
      </ul>
    </div>
  )
}
