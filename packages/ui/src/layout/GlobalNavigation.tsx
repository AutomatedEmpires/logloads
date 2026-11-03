import { BusinessSwitcher } from "./BusinessSwitcher"
import { cx } from "./cx"
import styles from "./GlobalNavigation.module.css"
import type { GlobalNavigationProps, Placement } from "./types"

/** Navigation landmark name, shared with the bottom tabs; only one of the two is displayed at a time. */
export const MAIN_NAVIGATION_LABEL = "Main"

function BrandContent() {
  return (
    <>
      <span aria-hidden="true" className={styles.mark}>
        <span className={styles.markCore} />
      </span>
      <span className={styles.word}>
        <b>Log</b>
        <span>Loads</span>
      </span>
    </>
  )
}

/**
 * The white top bar: brand, the workspace's destinations (bp-lg and up) and the business switcher.
 * The brand returns to the first destination, which is the workspace home.
 */
export function GlobalNavigation({ items, activeId, business, className }: GlobalNavigationProps & Placement) {
  const home = items[0]?.href

  return (
    <header className={cx(styles.nav, className)}>
      <div className={styles.inner}>
        {home ? (
          <a aria-label="LogLoads home" className={styles.brand} href={home}>
            <BrandContent />
          </a>
        ) : (
          <span className={styles.brand}>
            <BrandContent />
          </span>
        )}
        <nav aria-label={MAIN_NAVIGATION_LABEL} className={styles.links}>
          {items.map((item) => (
            <a
              aria-current={item.id === activeId ? "page" : undefined}
              className={styles.link}
              href={item.href}
              key={item.id}
            >
              {item.label}
              {item.count ? <span className={styles.count}>{item.count}</span> : null}
            </a>
          ))}
        </nav>
        {business ? (
          <div className={styles.business}>
            <BusinessSwitcher {...business} />
          </div>
        ) : null}
      </div>
    </header>
  )
}
