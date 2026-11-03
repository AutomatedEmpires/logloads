"use client"

import { useRef, type KeyboardEvent, type Ref } from "react"

import { assignRef, cx } from "./internal"
import { TabCount } from "./TabCount"
import type { TabsProps } from "./Tabs"
import styles from "./Tabs.module.css"

export interface TabListProps extends Omit<TabsProps, "ref" | "variant"> {
  variant: NonNullable<TabsProps["variant"]>
  rootRef?: Ref<HTMLElement>
}

/** The interactive half of `Tabs`: an ARIA tablist with automatic activation. Use `Tabs` rather than this directly. */
export function TabList({ variant, items, activeId, label, onChange, className, rootRef, ...rest }: TabListProps) {
  const tabs = useRef<Array<HTMLButtonElement | null>>([])
  const activeIndex = Math.max(0, items.findIndex((item) => item.id === activeId))

  function choose(index: number) {
    const item = items[index]
    if (!item) return
    tabs.current[index]?.focus()
    if (item.id !== activeId) onChange?.(item.id)
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = items.length - 1
    const next =
      event.key === "ArrowRight" ? (index === last ? 0 : index + 1)
      : event.key === "ArrowLeft" ? (index === 0 ? last : index - 1)
      : event.key === "Home" ? 0
      : event.key === "End" ? last
      : null

    if (next === null) return
    event.preventDefault()
    choose(next)
  }

  return (
    <div
      {...rest}
      aria-label={label}
      className={cx(styles.tabs, className)}
      data-variant={variant}
      ref={(node) => assignRef(rootRef, node)}
      role="tablist"
    >
      {items.map((item, index) => (
        <button
          aria-selected={item.id === activeId}
          className={styles.tab}
          key={item.id}
          onClick={() => choose(index)}
          onKeyDown={(event) => onKeyDown(event, index)}
          ref={(node) => {
            tabs.current[index] = node
          }}
          role="tab"
          tabIndex={index === activeIndex ? 0 : -1}
          type="button"
        >
          {item.label}
          <TabCount count={item.count} />
        </button>
      ))}
    </div>
  )
}
