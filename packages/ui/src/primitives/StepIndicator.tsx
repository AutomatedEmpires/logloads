import type { OlHTMLAttributes } from "react"

import a11y from "./a11y.module.css"
import { cx } from "./internal"
import styles from "./StepIndicator.module.css"

/** component-api.ts StepIndicatorProps. `current` is the zero-based index of the step in progress. */
export interface StepIndicatorProps extends Omit<OlHTMLAttributes<HTMLOListElement>, "children" | "className" | "style"> {
  steps: string[]
  current: number
  /** Layout placement only. */
  className?: string
}

type StepState = "done" | "current" | "todo"

const STATE_TEXT: Record<StepState, string> = { done: " (done)", current: " (current)", todo: "" }

/**
 * Progress through a multi-step form: an ordered list with `aria-current="step"` on the current step. Below bp-sm
 * (600 px of the ll-app container) only the current step's label stays visible; the others remain available to
 * screen readers.
 */
export function StepIndicator({ steps, current, className, ...rest }: StepIndicatorProps) {
  return (
    <ol aria-label="Progress" {...rest} className={cx(styles.steps, className)}>
      {steps.map((step, index) => {
        const state: StepState = index < current ? "done" : index === current ? "current" : "todo"

        return (
          <li aria-current={state === "current" ? "step" : undefined} className={styles.step} data-state={state} key={`${index}-${step}`}>
            <span aria-hidden="true" className={styles.number}>
              {state === "done" ? "✓" : index + 1}
            </span>
            <span className={styles.label}>
              {step}
              {state === "todo" ? null : <span className={a11y.visuallyHidden}>{STATE_TEXT[state]}</span>}
            </span>
          </li>
        )
      })}
    </ol>
  )
}
