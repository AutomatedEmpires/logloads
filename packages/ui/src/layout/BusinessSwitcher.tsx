import type { HTMLAttributes } from "react"

import styles from "./BusinessSwitcher.module.css"
import { cx } from "./cx"
import type { BusinessSwitcherProps, LayoutRef, Placement } from "./types"

export type BusinessSwitcherElementProps = Omit<HTMLAttributes<HTMLElement>, "children" | "className" | "style">

/**
 * The acting business, its kind and the viewer's role. With `switchHref` it is a link to the switch route
 * (which revalidates on the server). Without it, it is plain text and never a link; when the account has
 * more than one business, `unavailableNote` says why switching is not offered.
 */
export function BusinessSwitcher({
  current,
  memberships,
  switchHref,
  unavailableNote,
  className,
  ref,
  ...rest
}: BusinessSwitcherProps & BusinessSwitcherElementProps & Placement & { ref?: LayoutRef<HTMLElement> }) {
  const identity = (
    <>
      <span aria-hidden="true" className={styles.avatar}>{current.initials}</span>
      <span className={styles.text}>
        <span className={styles.name}>{current.name}</span>
        <span className={styles.role}>{current.kind} · {current.roleLabel}</span>
      </span>
    </>
  )

  if (switchHref) {
    return (
      // The accessible name is built from the visible text plus hidden words, so it always contains what sighted
      // users read (WCAG 2.5.3 Label in Name; an aria-label here dropped the visible role, found by axe in DS-05).
      <a
        {...rest}
        className={cx(styles.switcher, className)}
        href={switchHref}
        ref={ref as LayoutRef<HTMLAnchorElement> | undefined}
      >
        <span className={styles.visuallyHidden}>Acting as </span>
        {identity}
        <span className={styles.visuallyHidden}>. Switch business</span>
      </a>
    )
  }

  const note = memberships.length > 1 && unavailableNote ? unavailableNote : undefined

  return (
    <div
      {...rest}
      className={cx(styles.switcher, className)}
      data-static=""
      ref={ref as LayoutRef<HTMLDivElement> | undefined}
      title={note}
    >
      <span className={styles.visuallyHidden}>Acting as </span>
      {identity}
      {note ? <span className={styles.visuallyHidden}> {note}</span> : null}
    </div>
  )
}
