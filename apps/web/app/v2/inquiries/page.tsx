import { randomUUID } from "node:crypto"

import { notFound } from "next/navigation"

import type { MarketplaceInterestView } from "@logloads/contracts"
import { ContentGrid, PageContainer, PageHeader, Section } from "@logloads/ui/layout"
import { availabilityText, formatDay, InquiryRow } from "@logloads/ui/marketplace"
import { Button, EmptyState } from "@logloads/ui/primitives"

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
import { haulerReplyAction, withdrawInterestAction } from "@/lib/marketplace-v2/actions"
import { marketplaceV2Enabled } from "@/lib/marketplace-v2/flag"
import { pilotMarketplaceV2 } from "@/lib/marketplace-v2/pilot-adapter"
import { resolveV2Actor, withBusinessSwitchNote } from "@/lib/marketplace-v2/viewer"

type SearchParams = Promise<Record<string, string | string[] | undefined>>

const PATH = "/v2/inquiries"
const OPEN = new Set(["submitted", "viewed", "replied"])

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? ""
}

const WITHDRAW_TITLE = "Withdraw your interest?"

function withdrawBody(interest: MarketplaceInterestView) {
  return (
    <p className={styles.dialogBody}>
      {interest.landingOrganization.name} will see that you withdrew from “{interest.job.title}”, and the conversation closes. You
      can’t reply to it afterwards.
    </p>
  )
}

function haulerFacts(interest: MarketplaceInterestView): InquiryFact[] {
  const equipment = interest.equipment.map((line) => `${line.count} × ${line.label}`).join(", ")
  const available = availabilityText(interest)

  return [
    { label: "You offered", note: "Self-reported", value: `${interest.trucksOffered} truck${interest.trucksOffered === 1 ? "" : "s"}` },
    ...(equipment ? [{ label: "Equipment", value: equipment }] : []),
    ...(available ? [{ label: "Available", value: available }] : []),
    { label: "Sent", value: `${formatDay(interest.createdAt)} by ${interest.submittedBy.name}` }
  ]
}

/**
 * My inquiries (hauler, UX 02 §A9), built from the design system (DS-04, #147): the hauling business's inquiries as
 * InquiryRows beside the selected conversation (ContentGrid "split": side by side from 1024 px, stacked below).
 * Selection is the `inquiry` query parameter, so every row is a plain link that works without JavaScript. Replies
 * and withdrawals post to the existing server actions, which take identity from the session.
 */
export default async function MyInquiriesPage({ searchParams }: { searchParams: SearchParams }) {
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
    refusal = withBusinessSwitchNote("No hauling business is selected for your account.")
  } else {
    try {
      interests = await pilotMarketplaceV2.listHaulerInterests({ organizationId: workspace.id, userId: actor.profile.id })
    } catch (error) {
      refusal = withBusinessSwitchNote(error instanceof Error ? error.message : "Inquiries are not available for this business.")
    }
  }

  const error = one(query.error) || null
  const selected = interests.find((interest) => interest.id === one(query.inquiry)) ?? interests[0] ?? null

  return (
    <div data-ds-page="my-inquiries">
      <PageHeader
        description="Interest your hauling business sent to landing operators. This tracks conversations only — not contracts, loads or pay."
        title="My inquiries"
      />
      <PageContainer>
        {refusal || interests.length === 0 || !selected ? (
          <ContentGrid
            layout="single"
            main={
              <>
                {error ? <PageNotice role="alert" tone="critical">{error}</PageNotice> : null}
                {refusal ? (
                  <PageNotice>{refusal}</PageNotice>
                ) : (
                  <Section variant="flush">
                    <EmptyState
                      actions={<Button href="/v2/work" label="Find work" size="sm" variant="secondary" />}
                      body="Find work and express interest in a job that fits your trucks. Each inquiry and its messages show here."
                      title="No inquiries yet"
                    />
                  </Section>
                )}
              </>
            }
          />
        ) : (
          <ContentGrid
            aside={<HaulerConversation confirmWithdraw={one(query.confirm) === "withdraw"} interest={selected} />}
            layout="split"
            main={
              <>
                {error ? <PageNotice role="alert" tone="critical">{error}</PageNotice> : null}
                <Section
                  description="Newest activity first. Select one to read and reply."
                  title={`${interests.length} inquir${interests.length === 1 ? "y" : "ies"}`}
                  variant="flush"
                >
                  <ul aria-label="Your inquiries" className={styles.rows}>
                    {interests.map((interest) => (
                      <InquiryRow
                        href={inquiryHref(PATH, interest.id)}
                        interest={interest}
                        key={interest.id}
                        selected={interest.id === selected.id}
                        viewerSide="hauler"
                      />
                    ))}
                  </ul>
                </Section>
              </>
            }
          />
        )}
      </PageContainer>
    </div>
  )
}

/** The selected conversation: facts, thread, and while it is open the reply composer with Withdraw beside Send. */
function HaulerConversation({ confirmWithdraw, interest }: { confirmWithdraw: boolean; interest: MarketplaceInterestView }) {
  const open = OPEN.has(interest.status)
  const replyId = randomUUID()
  const withdrawFields = { interestId: interest.id }

  return (
    <InquiryConversation
      closedNote="This conversation is closed. Nothing more can be sent on it."
      composer={
        open ? (
          <InquiryReplyComposer
            action={haulerReplyAction}
            fields={{ interestId: interest.id, replyId }}
            key={replyId}
            recipientName={interest.landingOrganization.name}
            secondaryAction={
              <ConfirmActionDialog
                action={withdrawInterestAction}
                body={withdrawBody(interest)}
                confirmLabel="Withdraw interest"
                fallbackHref={inquiryHref(PATH, interest.id, { confirm: "withdraw" }, CONFIRM_ANCHOR)}
                fields={withdrawFields}
                title={WITHDRAW_TITLE}
                triggerLabel="Withdraw interest"
              />
            }
          />
        ) : null
      }
      confirmation={
        open && confirmWithdraw ? (
          <InquiryConfirmation body={withdrawBody(interest)} cancelHref={inquiryHref(PATH, interest.id)} title={WITHDRAW_TITLE}>
            <ConfirmActionForm action={withdrawInterestAction} confirmLabel="Withdraw interest" fields={withdrawFields} />
          </InquiryConfirmation>
        ) : null
      }
      facts={haulerFacts(interest)}
      interest={interest}
      viewerSide="hauler"
    />
  )
}
