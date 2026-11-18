import { randomUUID } from "node:crypto"

import { notFound } from "next/navigation"

import {
  marketplaceInterestIsOpen,
  offeredEquipmentFit,
  type MarketplaceInquiryJobContext,
  type MarketplaceInterestView,
  type MarketplacePay
} from "@logloads/contracts"
import { Icon } from "@logloads/ui/icons"
import { ContentGrid, PageContainer, PageHeader, Section } from "@logloads/ui/layout"
import { availabilityText, formatDay, InquiryRow, PayFigure } from "@logloads/ui/marketplace"
import { Button, FormField, Tabs } from "@logloads/ui/primitives"

import { ConfirmActionForm } from "@/components/v2/ConfirmActionForm"
import { ConfirmReasonField, type ConfirmReason } from "@/components/v2/ConfirmReasonField"
import {
  CONFIRM_ANCHOR,
  CONFIRM_FORM_ID,
  InquiryConfirmation,
  InquiryConversation,
  inquiryHref,
  InquiryJobTitle,
  jobIsListed,
  type InquiryFact
} from "@/components/v2/InquiryConversation"
import styles from "@/components/v2/InquiryConversation.module.css"
import { PageNotice } from "@/components/v2/PageNotice"
import { PendingSubmitButton } from "@/components/v2/PendingSubmitButton"
import { respondToInterestAction } from "@/lib/marketplace-v2/actions"
import { V2_FAULT_CODES, v2ErrorMessage, v2ErrorNotice } from "@/lib/marketplace-v2/error-codes"
import { reportV2Error } from "@/lib/marketplace-v2/error-log"
import { marketplaceV2Enabled } from "@/lib/marketplace-v2/flag"
import {
  chooseInquiryTab,
  inquiryTabCounts,
  LANDING_INQUIRY_TABS,
  landingInquiryFilters,
  landingQueueOf,
  listLandingInquiries,
  type LandingInquiryFilters
} from "@/lib/marketplace-v2/inquiries"
import { pilotMarketplaceV2 } from "@/lib/marketplace-v2/pilot-adapter"
import { resolveV2Actor, withBusinessSwitchNote } from "@/lib/marketplace-v2/viewer"

import { readyReplyTexts } from "./_lib/ready-replies"
import { LandingReplyBar } from "./LandingReplyBar"

type SearchParams = Promise<Record<string, string | string[] | undefined>>

const PATH = "/v2/landing/inquiries"

const CONTACT_LABELS = { email: "Email", in_app: "LogLoads messages", phone: "Phone" } as const

const DECLINE_TITLE = "Decline this inquiry?"

const DECLINE_REASON: ConfirmReason = {
  hint: "The hauler sees this as your last message, for example “We’ve filled this job” or “Equipment doesn’t fit”.",
  label: "Reason",
  name: "body"
}

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? ""
}

function declineBody(interest: MarketplaceInterestView) {
  return (
    <p className={styles.dialogBody}>
      {interest.haulerOrganization.name} will see that you declined their interest in “{interest.job.title}”, and the conversation
      closes. You can’t reply to it afterwards, and they can’t send interest in this job again.
    </p>
  )
}

/**
 * Each offered configuration against the job's equipment (UX 02 §B9, UX-09 criterion 4): "✓ matches" or "not
 * requested", advisory and self-reported. Without a comparable equipment list for the job, the lines are listed
 * without a verdict rather than with a guessed one.
 */
function offeredEquipment(interest: MarketplaceInterestView, jobEquipment: readonly string[] | null): InquiryFact | null {
  if (interest.equipment.length === 0) {
    return null
  }

  const compared = jobEquipment !== null && jobEquipment.length > 0

  return {
    label: "Equipment",
    note: compared ? "Self-reported by the hauler; compared with this job’s equipment" : "Self-reported by the hauler",
    value: (
      <ul className={styles.equipment}>
        {interest.equipment.map((line) => {
          const fit = compared ? offeredEquipmentFit(line.configurationKey, jobEquipment) : null

          return (
            <li className={styles.equipmentLine} key={line.configurationKey}>
              <span>{`${line.count} × ${line.label}`}</span>
              {fit ? (
                <span className={styles.fit} data-fit={fit}>
                  {fit === "matches" ? (
                    <>
                      <span aria-hidden="true">✓ </span>matches
                    </>
                  ) : "not requested"}
                </span>
              ) : null}
            </li>
          )
        })}
      </ul>
    )
  }
}

