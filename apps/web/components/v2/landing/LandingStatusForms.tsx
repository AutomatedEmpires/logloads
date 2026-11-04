import type { MarketplaceLandingStatus } from "@logloads/contracts"

import { setLandingStatusAction } from "@/lib/marketplace-v2/landing-actions"
import { LANDINGS_PATH, PLANS_HREF, type LandingRowView } from "@/lib/marketplace-v2/landing-workspace"

import { PendingSubmitButton } from "../PendingSubmitButton"
import styles from "./landing.module.css"

function StatusForm({ label, landingId, status, variant = "secondary" }: { label: string; landingId: string; status: MarketplaceLandingStatus; variant?: "secondary" | "ghost" }) {
  return (
    <form action={setLandingStatusAction}>
      <input name="landingId" type="hidden" value={landingId} />
      <input name="status" type="hidden" value={status} />
      <PendingSubmitButton label={label} size="sm" variant={variant} />
    </form>
  )
}

/**
 * A landing's status actions (#127 criteria 5 and 7). Each is its own small form with the landing id and the status
 * asked for, so a stale page can never resubmit the landing's details. The server re-checks the role and the plan.
 */
export function LandingStatusForms({ landing, recruit }: { landing: LandingRowView; recruit: "room" | "at_cap" | "billing_inactive" }) {
  const jobs = landing.activeJobs ?? 0
  const pauseNoteId = `landing-${landing.id}-pause-note`

  if (landing.status === "active") {
    return (
      <div className={styles.actions}>
        <StatusForm label={`Pause ${landing.name}`} landingId={landing.id} status="paused" />
        <StatusForm label="Archive" landingId={landing.id} status="archived" variant="ghost" />
        <p className={styles.note} id={pauseNoteId}>
          {jobs > 0 ? `Pausing or archiving unlists its ${jobs} job${jobs === 1 ? "" : "s"}.` : "Pausing frees its plan slot."}
        </p>
      </div>
    )
  }

  if (landing.status === "archived") {
    return (
      <div className={styles.actions}>
        <StatusForm label={`Restore ${landing.name} as paused`} landingId={landing.id} status="paused" />
      </div>
    )
  }

  return (
    <div className={styles.actions}>
      {recruit === "room" ? <StatusForm label={`Start recruiting at ${landing.name}`} landingId={landing.id} status="active" /> : null}
      <StatusForm label="Archive" landingId={landing.id} status="archived" variant="ghost" />
      {recruit === "at_cap" ? (
        <p className={styles.note}>
          Every active landing on your plan is in use. <a href={`${LANDINGS_PATH}#landings`}>Pause another landing</a> or <a href={PLANS_HREF}>see plans</a>.
        </p>
      ) : recruit === "billing_inactive" ? (
        <p className={styles.note}>
          Billing isn&rsquo;t active yet, so no landing can recruit. <a href={PLANS_HREF}>See plans</a>.
        </p>
      ) : null}
    </div>
  )
}
