"use client"

import type { HTMLAttributes, Ref } from "react"

import { cx } from "./internal"
import styles from "./SegmentedControl.module.css"

export interface SegmentedOption<T extends string> {
  value: T
  label: string
}

/** component-api.ts SegmentedControlProps. */
export interface SegmentedControlProps<T extends string> extends Omit<HTMLAttributes<HTMLDivElement>, "children" | "className" | "onChange" | "style"> {
  /** Accessible name of the group, e.g. "Pay type". */
  label: string
  options: Array<SegmentedOption<T>>
  /** null: nothing chosen yet. */
  value: T | null
  onChange: (value: T) => void
  /** Layout placement only. */
  className?: string
  ref?: Ref<HTMLDivElement>
}

/** One choice from a few options: a labelled group of toggle buttons with `aria-pressed`. */
export function SegmentedControl<T extends string>({ label, options, value, onChange, className, ref, ...rest }: SegmentedControlProps<T>) {
  return (
    <div {...rest} aria-label={label} className={cx(styles.group, className)} ref={ref} role="group">
      {options.map((option) => (
        <button
          aria-pressed={option.value === value}
          className={styles.option}
          key={option.value}
          onClick={() => {
            if (option.value !== value) onChange(option.value)
          }}
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
