import { randomUUID } from "node:crypto"

import { notFound } from "next/navigation"

import { marketplaceInterestIsFinal, marketplaceInterestIsOpen, type MarketplaceInterestView } from "@logloads/contracts"
import { ContentGrid, PageContainer, PageHeader, Section } from "@logloads/ui/layout"
import { availabilityText, formatDay, InquiryRow } from "@logloads/ui/marketplace"
import { Button, EmptyState, Tabs } from "@logloads/ui/primitives"

import { ConfirmActionDialog } from "@/components/v2/ConfirmActionDialog"
import { ConfirmActionForm } from "@/components/v2/ConfirmActionForm"
import { ConfirmReasonField, type ConfirmReason } from "@/components/v2/ConfirmReasonField"
import {
  CONFIRM_ANCHOR,
  CONFIRM_FORM_ID,
  InquiryConfirmation,
  InquiryConversation,
  inquiryHref,
  type InquiryFact
} from "@/components/v2/InquiryConversation"
import styles from "@/components/v2/InquiryConversation.module.css"
import { InquiryReplyComposer } from "@/components/v2/InquiryReplyComposer"
import { PageNotice } from "@/components/v2/PageNotice"
import { haulerReplyAction, withdrawInterestAction } from "@/lib/marketplace-v2/actions"
import { v2ErrorNotice } from "@/lib/marketplace-v2/error-codes"
import { v2FailureMessage } from "@/lib/marketplace-v2/error-log"
import { marketplaceV2Enabled } from "@/lib/marketplace-v2/flag"
import {
  chooseInquiryTab,
  HAULER_INQUIRY_TABS,
  haulerQueueOf,
  inquiryTabCounts,
  listHaulerInquiries
} from "@/lib/marketplace-v2/inquiries"
import { resolveV2Actor, withBusinessSwitchNote } from "@/lib/marketplace-v2/viewer"

type SearchParams = Promise<Record<string, string | string[] | undefined>>

const PATH = "/v2/inquiries"

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? ""
}

const WITHDRAW_TITLE = "Withdraw your interest?"

const WITHDRAW_REASON: ConfirmReason = {
  hint: "The landing sees this as your last message, for example “Booked on another job this week”.",
  label: "Reason",
  name: "reason"
}

/** #194 (HF-03): the landing's decline is final, so the page says so instead of offering anything. */
const DECLINED_NOTE = "The landing has closed this inquiry. It can’t be withdrawn or sent again, and nothing more can be sent on it."
const CLOSED_NOTE = "This conversation is closed. Nothing more can be sent on it."

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

function tabHref(tab: string): string {
  return tab === HAULER_INQUIRY_TABS[0]?.id ? PATH : `${PATH}?${new URLSearchParams({ tab }).toString()}`
}

