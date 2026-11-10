import { MARKETPLACE_AVAILABILITY_ATTESTATION, type LandingAllowanceSummary } from "@logloads/contracts"
import { Icon } from "@logloads/ui/icons"
import { Section } from "@logloads/ui/layout"
import { Button } from "@logloads/ui/primitives"

import { reconfirmJobAction } from "@/lib/marketplace-v2/actions"
import {
  LANDING_INBOX_PATH,
  LANDING_JOBS_PATH,
  NEW_JOB_PATH,
  newInquiriesLabel,
  OVERVIEW_PATH,
  UNCONFIRMED_INTERVAL_NOTE,
  unconfirmedLabel,
  type OverviewAttentionItem,
  type OverviewChecklistStep
} from "@/lib/marketplace-v2/landing-overview"
import { jobsLine, LANDINGS_PATH, landingStatusLabel, type LandingRowView } from "@/lib/marketplace-v2/landing-workspace"

import { LandingAllowanceFigures } from "./LandingAside"
import styles from "./landing.module.css"

/** B8's action row, in the spec's order (§4.0): post or maintain work, review interest, find trucks. */
export function OverviewActions({ canPost, inboxNew }: { canPost: boolean; inboxNew: number | null }) {
  return (
    <div className={styles.actionRow}>
      {canPost ? <Button href={NEW_JOB_PATH} label="Post a job" /> : null}
      <Button href={LANDING_INBOX_PATH} label={inboxNew === null ? "Inbox" : `Inbox (${inboxNew} new)`} variant="secondary" />
      <Button aria-describedby="find-trucks-note" aria-disabled label="Find trucks" variant="secondary" />
      <span className={styles.note} id="find-trucks-note">Searching for trucks isn&rsquo;t available in this preview yet.</span>
    </div>
  )
}

function ConfirmForm({ item, saves }: { item: Extract<OverviewAttentionItem, { kind: "unconfirmed" }>; saves: boolean }) {
  const describedBy = `attention-${item.jobId} overview-attestation${saves ? "" : " overview-confirm-note"}`

  // One tap: pressing Confirm is the explicit attestation (its value is sent only by this press, never pre-set). The
  // server checks it, the role and ownership, and records the server clock as the confirmation (LE-15, ATT-1).
  return (
    <form action={reconfirmJobAction}>
      <input name="jobId" type="hidden" value={item.jobId} />
      <input name="returnTo" type="hidden" value={OVERVIEW_PATH} />
      <Button
        aria-describedby={describedBy}
        aria-disabled={saves ? undefined : true}
        label="Confirm still available"
        name={MARKETPLACE_AVAILABILITY_ATTESTATION.field}
        size="sm"
        type="submit"
        value={MARKETPLACE_AVAILABILITY_ATTESTATION.value}
        variant="secondary"
      />
    </form>
  )
}

/**
 * B8 "Needs attention": new inquiries per job, and listings unconfirmed past the interval, each with its one action.
 * `complete` is false when a read behind the list failed. The page says which one, and the list never claims that
 * nothing needs attention (#209 review).
 */
export function OverviewAttention({ complete = true, items, saves }: { complete?: boolean; items: readonly OverviewAttentionItem[]; saves: boolean }) {
  const confirmable = items.some((item) => item.kind === "unconfirmed")

  return (
    <Section title="Needs attention">
      {items.length === 0 ? (
        <p className={styles.note}>
          {complete
            ? "Nothing needs attention right now. New inquiries and listings to confirm show here."
            : "This list could not be loaded in full. New inquiries and listings to confirm show here once they load."}
        </p>
      ) : (
        <div className={styles.stack}>
          <ul aria-label="Needs attention" className={styles.rows}>
            {items.map((item) => (
              <li className={styles.row} key={`${item.kind}-${item.jobId}`}>
                <div className={styles.rowHead}>
                  <p className={styles.rowTitle} id={`attention-${item.jobId}`}>
                    {item.kind === "new_inquiries" ? newInquiriesLabel(item) : unconfirmedLabel(item)}
                  </p>
                  {item.kind === "new_inquiries" ? (
                    <Button href={`${LANDING_INBOX_PATH}?inquiry=${encodeURIComponent(item.firstInterestId)}`} label="Review" size="sm" variant="secondary" />
                  ) : (
                    <ConfirmForm item={item} saves={saves} />
                  )}
                </div>
              </li>
            ))}
          </ul>
          {confirmable ? (
            <>
              <p className={styles.note} id="overview-attestation">
                Confirm records your statement: &ldquo;{MARKETPLACE_AVAILABILITY_ATTESTATION.label}&rdquo; {UNCONFIRMED_INTERVAL_NOTE}
              </p>
              {saves ? null : <p className={styles.note} id="overview-confirm-note">Confirming isn&rsquo;t saved in this preview.</p>}
            </>
          ) : null}
        </div>
      )}
    </Section>
  )
}

/** B8's empty state for a new subscriber: three steps instead of the attention list. */
export function OverviewChecklist({ steps }: { steps: readonly OverviewChecklistStep[] }) {
  return (
    <Section description="Three steps to your first hauler inquiry." title="Get started">
      <ol aria-label="Get started" className={styles.checklist}>
        {steps.map((step) => (
          <li key={step.id}>
            <Icon aria-hidden name={step.done ? "status.verified" : "status.open"} size={16} />
            <span>
              {step.href ? <a href={step.href}>{step.label}</a> : <strong>{step.label}</strong>}
              {step.done ? " · done" : ""}
              <span className={styles.hint}> {step.note}</span>
            </span>
          </li>
        ))}
      </ol>
    </Section>
  )
}

/** The allowance line (AC #133.3): limits from contracts, counts from the store, billing-inactive said plainly. */
export function OverviewAllowance({ summary }: { summary: LandingAllowanceSummary | null }) {
  return (
    <Section title="This billing cycle">
      {summary ? <LandingAllowanceFigures summary={summary} /> : <p className={styles.note}>Your plan could not be loaded.</p>}
      <p className={styles.note}>
        {summary?.billingActive ? "Unused invitations don't roll over. " : "Billing isn't active yet: no plan applies, so landings can't recruit and no targeted invitations are available. "}
        Job posts, inquiries and replies are unlimited.
      </p>
    </Section>
  )
}

/**
 * B8's landings list: each landing, its status and jobs. Public labels only. "All jobs" and "All landings" are how a
 * business on both sides reaches Post jobs and Landings, which are not among its five tabs (#209).
 */
export function OverviewLandings({ landings }: { landings: readonly LandingRowView[] | null }) {
  const links = (
    <div className={styles.links}>
      <Button href={LANDING_JOBS_PATH} label="All jobs" size="sm" variant="ghost" />
      <Button href={LANDINGS_PATH} label="All landings" size="sm" variant="ghost" />
    </div>
  )

  return (
    <Section actions={links} title="Landings">
      {landings === null ? (
        <p className={styles.note}>Your landings could not be loaded.</p>
      ) : landings.length === 0 ? (
        <p className={styles.note}>No landings yet.</p>
      ) : (
        <ul aria-label="Landings" className={styles.rows}>
          {landings.map((landing) => (
            <li className={styles.row} key={landing.id}>
              <p className={styles.rowTitle}>{landing.name}</p>
              <p className={styles.rowMeta}>{landingStatusLabel(landing.status)} · {jobsLine(landing.activeJobs)}</p>
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}
