"use client"

import type { MarketplaceJobSort } from "@logloads/contracts"
import { Button } from "@logloads/ui/primitives"
import Form from "next/form"

import { FIND_WORK_PATH, FIND_WORK_SORT_LABELS } from "@/lib/marketplace-v2/find-work"

import styles from "./FindWork.module.css"

/**
 * The list order (UX-06 criterion 4) as its own small GET form that keeps the rest of the search in hidden fields.
 * With scripts the order applies as soon as it changes (a client navigation through `next/form`); without them the
 * Sort button submits it. "Nearest" needs a location, so it is unavailable, and says why, until one is set.
 */
export function SortControl({
  hidden,
  nearestAvailable,
  value
}: {
  hidden: ReadonlyArray<{ name: string; value: string }>
  nearestAvailable: boolean
  value: MarketplaceJobSort
}) {
  return (
    <Form action={FIND_WORK_PATH} aria-label="Sort jobs" className={styles.sort} scroll={false}>
      {hidden.map((field) => <input key={`${field.name}=${field.value}`} name={field.name} type="hidden" value={field.value} />)}
      <label className={styles.sortLabel} htmlFor="work-sort">Sort</label>
      <select
        className={styles.sortSelect}
        defaultValue={value}
        id="work-sort"
        key={value}
        name="sort"
        onChange={(event) => event.currentTarget.form?.requestSubmit()}
      >
        <option value="newest">{FIND_WORK_SORT_LABELS.newest}</option>
        <option disabled={!nearestAvailable} value="nearest">
          {nearestAvailable ? FIND_WORK_SORT_LABELS.nearest : `${FIND_WORK_SORT_LABELS.nearest} (add a location)`}
        </option>
        <option value="pay">{FIND_WORK_SORT_LABELS.pay}</option>
      </select>
      <Button className={styles.sortSubmit} label="Sort" size="sm" type="submit" variant="secondary" />
    </Form>
  )
}
