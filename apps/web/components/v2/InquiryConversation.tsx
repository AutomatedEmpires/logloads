import type { MarketplaceInterestView } from "@logloads/contracts"
import { ConversationThread, inquiryStatus, type ViewerSide } from "@logloads/ui/marketplace"
import { Button } from "@logloads/ui/primitives"
import type { ReactNode } from "react"

import { AppLink } from "@/components/AppLink"

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

/** The job's link, or its title alone when the listing has no public page. */
export function InquiryJobTitle({ className, interest }: { className?: string; interest: Pick<MarketplaceInterestView, "job"> }) {
  // AppLink (#203): the job page renders per request, so the link is never prefetched.
  return jobIsListed(interest) ? (
    <AppLink className={className ?? styles.link} href={`/v2/work/${interest.job.slug}`}>{interest.job.title}</AppLink>
  ) : (
    <>{interest.job.title}</>
  )
}

/**
 * The selected inquiry beside the list (06_DESIGN_SYSTEM.md §4 "Inquiry and conversation"): who it is with and
 * for which job, the facts of the offer, the ConversationThread and then the page's composer, or why replying is
 * closed. Presentational: the page decides which facts, actions and composer the viewer gets.
 *
 * Flow C (#328, Figma 07 Flows C3 `124:390`) gives the landing three more parts: `job`, the job card (pay and title)
 * in place of the "For <job>" line; `factsTitle`, which frames the facts as a card ("They can bring"); and `notice`,
 * what the last answer did, under the thread. The hauler's page passes none of them and is unchanged.
 */
export function InquiryConversation({
  closedNote,
  composer,
  confirmation,
  facts,
  factsTitle,
  headActions,
  interest,
  job,
  notice,
  viewerSide,
  viewerUserId
}: {
  closedNote: string
  composer: ReactNode
  confirmation?: ReactNode
  facts: InquiryFact[]
  factsTitle?: string
  headActions?: ReactNode
  interest: MarketplaceInterestView
  job?: ReactNode
  notice?: ReactNode
  viewerSide: ViewerSide
  /** The session's own user, so the thread marks only their messages "You" and names colleagues. */
  viewerUserId?: string
}) {
  const name = viewerSide === "landing" ? interest.haulerOrganization.name : interest.landingOrganization.name
  const titleId = `conversation-${interest.id}-title`
  const factsId = `conversation-${interest.id}-facts`
  const status = inquiryStatus(interest, viewerSide)
  const list = (
    <dl aria-labelledby={factsTitle ? factsId : undefined} className={styles.facts}>
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
  )

  return (
    <section aria-labelledby={titleId} className={styles.conversation} id={CONVERSATION_ANCHOR}>
      <header className={styles.head}>
        <div className={styles.headTop}>
          <div className={styles.headText}>
            <h2 className={styles.title} id={titleId}>{name}</h2>
            <p className={styles.sub}>
              {job ? null : (
                <span>
                  {viewerSide === "landing" ? "For " : null}
                  <InquiryJobTitle interest={interest} />
                </span>
              )}
              <span className={styles.status} data-tone={status.tone}>{status.label}</span>
            </p>
          </div>
          {headActions ? <div className={styles.headActions}>{headActions}</div> : null}
        </div>
        {job ? <div className={styles.job} data-flow-c="">{job}</div> : null}
        {factsTitle ? (
          <div className={styles.offer}>
            <h3 className={styles.offerTitle} id={factsId}>{factsTitle}</h3>
            {list}
          </div>
        ) : list}
      </header>
      {confirmation}
      <ConversationThread interest={interest} viewerSide={viewerSide} viewerUserId={viewerUserId} />
      {notice}
      {composer ?? <p className={styles.closed}>{closedNote}</p>}
    </section>
  )
}

/** The id of the in-page confirmation's form, which its reason field names in `form`. */
export const CONFIRM_FORM_ID = `${CONFIRM_ANCHOR}-form`

/**
 * The no-JavaScript confirmation of a decline or withdraw, rendered by the server when the trigger link was
 * followed. With scripts the trigger opens a Dialog with the same text and form instead. `reason` (a
 * `ConfirmReasonField` for the form `CONFIRM_FORM_ID`) sits between the text and the actions.
 */
export function InquiryConfirmation({
  body,
  cancelHref,
  children,
  reason,
  title
}: {
  body: ReactNode
  cancelHref: string
  children: ReactNode
  reason?: ReactNode
  title: string
}) {
  const titleId = `${CONFIRM_ANCHOR}-title`

  return (
    <section aria-labelledby={titleId} className={styles.confirm} id={CONFIRM_ANCHOR}>
      <h3 className={styles.confirmTitle} id={titleId}>{title}</h3>
      <div className={styles.confirmBody}>{body}</div>
      {reason}
      <div className={styles.confirmActions}>
        <Button href={cancelHref} label="Cancel" variant="secondary" />
        {children}
      </div>
    </section>
  )
}
