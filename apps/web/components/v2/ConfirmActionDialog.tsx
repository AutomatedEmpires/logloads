"use client"

import { Button, Dialog } from "@logloads/ui/primitives"
import { useId, useRef, useState, type MouseEvent, type ReactNode } from "react"
import { createPortal } from "react-dom"

import { ConfirmActionForm, type ConfirmActionFormProps } from "./ConfirmActionForm"
import { ConfirmReasonField, type ConfirmReason } from "./ConfirmReasonField"
import styles from "./InquiryConversation.module.css"

function isPlainClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  return !event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
}

/**
 * A destructive inquiry action (decline, withdraw) confirmed in a design-system Dialog.
 *
 * The trigger is a link to `fallbackHref`, where the server renders the same confirmation in the page, so it works
 * without JavaScript. With scripts a plain click opens the Dialog instead. The Dialog is portalled to <body>
 * because the trigger sits inside the reply form and a form cannot contain another; it carries `ll-theme`, so it
 * keeps the V2 tokens there. Escape, Close and Cancel close it and return focus to the trigger. With `reason`, the
 * body also offers the optional reason the other side will see (UX-09 criterion 5), posted with the form.
 */
export function ConfirmActionDialog({
  body,
  fallbackHref,
  reason,
  title,
  triggerLabel,
  ...form
}: ConfirmActionFormProps & {
  body: ReactNode
  fallbackHref: string
  reason?: ConfirmReason
  title: string
  triggerLabel: string
}) {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLAnchorElement>(null)
  const formId = `confirm-${useId().replace(/[^A-Za-z0-9_-]/g, "")}`
  const close = () => setOpen(false)

  return (
    <>
      <Button
        aria-haspopup="dialog"
        href={fallbackHref}
        label={triggerLabel}
        onClick={(event) => {
          if (!isPlainClick(event)) return
          event.preventDefault()
          setOpen(true)
        }}
        ref={trigger}
        size="sm"
        variant="danger"
      />
      {open
        ? createPortal(
            <Dialog
              footer={
                <>
                  <Button data-autofocus="" label="Cancel" onClick={close} variant="secondary" />
                  <ConfirmActionForm {...form} className={styles.dialogForm} id={formId} />
                </>
              }
              onClose={close}
              open
              returnFocusRef={trigger}
              title={title}
            >
              {body}
              {reason ? <ConfirmReasonField form={formId} id={`${formId}-reason`} reason={reason} /> : null}
            </Dialog>,
            document.body
          )
        : null}
    </>
  )
}
