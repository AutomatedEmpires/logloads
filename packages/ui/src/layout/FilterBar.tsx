"use client"

import type { HTMLAttributes } from "react"

import { Icon } from "../icons"
import { cx } from "./cx"
import styles from "./FilterBar.module.css"
import type { FilterBarProps, LayoutRef, Placement } from "./types"

/** `onOpenFilter` id for the phone "Filters" button, which opens every filter at once. */
export const FILTER_BAR_ALL_ID = "all-filters"
/** `onOpenFilter` id for the "More filters" button. */
export const FILTER_BAR_MORE_ID = "more-filters"

export type FilterBarElementProps = Omit<HTMLAttributes<HTMLDivElement>, "children" | "className" | "style">

/**
 * A row of filter buttons; each shows its current value and asks the page to open that filter.
 * The page owns filter state and the sheet or popover that edits it.
 */
export function FilterBar({
  filters,
  onOpenFilter,
  onClearAll,
  moreFilters = false,
  className,
  ref,
  ...rest
}: FilterBarProps & FilterBarElementProps & Placement & { ref?: LayoutRef<HTMLDivElement> }) {
  const activeCount = filters.filter((filter) => filter.active).length

  return (
    <div aria-label="Filters" role="group" {...rest} className={cx(styles.bar, className)} ref={ref}>
      <div className={styles.inner}>
        <button
          className={cx(styles.filter, styles.narrowOnly)}
          data-active={activeCount > 0 ? "" : undefined}
          onClick={() => onOpenFilter(FILTER_BAR_ALL_ID)}
          type="button"
        >
          <Icon aria-hidden name="action.filter" size={16} />
          <span className={styles.filterValue}>Filters · {activeCount}</span>
        </button>
        {filters.map((filter) => (
          <button
            className={cx(styles.filter, filter.desktopOnly && styles.wideOnly)}
            data-active={filter.active ? "" : undefined}
            key={filter.id}
            onClick={() => onOpenFilter(filter.id)}
            type="button"
          >
            <span className={styles.filterLabel}>{filter.label}</span>{" "}
            <span className={styles.filterValue}>{filter.valueLabel}</span>
          </button>
        ))}
        {moreFilters ? (
          <button className={cx(styles.filter, styles.wideOnly)} onClick={() => onOpenFilter(FILTER_BAR_MORE_ID)} type="button">
            <Icon aria-hidden name="action.filter" size={16} />
            More filters
          </button>
        ) : null}
        {onClearAll ? (
          <button className={cx(styles.clear, styles.wideOnly)} onClick={onClearAll} type="button">
            Clear all
          </button>
        ) : null}
      </div>
    </div>
  )
}
