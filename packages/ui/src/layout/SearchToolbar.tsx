import type { HTMLAttributes } from "react"

import { Icon } from "../icons"
import { cx } from "./cx"
import { SearchDisclosure } from "./SearchDisclosure"
import styles from "./SearchToolbar.module.css"
import type { LayoutRef, Placement, SearchToolbarProps } from "./types"

export type SearchToolbarElementProps = Omit<HTMLAttributes<HTMLDivElement>, "children" | "className" | "style">

/** The query parameters the search form submits. */
export const SEARCH_PARAMS = Object.freeze({ location: "near", radius: "radius" } as const)

/**
 * Where-and-how-far search. A real GET form, so it works without JavaScript; the equipment summary is
 * read-only text about the viewer's own setups. Below bp-md a summary button stands in for the form.
 * Passing `onOpenMobileSearch` makes the summary open the page's own search sheet instead.
 */
export function SearchToolbar({
  location,
  radiusMiles,
  equipmentSummary,
  action,
  onOpenMobileSearch,
  className,
  id,
  ref,
  ...rest
}: SearchToolbarProps & SearchToolbarElementProps & Placement & { ref?: LayoutRef<HTMLDivElement> }) {
  const base = id ?? "ll-search"
  const formId = `${base}-form`
  const title = location ? `Near ${location} · ${radiusMiles} mi` : `Within ${radiusMiles} mi`

  return (
    <div {...rest} className={cx(styles.root, className)} id={id} ref={ref}>
      <SearchDisclosure detail={equipmentSummary} formId={formId} onOpen={onOpenMobileSearch} title={title}>
        <form action={action} className={styles.form} id={formId} method="get" role="search">
          <label className={styles.field}>
            <span className={styles.label}>Hauling from</span>
            <input
              autoComplete="off"
              className={styles.input}
              defaultValue={location}
              name={SEARCH_PARAMS.location}
              type="text"
            />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>
              Within<span className={styles.visuallyHidden}> (miles)</span>
            </span>
            <span className={styles.control}>
              <input
                className={styles.input}
                defaultValue={radiusMiles}
                inputMode="numeric"
                min={1}
                name={SEARCH_PARAMS.radius}
                type="number"
              />
              <span aria-hidden="true" className={styles.unit}>mi</span>
            </span>
          </label>
          <div className={styles.field} data-last="">
            <span className={styles.label}>Equipment</span>
            <span className={styles.value}>{equipmentSummary}</span>
          </div>
          <button className={styles.submit} type="submit">
            <Icon aria-hidden name="action.search" size={20} />
            Search
          </button>
        </form>
      </SearchDisclosure>
    </div>
  )
}