function landingFacts(interest: MarketplaceInterestView, jobEquipment: readonly string[] | null): InquiryFact[] {
  const equipment = offeredEquipment(interest, jobEquipment)
  const available = availabilityText(interest)

  return [
    {
      label: "Offers",
      note: "Self-reported by the hauler; not verified",
      value: `${interest.trucksOffered} truck${interest.trucksOffered === 1 ? "" : "s"}`
    },
    ...(equipment ? [equipment] : []),
    ...(available ? [{ label: "Available", value: available }] : []),
    { label: "Sent by", value: `${interest.submittedBy.name} · ${formatDay(interest.createdAt)}` },
    { label: "Contact", value: CONTACT_LABELS[interest.contactPreference] }
  ]
}

/** The applied filters as query parameters, carried by the tabs, the rows and the confirmation links. */
function filterQuery(filters: Pick<LandingInquiryFilters, "job" | "landing">): Record<string, string> {
  return { ...(filters.job ? { job: filters.job } : {}), ...(filters.landing ? { landing: filters.landing } : {}) }
}

function tabHref(tab: string, filters: Record<string, string>): string {
  const params = new URLSearchParams({ ...(tab === LANDING_INQUIRY_TABS[0]?.id ? {} : { tab }), ...filters }).toString()
  return params ? `${PATH}?${params}` : PATH
}

/**
 * Hauler inquiries (landing inbox, UX 02 §B9; UX-09 #132): New, Replied and Closed tabs as UX-DEC-01 maps them
 * (`landingInterestQueue`: "Mark reviewed" keeps an inquiry in New with a "Seen" marker), a job and landing filter
 * (a GET form), and the selected conversation beside the list. Tabs, filters and rows are plain links and forms, so
 * all of it works without JavaScript. Replying, marking reviewed and declining post to the existing server action;
 * declining is confirmed first, in a Dialog or in the page, and can carry a reason the hauler sees. Nothing here
 * shares the landing's private details: a reply carries only what its author writes.
 *
 * Flow C (#328): the inquiry link a notice carries (`?inquiry=<id>#conversation`) opens the thread with the reply
 * bar, so a ready reply is the second tap. Ready replies and confirmed declines are held a minute for Undo
 * (LandingReplyBar). A link to an inquiry this business cannot open shows the permission-denied panel (C-denied).
 */