/**
 * My inquiries (hauler, UX 02 §A9; UX-09 #132): Active, Replied and Closed tabs (`haulerInterestQueue`), each row
 * saying whose turn it is, beside the selected conversation (ContentGrid "split": side by side from 1024 px, stacked
 * below). Tabs and rows are plain links (`tab`, `inquiry`), so everything works without JavaScript; an inquiry the
 * query selects opens on its own tab. Replies and withdrawals post to the server actions, which take identity from
 * the session. A withdrawal can carry a reason the landing sees; a declined inquiry says plainly that it is closed.
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
      interests = await listHaulerInquiries(workspace.id, actor.profile.id)
    } catch (error) {
      // A store refusal keeps its words; anything else is logged and named by fixed copy and a reference (#279).
      refusal = withBusinessSwitchNote(v2FailureMessage(error, "inquiries.hauler_list"))
    }
  }

  // Only the fixed copy for an error code reaches the page, never text from the URL (#279).
  const failure = v2ErrorNotice(query)
  const counts = inquiryTabCounts(interests, HAULER_INQUIRY_TABS, haulerQueueOf)
  const requested = interests.find((interest) => interest.id === one(query.inquiry)) ?? null
  const tab = chooseInquiryTab(one(query.tab), requested ? haulerQueueOf(requested) : null, counts, HAULER_INQUIRY_TABS)
  const current = HAULER_INQUIRY_TABS.find((item) => item.id === tab) ?? HAULER_INQUIRY_TABS[0]
  const rows = interests.filter((interest) => haulerQueueOf(interest) === tab)
  const selected = (requested && haulerQueueOf(requested) === tab ? requested : null) ?? rows[0] ?? null
  const hasInquiries = !refusal && interests.length > 0

  return (
    <div data-ds-page="my-inquiries">
      <PageHeader
        description="Interest your hauling business sent to landing operators. This tracks conversations only — not contracts, loads or pay."
        tabs={
          hasInquiries ? (
            <Tabs
              activeId={tab}
              items={HAULER_INQUIRY_TABS.map((item) => ({ count: counts[item.id], href: tabHref(item.id), id: item.id, label: item.label }))}
              label="Inquiries by status"
            />
          ) : undefined
        }
        title="My inquiries"
      />
      <PageContainer>
        {!hasInquiries || !current ? (
          <ContentGrid
            layout="single"
            main={
              <>
                {failure ? <PageNotice role="alert" tone="critical">{failure.message}</PageNotice> : null}
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
            aside={
              selected && actor ? (
                <HaulerConversation confirmWithdraw={one(query.confirm) === "withdraw"} interest={selected} viewerUserId={actor.profile.id} />
              ) : undefined
            }
            layout={selected ? "split" : "single"}
            main={
              <>
                {failure ? <PageNotice role="alert" tone="critical">{failure.message}</PageNotice> : null}
                <Section
                  description={rows.length > 0 ? "Newest activity first. Select one to read and reply." : undefined}
                  title={rows.length > 0 ? `${rows.length} ${current.label.toLowerCase()} inquir${rows.length === 1 ? "y" : "ies"}` : current.label}
                  variant="flush"
                >
                  {rows.length === 0 ? (
                    <p className={styles.empty}>{current.empty}</p>
                  ) : (
                    <ul aria-label="Your inquiries" className={styles.rows}>
                      {rows.map((interest) => (
                        <InquiryRow
                          href={inquiryHref(PATH, interest.id)}
                          interest={interest}
                          key={interest.id}
                          selected={interest.id === selected?.id}
                          viewerSide="hauler"
                        />
                      ))}
                    </ul>
                  )}
                </Section>
              </>
            }
          />
        )}
      </PageContainer>
    </div>
  )
}

/**
 * The selected conversation: facts, thread, and while it is open the reply composer with Withdraw beside Send. A
 * withdrawal is confirmed first (a Dialog, or in the page without JavaScript) and can carry a reason.
 */
function HaulerConversation({
  confirmWithdraw,
  interest,
  viewerUserId
}: {
  confirmWithdraw: boolean
  interest: MarketplaceInterestView
  viewerUserId: string
}) {
  const open = marketplaceInterestIsOpen(interest.status)
  const replyId = randomUUID()
  // The reason is a message too: its own server-generated id makes a repeated withdrawal post it once.
  const withdrawFields = { interestId: interest.id, replyId: randomUUID() }

  return (
    <InquiryConversation
      closedNote={marketplaceInterestIsFinal(interest.status) ? DECLINED_NOTE : CLOSED_NOTE}
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
                reason={WITHDRAW_REASON}
                title={WITHDRAW_TITLE}
                triggerLabel="Withdraw interest"
              />
            }
          />
        ) : null
      }
      confirmation={
        open && confirmWithdraw ? (
          <InquiryConfirmation
            body={withdrawBody(interest)}
            cancelHref={inquiryHref(PATH, interest.id)}
            reason={<ConfirmReasonField form={CONFIRM_FORM_ID} id={`${CONFIRM_FORM_ID}-reason`} reason={WITHDRAW_REASON} />}
            title={WITHDRAW_TITLE}
          >
            <ConfirmActionForm action={withdrawInterestAction} confirmLabel="Withdraw interest" fields={withdrawFields} id={CONFIRM_FORM_ID} />
          </InquiryConfirmation>
        ) : null
      }
      facts={haulerFacts(interest)}
      interest={interest}
      viewerSide="hauler"
      viewerUserId={viewerUserId}
    />
  )
}
