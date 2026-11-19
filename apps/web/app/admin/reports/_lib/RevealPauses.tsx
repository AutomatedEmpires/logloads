import { PHONE_REVEAL_PAUSE_THRESHOLD, PHONE_REVEAL_PAUSE_WINDOW_HOURS, type MarketplaceRevealPause } from "@logloads/contracts"
import { Badge } from "@logloads/ui"

import { EmptyState, SectionHeader } from "@/components/v3/Shells"
import type { RevealPausesResult } from "@/lib/marketplace-v2/disclosure/load"

import { clearRevealPauseAction } from "../actions"
import { REVEAL_PAUSES_ANCHOR, revealPauseNotice } from "./reveal-pause-notice"

const WHEN = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })

const REPORT_LABELS: Record<MarketplaceRevealPause["reportStatus"], { label: string; tone: "warning" | "info" | "critical" | "neutral" }> = {
  actioned: { label: "Report actioned · still paused", tone: "critical" },
  dismissed: { label: "Report dismissed", tone: "neutral" },
  open: { label: "Report open", tone: "warning" },
  reviewing: { label: "Report in review", tone: "info" }
}

function PauseRow({ pause }: { pause: MarketplaceRevealPause }) {
  const report = REPORT_LABELS[pause.reportStatus]
  const reasonId = `reveal-pause-reason-${pause.id}`

  return (
    <article className="admin-row" id={`reveal-pause-${pause.id}`}>
      <div className="admin-row__main">
        <div className="admin-row__head">
          <h3>{pause.subjectName}</h3>
          <Badge tone="info">{pause.subjectKind === "organization" ? "Hauling business" : "Person"}</Badge>
          <Badge tone={report.tone}>{report.label}</Badge>
        </div>
        <p className="admin-row__meta">
          {pause.landingsInWindow} distinct landing{pause.landingsInWindow === 1 ? "" : "s"} in the last {PHONE_REVEAL_PAUSE_WINDOW_HOURS} hours
        </p>
        <span className="admin-row__when">Paused {WHEN.format(new Date(pause.openedAt))} UTC</span>
      </div>
      <div className="admin-decision admin-report-decision">
        <form action={clearRevealPauseAction} className="admin-resolution-form">
          <input name="pauseId" type="hidden" value={pause.id} />
          <label htmlFor={reasonId}>Why shares may resume (kept on the audit record)</label>
          <textarea id={reasonId} maxLength={500} minLength={5} name="reason" required />
          <button className="admin-btn admin-btn--primary" type="submit">Clear pause</button>
        </form>
      </div>
    </article>
  )
}

/**
 * Phone-reveal pauses on the moderation screen (#403, #325). A hauling business, or a person across their hauling
 * businesses, that receives a number from `PHONE_REVEAL_PAUSE_THRESHOLD` distinct landings in the window is paused:
 * its next shares are withheld and the landing's reply still goes. Each pause has a report in the queue; dismissing it
 * there clears the pause, and an actioned report keeps the pause until a moderator clears it here. Server-rendered,
 * and the clear posts natively, so it works without scripts. No phone, landing or job is shown.
 */
export function RevealPauses({ notice, result }: { notice: string | string[] | undefined; result: RevealPausesResult }) {
  const message = revealPauseNotice(notice)
  const pauses = result.kind === "ready" ? result.pauses : []

  return (
    <section className="app-section admin-panel" id={REVEAL_PAUSES_ANCHOR}>
      <SectionHeader eyebrow={result.kind === "ready" ? `${pauses.length} open` : "Phone reveal"} title="Phone-reveal pauses" />
      <p className="admin-panel__intro">
        A hauler that receives a phone number from {PHONE_REVEAL_PAUSE_THRESHOLD} different landings in {PHONE_REVEAL_PAUSE_WINDOW_HOURS} hours is
        paused for review. Its next shares are withheld; the landing&apos;s reply still goes, and neither side is told about the pause. Dismissing
        the pause&apos;s report clears it. After an actioned report the hauler stays paused until you clear it here.
      </p>
      {message ? (
        <p className={message.role === "alert" ? "admin-decision__error" : "admin-decision__success"} role={message.role}>{message.text}</p>
      ) : null}
      {result.kind === "unavailable" ? (
        <p className="admin-panel__intro">Pauses are kept in the normalized marketplace store, which this deployment is not using.</p>
      ) : result.kind === "denied" ? (
        <p className="admin-panel__intro">Only LogLoads moderators and support staff can see phone-reveal pauses.</p>
      ) : result.kind === "failed" ? (
        <p className="admin-decision__error" role="alert">
          The pauses couldn&apos;t load.{result.requestId ? ` Reference: ${result.requestId}.` : ""}
        </p>
      ) : pauses.length === 0 ? (
        <EmptyState body="A hauler paused for collecting numbers will appear here." title="No open pauses." />
      ) : (
        <div className="admin-rows">
          {pauses.map((pause) => <PauseRow key={pause.id} pause={pause} />)}
        </div>
      )}
    </section>
  )
}
