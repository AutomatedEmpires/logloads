"use client"

import { useState, type ReactNode } from "react"

import { Icon } from "../icons"
import styles from "./SearchToolbar.module.css"

export interface SearchDisclosureProps {
  /** The id of the search form the summary button reveals. */
  formId: string
  title: string
  detail: string
  /** When the page has its own search sheet, the summary opens it instead of revealing the form. */
  onOpen?: () => void
  children: ReactNode
}

/** The phone-width search summary (below bp-md). Internal to SearchToolbar. */
export function SearchDisclosure({ formId, title, detail, onOpen, children }: SearchDisclosureProps) {
  const [open, setOpen] = useState(false)

  return (
    <div className={styles.disclosure} data-open={open ? "" : undefined}>
      <button
        aria-controls={onOpen ? undefined : formId}
        aria-expanded={onOpen ? undefined : open}
        aria-haspopup={onOpen ? "dialog" : undefined}
        className={styles.summary}
        onClick={() => (onOpen ? onOpen() : setOpen((current) => !current))}
        type="button"
      >
        <Icon aria-hidden name="action.search" size={20} />
        <span className={styles.summaryText}>
          <span className={styles.visuallyHidden}>Change search: </span>
          <span className={styles.summaryTitle}>{title}</span>
          {detail ? <span className={styles.summaryDetail}>{detail}</span> : null}
        </span>
      </button>
      {children}
    </div>
  )
}
