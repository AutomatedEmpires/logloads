import { randomUUID } from "node:crypto"

import { notFound } from "next/navigation"

import { landingInterestQueue, type LandingInterestQueue, type MarketplaceInterestView } from "@logloads/contracts"
import { ContentGrid, PageContainer, PageHeader, Section } from "@logloads/ui/layout"
import { availabilityText, formatDay, InquiryRow } from "@logloads/ui/marketplace"

import { ConfirmActionDialog } from "@/components/v2/ConfirmActionDialog"
import { ConfirmActionForm } from "@/components/v2/ConfirmActionForm"
import {
  CONFIRM_ANCHOR,
  InquiryConfirmation,
  InquiryConversation,
  inquiryHref,
  type InquiryFact
} from "@/components/v2/InquiryConversation"
import styles from "@/components/v2/InquiryConversation.module.css"
import { InquiryReplyComposer } from "@/components/v2/InquiryReplyComposer"
import { PageNotice } from "@/components/v2/PageNotice"
import { PendingSubmitButton } from "@/components/v2/PendingSubmitButton"
import { respondToInterestAction } from "@/lib/marketplace-v2/actions"
import { marketplaceV2Enabled } from "@/lib/marketplace-v2/flag"
import { pilotMarketplaceV2 } from "@/lib/marketplace-v2/pilot-adapter"
import { resolveV2Actor, withBusinessSwitchNote } from "@/lib/marketplace-v2/viewer"

type SearchParams = Promise<Record<string, string | string[] | undefined>>

const PATH = "/v2/landing/inquiries"

const QUEUES: Array<{ key: LandingInterestQueue; title: string; empty: string }> = [
  { empty: "No new interest.", key: "new", title: "New" },
  { empty: "Nothing awaiting the hauler.", key: "responded", title: "Responded" },
  { empty: "No closed inquiries.", key: "closed", title: "Closed" }
]

const CONTACT_LABELS = { email: "Email", in_app: "LogLoads messages", phone: "Phone" } as const

const DECLINE_TITLE = "Decline this inquiry?"

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? ""
}

function declineBody(interest: MarketplaceInterestView) {
  return (
    <p className={styles.dialogBody}>
      {interest.haulerOrganization.name} will see that you declined their interest in “{interest.job.title}”, and the conversation
      closes. You can’t reply to it afterwards.
    </p>
  )
}

function landingFacts(interest: MarketplaceInterestView): InquiryFact[] {
  const equipment = interest.equipment.map((line) => `${line.count} × ${line.label}`).join(", ")
  const available = availabilityText(interest)

  return [
    {
      label: "Offers",
      note: "Self-reported by the hauler; not verified",
      value: `${interest.trucksOffered} truck${interest.trucksOffered === 1 ? "" : "s"}`
    },
    ...(equipment ? [{ label: "Equipment", value: equipment }] : []),
    ...(available ? [{ label: "Available", value: available }] : []),
    { label: "Sent by", value: `${interest.submittedBy.name} · ${formatDay(interest.createdAt)}` },
    { label: "Contact", value: CONTACT_LABELS[interest.contactPreference] }
  ]
}

/**
 * Hauler inquiries (landing inbox, UX 02 §B9), built from the design system (DS-04, #147): the New, Responded and
 * Closed queues as InquiryRows beside the selected conversation (ContentGrid "split"). Selection is the `inquiry`
 * query parameter, so rows are plain links. Replying, marking reviewed and declining post to the existing server
 * action; declining is confirmed first, in a Dialog, or in the page without JavaScript. Nothing here shares the
 * landing's private details: a reply carries only what its author writes.
 */
