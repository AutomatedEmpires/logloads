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
 * The pin preview (UX-13 criterion 3): the job cards of one approximate area, docked under the map below bp-md and
 * beside it from bp-md. It is part of the map region's layout, not an overlay, so it never covers a marker, the
 * "Approximate areas" label or the attribution. The map opens it and moves focus to its heading; Escape or Close
 * closes it and the map returns focus to the pin. Cards are the list's own `JobResultRow`s, built from public card
 * fields only; a point without a card is named and linked.
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
