import { Icon } from "../icons"
import { cx } from "./cx"
import { MAIN_NAVIGATION_LABEL } from "./GlobalNavigation"
import styles from "./ResponsiveNavigation.module.css"
import type { NavItem, Placement, ResponsiveNavigationProps } from "./types"

/** Bottom tabs hold at most five destinations (4 for haulers, 5 for landings). */
export const MAX_BOTTOM_TABS = 5

/** The destinations the bottom tabs render: the first five, in the order the server supplied. */
export function bottomTabItems(items: readonly NavItem[]): NavItem[] {
  return items.slice(0, MAX_BOTTOM_TABS)
}

export function ResponsiveNavigation({ items, activeId, className }: ResponsiveNavigationProps & Placement) {
  return (
    <nav aria-label={MAIN_NAVIGATION_LABEL} className={cx(styles.tabs, className)}>
      {bottomTabItems(items).map((item) => (
        <a
          aria-current={item.id === activeId ? "page" : undefined}
          className={styles.tab}
          href={item.href}
          key={item.id}
        >
          {item.icon ? <Icon aria-hidden name={item.icon} size={22} /> : null}
          {item.label}
          {item.count ? (
            <>
              <span className={styles.visuallyHidden}>, </span>
              <span className={styles.count}>{item.count}</span>
              <span className={styles.visuallyHidden}> unread</span>
            </>
          ) : null}
        </a>
      ))}
    </nav>
  )
}
