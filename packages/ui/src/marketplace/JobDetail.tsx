import type { ReactNode } from "react"

import { cx } from "../layout/cx"
import { Button } from "../primitives/Button"
import { AvailabilityStatus } from "./AvailabilityStatus"
import { EquipmentRequirement } from "./EquipmentRequirement"
import {
  areaText,
  demandText,
  estimatesText,
  haulDistanceText,
  JOB_PUBLIC_STATUS_LABELS,
  jobAvailabilityStatus,
  NOT_STATED,
  payParts,
  scheduleDetail,
  scheduleText
} from "./format"
import styles from "./JobDetail.module.css"
import { PayFigure } from "./PayFigure"
import { SponsoredIndicator } from "./SponsoredIndicator"
import type { JobDetailProps, Placement } from "./types"
import { VerificationIndicator } from "./VerificationIndicator"

function Fact({ label, children, note }: { label: string; children: ReactNode; note?: string | null }) {
  return (
    <div className={styles.fact}>
      <dt className={styles.label}>{label}</dt>
      <dd className={styles.value}>
        {children}
        {note ? <small className={styles.note}>{note}</small> : null}
      </dd>
    </div>
  )
}

/** The primary action, or why there is none. A plain function (not a component) so the tree stays inspectable. */
function interestAction({
  job,
  canExpressInterest,
  interestState,
  onExpressInterest,
  expressInterestHref
}: Pick<JobDetailProps, "job" | "canExpressInterest" | "interestState" | "onExpressInterest" | "expressInterestHref">): ReactNode {
  if (!job.acceptingInterest) {
    return <p className={styles.state}>{JOB_PUBLIC_STATUS_LABELS[job.status]}</p>
  }
  if (interestState === "sent") {
    return <p className={styles.state}>Interest sent · the poster reviews interest and replies</p>
  }
  if (interestState === "closed" || !canExpressInterest) {
    return null
  }
  if (expressInterestHref) {
    return <Button className={styles.primary} href={expressInterestHref} label="I'm interested" size="lg" />
  }
  if (onExpressInterest) {
    return <Button className={styles.primary} label="I'm interested" onClick={onExpressInterest} size="lg" />
  }
  return null
}

/** Where the pay figure comes from, in the poster's terms. LogLoads never sets or guarantees pay. */
const PAY_SOURCE = {
  negotiable: "Pay is negotiable. The poster's note is shown beside it.",
  negotiableWithoutNote: "Pay is negotiable. Ask the poster what it depends on.",
  rate: "Rate stated by the poster. LogLoads doesn't set or guarantee pay.",
  unstated: "The poster hasn't stated pay. Ask before you commit a truck."
} as const

/**
 * The facts of one job, shared by the DetailPanel beside the list, the mobile Dialog sheet and the job editor's
 * preview (fixes audit P1-8). Presentational: whether the viewer may express interest arrives as
 * `canExpressInterest`, resolved on the server. The area is approximate (V2-DEC-01), pay is the poster's
 * (V2-DEC-02) and "confirmed" wording appears only after the poster's explicit confirmation (V2-DEC-03).
 */
export function JobDetail({
  job,
  now,
  fit,
  canExpressInterest,
  interestState = "none",
  onExpressInterest,
  expressInterestHref,
  className
}: JobDetailProps & Placement) {
  const availability = jobAvailabilityStatus(job, now)
  const pay = payParts(job.pay)
  const payNote = pay.kind !== "negotiable" && job.pay.note ? job.pay.note : null
  const estimates = estimatesText(job)
  const action = interestAction({ canExpressInterest, expressInterestHref, interestState, job, onExpressInterest })

  return (
    <article aria-labelledby={`job-detail-${job.id}`} className={cx(styles.detail, className)}>
      <header className={styles.head}>
        <p className={styles.poster}>
          <span>{job.posterName}</span>
          <VerificationIndicator verification={job.posterVerification} />
        </p>
        {job.sponsored ? <SponsoredIndicator /> : null}
        <h2 className={styles.title} id={`job-detail-${job.id}`}>{job.title}</h2>
        <PayFigure pay={job.pay} size="lg" />
        <p className={styles.source}>{PAY_SOURCE[pay.kind === "negotiable" && !pay.basis ? "negotiableWithoutNote" : pay.kind]}</p>
        {payNote ? <p className={styles.source}>Poster&apos;s note on pay: {payNote}</p> : null}
        <div className={styles.actions}>{action}</div>
      </header>

      <div className={styles.body}>
        <section aria-labelledby={`job-detail-${job.id}-haul`} className={styles.group}>
          <h3 className={styles.groupTitle} id={`job-detail-${job.id}-haul`}>The haul</h3>
          <dl className={styles.facts}>
            <Fact label="Product">{job.product ?? NOT_STATED}</Fact>
            <Fact label="To" note={haulDistanceText(job)}>{job.destinationLabel ?? "Not stated by the poster"}</Fact>
            <Fact label="Equipment">
              <EquipmentRequirement codes={job.equipment} fit={fit} />
            </Fact>
          </dl>
        </section>

        <section aria-labelledby={`job-detail-${job.id}-schedule`} className={styles.group}>
          <h3 className={styles.groupTitle} id={`job-detail-${job.id}-schedule`}>Schedule and demand</h3>
          <dl className={styles.facts}>
            <Fact label="Start" note={scheduleDetail(job)}>{scheduleText(job)}</Fact>
            <Fact label="Trucks">{demandText(job.trucks)}</Fact>
            {estimates ? <Fact label="Volume">{estimates}</Fact> : null}
          </dl>
        </section>

        <section aria-labelledby={`job-detail-${job.id}-location`} className={styles.group}>
          <h3 className={styles.groupTitle} id={`job-detail-${job.id}-location`}>Location</h3>
          <dl className={styles.facts}>
            <Fact label="Area" note="Approximate area. The landing shares the exact site directly.">{areaText(job)}</Fact>
            <Fact label="Road">{job.publicRoadNotes ?? "No road notes from the poster"}</Fact>
            {job.publicAccessRequirements.length > 0 ? (
              <Fact label="Access">{job.publicAccessRequirements.join(", ")}</Fact>
            ) : null}
          </dl>
        </section>
      </div>

      <footer className={styles.foot}>
        <AvailabilityStatus label={availability.label} state={availability.state} />
        <span>Free and nonbinding. The poster reviews interest and replies through LogLoads messages.</span>
      </footer>
    </article>
  )
}
