"use client"

import { useMemo, useState, useTransition } from "react"

import {
  approveCapacityRequestAction,
  cancelAssignmentAction,
  closeLoadAction,
  createDirectOfferAction,
  createLoadPostingAction,
  createOperationalNoticeAction,
  publishDraftAction
} from "@/lib/cockpit-actions"
import type { HostPublishingOptions, RequirementOption } from "@/lib/host-data"
import { formatHuman, humanizeTag } from "@/lib/v3-shared"
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
  const [pending, startTransition] = useTransition()
  const [decision, setDecision] = useState<"approve" | "decline" | null>(null)
  const [error, setError] = useState<string | null>(null)

  const decide = (approve: boolean) => {
    startTransition(async () => {
      setError(null)
      setDecision(approve ? "approve" : "decline")

      const result = await approveCapacityRequestAction({ approve, assignmentId: request.assignmentId })

      if (!result.ok) {
        setDecision(null)
        setError(result.error ?? "That decision did not go through. Try again.")
      }
    })
  }

  return (
    <div className="host-approval-row">
      <strong>{request.driverName}</strong>
      <span>
        {request.truckUnit} · {request.loadTitle} · {request.scheduleLabel}
      </span>
      <div className="host-approval-actions">
        <button className="host-btn" disabled={pending} onClick={() => decide(true)} type="button">
          {pending && decision === "approve" ? "Approving…" : "Approve"}
        </button>
        <button className="host-btn host-btn--quiet" disabled={pending} onClick={() => decide(false)} type="button">
          {pending && decision === "decline" ? "Declining…" : "Decline"}
        </button>
      </div>
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
  const [visibility, setVisibility] = useState<BuilderVisibility>("open")
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
            : `Your workspace still needs ${missingSetup.join(", ")} on file before work can be published. These records come from onboarding — contact LogLoads support to add them.`}
        </p>
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
    Boolean(rate),
    true,
    true
  ]

  const publish = () => {
    if (!route || !rate || !landing) {
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
        setVisibility("open")
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
        <div className="host-choice host-step">
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
            <dt>Terms</dt>
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

export function DirectOfferPanel({ loads, partners }: { loads: OfferableLoad[]; partners: OfferPartner[] }) {
  const [loadPostingId, setLoadPostingId] = useState(loads[0]?.id ?? "")
  const [partnerId, setPartnerId] = useState(partners[0]?.id ?? "")
  const [truckloads, setTruckloads] = useState("1")
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null)
  const [pending, startTransition] = useTransition()

  if (partners.length === 0) {
    return (
      <EmptyState
        body="Direct offers need an active private-network relationship. Once a partner outfit is connected, reserve truckloads for them here."
        title="No active partners yet."
      />
    )
  }

  if (loads.length === 0) {
    return (
      <EmptyState
        actionHref="/host/opportunities"
        actionLabel="Publish work"
        body="Publish open work first, then hold truckloads on it for a trusted partner."
        title="No open work to offer."
      />
    )
  }

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
              text: `Direct offer sent: ${count} truckload${count === 1 ? "" : "s"} held for ${partner?.name ?? "the partner"}. The offer stays open for 3 days.`
            }
          : { ok: false, text: result.error ?? "The offer could not be sent." }
      )
    })
  }

  return (
    <div className="host-stack-form">
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
        Truckloads to hold
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
