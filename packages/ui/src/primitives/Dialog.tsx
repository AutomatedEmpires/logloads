"use client"

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  type DialogHTMLAttributes,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type Ref,
  type SyntheticEvent
} from "react"

import { Button } from "./Button"
import styles from "./Dialog.module.css"
import { assignRef, cx } from "./internal"

export type DialogSize = "default" | "wide"

/** component-api.ts DialogProps. */
export interface DialogProps extends Omit<DialogHTMLAttributes<HTMLDialogElement>, "children" | "className" | "onCancel" | "onClose" | "open" | "style" | "title"> {
  /** Visible heading; also the dialog's accessible name. */
  title: string
  open: boolean
  /** Called on Escape, the Close button and a backdrop click. The parent then sets `open` to false. */
  onClose: () => void
  size?: DialogSize
  footer?: ReactNode
  /** Where focus goes on close. Defaults to the element that had focus when the dialog opened. */
  returnFocusRef?: { current: HTMLElement | null }
  children: ReactNode
  /** Layout placement only. */
  className?: string
  ref?: Ref<HTMLDialogElement>
}

/**
 * A modal dialog on the native `<dialog>` element, opened with `showModal()`: the browser makes the rest of the
 * page inert and keeps Tab inside the dialog. The root carries `ll-theme`, so V2 tokens apply even when the dialog
 * is portalled outside the AppShell. Below 768 px it is a bottom sheet; from 768 px it is centred.
 *
 * Focus: on open it moves to the first element marked `data-autofocus`, otherwise to the first focusable element
 * (the Close button). On close (Escape, Close, backdrop, or `open` turning false) it returns to `returnFocusRef`, or
 * to the element that opened the dialog. Pass `returnFocusRef` when the opener may re-render or, as in Safari, a
 * click does not focus buttons.
 *
 * Content renders only while open.
 */
export function Dialog({
  title,
  open,
  onClose,
  size = "default",
  footer,
  returnFocusRef,
  children,
  className,
  ref,
  onClick,
  onPointerDown,
  ...rest
}: DialogProps) {
  const titleId = useId()
  const dialogRef = useRef<HTMLDialogElement | null>(null)
  const onCloseRef = useRef(onClose)
  const returnFocusRefRef = useRef(returnFocusRef)
  const closingFromProp = useRef(false)
  const pointerDownOnBackdrop = useRef(false)

  useEffect(() => {
    onCloseRef.current = onClose
    returnFocusRefRef.current = returnFocusRef
  })

  const setRef = useCallback(
    (node: HTMLDialogElement | null) => {
      dialogRef.current = node
      assignRef(ref, node)
    },
    [ref]
  )

  // Layout effect: open and close before paint, so the content never flashes in an unopened or emptied box.
  useLayoutEffect(() => {
    const dialog = dialogRef.current
    if (!open || !dialog) return

    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    if (!dialog.open) dialog.showModal()
    dialog.querySelector<HTMLElement>("[data-autofocus]")?.focus()

    return () => {
      if (dialog.open) {
        closingFromProp.current = true
        dialog.close()
      }
      const target = returnFocusRefRef.current?.current ?? opener
      if (target?.isConnected) target.focus()
    }
  }, [open])

  function handleCancel(event: SyntheticEvent<HTMLDialogElement>) {
    // Escape: keep `open` controlled by the parent instead of letting the browser close the dialog.
    event.preventDefault()
    onCloseRef.current()
  }

  function handleClose() {
    // Fired after any close. Report closes the parent did not ask for, e.g. a <form method="dialog"> submit.
    if (closingFromProp.current) {
      closingFromProp.current = false
      return
    }
    onCloseRef.current()
  }

  function handlePointerDown(event: PointerEvent<HTMLDialogElement>) {
    onPointerDown?.(event)
    pointerDownOnBackdrop.current = event.target === event.currentTarget
  }

  function handleClick(event: MouseEvent<HTMLDialogElement>) {
    onClick?.(event)
    // The content fills the dialog box, so a click whose target is the <dialog> itself landed on the backdrop.
    // Requiring the press to start there too keeps a text selection dragged out of the dialog from closing it.
    if (pointerDownOnBackdrop.current && event.target === event.currentTarget) onCloseRef.current()
    pointerDownOnBackdrop.current = false
  }

  return (
    <dialog
      {...rest}
      aria-labelledby={titleId}
      className={cx("ll-theme", styles.dialog, className)}
      data-size={size}
      onCancel={handleCancel}
      onClick={handleClick}
      onClose={handleClose}
      onPointerDown={handlePointerDown}
      ref={setRef}
    >
      {open ? (
        <div className={styles.surface}>
          <div className={styles.head}>
            <h2 className={styles.title} id={titleId}>
              {title}
            </h2>
            <Button label="Close" onClick={() => onCloseRef.current()} size="sm" variant="ghost" />
          </div>
          <div className={styles.body}>{children}</div>
          {footer ? <div className={styles.foot}>{footer}</div> : null}
        </div>
      ) : null}
    </dialog>
  )
}
