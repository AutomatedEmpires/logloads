"use client"

import { useCallback, useEffect, useRef, type HTMLAttributes, type KeyboardEvent } from "react"

import { cx } from "./cx"
import styles from "./DetailPanel.module.css"
import { createFocusReturn, type FocusReturn } from "./focus-return"
import type { DetailPanelProps, LayoutRef, Placement } from "./types"

export type DetailPanelElementProps = Omit<HTMLAttributes<HTMLElement>, "aria-label" | "children" | "className" | "style">

/**
 * The detail beside a "list-detail" ContentGrid at bp-xl and up. It owns its Close control: closing (the
 * button, or Escape inside the panel) returns focus to the control the panel was opened from, which is the
 * last element focused outside the panel. If the page removes the panel while focus is inside it, focus
 * also goes back to that control instead of falling to <body>. Pass `id` so a row link can `aria-controls` it.
 */
export function DetailPanel({
  label,
  onClose,
  children,
  className,
  onKeyDown,
  ref,
  ...rest
}: DetailPanelProps & DetailPanelElementProps & Placement & { ref?: LayoutRef<HTMLElement> }) {
  const panelRef = useRef<HTMLElement | null>(null)
  const focusReturn = useRef<FocusReturn | null>(null)

  if (focusReturn.current === null) {
    focusReturn.current = createFocusReturn(
      (node) => node instanceof Node && Boolean(panelRef.current?.contains(node)),
      (node) => node === document.body || node === document.documentElement
    )
  }

  useEffect(() => {
    const tracker = focusReturn.current
    if (!tracker) return

    tracker.note(document.activeElement)
    const onFocusIn = (event: FocusEvent) => tracker.note(event.target)
    document.addEventListener("focusin", onFocusIn)

    return () => {
      document.removeEventListener("focusin", onFocusIn)
      // Removed by the page while focus was inside: the focused node is gone and focus fell to <body>.
      if (!document.activeElement || document.activeElement === document.body) tracker.restore()
    }
  }, [])

  const close = useCallback(() => {
    focusReturn.current?.restore()
    onClose()
  }, [onClose])

  const setPanel = useCallback(
    (node: HTMLElement | null) => {
      panelRef.current = node
      if (typeof ref === "function") ref(node)
      else if (ref) ref.current = node
    },
    [ref]
  )

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    onKeyDown?.(event)
    if (event.defaultPrevented || event.key !== "Escape") return
    // A Dialog opened from inside the panel handles its own Escape.
    if (event.target instanceof Element && event.target.closest("dialog")) return
    event.preventDefault()
    close()
  }

  return (
    <aside {...rest} aria-label={label} className={cx(styles.panel, className)} onKeyDown={handleKeyDown} ref={setPanel} tabIndex={-1}>
      <div className={styles.bar}>
        <button className={styles.close} onClick={close} type="button">
          Close<span className={styles.visuallyHidden}> {label}</span>
        </button>
      </div>
      {children}
    </aside>
  )
}
