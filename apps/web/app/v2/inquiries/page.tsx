import { randomUUID } from "node:crypto"

import Link from "next/link"
import { notFound } from "next/navigation"

import type { MarketplaceInterestView } from "@logloads/contracts"

import { availabilityLabel, equipmentOfferLabel, formatDay, interestStatusLabel } from "@/components/v2/format"
import { haulerReplyAction, withdrawInterestAction } from "@/lib/marketplace-v2/actions"
import { marketplaceV2Enabled } from "@/lib/marketplace-v2/flag"
import { pilotMarketplaceV2 } from "@/lib/marketplace-v2/pilot-adapter"
import { requireAuthenticatedActor } from "@/lib/session"

type SearchParams = Promise<Record<string, string | string[] | undefined>>

const OPEN = new Set(["submitted", "viewed", "replied"])

export default async function MyInquiriesPage({ searchParams }: { searchParams: SearchParams }) {
  if (!marketplaceV2Enabled()) notFound()

  const actor = await requireAuthenticatedActor("/v2/inquiries")
  const query = await searchParams
  const workspace = actor.activeOrganization
  let interests: MarketplaceInterestView[] = []
  let refusal: string | null = null

  if (!workspace || actor.workspaceSelectionInvalid) {
    refusal = "Choose a hauling business workspace to see its inquiries."
  } else {
    try {
      interests = await pilotMarketplaceV2.listHaulerInterests({ organizationId: workspace.id, userId: actor.profile.id })
    } catch (error) {
      refusal = error instanceof Error ? error.message : "Inquiries are not available for this workspace."
    }
  }

  const error = typeof query.error === "string" ? query.error : null

  return (
    <>
      <h1>My inquiries</h1>
      <p className="v2-muted">Interest your hauling business sent to landing operators. This tracks conversations only — not contracts, loads or pay.</p>
      {error ? <p className="v2-banner v2-banner--error" role="alert">{error}</p> : null}
      {refusal ? (
        <p className="v2-banner">{refusal} <Link href="/workspace">Choose workspace</Link></p>
      ) : interests.length === 0 ? (
        <section className="v2-empty">
          <h2>No inquiries yet</h2>
          <p><Link href="/v2/work">Find work</Link> and express interest in a job that fits your trucks.</p>
        </section>
      ) : (
        <ol className="v2-list">
          {interests.map((interest) => (
            <li key={interest.id}>
              <article className="v2-card">
                <header className="v2-card__head">
                  <h2>
                    {interest.job.status === "closed" && interest.job.title === "Job no longer listed"
                      ? interest.job.title
                      : <Link href={`/v2/work/${interest.job.slug}`}>{interest.job.title}</Link>}
                  </h2>
                  <p className="v2-card__poster">{interest.landingOrganization.name}</p>
                </header>
                <p><span className={`v2-status v2-status--interest-${interest.status}`}>{interestStatusLabel(interest.status)}</span></p>
                <dl className="v2-facts">
                  <div><dt>You offered</dt><dd>{interest.trucksOffered} truck{interest.trucksOffered === 1 ? "" : "s"} <span className="v2-muted">(self-reported)</span></dd></div>
                  {equipmentOfferLabel(interest.equipment) ? <div><dt>Equipment</dt><dd>{equipmentOfferLabel(interest.equipment)}</dd></div> : null}
                  {availabilityLabel(interest) ? <div><dt>Available</dt><dd>{availabilityLabel(interest)}</dd></div> : null}
                  <div><dt>Sent</dt><dd>{formatDay(interest.createdAt)} by {interest.submittedBy.name}</dd></div>
                  {interest.message ? <div><dt>Your note</dt><dd>{interest.message}</dd></div> : null}
                </dl>
                {interest.replies.length > 0 ? (
                  <ol className="v2-thread" aria-label="Conversation">
                    {interest.replies.map((reply) => (
                      <li className={`v2-msg v2-msg--${reply.authorSide}`} key={reply.id}>
                        <strong>{reply.authorSide === "landing" ? interest.landingOrganization.name : "You"}</strong> · {formatDay(reply.createdAt)}
                        <p>{reply.body}</p>
                      </li>
                    ))}
                  </ol>
                ) : null}
                {OPEN.has(interest.status) ? (
                  <div className="v2-actions">
                    <form action={haulerReplyAction} className="v2-form v2-form--inline">
                      <input name="interestId" type="hidden" value={interest.id} />
                      <input name="replyId" type="hidden" value={randomUUID()} />
                      <label>
                        <span className="v2-sr">Message to {interest.landingOrganization.name}</span>
                        <input maxLength={2000} name="body" placeholder="Add a message" required />
                      </label>
                      <button type="submit">Send</button>
                    </form>
                    <form action={withdrawInterestAction}>
                      <input name="interestId" type="hidden" value={interest.id} />
                      <button className="v2-button--quiet" type="submit">Withdraw interest</button>
                    </form>
                  </div>
                ) : null}
              </article>
            </li>
          ))}
        </ol>
      )}
    </>
  )
}