export default async function LandingInboxPage({ searchParams }: { searchParams: SearchParams }) {
  if (!marketplaceV2Enabled()) notFound()

  const resolved = await resolveV2Actor(PATH)
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

  const error = one(query.error) || null
  const queues = QUEUES.map((queue) => ({ ...queue, rows: interests.filter((interest) => landingInterestQueue(interest.status) === queue.key) }))
  const ordered = queues.flatMap((queue) => queue.rows)
  const selected = ordered.find((interest) => interest.id === one(query.inquiry)) ?? ordered[0] ?? null

  const list = (
    <>
      {error ? <PageNotice role="alert" tone="critical">{error}</PageNotice> : null}
      {refusal ? (
        <PageNotice>{refusal}</PageNotice>
      ) : (
        queues.map((queue) => (
          <Section
            description={`${queue.rows.length} inquir${queue.rows.length === 1 ? "y" : "ies"}`}
            key={queue.key}
            title={queue.title}
            variant="flush"
          >
            {queue.rows.length === 0 ? (
              <p className={styles.empty}>{queue.empty}</p>
            ) : (
              <ul aria-label={`${queue.title} inquiries`} className={styles.rows}>
                {queue.rows.map((interest) => (
                  <InquiryRow
                    href={inquiryHref(PATH, interest.id)}
                    interest={interest}
                    key={interest.id}
                    selected={interest.id === selected?.id}
                    viewerSide="landing"
                  />
                ))}
              </ul>
            )}
          </Section>
        ))
      )}
    </>
  )

  return (
    <div data-ds-page="landing-inbox">
      <PageHeader
        description="Interest received on your organization’s jobs. Replies are unlimited; nothing here assigns trucks or records a hire."
        title="Hauler inquiries"
      />
      <PageContainer>
        {refusal || !selected ? (
          <ContentGrid layout="single" main={list} />
        ) : (
          <ContentGrid
            aside={<LandingConversation confirmDecline={one(query.confirm) === "decline"} interest={selected} />}
            layout="split"
            main={list}
          />
        )}
      </PageContainer>
    </div>
  )
}

/**
 * The selected conversation: facts, "Mark reviewed" while it is new, the thread, and while it is open the reply
 * composer with Decline beside Send.
 */
function LandingConversation({ confirmDecline, interest }: { confirmDecline: boolean; interest: MarketplaceInterestView }) {
  const open = interest.status !== "withdrawn" && interest.status !== "declined"
  const replyId = randomUUID()
  const declineFields = { decision: "declined", interestId: interest.id }

  return (
    <InquiryConversation
      closedNote="This conversation is closed. Nothing more can be sent on it."
      composer={
        open ? (
          <InquiryReplyComposer
            action={respondToInterestAction}
            fields={{ decision: "replied", interestId: interest.id, replyId }}
            key={replyId}
            recipientName={interest.haulerOrganization.name}
            secondaryAction={
              <ConfirmActionDialog
                action={respondToInterestAction}
                body={declineBody(interest)}
                confirmLabel="Decline inquiry"
                fallbackHref={inquiryHref(PATH, interest.id, { confirm: "decline" }, CONFIRM_ANCHOR)}
                fields={declineFields}
                title={DECLINE_TITLE}
                triggerLabel="Decline"
              />
            }
          />
        ) : null
      }
      confirmation={
        open && confirmDecline ? (
          <InquiryConfirmation body={declineBody(interest)} cancelHref={inquiryHref(PATH, interest.id)} title={DECLINE_TITLE}>
            <ConfirmActionForm action={respondToInterestAction} confirmLabel="Decline inquiry" fields={declineFields} />
          </InquiryConfirmation>
        ) : null
      }
      facts={landingFacts(interest)}
      headActions={
        interest.status === "submitted" ? (
          <form action={respondToInterestAction} className={styles.dialogForm}>
            <input name="interestId" type="hidden" value={interest.id} />
            <input name="decision" type="hidden" value="viewed" />
            <PendingSubmitButton label="Mark reviewed" size="sm" variant="secondary" />
          </form>
        ) : null
      }
      interest={interest}
      viewerSide="landing"
    />
  )
}
