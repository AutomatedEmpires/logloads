"use client"

import { PLATFORM_FEE_BPS, FEE_BPS_SCALE, createMoney, formatMoney } from "@logloads/contracts"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useMemo, useState, useTransition } from "react"

import {
  approveCapacityRequestAction,
  cancelAssignmentAction,
  closeLoadAction,
  createDirectOfferAction,
  createLoadPostingAction,
  createOperationalNoticeAction,
  markDriverPaymentSentAction,
  publishDraftAction,
  refreshRoutePackAction,
  revokeDirectOfferAction,
  settleHaulCompletionAction
} from "@/lib/cockpit-actions"
import { driverPayQuote, parseDriverPayCents, payOutlookForTruckloads } from "@/lib/driver-pay-input"
import type { HostPublishingOptions, RequirementOption } from "@/lib/host-data"
import { formatDateTime, formatHuman, humanizeTag } from "@/lib/v3-shared"
import { EmptyState } from "./Shells"

const ROAD_CONDITIONS = ["good", "wet", "muddy", "icy", "snow", "restricted", "closed"] as const
const WEEKDAYS: Array<[number, string]> = [
  [1, "Mon"],
  [2, "Tue"],
  [3, "Wed"],
  [4, "Thu"],
  [5, "Fri"],
  [6, "Sat"],
  [0, "Sun"]
]
const VISIBILITY_MODES: Array<[string, string, string]> = [
  ["open_network", "Open network", "Any hauling organization can see and request this work."],
  ["private_network", "Private — partners only", "Only your trusted partner organizations see it."],
  ["verified_network", "Verified carriers", "Limited to carriers building a verified track record."]
]

/**
 * The rate as a host reads it, derived from the constant the ledger charges at.
 * A typed "5%" beside a changed constant is a lie printed next to a real number.
 */
const FEE_PERCENT_LABEL = `${(PLATFORM_FEE_BPS / FEE_BPS_SCALE) * 100}%`

/**
 * Whole cents, as a host reads them. Goes through the contracts money helpers so
 * the currency is the one the rest of the system uses and the division by 100
 * happens in exactly one place.
 */
function money(amountCents: number): string {
  return formatMoney(createMoney(amountCents))
}

type ScheduleKind = "one_off" | "recurring" | "campaign"

function toggleInSet<T>(current: Set<T>, value: T): Set<T> {
  const next = new Set(current)
  if (next.has(value)) {
    next.delete(value)
  } else {
    next.add(value)
  }
  return next
}

