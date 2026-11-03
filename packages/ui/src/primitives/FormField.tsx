import { cloneElement, isValidElement, type AriaAttributes, type HTMLAttributes, type ReactElement, type ReactNode } from "react"

import styles from "./FormField.module.css"
import { cx } from "./internal"

/** component-api.ts FormFieldProps. */
export interface FormFieldProps extends Omit<HTMLAttributes<HTMLDivElement>, "children" | "className" | "id" | "style"> {
  /** The control's id. FormField sets it on the control and points the label at it. */
  id: string
  label: string
  hint?: string
  error?: string
  optional?: boolean
  /** One labelable control: `<input>`, `<select>`, `<textarea>`, or a component that passes these props to one. */
  children: ReactNode
  /** Layout placement only. */
  className?: string
}

interface ControlProps {
  id?: string
  className?: string
  type?: string
  "aria-describedby"?: string
  "aria-invalid"?: AriaAttributes["aria-invalid"]
}

const STYLED_CONTROLS = new Set(["input", "select", "textarea"])
const UNSTYLED_INPUT_TYPES = new Set(["checkbox", "radio", "hidden"])

function isStyledControl(element: ReactElement<ControlProps>): boolean {
  return typeof element.type === "string" && STYLED_CONTROLS.has(element.type) && !UNSTYLED_INPUT_TYPES.has(element.props.type ?? "")
}

/**
 * Label, optional hint, one control and an optional error.
 *
 * Wiring: the control gets `id`, `aria-describedby` (error, then hint, then any ids it already had) and, with an
 * error, `aria-invalid="true"`. Native inputs, selects and textareas also get the field's control styling. For
 * checkbox and radio groups, use a `<fieldset>` with `Checkbox` or `ChoiceCard`; for groups like `NumberStepper`
 * or `SegmentedControl`, give the group its own `label`.
 */
export function FormField({ id, label, hint, error, optional = false, children, className, ...rest }: FormFieldProps) {
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined

  const control = isValidElement<ControlProps>(children)
    ? cloneElement(children, {
        id,
        "aria-describedby": cx(errorId, hintId, children.props["aria-describedby"]) || undefined,
        "aria-invalid": error ? true : children.props["aria-invalid"],
        ...(isStyledControl(children) ? { className: cx(styles.control, children.props.className) } : {})
      })
    : children

  return (
    <div {...rest} className={cx(styles.field, className)}>
      <label className={styles.label} htmlFor={id}>
        {label}
        {optional ? <span className={styles.optional}> (optional)</span> : null}
      </label>
      {hint ? (
        <span className={styles.hint} id={hintId}>
          {hint}
        </span>
      ) : null}
      {control}
      {error ? (
        <span className={styles.error} id={errorId} role="alert">
          {error}
        </span>
      ) : null}
    </div>
  )
}
