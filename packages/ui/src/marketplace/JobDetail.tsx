import { describeMarketplaceVerification } from "@logloads/contracts"
import type { ReactNode } from "react"

import { cx } from "../layout/cx"
import { Button } from "../primitives/Button"
import { estimatesText, jobClosureText } from "./format"
import styles from "./JobDetail.module.css"
import { JobSummary, jobTitleId } from "./JobSummary"
import type { JobDetailProps, Placement } from "./types"

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.fact}>
      <dt className={styles.label}>{label}</dt>
      <dd className={styles.value}>{children}</dd>
    </div>
  )
}

/** One collapsible section under the summary: a native <details>, so it opens from the keyboard and without scripts. */
function More({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className={styles.more}>
      <summary className={styles.summary}>{title}</summary>
      <div className={styles.moreBody}>{children}</div>
    </details>
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
    // Why and when (spec §5.3): the status, and the date the listing records for it.
    return (
      <div className={styles.closed}>
        <p className={styles.state}>Not accepting interest</p>
        <p className={styles.closedWhy}>{jobClosureText(job)}</p>
      </div>
    )
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

/**
 * The facts of one job, shared by the job page, the DetailPanel beside the list, the mobile Dialog sheet and the job
 * editor's preview (fixes audit P1-8). The decision summary (JobSummary) comes first; the rest is in collapsible
 * sections (UX-07, #130): haul details, road and access, weather, and the poster. Presentational: whether the viewer
 * may express interest arrives as `canExpressInterest`, resolved on the server. The area is approximate (V2-DEC-01),
 * pay is the poster's (V2-DEC-02) and "confirmed" wording appears only after the poster's explicit confirmation
 * (V2-DEC-03). Exact location, gate and access instructions and contact details are never part of the view.
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
  const estimates = estimatesText(job)
  const action = interestAction({ canExpressInterest, expressInterestHref, interestState, job, onExpressInterest })
  const verification = job.posterVerification ? describeMarketplaceVerification(job.posterVerification).statement : null

  return (
    <article aria-labelledby={jobTitleId(job.id)} className={cx(styles.detail, className)}>
      <JobSummary action={action} fit={fit} job={job} now={now} />

      <div className={styles.sections}>
        <More title="Haul details">
          {job.product || estimates ? (
            <dl className={styles.facts}>
              {job.product ? <Fact label="Product">{job.product}</Fact> : null}
              {estimates ? <Fact label="Volume">{estimates}</Fact> : null}
            </dl>
          ) : (
            <p className={styles.text}>The poster gave no more haul details.</p>
          )}
        </More>

        <More title="Road and access">
          {job.publicRoadNotes || job.publicAccessRequirements.length > 0 ? (
            <dl className={styles.facts}>
              {job.publicRoadNotes ? <Fact label="Road">{job.publicRoadNotes}</Fact> : null}
              {job.publicAccessRequirements.length > 0 ? <Fact label="Access">{job.publicAccessRequirements.join(", ")}</Fact> : null}
            </dl>
          ) : (
            <p className={styles.text}>No road notes from the poster.</p>
          )}
          <p className={styles.hint}>
            Public notes only, and the area is approximate. The landing shares the exact site and access if they choose,
            after you&apos;ve been in touch.
          </p>
        </More>

        <More title="Weather near the landing">
          <p className={styles.text}>
            Weather isn&apos;t shown in this preview yet. Check a forecast for {job.origin.label} before you send a truck.
          </p>
        </More>

        <More title={`About ${job.posterName}`}>
          <p className={styles.text}>{verification ?? "LogLoads hasn't verified this business."}</p>
          <p className={styles.hint}>
            Listings never show the poster&apos;s phone number or email address. You reach them through LogLoads messages
            once you express interest.
          </p>
        </More>
      </div>

      <footer className={styles.foot}>
        <span>Free and nonbinding. The poster reviews interest and replies through LogLoads messages.</span>
      </footer>
    </article>
  )
}
