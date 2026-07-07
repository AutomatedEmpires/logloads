"use client"

import { useMemo, useState, useTransition } from "react"

import {
  approveCapacityRequestAction,
  createDirectOfferAction,
  createLoadPostingAction,
  createOperationalNoticeAction
} from "@/lib/cockpit-actions"
import type { HostPublishingOptions } from "@/lib/host-data"
import { formatHuman } from "@/lib/v3-shared"
import { EmptyState } from "./Shells"

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
  const [landingId, setLandingId] = useState(options.landings[0]?.id ?? "")
  const [routeId, setRouteId] = useState("")
  const [truckloads, setTruckloads] = useState("2")
  const [loadDate, setLoadDate] = useState(defaultLoadDate)
  const [rateId, setRateId] = useState(options.rates[0]?.id ?? "")
  const [visibility, setVisibility] = useState<BuilderVisibility>("open")
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

  const stepReady = [
    title.trim().length > 0,
    Boolean(landing && route),
    Number.isInteger(truckloadCount) && truckloadCount > 0 && /^\d{4}-\d{2}-\d{2}$/.test(loadDate),
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

      const result = await createLoadPostingAction({
        accessRequirements: [],
        campaignEndDate: null,
        campaignStartDate: null,
        dailyTruckCountNeeded: truckloadCount,
        dispatcherContact: {
          email: dispatcher.email,
          name: dispatcher.name,
          phone: dispatcher.phone
        },
        dispatcherProfileId: dispatcher.id,
        dropoffMillId: route.millId,
        equipmentRequirements: [],
        estimatedTonsPerLoad: tonsValue && tonsValue > 0 ? tonsValue : null,
        loadDate,
        loadType,
        loaderContact: null,
        loaderProfileId: null,
        pickupLandingId: landing.id,
        rateId: rate.id,
        recurringSchedule: null,
        roadCondition: route.roadCondition,
        routeId: route.id,
        scheduleType: "one_off",
        status: visibility === "open" ? "open" : "draft",
        title: title.trim(),
        weatherNotes: null
      })

      if (result.ok) {
        setPublished({ title: title.trim(), visibility })
        setStep(0)
        setTitle("")
        setTons("")
        setRouteId("")
        setTruckloads("2")
        setLoadDate(defaultLoadDate())
        setVisibility("open")
      } else {
        setError(result.error ?? "Publishing failed. Check the details and try again.")
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
              <span>Road {formatHuman(route.roadCondition)}</span>
            </div>
          ) : null}
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
            Load date
            <input onChange={(event) => setLoadDate(event.target.value)} type="date" value={loadDate} />
          </label>
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
        <div className="host-choice host-step">
          <label>
            <input
              checked={visibility === "open"}
              name="host-visibility"
              onChange={() => setVisibility("open")}
              type="radio"
            />
            <span>
              <strong>Open network</strong>
              <span>
                Any hauling organization on LogLoads can see this work, and it appears on the public loads board.
                Exact landing access still unlocks only after you approve an assignment.
              </span>
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
              <span>
                Stays inside your workspace until you open it. To steer open work toward trusted partners, send a
                direct offer from the Carriers page.
              </span>
            </span>
          </label>
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
              {truckloadCount} truckload{truckloadCount === 1 ? "" : "s"} per day on {loadDate}
            </dd>
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
            <dd>{visibility === "open" ? "Open network" : "Draft — team only"}</dd>
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
