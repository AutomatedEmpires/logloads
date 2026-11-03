"use client"

import { Icon } from "@logloads/ui/icons"
import { Button, Dialog } from "@logloads/ui/primitives"
import { useRef, useState, useSyncExternalStore } from "react"

import { FIND_WORK_PATH, type FindWorkFormValues } from "@/lib/marketplace-v2/find-work"

import styles from "./FindWork.module.css"
import { FindWorkFields } from "./FindWorkFields"

const FORM_ID = "work-filters"
const SUMMARY_ID = "work-filters-summary"

const subscribe = () => () => {}

/** False on the server and while hydrating, true once React runs in the browser. */
function useScripted(): boolean {
  return useSyncExternalStore(subscribe, () => true, () => false)
}

export interface FindWorkFiltersProps {
  values: FindWorkFormValues
  /** "Near Sweet Home, OR · 100 mi" */
  where: string
  /** "My trucks · Any pay basis · Starting within 14 days" */
  what: string
  /** The default search (keeps the map view when it is open). */
  resetHref: string
  places: readonly string[]
}

function SummaryText({ what, where }: { what: string; where: string }) {
  return (
    <>
      <Icon aria-hidden className={styles.summaryIcon} name="action.search" size={20} />
      {/* The spaces keep the parts apart in the accessible name, which is the visible text (WCAG 2.5.3). */}
      <span className={styles.summaryText}>
        <span className={styles.summaryWhere}>{where}</span>{" "}
        <span className={styles.summaryWhat}>{what}</span>
      </span>{" "}
      <span className={styles.summaryAction}>Change</span>
    </>
  )
}

/**
 * Find work's summary bar and filter sheet (UX-06 criterion 1, UX 02 §A6). The bar states the active search as text;
 * it opens a Dialog (a bottom sheet below 768 px) holding the GET form, with Apply and Reset in the sheet's footer.
 *
 * Without JavaScript (and until hydration) the bar is a native <details> whose body is the same form. Either way
 * Apply submits a plain GET request to /v2/work, so the search is the URL and a full page load renders it.
 */
export function FindWorkFilters({ places, resetHref, values, what, where }: FindWorkFiltersProps) {
  const scripted = useScripted()
  const [open, setOpen] = useState(false)
  const openerRef = useRef<HTMLButtonElement | null>(null)

  if (!scripted) {
    return (
      <details className={styles.disclosure}>
        <summary className={styles.summary} id={SUMMARY_ID}>
          <SummaryText what={what} where={where} />
        </summary>
        <form action={FIND_WORK_PATH} aria-labelledby={SUMMARY_ID} className={styles.form} id={FORM_ID} method="get" role="search">
          <FindWorkFields places={places} values={values} />
          <div className={styles.formActions}>
            <Button label="Apply" type="submit" />
            <Button href={resetHref} label="Reset" variant="secondary" />
          </div>
        </form>
      </details>
    )
  }

  return (
    <>
      <button
        aria-haspopup="dialog"
        className={styles.summary}
        id={SUMMARY_ID}
        onClick={() => setOpen(true)}
        ref={openerRef}
        type="button"
      >
        <SummaryText what={what} where={where} />
      </button>
      <Dialog
        className={styles.sheet}
        footer={
          <div className={styles.sheetActions}>
            <Button href={resetHref} label="Reset" onClick={() => setOpen(false)} variant="secondary" />
            <Button form={FORM_ID} label="Apply" type="submit" />
          </div>
        }
        onClose={() => setOpen(false)}
        open={open}
        returnFocusRef={openerRef}
        title="Filter jobs"
      >
        <form action={FIND_WORK_PATH} aria-label="Filter jobs" className={styles.form} id={FORM_ID} method="get" role="search">
          <FindWorkFields places={places} values={values} />
        </form>
      </Dialog>
    </>
  )
}