export default async function LandingInboxPage({ searchParams }: { searchParams: SearchParams }) {
  if (!marketplaceV2Enabled()) notFound()

  const resolved = await resolveV2Actor(PATH)
  const query = await searchParams
  const actor = resolved.ok ? resolved.actor : null
  const workspace = actor && !actor.workspaceSelectionInvalid ? actor.activeOrganization : null
  let interests: MarketplaceInterestView[] = []
  let jobs: MarketplaceInquiryJobContext[] | null = null
  let refusal: string | null = null

  if (!resolved.ok) {
    refusal = resolved.refusal
  } else if (!actor || !workspace) {
    refusal = withBusinessSwitchNote("No landing business is selected for your account.")
  } else {
    const viewer = { organizationId: workspace.id, userId: actor.profile.id }

    try {
      interests = await listLandingInquiries(viewer.organizationId, viewer.userId)
    } catch (error) {
      // A refusal reads as the role note; a fault is logged and says so, with its reference (#279, K2).
      const failure = reportV2Error(error, "inquiries.landing_list")
      refusal = V2_FAULT_CODES.has(failure.code)
        ? v2ErrorMessage(failure.code, failure.requestId)
        : withBusinessSwitchNote("Your role in this business cannot review hauler inquiries.")
    }

    if (!refusal && interests.length > 0) {
      // The landing filter and the equipment comparison only: without them the inbox still works, so a store that
      // cannot answer leaves both out instead of guessing.
      jobs = await pilotMarketplaceV2.landingInquiryJobs(viewer).catch(() => null)
    }
  }

  // Only the fixed copy for an error code reaches the page, never text from the URL (#279).
  const failure = v2ErrorNotice(query)
  const filters = landingInquiryFilters(interests, jobs, { job: one(query.job), landing: one(query.landing) })
  const carried = filterQuery(filters)
  const counts = inquiryTabCounts(filters.interests, LANDING_INQUIRY_TABS, landingQueueOf)
  const requestedId = one(query.inquiry).trim()
  // C-denied (#328, Figma `315:1506`): an inquiry link this business cannot open. An inquiry that does not exist gets
  // the same panel, so the page never tells which business holds an inquiry, or that it exists.
  const denied = !refusal && actor !== null && requestedId !== "" && !interests.some((interest) => interest.id.toLowerCase() === requestedId.toLowerCase())
  const requested = filters.interests.find((interest) => interest.id === one(query.inquiry)) ?? null
  const tab = chooseInquiryTab(one(query.tab), requested ? landingQueueOf(requested) : null, counts, LANDING_INQUIRY_TABS)
  const current = LANDING_INQUIRY_TABS.find((item) => item.id === tab) ?? LANDING_INQUIRY_TABS[0]
  const rows = filters.interests.filter((interest) => landingQueueOf(interest) === tab)
  const selected = denied ? null : (requested && landingQueueOf(requested) === tab ? requested : null) ?? rows[0] ?? null
  const hasInquiries = !refusal && interests.length > 0
  const jobEquipment = (interest: MarketplaceInterestView) => jobs?.find((job) => job.jobId === interest.job.id)?.equipmentCodes ?? null
  // The job card's pay (C3): the job as this business sees it. Without it the card shows the title alone.
  const jobPay: MarketplacePay | null =
    selected && actor && workspace && jobIsListed(selected)
      ? await pilotMarketplaceV2
          .getJob(selected.job.id, { organizationId: workspace.id, userId: actor.profile.id })
          .then((job) => job?.pay ?? null)
          .catch(() => null)
      : null

  const list = (
    <>
      {failure ? <PageNotice role="alert" tone="critical">{failure.message}</PageNotice> : null}
      {refusal ? (
        <PageNotice>{refusal}</PageNotice>
      ) : (
        <>
          {hasInquiries ? <InboxFilters filters={filters} /> : null}
          {current ? (
            <Section description={`${rows.length} inquir${rows.length === 1 ? "y" : "ies"}`} title={current.label} variant="flush">
              {rows.length === 0 ? (
                <p className={styles.empty}>{current.empty}</p>
              ) : (
                <ul aria-label={`${current.label} inquiries`} className={styles.rows}>
                  {rows.map((interest) => (
                    <InquiryRow
                      href={inquiryHref(PATH, interest.id, carried)}
                      interest={interest}
                      key={interest.id}
                      selected={interest.id === selected?.id}
                      viewerSide="landing"
                    />
                  ))}
                </ul>
              )}
            </Section>
          ) : null}
        </>
      )}
    </>
  )

  return (
    <div data-ds-page="landing-inbox">
      <PageHeader
        description="Interest received on your organization’s jobs. Replies are unlimited; nothing here assigns trucks or records a hire."
        tabs={
          hasInquiries ? (
            <Tabs
              activeId={tab}
              items={LANDING_INQUIRY_TABS.map((item) => ({ count: counts[item.id], href: tabHref(item.id, carried), id: item.id, label: item.label }))}
              label="Inquiries by queue"
            />
          ) : undefined
        }
        title="Hauler inquiries"
      />
      <PageContainer>
        {refusal || !actor ? (
          <ContentGrid layout="single" main={list} />
        ) : denied ? (
          <ContentGrid aside={<DeniedInquiry canSwitch={actor.memberships.length > 1} />} layout="split" main={list} />
        ) : !selected ? (
          <ContentGrid layout="single" main={list} />
        ) : (
          <ContentGrid
            aside={
              <LandingConversation
                carried={carried}
                confirmDecline={one(query.confirm) === "decline"}
                interest={selected}
                jobEquipment={jobEquipment(selected)}
                pay={jobPay}
                today={new Date().toISOString().slice(0, 10)}
                updated={one(query.inquiry) === selected.id ? one(query.updated) : ""}
                viewerUserId={actor.profile.id}
              />
            }
            layout="split"
            main={list}
          />
        )}
      </PageContainer>
    </div>
  )
}

/**
 * The inbox's job and landing filter (spec §4.7) as a GET form, so it works without JavaScript. The landing filter
 * is offered only when the store names a landing for the jobs.
 */
function InboxFilters({ filters }: { filters: LandingInquiryFilters }) {
  const active = Boolean(filters.job || filters.landing)

  return (
    <form action={PATH} aria-label="Filter inquiries" className={styles.filters} method="get" role="search">
      <FormField id="inbox-job" label="Job">
        <select defaultValue={filters.job} name="job">
          <option value="">All jobs</option>
          {filters.jobOptions.map((option) => (
            <option key={option.id} value={option.id}>{option.label}</option>
          ))}
        </select>
      </FormField>
      {filters.landingOptions.length > 0 ? (
        <FormField id="inbox-landing" label="Landing">
          <select defaultValue={filters.landing} name="landing">
            <option value="">All landings</option>
            {filters.landingOptions.map((option) => (
              <option key={option.id} value={option.id}>{option.label}</option>
            ))}
          </select>
        </FormField>
      ) : null}
      <div className={styles.filterActions}>
        <Button label="Apply" size="sm" type="submit" variant="secondary" />
        {active ? <Button href={PATH} label="Clear filters" size="sm" variant="ghost" /> : null}
      </div>
    </form>
  )
}

/**
 * C-denied (#328, Figma 07 Flows `315:1506`): an inquiry link the session's business cannot open. It names no
 * business and says nothing of the inquiry. Someone with another business is offered the switch.
 */
