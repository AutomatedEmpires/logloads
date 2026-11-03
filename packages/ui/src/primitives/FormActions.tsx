import type { HTMLAttributes, ReactNode } from "react"

import styles from "./FormActions.module.css"
import { cx } from "./internal"

/** component-api.ts FormActionsProps. */
export interface FormActionsProps extends Omit<HTMLAttributes<HTMLDivElement>, "children" | "className" | "style"> {
  /** Back, Cancel. Sits on the left. */
  secondary?: ReactNode
  /** Save draft, Next, Publish. Sits on the right; at most one primary Button. */
  primary: ReactNode
  /** Layout placement only. */
  className?: string
}

/** The action row at the end of a form. Below bp-sm it sticks above the bottom navigation. */
export function FormActions({ secondary, primary, className, ...rest }: FormActionsProps) {
  return (
    <div {...rest} className={cx(styles.actions, className)}>
      {secondary ? <div className={styles.group}>{secondary}</div> : null}
      <div className={cx(styles.group, styles.primary)}>{primary}</div>
    </div>
  )
}
