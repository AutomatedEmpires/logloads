"use client"

import type { HTMLAttributes, Ref } from "react"

import a11y from "./a11y.module.css"
import { cx } from "./internal"
import styles from "./NumberStepper.module.css"

/** component-api.ts NumberStepperProps. `value: null` means unknown and is never shown as 0. */
export interface NumberStepperProps extends Omit<HTMLAttributes<HTMLDivElement>, "children" | "className" | "onChange" | "style"> {
  /** Accessible name of the group, e.g. "Trucks available". */
  label: string
  value: number | null
  /** Default 0. */
  min?: number
  max?: number
  onChange: (next: number) => void
  /** Submits the value with the surrounding form through a hidden input. */
  name?: string
  /** Layout placement only. */
  className?: string
  ref?: Ref<HTMLDivElement>
}

/** Clamps `value` into [min, max]. */
export function clampStep(value: number, min: number, max: number | undefined): number {
  return Math.max(min, max === undefined ? value : Math.min(max, value))
}

/**
 * A − / + stepper. It only ever emits values clamped to [min, max]. The step that would leave the range is
 * `aria-disabled` rather than `disabled`, so focus stays on it when the limit is reached and screen readers
 * announce it as unavailable. From an unknown value, + starts at min + 1 and − is unavailable.
 */
export function NumberStepper({ label, value, min = 0, max, onChange, name, className, ref, ...rest }: NumberStepperProps) {
  const canDecrease = value !== null && value > min
  const canIncrease = max === undefined || value === null || value < max

  function step(delta: 1 | -1) {
    if (delta < 0 ? !canDecrease : !canIncrease) return
    onChange(clampStep((value ?? min) + delta, min, max))
  }

  return (
    <div {...rest} aria-label={label} className={cx(styles.stepper, className)} ref={ref} role="group">
      <button aria-disabled={canDecrease ? undefined : true} aria-label="One fewer" className={styles.step} onClick={() => step(-1)} type="button">
        −
      </button>
      <output aria-live="polite" className={styles.value}>
        {value ?? (
          <>
            <span aria-hidden="true">?</span>
            <span className={a11y.visuallyHidden}>Not set</span>
          </>
        )}
      </output>
      <button aria-disabled={canIncrease ? undefined : true} aria-label="One more" className={styles.step} onClick={() => step(1)} type="button">
        +
      </button>
      {name ? <input name={name} type="hidden" value={value ?? ""} /> : null}
    </div>
  )
}