function DeniedInquiry({ canSwitch }: { canSwitch: boolean }) {
  return (
    <section aria-labelledby="inquiry-denied-title" className={styles.denied} data-flow-c="">
      <span aria-hidden="true" className={styles.deniedMark}>
        <Icon aria-hidden name="status.lock" size={24} />
      </span>
      <h2 className={styles.deniedTitle} id="inquiry-denied-title">You can’t open this inquiry</h2>
      <p className={styles.deniedBody}>
        It belongs to another business, or it is no longer here. Only that business’s owner, managers and staff can read it
        and reply. Sign in with that account, or ask its owner to add you.
      </p>
      <div className={styles.deniedActions}>
        {canSwitch ? <Button href="/v2/switch" label="Switch business" size="lg" /> : null}
        <Button href="/v2/landing" label="Go to my home page" size="lg" variant={canSwitch ? "secondary" : "primary"} />
      </div>
    </section>
  )
}

/** The job card at the top of the thread (C3): the pay as the poster stated it, then the job. */
function JobCard({ interest, pay }: { interest: MarketplaceInterestView; pay: MarketplacePay | null }) {
  return (
    <>
      {pay ? <PayFigure className={styles.jobPay} pay={pay} /> : null}
      <span className={styles.jobTitle}>
        <InquiryJobTitle interest={interest} />
      </span>
    </>
  )
}

/** What the last answer did, from the server's redirect (C4 and C7 once the minute is over, or without scripts). */
function answerNotice(updated: string, interest: MarketplaceInterestView) {
  const name = interest.haulerOrganization.name
  const text = updated === "replied" ? `Reply sent to ${name}.` : updated === "declined" ? `Declined. ${name} can see it.` : null

  return text ? (
    <p className={styles.answered} data-flow-c="" role="status">
      <Icon aria-hidden name="status.assigned" size={20} />
      <span>{text}</span>
    </p>
  ) : null
}

/**
 * The selected conversation: the job card, what the hauler can bring (each offered configuration against the job's
 * equipment), "Mark reviewed" while it is new, the thread, and while it is open the reply bar (flow C, #328): two
 * ready replies that go in one tap with a minute to undo, the typed reply, and Decline beside Send. Declining is
 * confirmed first, can carry a reason the hauler sees, and is then held for a minute too.
 */
function LandingConversation({
  carried,
  confirmDecline,
  interest,
  jobEquipment,
  pay,
  today,
  updated,
  viewerUserId
}: {
  carried: Record<string, string>
  confirmDecline: boolean
  interest: MarketplaceInterestView
  jobEquipment: readonly string[] | null
  pay: MarketplacePay | null
  /** The server's calendar day (YYYY-MM-DD), for the ready reply that names the hauler's first day. */
  today: string
  /** `updated` from the redirect, when it was for this inquiry. */
  updated: string
  viewerUserId: string
}) {
  const open = marketplaceInterestIsOpen(interest.status)
  const replyId = randomUUID()
  // The reason is a landing message: its own server-generated id makes a repeated decline post it once.
  const declineFields = { decision: "declined", interestId: interest.id, replyId: randomUUID() }
  // Each ready reply has its own server-generated id, so a retried send is recorded once.
  const readyReplies = readyReplyTexts(interest, today).map((body) => ({ body, replyId: randomUUID() }))

  return (
    <InquiryConversation
      closedNote="This conversation is closed. Nothing more can be sent on it."
      composer={
        open ? (
          <LandingReplyBar
            action={respondToInterestAction}
            decline={{
              body: declineBody(interest),
              confirmLabel: "Decline inquiry",
              fallbackHref: inquiryHref(PATH, interest.id, { confirm: "decline", ...carried }, CONFIRM_ANCHOR),
              fields: declineFields,
              reason: DECLINE_REASON,
              title: DECLINE_TITLE,
              triggerLabel: "Decline"
            }}
            interestId={interest.id}
            key={replyId}
            readyReplies={readyReplies}
            recipientName={interest.haulerOrganization.name}
            replyFields={{ decision: "replied", interestId: interest.id, replyId }}
          />
        ) : null
      }
      confirmation={
        open && confirmDecline ? (
          <InquiryConfirmation
            body={declineBody(interest)}
            cancelHref={inquiryHref(PATH, interest.id, carried)}
            reason={<ConfirmReasonField form={CONFIRM_FORM_ID} id={`${CONFIRM_FORM_ID}-reason`} reason={DECLINE_REASON} />}
            title={DECLINE_TITLE}
          >
            <ConfirmActionForm action={respondToInterestAction} confirmLabel="Decline inquiry" fields={declineFields} id={CONFIRM_FORM_ID} />
          </InquiryConfirmation>
        ) : null
      }
      facts={landingFacts(interest, jobEquipment)}
      factsTitle="They can bring"
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
      job={<JobCard interest={interest} pay={pay} />}
      notice={answerNotice(updated, interest)}
      viewerSide="landing"
      viewerUserId={viewerUserId}
    />
  )
}