function RequirementChips({
  options,
  selected,
  onToggle,
  empty
}: {
  options: RequirementOption[]
  selected: Set<string>
  onToggle: (value: string) => void
  empty: string
}) {
  if (options.length === 0) {
    return <p className="host-builder-note">{empty}</p>
  }

  return (
    <div className="req-chips">
      {options.map((option) => (
        <button
          aria-pressed={selected.has(option.value)}
          className={selected.has(option.value) ? "req-chip is-on" : "req-chip"}
          key={option.value}
          onClick={() => onToggle(option.value)}
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

// --- Capacity request approvals ---------------------------------------------

export interface PendingCapacityRequest {
  assignmentId: string
  driverName: string
  truckUnit: string
  loadTitle: string
  scheduleLabel: string
}

function ApprovalRow({ request }: { request: PendingCapacityRequest }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [confirming, setConfirming] = useState<"approve" | "decline" | null>(null)
  const [decided, setDecided] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const decide = (approve: boolean) => {
    startTransition(async () => {
      setError(null)

      try {
        const result = await approveCapacityRequestAction({ approve, assignmentId: request.assignmentId })

        if (!result.ok) {
          setError(result.error ?? "That decision did not go through. Try again.")
          return
        }

        setConfirming(null)
        setDecided(true)
        router.refresh()
      } catch {
        setError("That decision did not go through. Check your connection and try again.")
      }
    })
  }

  if (decided) {
    return null
  }

  return (
    <div className="host-approval-row" data-assignment-id={request.assignmentId}>
      <strong>{request.driverName}</strong>
      <span>
        {request.truckUnit} · {request.loadTitle} · {request.scheduleLabel}
      </span>
      {confirming ? (
        <div className="host-stack-form" role="group" aria-label={`Confirm ${confirming} request`}>
          <p className="host-builder-note">
            {confirming === "approve"
              ? `Reserve one truckload for ${request.driverName} in ${request.truckUnit}. Approval unlocks the assignment Route Pack.`
              : `Decline ${request.driverName}'s request. No truckload will be reserved.`}
          </p>
          <div className="host-approval-actions">
            <button className="host-btn" disabled={pending} onClick={() => decide(confirming === "approve")} type="button">
              {pending ? "Saving…" : confirming === "approve" ? "Confirm approval" : "Confirm decline"}
            </button>
            <button className="host-btn host-btn--quiet" disabled={pending} onClick={() => setConfirming(null)} type="button">
              Go back
            </button>
          </div>
        </div>
      ) : (
        <div className="host-approval-actions">
          <button className="host-btn" disabled={pending} onClick={() => setConfirming("approve")} type="button">Review approval</button>
          <button className="host-btn host-btn--quiet" disabled={pending} onClick={() => setConfirming("decline")} type="button">Review decline</button>
        </div>
      )}
      {error ? (
        <p className="host-form-feedback host-form-feedback--error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}

export function CapacityApprovalList({ requests }: { requests: PendingCapacityRequest[] }) {
  if (requests.length === 0) {
    return (
      <EmptyState
        body="Requests appear here the moment a hauler asks for one of your truckloads. Approving one puts the truck on your live board."
        title="No capacity requests waiting."
      />
    )
  }

  return (
    <div className="host-approvals">
      {requests.map((request) => (
        <ApprovalRow key={request.assignmentId} request={request} />
      ))}
    </div>
  )
}

// --- Booked-haul cancellation -------------------------------------------------

/**
 * Two-step cancel for a booked haul: the truckload returns to the load's open
 * capacity and the driver is notified with the reason entered here.
 */
export function CancelAssignmentButton({ assignmentId, driverName }: { assignmentId: string; driverName: string }) {
  const [confirming, setConfirming] = useState(false)
  const [reason, setReason] = useState("")
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null)
  const [pending, startTransition] = useTransition()

  if (feedback?.ok) {
    return (
      <p className="host-form-feedback host-form-feedback--success" role="status">
        {feedback.text}
      </p>
    )
  }

  if (!confirming) {
    return (
      <button className="host-btn host-btn--quiet" onClick={() => setConfirming(true)} type="button">
        Cancel haul
      </button>
    )
  }

  const cancel = () => {
    startTransition(async () => {
      setFeedback(null)

      const result = await cancelAssignmentAction({ assignmentId, reason: reason.trim() || null })

      setFeedback(
        result.ok
          ? {
              ok: true,
              text: `The haul with ${driverName} is cancelled. The truckload is open again and the driver was notified.`
            }
          : { ok: false, text: result.error ?? "The haul could not be cancelled. Try again." }
      )
    })
  }

  return (
    <div className="host-stack-form">
      <label>
        Reason the driver sees (optional)
        <input maxLength={140} onChange={(event) => setReason(event.target.value)} type="text" value={reason} />
      </label>
      <div className="host-approval-actions">
        <button className="host-btn" disabled={pending} onClick={cancel} type="button">
          {pending ? "Cancelling…" : "Yes, cancel the haul"}
        </button>
        <button
          className="host-btn host-btn--quiet"
          disabled={pending}
          onClick={() => {
            setFeedback(null)
            setConfirming(false)
          }}
          type="button"
        >
          Keep it
        </button>
      </div>
      {feedback && !feedback.ok ? (
        <p className="host-form-feedback host-form-feedback--error" role="alert">
          {feedback.text}
        </p>
      ) : null}
    </div>
  )
}

// --- Delivered record settlement ------------------------------------------------

export interface DeliveredRecordSummary {
  status: string
  quantityLabel: string | null
  exceptionLabel: string | null
  ticketNumber: string | null
}

/**
 * The host settling the driver's account: confirming it, or contesting it with
 * a reason. Disputing keeps the driver's figures and lets them resubmit — it
 * is a disagreement, not an erasure.
 */
export function SettleDeliveryControl({
  driverName,
  record,
  tripId
}: {
  driverName: string
  record: DeliveredRecordSummary
  tripId: string
}) {
  const [disputing, setDisputing] = useState(false)
  const [confirmingDelivery, setConfirmingDelivery] = useState(false)
  const [reason, setReason] = useState("")
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null)
  const [pending, startTransition] = useTransition()

  if (feedback?.ok) {
    return (
      <p className="host-form-feedback host-form-feedback--success" role="status">
        {feedback.text}
      </p>
    )
  }

  const settle = (decision: "confirm" | "dispute") => {
    startTransition(async () => {
      setFeedback(null)

      try {
        const result = await settleHaulCompletionAction({
          decision,
          reason: decision === "dispute" ? reason.trim() : null,
          tripId
        })

        setFeedback(
          result.ok
            ? {
                ok: true,
                text: decision === "confirm"
                  ? `Delivery confirmed. ${driverName}'s record is settled.`
                  : `Record contested. ${driverName} was asked to resubmit.`
              }
            : { ok: false, text: result.error ?? "That decision did not go through. Try again." }
        )
      } catch {
        setFeedback({ ok: false, text: "That decision did not go through. Check your connection and try again." })
      }
    })
  }

  return (
    <div className="host-stack-form">
      <p className="host-builder-note">
        {record.quantityLabel ?? "No delivered quantity recorded"}
        {record.ticketNumber ? ` · ticket ${record.ticketNumber}` : ""}
      </p>
      {record.exceptionLabel ? (
        <p className="host-form-feedback host-form-feedback--error">{record.exceptionLabel}</p>
      ) : null}
      {disputing ? (
        <label>
          What is wrong with the record
          <input maxLength={500} onChange={(event) => setReason(event.target.value)} type="text" value={reason} />
        </label>
      ) : null}
      {confirmingDelivery ? (
        <div className="host-stack-form" role="group" aria-label="Confirm delivery record">
          <p className="host-builder-note">Confirm this record only after checking the quantity, ticket, and any exception above. This settles the host-side delivery record.</p>
          <div className="host-approval-actions">
            <button className="host-btn" disabled={pending} onClick={() => settle("confirm")} type="button">
              {pending ? "Confirming…" : "Yes, confirm delivery"}
            </button>
            <button className="host-btn host-btn--quiet" disabled={pending} onClick={() => setConfirmingDelivery(false)} type="button">Go back</button>
          </div>
        </div>
      ) : <div className="host-approval-actions">
        {disputing ? (
          <>
            <button className="host-btn" disabled={pending || !reason.trim()} onClick={() => settle("dispute")} type="button">
              {pending ? "Sending…" : "Send dispute"}
            </button>
            <button
              className="host-btn host-btn--quiet"
              disabled={pending}
              onClick={() => {
                setFeedback(null)
                setDisputing(false)
              }}
              type="button"
            >
              Back
            </button>
          </>
        ) : (
          <>
            <button className="host-btn" disabled={pending} onClick={() => setConfirmingDelivery(true)} type="button">
              Review confirmation
            </button>
            <button className="host-btn host-btn--quiet" disabled={pending} onClick={() => setDisputing(true)} type="button">
              Dispute
            </button>
          </>
        )}
      </div>}
      {feedback && !feedback.ok ? (
        <p className="host-form-feedback host-form-feedback--error" role="alert">
          {feedback.text}
        </p>
      ) : null}
    </div>
  )
}

export function DriverPaymentControl({
  assignmentId,
  driverName,
  expectedPayLabel,
  matchesExpected,
  receivedPayLabel,
  status
}: {
  assignmentId: string
  driverName: string
  expectedPayLabel: string | null
  matchesExpected: boolean | null
  receivedPayLabel: string | null
  status: "not_sent" | "sent" | "received"
}) {
  const [confirming, setConfirming] = useState(false)
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null)
  const [pending, startTransition] = useTransition()

  if (!expectedPayLabel) {
    return (
      <p className="host-builder-note" role="status">
        This legacy assignment has no frozen driver-pay amount and currency. Agree
        the payment off-platform and ask support to repair the accepted terms
        before recording a receipt.
      </p>
    )
  }

  if (status === "received" || feedback?.ok) {
    if (!feedback?.ok && matchesExpected === false) {
      return (
        <p className="host-form-feedback host-form-feedback--error" role="alert">
          {driverName} recorded {receivedPayLabel ?? "a different amount"} received, not the accepted {expectedPayLabel}. The discrepancy remains on this haul until you resolve it directly.
        </p>
      )
    }

    return (
      <p className="host-form-feedback host-form-feedback--success" role="status">
        {feedback?.text ??
          (receivedPayLabel
            ? `${driverName} recorded receipt of ${receivedPayLabel}.`
            : `${driverName} confirmed receipt of ${expectedPayLabel}; the legacy receipt did not preserve the actual amount.`)}
      </p>
    )
  }

  if (status === "sent") {
    return (
      <p className="host-builder-note" role="status">
        You marked {expectedPayLabel} sent. Waiting for {driverName} to confirm it arrived.
      </p>
    )
  }

  const send = () => {
    startTransition(async () => {
      setFeedback(null)

      try {
        const result = await markDriverPaymentSentAction({ assignmentId })

        setFeedback(
          result.ok
            ? {
                ok: true,
                text: `${expectedPayLabel} marked sent. ${driverName} was asked to confirm receipt.`
              }
            : { ok: false, text: result.error ?? "Driver payment could not be recorded." }
        )
      } catch {
        setFeedback({
          ok: false,
          text: "Driver payment could not be recorded. Check your connection and try again."
        })
      }
    })
  }

  return (
    <div className="host-stack-form">
      <p className="host-builder-note">
        Driver pay stays between you and {driverName}. Mark it sent only after paying the frozen
        amount of {expectedPayLabel}; LogLoads earns its fee after the driver confirms receipt.
      </p>
      {confirming ? (
        <div className="host-approval-actions" role="group" aria-label="Confirm driver payment sent">
          <button className="host-btn" disabled={pending} onClick={send} type="button">
            {pending ? "Recording…" : `Yes, I sent ${expectedPayLabel}`}
          </button>
          <button className="host-btn host-btn--quiet" disabled={pending} onClick={() => setConfirming(false)} type="button">
            Not yet
          </button>
        </div>
      ) : (
        <button className="host-btn" onClick={() => setConfirming(true)} type="button">
          Mark driver paid
        </button>
      )}
      {feedback && !feedback.ok ? (
        <p className="host-form-feedback host-form-feedback--error" role="alert">
          {feedback.text}
        </p>
      ) : null}
    </div>
  )
}

// --- Route Pack ---------------------------------------------------------------

/**
 * Re-issues the Route Pack a booked driver holds from the load's current
 * instructions. Only a material change mints a new version and alerts them.
 */
export function RefreshRoutePackButton({ assignmentId, driverName }: { assignmentId: string; driverName: string }) {
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null)
  const [pending, startTransition] = useTransition()

  const refresh = () => {
    startTransition(async () => {
      setFeedback(null)

      const result = await refreshRoutePackAction({ assignmentId })

      if (!result.ok) {
        setFeedback({ ok: false, text: result.error ?? "The Route Pack could not be updated. Try again." })
        return
      }

      setFeedback({
        ok: true,
        text: result.changed
          ? `Version ${result.version} issued. ${driverName} was alerted to read it before rolling.`
          : "Nothing operational changed, so the driver keeps the version they have."
      })
    })
  }

  return (
    <div className="host-row-actions">
      <button className="host-btn host-btn--quiet" disabled={pending} onClick={refresh} type="button">
        {pending ? "Checking…" : "Re-issue Route Pack"}
      </button>
      {feedback ? (
        <p
          className={`host-form-feedback ${feedback.ok ? "host-form-feedback--success" : "host-form-feedback--error"}`}
          role={feedback.ok ? "status" : "alert"}
        >
          {feedback.text}
        </p>
      ) : null}
    </div>
  )
}

// --- Published-work management ---------------------------------------------

/**
 * Opens a draft to the network: capacity and loading slots are minted on
 * publish. Reach is chosen here because a draft carries none — the builder's
 * earlier reach selection applies only to work published live.
 */
export function PublishDraftButton({ loadPostingId }: { loadPostingId: string }) {
  const [visibilityMode, setVisibilityMode] = useState("open_network")
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null)
  const [pending, startTransition] = useTransition()

  if (feedback?.ok) {
    return (
      <p className="host-form-feedback host-form-feedback--success" role="status">
        {feedback.text}
      </p>
    )
  }

  const publish = () => {
    startTransition(async () => {
      setFeedback(null)

      const result = await publishDraftAction({ loadPostingId, visibilityMode })

      setFeedback(
        result.ok
          ? { ok: true, text: "This work is live on the network." }
          : { ok: false, text: result.error ?? "The draft could not be published. Try again." }
      )
    })
  }

  return (
    <div className="host-stack-form">
      <label>
        Who can see this work
        <select onChange={(event) => setVisibilityMode(event.target.value)} value={visibilityMode}>
          {VISIBILITY_MODES.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <button className="host-btn" disabled={pending} onClick={publish} type="button">
        {pending ? "Publishing…" : "Publish now"}
      </button>
      {feedback && !feedback.ok ? (
        <p className="host-form-feedback host-form-feedback--error" role="alert">
          {feedback.text}
        </p>
      ) : null}
    </div>
  )
}

/**
 * Two-step close for published work: waiting requests are declined with the
 * reason entered here, remaining loading slots are cancelled, and the work
 * leaves the network. Booked hauls block the close.
 */
export function CloseWorkButton({ loadPostingId, waitingRequests }: { loadPostingId: string; waitingRequests: number }) {
  const [confirming, setConfirming] = useState(false)
  const [reason, setReason] = useState("")
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null)
  const [pending, startTransition] = useTransition()

  if (feedback?.ok) {
    return (
      <p className="host-form-feedback host-form-feedback--success" role="status">
        {feedback.text}
      </p>
    )
  }

  if (!confirming) {
    return (
      <button className="host-btn host-btn--quiet" onClick={() => setConfirming(true)} type="button">
        Close work
      </button>
    )
  }

  const close = () => {
    startTransition(async () => {
      setFeedback(null)

      const result = await closeLoadAction({ loadPostingId, reason: reason.trim() || null })

      setFeedback(
        result.ok
          ? { ok: true, text: "This work is closed and off the network." }
          : { ok: false, text: result.error ?? "The work could not be closed. Try again." }
      )
    })
  }

  return (
    <div className="host-stack-form">
      <p className="host-builder-note">
        {waitingRequests > 0
          ? `Closing declines ${waitingRequests} waiting request${waitingRequests === 1 ? "" : "s"} and takes this work off the network.`
          : "Closing takes this work off the network."}
      </p>
      <label>
        Reason drivers see (optional)
        <input maxLength={140} onChange={(event) => setReason(event.target.value)} type="text" value={reason} />
      </label>
      <div className="host-approval-actions">
        <button className="host-btn" disabled={pending} onClick={close} type="button">
          {pending ? "Closing…" : "Yes, close this work"}
        </button>
        <button
          className="host-btn host-btn--quiet"
          disabled={pending}
          onClick={() => {
            setFeedback(null)
            setConfirming(false)
          }}
          type="button"
        >
          Keep it open
        </button>
      </div>
      {feedback && !feedback.ok ? (
        <p className="host-form-feedback host-form-feedback--error" role="alert">
          {feedback.text}
        </p>
      ) : null}
    </div>
  )
}

// --- Opportunity builder ------------------------------------------------------

type BuilderVisibility = "open" | "draft"

const BUILDER_STEPS = ["Timber", "Movement", "Capacity", "Terms", "Visibility", "Review"] as const

function defaultLoadDate(): string {
  return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

export function OpportunityBuilder({ options }: { options: HostPublishingOptions }) {
  const [step, setStep] = useState(0)
  const [title, setTitle] = useState("")
  const [loadType, setLoadType] = useState(options.loadTypes[0] ?? "saw_logs")
  const [tons, setTons] = useState("")
  const [equipment, setEquipment] = useState<Set<string>>(new Set())
  const [access, setAccess] = useState<Set<string>>(new Set())
  const [landingId, setLandingId] = useState(options.landings[0]?.id ?? "")
  const [routeId, setRouteId] = useState("")
  const [roadOverride, setRoadOverride] = useState<string>("")
  const [weather, setWeather] = useState("")
  const [truckloads, setTruckloads] = useState("2")
  const [scheduleKind, setScheduleKind] = useState<ScheduleKind>("one_off")
  const [loadDate, setLoadDate] = useState(defaultLoadDate)
  const [campaignStart, setCampaignStart] = useState(defaultLoadDate)
  const [campaignEnd, setCampaignEnd] = useState("")
  const [days, setDays] = useState<Set<number>>(new Set([1, 3, 5]))
  const [until, setUntil] = useState("")
  const [rateId, setRateId] = useState(options.rates[0]?.id ?? "")
  // What this work pays a driver for ONE truckload, as the host types it. Held as
  // the typed string so a half-entered "52." is never silently read as $52.
  const [driverPay, setDriverPay] = useState("")
  const [visibility, setVisibility] = useState<BuilderVisibility>("draft")
  const [visibilityMode, setVisibilityMode] = useState<string>("open_network")
  const [error, setError] = useState<string | null>(null)
  const [published, setPublished] = useState<{ title: string; visibility: BuilderVisibility } | null>(null)
  const [pending, startTransition] = useTransition()

  const routesForLanding = useMemo(
    () => options.routes.filter((route) => route.landingId === landingId),
    [landingId, options.routes]
  )
  const landing = options.landings.find((entry) => entry.id === landingId) ?? null
  const route = options.routes.find((entry) => entry.id === routeId) ?? null
  const rate = options.rates.find((entry) => entry.id === rateId) ?? null

  const truckloadCount = Number.parseInt(truckloads, 10)
  const tonsValue = tons.trim() === "" ? null : Number(tons)

  // One parse, used for the quote AND for the payload, so the host cannot be
  // shown one number and have another one published.
  const driverPayCents = parseDriverPayCents(driverPay)
  const payQuote = driverPayQuote(driverPay)
  const perDayOutlook =
    driverPayCents !== null && Number.isInteger(truckloadCount) && truckloadCount > 0
      ? payOutlookForTruckloads(driverPayCents, truckloadCount)
      : null

  const missingSetup = [
    options.landings.length === 0 ? "a landing" : null,
    options.routes.length === 0 ? "a haul route" : null,
    options.rates.length === 0 ? "a rate" : null
  ].filter((value): value is string => Boolean(value))

  if (!options.dispatcher || missingSetup.length > 0) {
    return (
      <article className="opportunity-builder host-builder">
        <p className="eyebrow">Opportunity builder</p>
        <h2>Publishing is not ready yet</h2>
        <p className="host-builder-note">
          {!options.dispatcher
            ? "Every posting carries a dispatch contact so drivers know who runs the move. Add a dispatcher to your workspace before publishing work."
            : `Your workspace still needs ${missingSetup.join(", ")} on file before work can be published.`}
        </p>
        {options.dispatcher ? (
          <Link className="action-link" href="/host/landings">
            Set these up
          </Link>
        ) : null}
      </article>
    )
  }

  const dispatcher = options.dispatcher

  const weekdayNames = (values: number[]) =>
    values
      .slice()
      .sort((left, right) => left - right)
      .map((day) => WEEKDAYS.find(([value]) => value === day)?.[1])
      .filter((value): value is string => Boolean(value))
      .join(", ")

  const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value)
  // The load's roadCondition is the LANDING's road (matching reports it as the
  // landing axis, separate from the route). Default from the landing, host-editable.
  const roadCondition = roadOverride || landing?.roadCondition || "good"
  const scheduleReady =
    scheduleKind === "one_off"
      ? isDate(loadDate)
      : scheduleKind === "campaign"
        ? isDate(campaignStart) && isDate(campaignEnd) && campaignStart <= campaignEnd
        : days.size > 0 && isDate(campaignStart) && isDate(until) && campaignStart <= until

  const stepReady = [
    title.trim().length > 0,
    Boolean(landing && route),
    Number.isInteger(truckloadCount) && truckloadCount > 0 && scheduleReady,
    // Stated driver pay is required to leave Terms, not merely encouraged: it is
    // what a driver is promised and the base LogLoads charges its fee on. The
    // service refuses a publish without it too — this only means the host is
    // asked here rather than rejected at the last step.
    Boolean(rate) && driverPayCents !== null,
    true,
    true
  ]

  const publish = () => {
    if (!route || !rate || !landing || driverPayCents === null) {
      return
    }

    startTransition(async () => {
      setError(null)

      try {
      const result = await createLoadPostingAction({
        accessRequirements: [...access],
        allocationMode: "request_approval",
        campaignEndDate: scheduleKind === "campaign" ? campaignEnd : null,
        campaignStartDate: scheduleKind === "one_off" ? null : campaignStart,
        dailyTruckCountNeeded: truckloadCount,
        dispatcherContact: {
          email: dispatcher.email,
          name: dispatcher.name,
          phone: dispatcher.phone
        },
        dispatcherProfileId: dispatcher.id,
        // Per truckload. One assignment is one truckload hauled by one driver, and
        // the fee ledger keys on the assignment, so a series of N truckloads is N
        // payments of this figure and N fees on it.
        driverPayCents,
        dropoffMillId: route.millId,
        equipmentRequirements: [...equipment],
        estimatedTonsPerLoad: tonsValue && tonsValue > 0 ? tonsValue : null,
        loadDate: scheduleKind === "one_off" ? loadDate : null,
        loadType,
        loaderContact: null,
        loaderProfileId: null,
        pickupLandingId: landing.id,
        rateId: rate.id,
        recurringSchedule:
          scheduleKind === "recurring"
            ? { daysOfWeek: [...days].sort((a, b) => a - b), frequency: "weekly", untilDate: until }
            : null,
        roadCondition,
        routeId: route.id,
        scheduleType: scheduleKind,
        status: visibility === "open" ? "open" : "draft",
        title: title.trim(),
        visibilityMode,
        weatherNotes: weather.trim() || null
      })

      if (result.ok) {
        setPublished({ title: title.trim(), visibility })
        setStep(0)
        setTitle("")
        setTons("")
        setEquipment(new Set())
        setAccess(new Set())
        setDriverPay("")
        setRoadOverride("")
        setWeather("")
        setRouteId("")
        setTruckloads("2")
        setScheduleKind("one_off")
        setLoadDate(defaultLoadDate())
        setCampaignStart(defaultLoadDate())
        setCampaignEnd("")
        setDays(new Set([1, 3, 5]))
        setUntil("")
        setVisibility("draft")
        setVisibilityMode("open_network")
      } else {
        setError(result.error ?? "Publishing failed. Check the details and try again.")
      }
      } catch {
        setError("Publishing didn't go through. Check your connection and try again.")
      }
    })
  }

  return (
    <article className="opportunity-builder host-builder">
      <p className="eyebrow">Opportunity builder</p>
      <h2>Publish timber movement</h2>
      <div className="host-builder-rail" role="list">
        {BUILDER_STEPS.map((label, index) => (
          <span
            className={index === step ? "is-current" : index < step ? "is-done" : undefined}
            key={label}
            role="listitem"
          >
            {index + 1}. {label}
          </span>
        ))}
      </div>

      {published ? (
        <p className="host-form-feedback host-form-feedback--success" role="status">
          {published.visibility === "open"
            ? `"${published.title}" is live on the network. It is listed under published work.`
            : `"${published.title}" is saved as a draft only your team can see.`}
        </p>
      ) : null}

      {step === 0 ? (
        <div className="builder-form host-step">
          <label className="host-field--full">
            Work title
            <input
              onChange={(event) => setTitle(event.target.value)}
              placeholder="e.g. Blue River saw-log morning block"
              type="text"
              value={title}
            />
          </label>
          <label>
            Timber product
            <select onChange={(event) => setLoadType(event.target.value)} value={loadType}>
              {options.loadTypes.map((type) => (
                <option key={type} value={type}>
                  {formatHuman(type)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Estimated tons per load (optional)
            <input
              inputMode="decimal"
              min="1"
              onChange={(event) => setTons(event.target.value)}
              type="number"
              value={tons}
            />
          </label>
          <div className="host-field--full req-block">
            <span className="req-label">Equipment required</span>
            <RequirementChips
              empty="No carrier equipment on file yet — post without equipment requirements for now."
              onToggle={(value) => setEquipment((current) => toggleInSet(current, value))}
              options={options.equipmentVocabulary}
              selected={equipment}
            />
            <span className="req-hint">Only carriers whose trucks carry every selected item can request this load.</span>
          </div>
          <div className="host-field--full req-block">
            <span className="req-label">Access needs (optional)</span>
            <RequirementChips
              empty="No access tags on file yet."
              onToggle={(value) => setAccess((current) => toggleInSet(current, value))}
              options={options.accessVocabulary}
              selected={access}
            />
            <span className="req-hint">Flags carriers without these — a soft caution, not a hard block.</span>
          </div>
        </div>
      ) : null}

      {step === 1 ? (
        <div className="builder-form host-step">
          <label>
            Landing
            <select
              onChange={(event) => {
                setLandingId(event.target.value)
                setRouteId("")
              }}
              value={landingId}
            >
              {options.landings.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Haul route
            <select onChange={(event) => setRouteId(event.target.value)} value={routeId}>
              <option disabled value="">
                Pick a route
              </option>
              {routesForLanding.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label} · {entry.distanceMiles.toFixed(0)} mi
                </option>
              ))}
            </select>
          </label>
          {routesForLanding.length === 0 ? (
            <p className="host-form-feedback host-form-feedback--error host-field--full">
              No haul routes start at this landing yet. Pick a different landing.
            </p>
          ) : null}
          {route ? (
            <div className="host-route-fact host-field--full">
              <span>Destination: {route.millLabel}</span>
              <span>
                {route.distanceMiles.toFixed(0)} mi · {route.runTimeMinutes} min planned
              </span>
              <span>Route road {formatHuman(route.roadCondition)}</span>
            </div>
          ) : null}
          <label>
            Landing road condition
            <select onChange={(event) => setRoadOverride(event.target.value)} value={roadCondition}>
              {ROAD_CONDITIONS.map((condition) => (
                <option key={condition} value={condition}>
                  {formatHuman(condition)}
                </option>
              ))}
            </select>
          </label>
          <label className="host-field--full">
            Site &amp; weather notes (optional)
            <textarea
              maxLength={280}
              onChange={(event) => setWeather(event.target.value)}
              placeholder="e.g. Fog through 09:00; chains advised above 3000 ft."
              rows={2}
              value={weather}
            />
          </label>
        </div>
      ) : null}

      {step === 2 ? (
        <div className="builder-form host-step">
          <label>
            Truckloads needed per day
            <input
              inputMode="numeric"
              min="1"
              onChange={(event) => setTruckloads(event.target.value)}
              type="number"
              value={truckloads}
            />
          </label>
          <label>
            Cadence
            <select onChange={(event) => setScheduleKind(event.target.value as ScheduleKind)} value={scheduleKind}>
              <option value="one_off">One-off — a single day</option>
              <option value="recurring">Recurring — weekly on set days</option>
              <option value="campaign">Campaign — every day in a range</option>
            </select>
          </label>

          {scheduleKind === "one_off" ? (
            <label>
              Load date
              <input onChange={(event) => setLoadDate(event.target.value)} type="date" value={loadDate} />
            </label>
          ) : null}

          {scheduleKind === "campaign" ? (
            <>
              <label>
                Campaign start
                <input onChange={(event) => setCampaignStart(event.target.value)} type="date" value={campaignStart} />
              </label>
              <label>
                Campaign end
                <input onChange={(event) => setCampaignEnd(event.target.value)} type="date" value={campaignEnd} />
              </label>
            </>
          ) : null}

          {scheduleKind === "recurring" ? (
            <>
              <label>
                Starting
                <input onChange={(event) => setCampaignStart(event.target.value)} type="date" value={campaignStart} />
              </label>
              <label>
                Repeat until
                <input onChange={(event) => setUntil(event.target.value)} type="date" value={until} />
              </label>
              <div className="host-field--full req-block">
                <span className="req-label">Days of the week</span>
                <div className="req-chips">
                  {WEEKDAYS.map(([value, label]) => (
                    <button
                      aria-pressed={days.has(value)}
                      className={days.has(value) ? "req-chip is-on" : "req-chip"}
                      key={value}
                      onClick={() => setDays((current) => toggleInSet(current, value))}
                      type="button"
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </>
          ) : null}
        </div>
      ) : null}

      {step === 3 ? (
        <div className="host-step">
          <div className="builder-form">
            <label className="host-field--full">
              What this work pays a driver, per truckload
              <input
                aria-describedby="host-driver-pay-help"
                inputMode="decimal"
                onChange={(event) => setDriverPay(event.target.value)}
                placeholder="e.g. 525.00"
                type="text"
                value={driverPay}
              />
            </label>
            <p className="host-builder-note host-field--full" id="host-driver-pay-help">
              The flat amount one truckload pays the driver, in dollars. Every truckload on this
              work pays the same figure, so {truckloadCount > 1 ? `${truckloadCount} truckloads a day means ${truckloadCount} payments of it` : "each truckload is one payment of it"}.
              Drivers see this number and are paid exactly it.
            </p>
          </div>

          {payQuote ? (
            <div className="host-route-fact host-field--full" aria-label="What one truckload costs you">
              <span>Driver is paid {money(payQuote.driverPayCents)} per truckload</span>
              <span>
                LogLoads fee {FEE_PERCENT_LABEL}, added on top:{" "}
                {money(payQuote.platformFeeCents)}
              </span>
              <span>
                <strong>
                  Your cost per truckload {money(payQuote.hostTotalCents)}
                </strong>
              </span>
              {perDayOutlook && perDayOutlook.truckloads > 1 ? (
                <span>
                  Each loading day, if all {perDayOutlook.truckloads} truckloads run:{" "}
                  {money(perDayOutlook.driverPayCents)} to drivers
                  + {money(perDayOutlook.platformFeeCents)} fee ={" "}
                  {money(perDayOutlook.hostTotalCents)}
                </span>
              ) : null}
            </div>
          ) : (
            <p className="host-builder-note">
              Enter what one truckload pays a driver to see the {FEE_PERCENT_LABEL} LogLoads fee and your total.
            </p>
          )}

          <p className="host-builder-note">
            The fee is charged to you, on top of driver pay — never taken out of it. It is billed
            monthly and only on truckloads that actually complete. Posting costs nothing, and a
            truckload nobody hauls costs nothing.
          </p>

          <span className="req-label">Rate card for this lane</span>
          <div className="host-choice">
            {options.rates.map((entry) => (
              <label key={entry.id}>
                <input
                  checked={rateId === entry.id}
                  name="host-rate"
                  onChange={() => setRateId(entry.id)}
                  type="radio"
                />
                <span>
                  <strong>{entry.label}</strong>
                  {entry.detail ? <span>{entry.detail}</span> : null}
                </span>
              </label>
            ))}
          </div>
          <p className="host-builder-note">
            Your standing price list, kept on the posting for your own records and for the lanes and
            older work that still reference it. The driver pay above is what a driver is shown and
            what the fee is calculated from.
          </p>
        </div>
      ) : null}

      {step === 4 ? (
        <div className="host-step host-visibility-step">
          <span className="req-label">Who can see this work</span>
          <div className="host-choice">
            {VISIBILITY_MODES.map(([value, label, description]) => (
              <label key={value}>
                <input
                  checked={visibilityMode === value}
                  name="host-reach"
                  onChange={() => setVisibilityMode(value)}
                  type="radio"
                />
                <span>
                  <strong>{label}</strong>
                  <span>{description}</span>
                </span>
              </label>
            ))}
          </div>
          <span className="req-label">Publish now, or hold as a draft</span>
          <div className="host-choice">
            <label>
              <input
                checked={visibility === "open"}
                name="host-visibility"
                onChange={() => setVisibility("open")}
                type="radio"
              />
              <span>
                <strong>Publish now</strong>
                <span>Goes live for the reach you chose. Exact landing access still unlocks only after you approve an assignment.</span>
              </span>
            </label>
            <label>
              <input
                checked={visibility === "draft"}
                name="host-visibility"
                onChange={() => setVisibility("draft")}
                type="radio"
              />
              <span>
                <strong>Draft — team only</strong>
                <span>Stays inside your workspace until you open it.</span>
              </span>
            </label>
          </div>
        </div>
      ) : null}

      {step === 5 ? (
        <dl className="host-review host-step">
          <div>
            <dt>Work</dt>
            <dd>
              {title.trim()} · {formatHuman(loadType)}
            </dd>
          </div>
          <div>
            <dt>Movement</dt>
            <dd>
              {landing?.label} to {route?.millLabel}
            </dd>
          </div>
          <div>
            <dt>Capacity</dt>
            <dd>
              {truckloadCount} truckload{truckloadCount === 1 ? "" : "s"} per day ·{" "}
              {scheduleKind === "one_off"
                ? `on ${loadDate}`
                : scheduleKind === "campaign"
                  ? `every day, ${campaignStart} to ${campaignEnd}`
                  : `weekly on ${weekdayNames([...days])} until ${until}`}
            </dd>
          </div>
          <div>
            <dt>Loading window</dt>
            <dd>1:00 PM–9:00 PM UTC for each scheduled truckload</dd>
          </div>
          <div>
            <dt>Equipment</dt>
            <dd>{equipment.size > 0 ? [...equipment].map(humanizeTag).join(", ") : "No specific requirements"}</dd>
          </div>
          {access.size > 0 ? (
            <div>
              <dt>Access</dt>
              <dd>{[...access].map(humanizeTag).join(", ")}</dd>
            </div>
          ) : null}
          <div>
            <dt>Landing road</dt>
            <dd>{formatHuman(roadCondition)}{weather.trim() ? ` · ${weather.trim()}` : ""}</dd>
          </div>
          <div>
            <dt>Driver pay</dt>
            <dd>
              {payQuote
                ? `${money(payQuote.driverPayCents)} per truckload, paid in full to the driver`
                : "Not stated — go back to Terms"}
            </dd>
          </div>
          <div>
            <dt>LogLoads fee</dt>
            <dd>
              {payQuote
                ? `${money(payQuote.platformFeeCents)} per completed truckload (${FEE_PERCENT_LABEL}, charged to you on top), billed monthly`
                : `${FEE_PERCENT_LABEL} of stated driver pay, charged to you on top of it`}
            </dd>
          </div>
          <div>
            <dt>Your cost</dt>
            <dd>
              {payQuote
                ? `${money(payQuote.hostTotalCents)} per truckload that completes${
                    perDayOutlook && perDayOutlook.truckloads > 1
                      ? ` · ${money(perDayOutlook.hostTotalCents)} a loading day if all ${perDayOutlook.truckloads} run`
                      : ""
                  }`
                : "Stated driver pay plus the fee"}
            </dd>
          </div>
          <div>
            <dt>Rate card</dt>
            <dd>{rate?.label}</dd>
          </div>
          <div>
            <dt>Weight</dt>
            <dd>{tonsValue ? `${tonsValue} tons per load (estimate)` : "To be confirmed at the scale"}</dd>
          </div>
          <div>
            <dt>Visibility</dt>
            <dd>
              {visibility === "open"
                ? VISIBILITY_MODES.find(([value]) => value === visibilityMode)?.[1] ?? "Open network"
                : "Draft — team only"}
            </dd>
          </div>
          <div>
            <dt>Dispatch contact</dt>
            <dd>
              {dispatcher.name} · {dispatcher.phone}
            </dd>
          </div>
        </dl>
      ) : null}

      {error ? (
        <p className="host-form-feedback host-form-feedback--error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="host-builder-nav">
        <button
          className="host-btn host-btn--quiet"
          disabled={step === 0 || pending}
          onClick={() => setStep((current) => Math.max(0, current - 1))}
          type="button"
        >
          Back
        </button>
        {step < BUILDER_STEPS.length - 1 ? (
          <button
            className="host-btn"
            disabled={!stepReady[step]}
            onClick={() => setStep((current) => current + 1)}
            type="button"
          >
            Next
          </button>
        ) : (
          <button
            className="host-btn"
            disabled={pending || stepReady.some((ready) => !ready)}
            onClick={publish}
            type="button"
          >
            {pending ? "Publishing…" : visibility === "open" ? "Publish to the network" : "Save draft"}
          </button>
        )}
      </div>
    </article>
  )
}

// --- Direct offers -------------------------------------------------------------

export interface OfferableLoad {
  id: string
  title: string
  detail: string
}

export interface OfferPartner {
  id: string
  name: string
}

export interface SentDirectOffer {
  id: string
  loadTitle: string
  counterpartName: string
  status: string
  offeredTruckloads: number
  acceptedTruckloads: number
  remainingTruckloads: number
  expiresAt: string
  actionable: boolean
}

function RevokeDirectOfferButton({ directOfferId }: { directOfferId: string }) {
  const [confirming, setConfirming] = useState(false)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [revoked, setRevoked] = useState(false)

  if (revoked) return <span>Remaining invitation closed.</span>

  if (!confirming) {
    return (
      <button className="host-btn host-btn--quiet" onClick={() => setConfirming(true)} type="button">
        Close remaining invitation
      </button>
    )
  }

  return (
    <div>
      <p>Already confirmed trucks stay assigned. Close only the unclaimed truckloads?</p>
      <button
        className="host-btn host-btn--quiet"
        disabled={pending}
        onClick={() => {
          setError(null)
          startTransition(async () => {
            const result = await revokeDirectOfferAction({ directOfferId })

            if (result.ok) setRevoked(true)
            else setError(result.error ?? "The invitation could not be closed.")
          })
        }}
        type="button"
      >
        {pending ? "Closing…" : "Confirm close"}
      </button>
      <button className="host-btn host-btn--quiet" disabled={pending} onClick={() => setConfirming(false)} type="button">
        Keep it open
      </button>
      {error ? <p className="host-form-feedback host-form-feedback--error" role="alert">{error}</p> : null}
    </div>
  )
}

export function DirectOfferPanel({
  loads,
  partners,
  sentOffers
}: {
  loads: OfferableLoad[]
  partners: OfferPartner[]
  sentOffers: SentDirectOffer[]
}) {
  const [loadPostingId, setLoadPostingId] = useState(loads[0]?.id ?? "")
  const [partnerId, setPartnerId] = useState(partners[0]?.id ?? "")
  const [truckloads, setTruckloads] = useState("1")
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null)
  const [pending, startTransition] = useTransition()

  const count = Number.parseInt(truckloads, 10)
  const ready = Boolean(loadPostingId && partnerId) && Number.isInteger(count) && count > 0

  const send = () => {
    startTransition(async () => {
      setFeedback(null)

      const result = await createDirectOfferAction({
        loadPostingId,
        offeredToOrganizationId: partnerId,
        offeredTruckloads: count
      })
      const partner = partners.find((entry) => entry.id === partnerId)

      setFeedback(
        result.ok
          ? {
              ok: true,
              text: `Direct offer sent to ${partner?.name ?? "the partner"} for ${count} truckload${count === 1 ? "" : "s"}. Capacity remains open until each truck is accepted; the invitation expires in 3 days.`
            }
          : { ok: false, text: result.error ?? "The offer could not be sent." }
      )
    })
  }

  return (
    <div className="host-stack-form">
      {partners.length === 0 ? (
        <EmptyState
          body="Direct offers need an active private-network relationship. Once a partner outfit is connected, invite its trucks here."
          title="No active partners yet."
        />
      ) : loads.length === 0 ? (
        <EmptyState
          actionHref="/host/opportunities"
          actionLabel="Publish work"
          body="Publish open work first, then invite a trusted partner to assign trucks."
          title="No open work to offer."
        />
      ) : (
        <>
          <label>
            Open work
            <select onChange={(event) => setLoadPostingId(event.target.value)} value={loadPostingId}>
              {loads.map((load) => (
                <option key={load.id} value={load.id}>
                  {load.title} · {load.detail}
                </option>
              ))}
            </select>
          </label>
          <label>
            Partner
            <select onChange={(event) => setPartnerId(event.target.value)} value={partnerId}>
              {partners.map((partner) => (
                <option key={partner.id} value={partner.id}>
                  {partner.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Truckloads to invite
            <input
              inputMode="numeric"
              min="1"
              onChange={(event) => setTruckloads(event.target.value)}
              type="number"
              value={truckloads}
            />
          </label>
          <button className="host-btn" disabled={pending || !ready} onClick={send} type="button">
            {pending ? "Sending…" : "Send direct offer"}
          </button>
          {feedback ? (
            <p
              className={`host-form-feedback ${feedback.ok ? "host-form-feedback--success" : "host-form-feedback--error"}`}
              role={feedback.ok ? "status" : "alert"}
            >
              {feedback.text}
            </p>
          ) : null}
        </>
      )}
      {sentOffers.length > 0 ? (
        <div className="board-list" aria-label="Sent direct offers">
          {sentOffers.map((offer) => (
            <article className="trip-row" key={offer.id}>
              <div>
                <strong>{offer.loadTitle}</strong>
                <span>
                  {offer.counterpartName} · {offer.acceptedTruckloads} of {offer.offeredTruckloads} accepted · {formatHuman(offer.status)} · expires {formatDateTime(offer.expiresAt)}
                </span>
              </div>
              {offer.actionable && offer.remainingTruckloads > 0 ? (
                <RevokeDirectOfferButton directOfferId={offer.id} />
              ) : null}
            </article>
          ))}
        </div>
      ) : null}
    </div>
  )
}

// --- Operational notices ---------------------------------------------------------

export function NoticeComposer({ loads }: { loads: Array<{ id: string; title: string }> }) {
  const [title, setTitle] = useState("")
  const [body, setBody] = useState("")
  const [severity, setSeverity] = useState<"info" | "watch" | "critical">("watch")
  const [relatedLoadId, setRelatedLoadId] = useState("")
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null)
  const [pending, startTransition] = useTransition()

  const ready = title.trim().length > 0 && body.trim().length > 0

  const publishNotice = () => {
    startTransition(async () => {
      setFeedback(null)

      const result = await createOperationalNoticeAction({
        body: body.trim(),
        relatedLoadId: relatedLoadId || null,
        severity,
        title: title.trim()
      })

      if (result.ok) {
        setFeedback({
          ok: true,
          text: relatedLoadId
            ? "Notice published. Drivers working the related load are notified."
            : "Notice published. It now shows in the attention feed for your operation."
        })
        setTitle("")
        setBody("")
        setRelatedLoadId("")
      } else {
        setFeedback({ ok: false, text: result.error ?? "The notice could not be published." })
      }
    })
  }

  return (
    <div className="host-stack-form">
      <label>
        Headline
        <input
          onChange={(event) => setTitle(event.target.value)}
          placeholder="e.g. Bridge control active after mile 18"
          type="text"
          value={title}
        />
      </label>
      <label>
        What crews need to know
        <textarea
          onChange={(event) => setBody(event.target.value)}
          placeholder="Say what changed, where, and what drivers should do about it."
          value={body}
        />
      </label>
      <label>
        Severity
        <select
          onChange={(event) => setSeverity(event.target.value as "info" | "watch" | "critical")}
          value={severity}
        >
          <option value="info">Info — good to know</option>
          <option value="watch">Watch — plan around it</option>
          <option value="critical">Critical — act now</option>
        </select>
      </label>
      <label>
        Related work (optional)
        <select onChange={(event) => setRelatedLoadId(event.target.value)} value={relatedLoadId}>
          <option value="">Whole operation</option>
          {loads.map((load) => (
            <option key={load.id} value={load.id}>
              {load.title}
            </option>
          ))}
        </select>
      </label>
      <button className="host-btn" disabled={pending || !ready} onClick={publishNotice} type="button">
        {pending ? "Publishing…" : "Publish notice"}
      </button>
      {feedback ? (
        <p
          className={`host-form-feedback ${feedback.ok ? "host-form-feedback--success" : "host-form-feedback--error"}`}
          role={feedback.ok ? "status" : "alert"}
        >
          {feedback.text}
        </p>
      ) : null}
    </div>
  )
}
