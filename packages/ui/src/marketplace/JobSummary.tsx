import type { ReactNode } from "react"

import { cx } from "../layout/cx"
import { AvailabilityStatus } from "./AvailabilityStatus"
import { EquipmentRequirement } from "./EquipmentRequirement"
import {
  areaText,
  demandText,
  haulDistanceText,
  jobAvailabilityStatus,
  payParts,
  scheduleDetail,
  scheduleText,
  unstatedText
} from "./format"
import styles from "./JobSummary.module.css"
import { PayFigure } from "./PayFigure"
import { SponsoredIndicator } from "./SponsoredIndicator"
import type { JobSummaryProps, Placement } from "./types"
import { VerificationIndicator } from "./VerificationIndicator"

/** The summary's element id, so a page can tell when it has scrolled out of view (the sticky interest bar). */
export function jobSummaryId(jobId: string): string {
  return `job-summary-${jobId}`
}

/** The job title's id: JobDetail's article is labelled by it. */
export function jobTitleId(jobId: string): string {
  return `job-detail-${jobId}`
}

/** Where the pay figure comes from, in the poster's terms. LogLoads never sets or guarantees pay (UX 02 §A7). */
const PAY_SOURCE = {
  negotiable: "The poster's terms. Not a LogLoads guarantee.",
  negotiableWithoutNote: "Negotiable. Ask the poster what it depends on.",
  rate: "Stated by the poster. Not a LogLoads guarantee.",
  unstated: "The poster hasn't stated pay. Ask before you commit a truck."
} as const

/** A fact and its note; a short note runs on the same line ("Near Oakridge, OR · approximate") to keep the fold. */
function Fact({ label, children, note, inline = false }: { label: string; children: ReactNode; note?: string | null; inline?: boolean }) {
  return (
    <div className={styles.fact}>
      <dt className={styles.label}>{label}</dt>
      <dd className={styles.value}>
        {children}
        {note ? <small className={inline ? styles.inlineNote : styles.note}>{inline ? ` · ${note}` : note}</small> : null}
      </dd>
    </div>
  )
}

/**
 * The decision summary of one job (UX-07, #130; UX 02 §A7): poster, title, pay with its source, then the decision
 * facts a hauler needs for a yes or no, sized to sit in the first 600 px of a 390 px phone. A fact the poster did not
 * state gets no row of its own: every unstated field is named once, in one "Not stated by the poster" line.
 *
 * The same component renders in JobDetail on the job page, in Find work's DetailPanel and sheet, and in the job
 * editor's preview (UX-05), so what a poster previews is exactly what haulers see. Presentational: the interest action
 * arrives as `action`, already resolved.
 */
export function JobSummary({ job, now, fit, action, className }: JobSummaryProps & Placement) {
  const pay = payParts(job.pay)
  const payNote = pay.kind !== "negotiable" && job.pay.note ? job.pay.note : null
  const availability = jobAvailabilityStatus(job, now)
  const distance = haulDistanceText(job)
  const scheduled = Boolean(job.startsOn || job.scheduleNote)
  const trucksStated = job.trucks.total !== null || job.trucks.perDay !== null
  const unstated = unstatedText(job)

  return (
    <div className={cx(styles.summary, className)} id={jobSummaryId(job.id)}>
      <div className={styles.head}>
        <p className={styles.poster}>
          <span>{job.posterName}</span>
          <VerificationIndicator verification={job.posterVerification} />
        </p>
        {job.sponsored ? <SponsoredIndicator /> : null}
        <h2 className={styles.title} id={jobTitleId(job.id)}>{job.title}</h2>
        <PayFigure pay={job.pay} size="lg" />
        <p className={styles.source}>{PAY_SOURCE[pay.kind === "negotiable" && !pay.basis ? "negotiableWithoutNote" : pay.kind]}</p>
        {payNote ? <p className={styles.source}>Poster&apos;s note on pay: {payNote}</p> : null}
      </div>

      <dl className={styles.facts}>
        {job.equipment.length > 0 ? (
          <Fact label="Equipment">
            <EquipmentRequirement codes={job.equipment} fit={fit} />
          </Fact>
        ) : null}
        <Fact inline label="Area" note="approximate">{areaText(job)}</Fact>
        {job.destinationLabel || distance ? (
          <Fact label="To" note={job.destinationLabel ? distance : null}>{job.destinationLabel ?? distance}</Fact>
        ) : null}
        {scheduled ? <Fact inline label="Schedule" note={scheduleDetail(job)}>{scheduleText(job)}</Fact> : null}
        {trucksStated ? <Fact label="Trucks">{demandText(job.trucks)}</Fact> : null}
        <Fact label="Listing">
          <AvailabilityStatus label={availability.label} state={availability.state} />
        </Fact>
      </dl>

      {unstated ? <p className={styles.unstated}>{unstated}</p> : null}
      {action ? <div className={styles.actions}>{action}</div> : null}
    </div>
  )
}
