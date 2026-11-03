import type { KeyboardEvent, Ref } from "react"

import { JobResultList, JobResultRow } from "@logloads/ui/marketplace"
import { Button } from "@logloads/ui/primitives"

import {
  jobMapCardView,
  jobMapJobHref,
  siteAreaText,
  siteSheetTitle,
  type JobMapSite
} from "@/lib/marketplace-v2/job-map"

import styles from "./JobMap.module.css"

export interface JobMapSheetProps {
  site: JobMapSite
  /** The request's ISO 8601 instant, for the cards' freshness. */
  now: string
  id: string
  headingRef?: Ref<HTMLHeadingElement>
  onClose: () => void
}

/**
 * The pin preview (UX-13 criterion 3): the job cards of one approximate area, as a sheet over the bottom of the map
 * below bp-md and over its right side from bp-md. It covers a fixed share of the map and never resizes it; the map
 * moves its attribution and controls clear of it and pans the open area (and any marker reached by keyboard) out from
 * under it. The map opens it and moves focus to its heading; Escape or Close closes it and the map returns focus to
 * the pin. Cards are the list's own `JobResultRow`s, built from public card fields only; a point without a card is
 * named and linked.
 */
export function JobMapSheet({ site, now, id, headingRef, onClose }: JobMapSheetProps) {
  const headingId = `${id}-title`
  const area = siteAreaText(site)
  const withCards = site.points.every((point) => point.card)

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== "Escape" || event.defaultPrevented) return
    event.preventDefault()
    onClose()
  }

  return (
    <section aria-labelledby={headingId} className={styles.sheet} id={id} onKeyDown={handleKeyDown}>
      <div className={styles.sheetHead}>
        <div className={styles.sheetHeading}>
          <h2 className={styles.sheetTitle} id={headingId} ref={headingRef} tabIndex={-1}>
            {siteSheetTitle(site)}
          </h2>
          <p className={styles.sheetNote}>{area ? `${area} · approximate area` : "Approximate area"}</p>
        </div>
        <Button aria-label="Close job preview" label="Close" onClick={onClose} size="sm" variant="ghost" />
      </div>
      {withCards ? (
        <JobResultList className={styles.sheetList} label="Jobs in this area">
          {site.points.map((point) => (
            <JobResultRow
              context="hauler"
              href={jobMapJobHref(point)}
              job={jobMapCardView(point.card!, point)}
              key={point.id}
              now={now}
            />
          ))}
        </JobResultList>
      ) : (
        <ul aria-label="Jobs in this area" className={styles.sheetLinks}>
          {site.points.map((point) => (
            <li key={point.id}>
              <a className={styles.sheetLink} href={jobMapJobHref(point)}>
                {point.title}
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
