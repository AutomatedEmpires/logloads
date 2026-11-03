"use client"

import { Icon } from "@logloads/ui/icons"
import { Button, Dialog } from "@logloads/ui/primitives"
import Form from "next/form"
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
      <span className={styles.summaryText}>
        <span className={styles.summaryWhere}>{where}</span>
        <span className={styles.summaryWhat}>{what}</span>
      </span>
      <span aria-hidden="true" className={styles.summaryAction}>Change</span>
    </>
  )
}

/**
 * Find work's summary bar and filter sheet (UX-06 criterion 1, UX 02 §A6). The bar states the active search as text;
 * it opens a Dialog (a bottom sheet below 768 px) holding the GET form, with Apply and Reset in the sheet's footer.
 *
 * Without JavaScript (and until hydration) the bar is a native <details> whose body is the same form, so every
 * field still submits as a plain GET request. `next/form` turns the submit into a client navigation when scripts
 * run, which keeps the list's own state (density) and skips a full reload.
 */
export function FindWorkFilters({ places, resetHref, values, what, where }: FindWorkFiltersProps) {
  const scripted = useScripted()
  const [open, setOpen] = useState(false)
  const openerRef = useRef<HTMLButtonElement | null>(null)

  if (!scripted) {
    return (
      <details className={styles.disclosure}>
        <summary aria-label={`Change search: ${where}. ${what}`} className={styles.summary} id={SUMMARY_ID}>
          <SummaryText what={what} where={where} />
        </summary>
        <Form action={FIND_WORK_PATH} aria-labelledby={SUMMARY_ID} className={styles.form} id={FORM_ID} role="search">
          <FindWorkFields places={places} values={values} />
          <div className={styles.formActions}>
            <Button label="Apply" type="submit" />
            <Button href={resetHref} label="Reset" variant="secondary" />
          </div>
        </Form>
      </details>
    )
  }

  return (
    <>
      <button
        aria-haspopup="dialog"
        aria-label={`Change search: ${where}. ${what}`}
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
        <Form
          action={FIND_WORK_PATH}
          aria-label="Filter jobs"
          className={styles.form}
          id={FORM_ID}
          onSubmit={() => setOpen(false)}
          role="search"
        >
          <FindWorkFields places={places} values={values} />
        </Form>
      </Dialog>
    </>
  )
}
