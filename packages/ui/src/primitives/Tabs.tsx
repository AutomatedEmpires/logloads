import type { HTMLAttributes, Ref } from "react"

import { cx } from "./internal"
import { TabCount } from "./TabCount"
import { TabList } from "./TabList"
import styles from "./Tabs.module.css"

export interface TabItem {
  id: string
  label: string
  count?: number
  href?: string
}

export type TabsVariant = "page" | "segmented"

/** component-api.ts TabsProps. */
export interface TabsProps extends Omit<HTMLAttributes<HTMLElement>, "children" | "className" | "onChange" | "style"> {
  variant?: TabsVariant
  items: TabItem[]
  activeId: string
  /** Accessible name of the tab set, e.g. "Job sections". */
  label: string
  onChange?: (id: string) => void
  /** Layout placement only. */
  className?: string
  ref?: Ref<HTMLElement>
}

/**
 * Tabs in two looks: "page" (underline, under a PageHeader) and "segmented" (joined buttons).
 *
 * When every item has an `href` they are navigation: a `<nav>` of links with `aria-current="page"` on the active
 * one. This renders on the server and works without JavaScript. Otherwise they are an ARIA tablist (`TabList`) with
 * `aria-selected`, roving focus and arrow, Home and End keys; `onChange` receives the chosen id.
 */
export function Tabs(props: TabsProps) {
  const { variant = "page", items, activeId, label, onChange, className, ref, ...rest } = props

  if (items.length === 0 || !items.every((item) => item.href !== undefined)) {
    return <TabList {...rest} activeId={activeId} className={className} items={items} label={label} onChange={onChange} rootRef={ref} variant={variant} />
  }

  return (
    <nav {...rest} aria-label={label} className={cx(styles.tabs, className)} data-variant={variant} ref={ref}>
      {items.map((item) => (
        <a aria-current={item.id === activeId ? "page" : undefined} className={styles.tab} href={item.href} key={item.id}>
          {item.label}
          <TabCount count={item.count} />
        </a>
      ))}
    </nav>
  )
}
