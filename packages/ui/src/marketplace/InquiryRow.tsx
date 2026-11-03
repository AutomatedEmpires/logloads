import type { MouseEvent } from "react"

import { cx } from "../layout/cx"
import { availabilityText, formatDay, inquiryStatus, offerText } from "./format"
import styles from "./InquiryRow.module.css"
import type { InquiryRowProps, Placement } from "./types"

function isPlainClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  return !event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
}

/**
 * One inquiry in a semantic <ul>: the same row pattern as JobResultRow. The other party's name is the row's single
 * link (`aria-current="true"` when selected, stretched over the row); the turn state comes from UX-DEC-01. What
 * the hauler offers is self-reported, and the row says nothing about it being booked.
 */
export function InquiryRow({ interest, viewerSide, selected, href, onSelect, className }: InquiryRowProps & Placement) {
  const landing = viewerSide === "landing"
  const name = landing ? interest.haulerOrganization.name : interest.landingOrganization.name
  const status = inquiryStatus(interest, viewerSide)
  const available = availabilityText(interest)
  const updated = formatDay(interest.updatedAt)

  return (
    <li className={cx(styles.row, className)} data-selected={selected ? "" : undefined}>
      <div className={styles.top}>
        <a
          aria-current={selected ? "true" : undefined}
          className={styles.link}
          href={href}
          onClick={onSelect ? (event) => {
            if (!isPlainClick(event)) return
            event.preventDefault()
            onSelect(interest.id)
          } : undefined}
        >
          {name}
        </a>
        {updated ? <span className={styles.time}>{updated}</span> : null}
      </div>
      <p className={styles.job}>{interest.job.title}</p>
      <p className={styles.offer}>{offerText(interest)}</p>
      <p className={styles.state} data-tone={status.tone}>
        {available ? `${status.label} · ${available.charAt(0).toLowerCase()}${available.slice(1)}` : status.label}
      </p>
    </li>
  )
}
