import { cx } from "./cx"
import styles from "./PageContainer.module.css"
import type { PageContainerProps, Placement } from "./types"

export function PageContainer({ width = "default", children, className }: PageContainerProps & Placement) {
  return (
    <div className={cx(styles.container, className)} data-width={width === "narrow" ? "narrow" : undefined}>
      {children}
    </div>
  )
}
