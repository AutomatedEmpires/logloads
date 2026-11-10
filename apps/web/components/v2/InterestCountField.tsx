"use client"

import { FormField, NumberStepper } from "@logloads/ui/primitives"
import { useState, useSyncExternalStore } from "react"

import styles from "./InterestForm.module.css"

const subscribeNever = () => () => {}

/** True once React runs in the browser; false on the server and while hydrating, so the markup matches. */
function useScripted(): boolean {
  return useSyncExternalStore(subscribeNever, () => true, () => false)
}

/**
 * A truck count in the express-interest form. The server sends a native number input, so the form works before
 * hydration and without JavaScript; once scripts run it becomes the design-system NumberStepper, which only emits
 * values clamped to [min, max] and submits through a hidden input of the same name. Exactly one field with `name`
 * is ever rendered, so the action's parallel `equipmentKey` / `equipmentCount` lists stay aligned.
 *
 * `label` is the accessible name. With `labelHidden` the surrounding row shows it (an equipment configuration);
 * otherwise it is the field's visible label. The server re-checks every count against the business profile.
 */
export function InterestCountField({
  defaultValue,
  hint,
  id,
  label,
  labelHidden = false,
  max,
  min,
  name,
  onValueChange,
  required = false
}: {
  defaultValue: number
  hint?: string
  id: string
  label: string
  labelHidden?: boolean
  max: number
  min: number
  name: string
  /** Told each value the stepper emits once scripts run (the interest sheet's capacity check, UX-08 #131). */
  onValueChange?: (value: number) => void
  required?: boolean
}) {
  const scripted = useScripted()
  const [value, setValue] = useState(defaultValue)
  const hintId = hint ? `${id}-hint` : undefined
  const change = (next: number) => {
    setValue(next)
    onValueChange?.(next)
  }

  if (!scripted) {
    const input = (
      <input
        aria-label={labelHidden ? label : undefined}
        className={labelHidden ? styles.countInput : undefined}
        defaultValue={defaultValue}
        id={id}
        inputMode="numeric"
        max={max}
        min={min}
        name={name}
        required={required}
        type="number"
      />
    )

    return labelHidden ? input : <FormField hint={hint} id={id} label={label}>{input}</FormField>
  }

  const stepper = (
    <NumberStepper aria-describedby={hintId} id={id} label={label} max={max} min={min} name={name} onChange={change} value={value} />
  )

  if (labelHidden) return stepper

  return (
    <div className={styles.countField}>
      <span aria-hidden="true" className={styles.countLabel}>{label}</span>
      {hint ? <span className={styles.countHint} id={hintId}>{hint}</span> : null}
      {stepper}
    </div>
  )
}
