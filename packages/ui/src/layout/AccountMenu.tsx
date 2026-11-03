"use client"

import { useEffect, useId, useRef, type KeyboardEvent } from "react"

import { Icon } from "../icons"
import styles from "./AccountMenu.module.css"
import { cx } from "./cx"
import type { AccountMenuProps, Placement } from "./types"

/** The trigger's visible word; at bp-lg and up it shows beside the icon, below that only the icon does. */
export const ACCOUNT_MENU_LABEL = "Account"

/**
 * The account menu at the end of the top bar (#124): the signed-in person, a few plain links, a notice such
 * as the development preview, and an app-supplied action such as sign-out. It is a disclosure built on
 * <details>, so it opens and closes with Enter or Space and works before (or without) JavaScript. Once
 * hydrated, Escape inside it closes it and returns focus to the trigger, and a pointer press or focus
 * moving outside closes it. It is not an ARIA menu: the panel holds text, and its links keep native
 * link behaviour and the ordinary tab order.
 */
export function AccountMenu({ person, links = [], note, tag, action, className }: AccountMenuProps & Placement) {
  const detailsRef = useRef<HTMLDetailsElement>(null)
  const triggerRef = useRef<HTMLElement>(null)
  const noteTitleId = useId()

  useEffect(() => {
    const details = detailsRef.current
    if (!details) return

    const closeOnOutsidePress = (event: PointerEvent) => {
      if (details.open && event.target instanceof Node && !details.contains(event.target)) details.open = false
    }
    // Only a focus move to a known element outside closes it; clicking the panel's own text moves focus nowhere.
    const closeOnFocusOut = (event: FocusEvent) => {
      if (details.open && event.relatedTarget instanceof Node && !details.contains(event.relatedTarget)) details.open = false
    }

    document.addEventListener("pointerdown", closeOnOutsidePress)
    details.addEventListener("focusout", closeOnFocusOut)
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePress)
      details.removeEventListener("focusout", closeOnFocusOut)
    }
  }, [])

  const closeOnEscape = (event: KeyboardEvent<HTMLDetailsElement>) => {
    const details = detailsRef.current
    if (event.key !== "Escape" || !details?.open) return
    event.preventDefault()
    details.open = false
    triggerRef.current?.focus()
  }

  return (
    <details className={cx(styles.menu, className)} onKeyDown={closeOnEscape} ref={detailsRef}>
      <summary className={styles.trigger} ref={triggerRef}>
        <Icon aria-hidden name="nav.profile" size={20} />
        <span className={styles.label}>{ACCOUNT_MENU_LABEL}</span>
        {tag ? (
          <>
            <span className={styles.visuallyHidden}>, </span>
            <span className={styles.tag}>{tag}</span>
          </>
        ) : null}
      </summary>
      <div className={styles.panel}>
        {person ? (
          <div className={styles.person}>
            <span className={styles.name}>{person.name}</span>
            {person.email ? <span className={styles.email}>{person.email}</span> : null}
          </div>
        ) : null}
        {links.length > 0 ? (
          <div className={styles.links}>
            {links.map((link) => (
              <a className={styles.link} href={link.href} key={link.id}>
                {link.label}
              </a>
            ))}
          </div>
        ) : null}
        {note ? (
          <div aria-labelledby={noteTitleId} className={styles.note} role="note">
            <p className={styles.noteTitle} id={noteTitleId}>{note.title}</p>
            <div className={styles.noteBody}>{note.body}</div>
          </div>
        ) : null}
        {action ? <div className={styles.action}>{action}</div> : null}
      </div>
    </details>
  )
}
