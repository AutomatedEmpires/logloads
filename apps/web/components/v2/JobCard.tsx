import Link from "next/link"

import { postingFreshness, type MarketplaceJobCardView } from "@logloads/contracts"

import { distanceLabel, JOB_STATUS_LABELS, payLabel, scheduleLabel, trucksLabel, volumeLabel } from "./format"

export function JobCard({ job, now }: { job: MarketplaceJobCardView; now: string }) {
  const freshness = postingFreshness(job.lastConfirmedAt, now)
  const distance = distanceLabel(job)
  const volume = volumeLabel(job)

  return (
    <article className="v2-card" aria-labelledby={`job-${job.id}`}>
      <header className="v2-card__head">
        <h2 id={`job-${job.id}`}>
          <Link href={`/v2/work/${job.slug}`}>{job.title}</Link>
        </h2>
        <p className="v2-card__poster">
          {job.posterName}
          {job.posterVerified ? <span className="v2-tag v2-tag--ok">Business verified</span> : null}
        </p>
      </header>
      <p className="v2-card__pay">{payLabel(job)}</p>
      <dl className="v2-facts">
        <div><dt>Product</dt><dd>{job.product ?? "Not stated"}</dd></div>
        <div><dt>Near</dt><dd>{job.origin.label} <span className="v2-muted">(approximate)</span></dd></div>
        {job.destinationLabel ? <div><dt>To</dt><dd>{job.destinationLabel}</dd></div> : null}
        {distance ? <div><dt>Haul</dt><dd>{distance}</dd></div> : null}
        <div><dt>When</dt><dd>{scheduleLabel(job)}</dd></div>
        <div><dt>Trucks</dt><dd>{trucksLabel(job)}</dd></div>
        {volume ? <div><dt>Volume</dt><dd>{volume}</dd></div> : null}
      </dl>
      <ul className="v2-chips" aria-label="Equipment required">
        {job.equipment.length > 0
          ? job.equipment.map((item) => <li key={item}>{item}</li>)
          : <li>Equipment not stated</li>}
      </ul>
      <footer className="v2-card__foot">
        <span className={`v2-status v2-status--${job.status}`}>{JOB_STATUS_LABELS[job.status]}</span>
        <span className={`v2-fresh v2-fresh--${freshness.band}`}>{freshness.label}</span>
      </footer>
    </article>
  )
}
