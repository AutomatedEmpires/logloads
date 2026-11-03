import styles from "./ContentGrid.module.css"
import { cx } from "./cx"
import type { ContentGridProps, Placement } from "./types"

/**
 * Page body layouts. In "list-detail" the aside is expected to be a <DetailPanel> and is placed directly in
 * the grid; it shows beside the list only at bp-xl and up while `detailOpen` is true. Other layouts wrap the
 * aside in a column.
 */
export function ContentGrid({ layout, detailOpen = false, main, aside, className }: ContentGridProps & Placement) {
  const listDetail = layout === "list-detail"

  return (
    <div
      className={cx(styles.grid, className)}
      data-detail={listDetail ? (detailOpen ? "open" : "closed") : undefined}
      data-layout={layout}
    >
      <div className={styles.col}>{main}</div>
      {aside ? listDetail ? aside : <div className={styles.col}>{aside}</div> : null}
    </div>
  )
}
