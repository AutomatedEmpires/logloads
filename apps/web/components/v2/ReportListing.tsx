"use client"

import {
  MARKETPLACE_LISTING_REPORT_DETAILS_MAX,
  MARKETPLACE_LISTING_REPORT_REASON_LABELS,
  MARKETPLACE_LISTING_REPORT_REASONS
} from "@logloads/contracts"
import { formatDay } from "@logloads/ui/marketplace"
import { Button, FormField } from "@logloads/ui/primitives"
import { useActionState, useEffect, useRef } from "react"

import { reportListingAction } from "@/lib/marketplace-v2/report-actions"
import { REPORT_LISTING_IDLE } from "@/lib/marketplace-v2/report-state"

import styles from "./JobPage.module.css"
import { PageNotice } from "./PageNotice"
import { PendingSubmitButton } from "./PendingSubmitButton"

/** UX 02 §A7: the acknowledgement is factual and promises nothing about the outcome. */
const REVIEWED = "LogLoads staff review reports. The listing stays up until reviewed."

/**
 * "Report this listing" (spec §8.18, §10.27; UX 02 §A7): the spec's short reasons and optional details, sent to
 * LogLoads staff, never to the poster. A signed-out visitor is asked to sign in first. The form posts without
 * JavaScript too; when the store keeps no reports yet (the pilot adapter) it says so plainly and keeps what the person
 * chose and wrote, and it never claims a report was sent.
 */
export function ReportListing({ jobId, signInHref, signedIn }: { jobId: string; signInHref: string; signedIn: boolean }) {
  const [state, formAction] = useActionState(reportListingAction, REPORT_LISTING_IDLE)
  const acknowledgement = useRef<HTMLParagraphElement | null>(null)
  const kept = state.status === "unavailable" || state.status === "error" ? state : null

  // The form is replaced by the acknowledgement, so focus moves to it rather than falling back to the page.
  useEffect(() => {
    if (state.status === "sent") acknowledgement.current?.focus()
  }, [state])

  return (
    <details className={styles.tool} id="report" open={state.status === "idle" ? undefined : true}>
      <summary className={styles.toolSummary}>Report this listing</summary>
      <div className={styles.toolBody}>
        {!signedIn ? (
          <>
            <p className={styles.text}>Sign in to report this listing. Reports go to LogLoads staff, not the poster.</p>
            <Button className={styles.submit} href={signInHref} label="Sign in to report" variant="secondary" />
          </>
        ) : state.status === "sent" ? (
          <p className={styles.ack} ref={acknowledgement} role="status" tabIndex={-1}>
            {state.alreadyReported ? `You already reported this listing on ${formatDay(state.reportedAt)}. ${REVIEWED}` : `Thanks. ${REVIEWED}`}
          </p>
        ) : (
          <form action={formAction} className={styles.form}>
            <input name="jobId" type="hidden" value={jobId} />
            <div aria-live="polite">
              {state.status === "unavailable" ? (
                <PageNotice tone="info">
                  Reporting isn&apos;t available in this preview yet, so nothing was sent. Your report is still here.
                </PageNotice>
              ) : null}
            </div>
            {state.status === "error" ? (
              <PageNotice role="alert" tone="critical">
                {state.message}
              </PageNotice>
            ) : null}
            <fieldset className={styles.fieldset}>
              <legend className={styles.legend}>What&apos;s wrong with this listing?</legend>
              {MARKETPLACE_LISTING_REPORT_REASONS.map((reason) => (
                <label className={styles.reason} key={reason}>
                  <input className={styles.radio} defaultChecked={kept?.reason === reason} name="reason" required type="radio" value={reason} />
                  <span>{MARKETPLACE_LISTING_REPORT_REASON_LABELS[reason]}</span>
                </label>
              ))}
            </fieldset>
            <FormField
              hint="Only LogLoads staff read reports. The poster isn't told who reported the listing."
              id="report-details"
              label="What did you see?"
              optional
            >
              <textarea defaultValue={kept?.details ?? ""} maxLength={MARKETPLACE_LISTING_REPORT_DETAILS_MAX} name="details" rows={3} />
            </FormField>
            <PendingSubmitButton className={styles.submit} label="Send report" variant="secondary" />
            <p className={styles.hint}>A report alone never takes a listing down. {REVIEWED.split(". ")[0]}.</p>
          </form>
        )}
      </div>
    </details>
  )
}
