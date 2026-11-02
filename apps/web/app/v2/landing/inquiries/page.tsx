import { randomUUID } from "node:crypto"

import Link from "next/link"
import { notFound } from "next/navigation"

import { landingInterestQueue, type LandingInterestQueue, type MarketplaceInterestView } from "@logloads/contracts"

import { availabilityLabel, equipmentOfferLabel, formatDay, interestStatusLabel } from "@/components/v2/format"
import { respondToInterestAction } from "@/lib/marketplace-v2/actions"
import { marketplaceV2Enabled } from "@/lib/marketplace-v2/flag"
import { pilotMarketplaceV2 } from "@/lib/marketplace-v2/pilot-adapter"
import { resolveV2Actor, withBusinessSwitchNote } from "@/lib/marketplace-v2/viewer"

type SearchParams = Promise<Record<string, string | string[] | undefined>>

const QUEUES: Array<{ key: LandingInterestQueue; title: string; empty: string }> = [
  { empty: "No new interest.", key: "new", title: "New" },
  { empty: "Nothing awaiting the hauler.", key: "responded", title: "Responded" },
  { empty: "No closed inquiries.", key: "closed", title: "Closed" }
]

const CONTACT_LABELS = { email: "Email", in_app: "LogLoads messages", phone: "Phone" } as const

function InquiryCard({ interest }: { interest: MarketplaceInterestView }) {
  const open = interest.status !== "withdrawn" && interest.status !== "declined"

  return (
    <article className="v2-card">
      <header className="v2-card__head">
        <h3>{interest.haulerOrganization.name}</h3>
        <p className="v2-card__poster">for <Link href={`/v2/work/${interest.job.slug}`}>{interest.job.title}</Link></p>
      </header>
      <p><span className={`v2-status v2-status--interest-${interest.status}`}>{interestStatusLabel(interest.status)}</span></p>
      <dl className="v2-facts">
        <div><dt>Offers</dt><dd>{interest.trucksOffered} truck{interest.trucksOffered === 1 ? "" : "s"} <span className="v2-muted">(self-reported by the hauler; not verified)</span></dd></div>
        {equipmentOfferLabel(interest.equipment) ? <div><dt>Equipment</dt><dd>{equipmentOfferLabel(interest.equipment)}</dd></div> : null}
        {availabilityLabel(interest) ? <div><dt>Available</dt><dd>{availabilityLabel(interest)}</dd></div> : null}
        <div><dt>Sent by</dt><dd>{interest.submittedBy.name} · {formatDay(interest.createdAt)}</dd></div>
        <div><dt>Contact</dt><dd>{CONTACT_LABELS[interest.contactPreference]}</dd></div>
        {interest.message ? <div><dt>Note</dt><dd>{interest.message}</dd></div> : null}
      </dl>
      {interest.replies.length > 0 ? (
        <ol className="v2-thread" aria-label="Conversation">
          {interest.replies.map((reply) => (
            <li className={`v2-msg v2-msg--${reply.authorSide}`} key={reply.id}>
              <strong>{reply.authorSide === "landing" ? `${reply.authorName} (your team)` : interest.haulerOrganization.name}</strong> · {formatDay(reply.createdAt)}
              <p>{reply.body}</p>
            </li>
          ))}
        </ol>
      ) : null}
      {open ? (
        <div className="v2-actions">
          <form action={respondToInterestAction} className="v2-form v2-form--inline">
            <input name="interestId" type="hidden" value={interest.id} />
            <input name="replyId" type="hidden" value={randomUUID()} />
            <input name="decision" type="hidden" value="replied" />
            <label>
              <span className="v2-sr">Reply to {interest.haulerOrganization.name}</span>
              <input maxLength={2000} name="body" placeholder="Reply" required />
            </label>
            <button type="submit">Reply</button>
          </form>
          {interest.status === "submitted" ? (
            <form action={respondToInterestAction}>
              <input name="interestId" type="hidden" value={interest.id} />
              <input name="decision" type="hidden" value="viewed" />
              <button className="v2-button--quiet" type="submit">Mark reviewed</button>
            </form>
          ) : null}
          <form action={respondToInterestAction}>
            <input name="interestId" type="hidden" value={interest.id} />
            <input name="decision" type="hidden" value="declined" />
            <button className="v2-button--quiet" type="submit">Decline</button>
          </form>
        </div>
      ) : null}
    </article>
  )
}

export default async function LandingInboxPage({ searchParams }: { searchParams: SearchParams }) {
  if (!marketplaceV2Enabled()) notFound()

  const resolved = await resolveV2Actor("/v2/landing/inquiries")
  const query = await searchParams
  const actor = resolved.ok ? resolved.actor : null
  const workspace = actor && !actor.workspaceSelectionInvalid ? actor.activeOrganization : null
  let interests: MarketplaceInterestView[] = []
  let refusal: string | null = null

  if (!resolved.ok) {
    refusal = resolved.refusal
  } else if (!actor || !workspace) {
    refusal = withBusinessSwitchNote("No landing business is selected for your account.")
  } else {
    try {
      interests = await pilotMarketplaceV2.listLandingInterests({ organizationId: workspace.id, userId: actor.profile.id })
    } catch {
      refusal = withBusinessSwitchNote("Your role in this business cannot review hauler inquiries.")
    }
  }

  const error = typeof query.error === "string" ? query.error : null

  return (
    <>
      <h1>Hauler inquiries</h1>
      <p className="v2-muted">Interest received on your organization’s jobs. Replies are unlimited; nothing here assigns trucks or records a hire.</p>
      {error ? <p className="v2-banner v2-banner--error" role="alert">{error}</p> : null}
      {refusal ? (
        <p className="v2-banner">{refusal}</p>
      ) : (
        QUEUES.map((queue) => {
          const rows = interests.filter((interest) => landingInterestQueue(interest.status) === queue.key)

          return (
            <section aria-labelledby={`queue-${queue.key}`} className="v2-queue" key={queue.key}>
              <h2 id={`queue-${queue.key}`}>{queue.title} <span className="v2-count-badge">{rows.length}</span></h2>
              {rows.length === 0
                ? <p className="v2-muted">{queue.empty}</p>
                : <ol className="v2-list">{rows.map((interest) => <li key={interest.id}><InquiryCard interest={interest} /></li>)}</ol>}
            </section>
          )
        })
      )}
    </>
  )
}
