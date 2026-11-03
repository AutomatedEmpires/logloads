"use client"

import { useId, type InputHTMLAttributes, type Ref } from "react"

import styles from "./ChoiceCard.module.css"
import { cx } from "./internal"

/** component-api.ts ChoiceCardProps. Group cards with the same `name` inside a `<fieldset>` with a `<legend>`. */
export interface ChoiceCardProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "checked" | "children" | "className" | "defaultChecked" | "name" | "onChange" | "style" | "title" | "type" | "value"> {
  name: string
  value: string
  checked: boolean
  title: string
  description: string
  onChange: (value: string) => void
  /** Layout placement only; applied to the label that wraps the input. */
  className?: string
  ref?: Ref<HTMLInputElement>
}

/** A native radio inside a card-sized label. Named by `title`, described by `description`. */
export function ChoiceCard({ name, value, checked, title, description, onChange, className, ref, ...rest }: ChoiceCardProps) {
  const id = useId()
  const titleId = `${id}-title`
  const descriptionId = `${id}-description`

  return (
    <label className={cx(styles.choice, className)}>
      <input
        {...rest}
        aria-describedby={cx(descriptionId, rest["aria-describedby"])}
        aria-labelledby={titleId}
        checked={checked}
        className={styles.input}
        name={name}
        onChange={() => onChange(value)}
        ref={ref}
        type="radio"
        value={value}
      />
      <span className={styles.text}>
        <span className={styles.title} id={titleId}>
          {title}
        </span>
        <span className={styles.description} id={descriptionId}>
          {description}
        </span>
      </span>
    </label>
  )
}
