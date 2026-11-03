import type { MarketplaceInterestView } from "@logloads/contracts"
import { ConversationThread, inquiryStatus, type ViewerSide } from "@logloads/ui/marketplace"
import { Button } from "@logloads/ui/primitives"
import Link from "next/link"
import type { ReactNode } from "react"

import styles from "./InquiryConversation.module.css"

/** The id the inquiry row links point at, so a phone scrolls to the conversation below the list. */
export const CONVERSATION_ANCHOR = "conversation"

/** The id of the in-page confirmation a decline or withdraw link opens without JavaScript. */
export const CONFIRM_ANCHOR = "confirm-action"

/**
 * A link to an inquiry list with one inquiry selected (`inquiry`), plus any extra query (e.g. `confirm`), ending at
 * the conversation, or at `anchor`.
 */
export function inquiryHref(path: string, interestId: string, extra: Record<string, string> = {}, anchor: string = CONVERSATION_ANCHOR): string {
  return `${path}?${new URLSearchParams({ inquiry: interestId, ...extra }).toString()}#${anchor}`
}

export interface InquiryFact {
  label: string
  value: ReactNode
  note?: string
}

/** A pilot interest whose listing was removed keeps a placeholder job that has no public page. */
export function jobIsListed(interest: Pick<MarketplaceInterestView, "job">): boolean {
  return !(interest.job.status === "closed" && interest.job.title === "Job no longer listed")
}

/**
 * The selected inquiry beside the list (06_DESIGN_SYSTEM.md §4 "Inquiry and conversation"): who it is with and
 * for which job, the facts of the offer, the ConversationThread and then the page's composer, or why replying is
 * closed. Presentational: the page decides which facts, actions and composer the viewer gets.
 */
export function InquiryConversation({
  closedNote,
  composer,
  confirmation,
  facts,
  headActions,
  interest,
  viewerSide
}: {
  closedNote: string
  composer: ReactNode
  confirmation?: ReactNode
  facts: InquiryFact[]
  headActions?: ReactNode
  interest: MarketplaceInterestView
  viewerSide: ViewerSide
}) {
  const name = viewerSide === "landing" ? interest.haulerOrganization.name : interest.landingOrganization.name
  const titleId = `conversation-${interest.id}-title`
  const status = inquiryStatus(interest, viewerSide)

  return (
    <section aria-labelledby={titleId} className={styles.conversation} id={CONVERSATION_ANCHOR}>
      <header className={styles.head}>
        <div className={styles.headTop}>
          <div className={styles.headText}>
            <h2 className={styles.title} id={titleId}>{name}</h2>
            <p className={styles.sub}>
              <span>
                {viewerSide === "landing" ? "For " : null}
                {jobIsListed(interest) ? <Link className={styles.link} href={`/v2/work/${interest.job.slug}`}>{interest.job.title}</Link> : interest.job.title}
              </span>
              <span className={styles.status} data-tone={status.tone}>{status.label}</span>
            </p>
          </div>
          {headActions ? <div className={styles.headActions}>{headActions}</div> : null}
        </div>
        <dl className={styles.facts}>
          {facts.map((fact) => (
            <div className={styles.fact} key={fact.label}>
              <dt className={styles.label}>{fact.label}</dt>
              <dd className={styles.value}>
                {fact.value}
                {fact.note ? <small className={styles.note}>{fact.note}</small> : null}
              </dd>
            </div>
          ))}
        </dl>
      </header>
      {confirmation}
      <ConversationThread interest={interest} viewerSide={viewerSide} />
      {composer ?? <p className={styles.closed}>{closedNote}</p>}
    </section>
  )
}

/**
 * The no-JavaScript confirmation of a decline or withdraw, rendered by the server when the trigger link was
 * followed. With scripts the trigger opens a Dialog with the same text and form instead.
 */
export function InquiryConfirmation({ body, cancelHref, children, title }: { body: ReactNode; cancelHref: string; children: ReactNode; title: string }) {
  const titleId = `${CONFIRM_ANCHOR}-title`

  return (
    <section aria-labelledby={titleId} className={styles.confirm} id={CONFIRM_ANCHOR}>
      <h3 className={styles.confirmTitle} id={titleId}>{title}</h3>
      <div className={styles.confirmBody}>{body}</div>
      <div className={styles.confirmActions}>
        <Button href={cancelHref} label="Cancel" variant="secondary" />
        {children}
      </div>
    </section>
  )
}
