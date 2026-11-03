import type { MouseEvent } from "react"

import { cx } from "../layout/cx"
import { Button } from "../primitives/Button"
import { AvailabilityStatus } from "./AvailabilityStatus"
import { EquipmentRequirement } from "./EquipmentRequirement"
import {
  areaText,
  demandText,
  distanceText,
  JOB_PUBLIC_STATUS_LABELS,
  jobAvailabilityStatus,
  scheduleDetail,
  scheduleText
} from "./format"
import styles from "./JobResultRow.module.css"
import { PayFigure } from "./PayFigure"
import { SponsoredIndicator } from "./SponsoredIndicator"
import type { JobResultRowProps, Placement } from "./types"
import { VerificationIndicator } from "./VerificationIndicator"

/** A plain primary click; modified clicks (new tab, new window) keep the link's native behaviour. */
function isPlainClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  return !event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
}

function interestText(interest: { total: number; new: number }): { value: string; note: string } {
  return {
    note: interest.new > 0 ? `${interest.new} new` : "None new",
    value: `${interest.total} ${interest.total === 1 ? "business" : "businesses"}`
  }
}

/**
 * One job in a JobResultList: a semantic <li> whose title link is the row's single link (selection and
 * navigation target; its stretched ::after makes the whole row clickable). Save is an independent button beside
 * it, never nested inside. The same markup serves comfortable and compact density (a data-density ancestor) and
 * the hauler, poster and preview contexts, so the row's rules exist once.
 *
 * Server-renderable: it holds no state, and the optional handlers attach only when a client component passes
 * them. Without JavaScript the title is an ordinary link to `href`.
 */
export function JobResultRow(props: JobResultRowProps & Placement) {
  const { job, now, context, selected = false, fit, distanceMiles, interest, onSelect, onSave, detailId, className } = props
  const hauler = context === "hauler"
  const poster = context === "poster"
  const href = context === "preview" ? undefined : props.href
  const availability = jobAvailabilityStatus(job, now)
  const distance = hauler ? distanceText(distanceMiles) : null
  const schedule = scheduleDetail(job)
  const interestFacts = poster && interest ? interestText(interest) : null
  const showStatus = poster || !job.acceptingInterest

  return (
    <li
      className={cx(styles.row, className)}
      data-context={context}
      data-linked={href ? "" : undefined}
      data-selected={selected ? "" : undefined}
      data-sponsored={job.sponsored ? "" : undefined}
    >
      <div className={styles.pay}>
        <PayFigure pay={job.pay} />
      </div>

      <div className={styles.main}>
        {job.sponsored ? <SponsoredIndicator /> : null}
        <h3 className={styles.title}>
          {href ? (
            <a
              aria-controls={detailId}
              aria-current={selected ? "true" : undefined}
              className={styles.link}
              href={href}
              onClick={onSelect ? (event) => {
                if (!isPlainClick(event)) return
                event.preventDefault()
                onSelect(job.id)
              } : undefined}
            >
              {job.title}
            </a>
          ) : (
            job.title
          )}
        </h3>
        <p className={styles.business}>
          {poster ? null : <span className={styles.poster}>{job.posterName}</span>}
          {job.product ? <span>{job.product}</span> : null}
          {poster || !job.posterVerification ? null : (
            <span className={styles.verification}>
              <VerificationIndicator verification={job.posterVerification} />
            </span>
          )}
          {showStatus ? (
            <span className={styles.status} data-accepting={job.acceptingInterest ? "" : undefined}>
              {JOB_PUBLIC_STATUS_LABELS[job.status]}
            </span>
          ) : null}
        </p>
      </div>

      <div className={styles.fresh}>
        <AvailabilityStatus label={availability.label} state={availability.state} />
      </div>

      <div className={styles.end}>
        {hauler && onSave ? (
          <Button
            className={styles.save}
            icon="action.save"
            iconOnly
            label={`Save ${job.title}`}
            onClick={() => onSave(job.id)}
            size="sm"
            variant="secondary"
          />
        ) : null}
      </div>

      <dl className={styles.facts}>
        <div className={styles.fact}>
          <dt className={styles.label}>Area</dt>
          <dd className={styles.value}>
            {areaText(job)}
            <small className={styles.note}>{distance ?? "Approximate area"}</small>
          </dd>
        </div>
        <div className={styles.fact}>
          <dt className={styles.label}>Truck and trailer</dt>
          <dd className={styles.value}>
            <EquipmentRequirement codes={job.equipment} fit={hauler ? fit : undefined} />
          </dd>
        </div>
        <div className={styles.fact}>
          <dt className={styles.label}>Schedule</dt>
          <dd className={styles.value}>
            {scheduleText(job)}
            {schedule ? <small className={styles.note}>{schedule}</small> : null}
          </dd>
        </div>
        <div className={styles.fact}>
          <dt className={styles.label}>{interestFacts ? "Interest" : "Demand"}</dt>
          <dd className={styles.value}>
            {interestFacts ? (
              <>
                {interestFacts.value}
                <small className={styles.note}>{interestFacts.note}</small>
              </>
            ) : (
              demandText(job.trucks)
            )}
          </dd>
        </div>
      </dl>
    </li>
  )
}
