"use client"

import type { InputHTMLAttributes, Ref } from "react"

import styles from "./Checkbox.module.css"
import { cx } from "./internal"

/** component-api.ts CheckboxProps. Other input attributes (name, value, required, disabled, aria-*) reach the input. */
export interface CheckboxProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "checked" | "children" | "className" | "defaultChecked" | "id" | "onChange" | "style" | "type"> {
  id: string
  label: string
  checked: boolean
  hint?: string
  onChange: (checked: boolean) => void
  /** Layout placement only; applied to the label that wraps the input. */
  className?: string
  ref?: Ref<HTMLInputElement>
}

/**
 * A native checkbox inside its label, so the whole 44 px row toggles it. With a hint, the input is named by the
 * label text alone and described by the hint, so the hint is read once rather than twice.
 */
export function Checkbox({ id, label, checked, hint, onChange, className, ref, ...rest }: CheckboxProps) {
  const labelId = `${id}-label`
  const hintId = hint ? `${id}-hint` : undefined

  return (
    <label className={cx(styles.check, className)} htmlFor={id}>
      <input
        {...rest}
        aria-describedby={cx(rest["aria-describedby"], hintId) || undefined}
        aria-labelledby={hint ? labelId : rest["aria-labelledby"]}
        checked={checked}
        className={styles.input}
        id={id}
        onChange={(event) => onChange(event.currentTarget.checked)}
        ref={ref}
        type="checkbox"
      />
      <span className={styles.text}>
        <span id={labelId}>{label}</span>
        {hint ? (
          <small className={styles.hint} id={hintId}>
            {hint}
          </small>
        ) : null}
      </span>
    </label>
  )
}
