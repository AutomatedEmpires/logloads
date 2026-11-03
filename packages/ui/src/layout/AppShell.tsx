import styles from "./AppShell.module.css"
import { cx } from "./cx"
import { GlobalNavigation } from "./GlobalNavigation"
import { ResponsiveNavigation } from "./ResponsiveNavigation"
import type { AppShellProps, Placement } from "./types"

/** The id of the shell's <main>; the skip link targets it. */
export const MAIN_CONTENT_ID = "main"

/**
 * The single V2 application frame: skip link, optional banner, white top navigation (bp-lg and up),
 * the page, and bottom tabs below bp-lg. Server-renderable; the page decides `activeNavId`.
 */
export function AppShell({
  workspace,
  navigation,
  activeNavId,
  business,
  children,
  density = "comfortable",
  banner,
  className
}: AppShellProps & Placement) {
  return (
    <div className={cx("ll-theme ll-app", styles.root, className)} data-density={density} data-workspace={workspace}>
      <a className={styles.skip} href={`#${MAIN_CONTENT_ID}`}>Skip to main content</a>
      {banner ? <div className={styles.banner}>{banner}</div> : null}
      <GlobalNavigation activeId={activeNavId} business={business} items={navigation} />
      <main className={styles.main} id={MAIN_CONTENT_ID} tabIndex={-1}>
        {children}
      </main>
      <ResponsiveNavigation activeId={activeNavId} items={navigation} />
    </div>
  )
}
