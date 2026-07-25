"use client"

import Link from "next/link"
import Image from "next/image"
import { useRouter } from "next/navigation"
import { useState, useTransition, type FormEvent } from "react"
import { PRE_TRIP_INSPECTION_CHECKLIST } from "@logloads/contracts"
import { Badge, Icon } from "@logloads/ui"

import {
  addEquipmentAction,
  attachTripDocumentAction,
  cancelAssignmentAction,
  featureTruckPhotoAction,
  progressTripAction,
  recordPreTripInspectionAction,
  requestCapacityAction,
  saveDriverMediaAction,
  submitHaulCompletionAction,
  updateDriverAvailabilityAction,
  updateDriverEconomicsAction,
  updateEquipmentStatusAction
} from "@/lib/cockpit-actions"
import type { NetworkLoadView, NetworkView } from "@/lib/network"
import { signOutAction } from "@/lib/session-actions"

type TripStatus = NetworkView["trips"][number]["status"]
type CompletionStatus = NetworkView["trips"][number]["completion"]["status"]

const TRIP_STEPS: Partial<Record<TripStatus, { label: string; next: TripStatus }>> = {
  assigned: { label: "Head to landing", next: "en_route_to_landing" },
  at_destination: { label: "Start unloading", next: "unloading" },
  checked_in: { label: "Start loading", next: "loading" },
  en_route_to_destination: { label: "Arrived at mill", next: "at_destination" },
  en_route_to_landing: { label: "Arrived at landing", next: "checked_in" },
  loaded: { label: "Head to mill", next: "en_route_to_destination" },
  loading: { label: "Confirm loaded", next: "loaded" },
  unloading: { label: "Finish trip", next: "completed" }
}

/**
 * The label of the control `TripProgressButton` will actually render for this
 * trip, or null when the pre-trip gate owns the state.
 *
 * Exported so surrounding copy ("Next step: …") cannot contradict the button
 * sitting beside it. `tripActionLabel` is the wrong source for an instruction:
 * it names the current leg, so `en_route_to_landing` reads "Head to landing"
 * while the button performs "Arrived at landing".
 */
export function nextFieldStepLabel(
  status: TripStatus,
  completionStatus: CompletionStatus,
  inspectionPassed = false
): string | null {
  if (status === "assigned") {
    // A recorded pass clears the gate, so the haul can simply start; the
    // control agrees, which is why this is not "re-run the inspection".
    return inspectionPassed ? TRIP_STEPS.assigned?.label ?? null : null
  }

  const step = TRIP_STEPS[status]

  if (!step) {
    return null
  }

  if (step.next === "completed" && completionStatus === "pending") {
    return "Record the delivery before finishing this trip"
  }

  return step.label
}

/** The single next field action for a trip, wired to the real trip state machine. */
export function TripProgressButton({
  completionStatus,
  inspectionPassed = false,
  status,
  tone = "row",
  tripId
}: {
  completionStatus: CompletionStatus
  inspectionPassed?: boolean
  status: TripStatus
  tone?: "hero" | "row"
  tripId: string
}) {
  const step = TRIP_STEPS[status]
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  // Rolling starts with the walk-around. The service refuses the transition
  // without a passing recorded inspection, so this panel is the paved path,
  // not the enforcement.
  // A pass is already recorded, so the gate is clear and the haul just starts.
  // Without this the driver would be asked to re-run an inspection they have
  // already passed — and the instruction above the button would say so too.
  if (status === "assigned" && !inspectionPassed) {
    return <PreTripRollControl tone={tone} tripId={tripId} />
  }

  if (!step) {
    return null
  }

  if (step.next === "completed" && completionStatus === "pending") {
    return (
      <div className={`trip-advance trip-advance--${tone}`}>
        <button className="advance-button" disabled type="button">Finish trip</button>
        <p className="action-note" role="note">Record the delivery before finishing this trip.</p>
      </div>
    )
  }

  const advance = () => {
    setError(null)
    startTransition(async () => {
      try {
        const result = await progressTripAction({ nextStatus: step.next, tripId })

        if (!result.ok) {
          setError(result.error ?? "The trip could not be updated. Try again.")
        }
      } catch {
        setError("The trip could not be updated. Check your connection and try again.")
      }
    })
  }

  return (
    <div className={`trip-advance trip-advance--${tone}`}>
      <button className="advance-button" disabled={pending} onClick={advance} type="button">
        {pending ? "Updating…" : step.label}
      </button>
      {error ? <p className="action-error" role="alert">{error}</p> : null}
    </div>
  )
}

type InspectionAnswer = { status: "pass" | "fail"; note: string }

/**
 * The DVIR-style walk-around gate on the one button that starts a haul.
 * The button opens the checklist; every item is answered pass or fail, a fail
 * says what the driver found, and the record is written before the truck
 * moves. A fail is recorded too — the truck goes to the shop and dispatch
 * hears about it rather than the app pretending nothing happened.
 *
 * It is labelled for what the tap actually does. It used to read "Head to
 * landing" while the surface above it told the driver to complete a pre-trip
 * inspection: one tap, two names, and the driver had to discover that the
 * roll button was also the inspection button.
 */
function PreTripRollControl({ tone, tripId }: { tone: "hero" | "row"; tripId: string }) {
  const [open, setOpen] = useState(false)
  const [answers, setAnswers] = useState<Record<string, InspectionAnswer>>({})
  const [error, setError] = useState<string | null>(null)
  const [failRecorded, setFailRecorded] = useState(false)
  const [pending, startTransition] = useTransition()

  if (failRecorded) {
    return (
      <p className="action-note" role="status">
        Inspection recorded. Your truck is marked In shop and dispatch has been
        notified — fix what failed, set the truck back to Ready, and re-inspect
        before rolling.
      </p>
    )
  }

  if (!open) {
    return (
      <div className={`trip-advance trip-advance--${tone}`}>
        <button className="advance-button" onClick={() => setOpen(true)} type="button">
          Start pre-trip inspection
        </button>
      </div>
    )
  }

  const answerFor = (key: string): InspectionAnswer | null => answers[key] ?? null
  const allAnswered = PRE_TRIP_INSPECTION_CHECKLIST.every((item) => {
    const answer = answerFor(item.key)

    return answer !== null && (answer.status === "pass" || answer.note.trim().length > 0)
  })
  const anyFail = PRE_TRIP_INSPECTION_CHECKLIST.some((item) => answerFor(item.key)?.status === "fail")

  const submit = () => {
    setError(null)
    startTransition(async () => {
      const items = PRE_TRIP_INSPECTION_CHECKLIST.map((item) => ({
        key: item.key,
        note: answers[item.key]?.note.trim() || null,
        status: answers[item.key]?.status ?? ("fail" as const)
      }))
      // One action records AND rolls: the server does both in one mutation,
      // so a dropped connection can never leave a passed inspection on a
      // truck that silently stayed parked.
      const recorded = await recordPreTripInspectionAction({ items, rollOnPass: true, tripId })

      if (!recorded.ok) {
        setError(recorded.error ?? "The inspection could not be recorded. Try again.")

        return
      }

      if (recorded.outcome === "fail") {
        setFailRecorded(true)
      }
    })
  }

  return (
    <div aria-label="Pre-trip inspection" className={`pre-trip pre-trip--${tone}`} role="group">
      <p className="pre-trip__title">Pre-trip walk-around — answer every item before rolling.</p>
      {PRE_TRIP_INSPECTION_CHECKLIST.map((item) => {
        const answer = answerFor(item.key)

        return (
          <div className="pre-trip__item" key={item.key}>
            <span className="pre-trip__label">{item.label}</span>
            <div className="pre-trip__choices">
              <button
                aria-pressed={answer?.status === "pass"}
                className="pre-trip__pass"
                disabled={pending}
                onClick={() => setAnswers((current) => ({ ...current, [item.key]: { note: "", status: "pass" } }))}
                type="button"
              >
                Pass
              </button>
              <button
                aria-pressed={answer?.status === "fail"}
                className="pre-trip__fail"
                disabled={pending}
                onClick={() =>
                  setAnswers((current) => ({
                    ...current,
                    [item.key]: { note: current[item.key]?.note ?? "", status: "fail" }
                  }))
                }
                type="button"
              >
                Fail
              </button>
            </div>
            {answer?.status === "fail" ? (
              <label>
                <span className="sr-only">{`What failed for ${item.label}`}</span>
                <input
                  maxLength={300}
                  onChange={(event) =>
                    setAnswers((current) => ({
                      ...current,
                      [item.key]: { note: event.target.value, status: "fail" }
                    }))
                  }
                  placeholder="What did you find?"
                  type="text"
                  value={answer.note}
                />
              </label>
            ) : null}
          </div>
        )
      })}
      <div className="pre-trip__actions">
        <button className="advance-button" disabled={pending || !allAnswered} onClick={submit} type="button">
          {pending ? "Recording…" : anyFail ? "Record inspection" : "Record & roll"}
        </button>
        <button className="cancel-haul__keep" disabled={pending} onClick={() => setOpen(false)} type="button">
          Not yet
        </button>
      </div>
      {error ? <p className="action-error" role="alert">{error}</p> : null}
    </div>
  )
}

const ASSIGNMENT_STATE: Record<string, { badge: string; body: string; tone: "success" | "warning" | "info" }> = {
  accepted: { badge: "You're booked", body: "This haul is yours. Exact access is unlocked and your next action is in Schedule.", tone: "success" },
  checked_in: { badge: "At the landing", body: "You are checked in. Open Schedule when loading begins.", tone: "success" },
  hauled: { badge: "Hauled", body: "Open Schedule to finish the delivery record.", tone: "success" },
  loading: { badge: "Loading", body: "Loading is underway. Confirm loaded from Schedule when the wood is on.", tone: "success" },
  offered: { badge: "Offered to you", body: "This host invited you to the haul. Review the details before you commit.", tone: "info" },
  requested: { badge: "Request sent", body: "The host is deciding. We will notify you as soon as you are booked or not selected.", tone: "warning" }
}

/** Sticky decision panel for the load detail page: request, requested, or filled. */
export function RequestCapacityPanel({ load }: { load: NetworkLoadView }) {
  const [error, setError] = useState<string | null>(null)
  const [requested, setRequested] = useState(false)
  // null means "whatever the load offers as earliest" — the driver has not
  // overridden it. Storing the default explicitly would go stale if the
  // earliest slot fills while this panel is open.
  const [chosenSlotId, setChosenSlotId] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  if (load.viewerAssignment) {
    const state = ASSIGNMENT_STATE[load.viewerAssignment.status] ?? {
      badge: "On this load",
      body: "Your organization holds an assignment on this load.",
      tone: "info" as const
    }

    return (
      <div className="request-panel">
        <Badge tone={state.tone}>{state.badge}</Badge>
        <p>{state.body}</p>
        <div className="request-links">
          <Link className="action-link" href="/driver/schedule">Open Schedule</Link>
          <Link className="action-link action-link--secondary" href="/driver/messages">Message the host</Link>
        </div>
      </div>
    )
  }

  if (requested) {
    return (
      <div className="request-panel">
        <Badge tone="warning">Request sent</Badge>
        <strong>
          {load.allocationMode === "request_approval"
            ? "The host is deciding."
            : "The host is confirming your haul."}
        </strong>
        <p>We will notify you when the decision is made. Track this request in Schedule.</p>
        <div className="request-links">
          <Link className="action-link" href="/driver/schedule">View Schedule</Link>
          <Link className="action-link action-link--secondary" href="/driver/loads">Find another load</Link>
        </div>
      </div>
    )
  }

  if (load.allocationMode !== "request_approval") {
    const directOffer = load.allocationMode === "direct_offer"

    return (
      <div className="request-panel">
        <Badge tone="info">{directOffer ? "Invite only" : "Dispatch assigned"}</Badge>
        <strong>{directOffer ? "The host sends this haul directly." : "A dispatcher assigns this haul."}</strong>
        <p>This load is visible for planning, but it is not open for driver requests.</p>
        <Link className="action-link action-link--secondary" href="/driver/loads">Find requestable loads</Link>
      </div>
    )
  }

  // Guards a stale CLIENT selection only: if a re-render drops the chosen slot
  // from the list, fall back to the earliest rather than submitting an id that
  // is no longer offered. It does not and cannot detect a slot filling
  // server-side without a re-render — there is no tap-time refetch, so that
  // request is sent and the service refuses it. The service is the authority
  // on capacity; this just avoids submitting something the page itself has
  // already stopped showing.
  const selectable = load.slots.selectable
  const slotId = selectable.some((slot) => slot.id === chosenSlotId)
    ? chosenSlotId
    : load.slots.requestableSlotId
  const chosenWindow = selectable.find((slot) => slot.id === slotId)?.window ?? load.slots.nextWindow

  if (load.capacity.remaining <= 0 || !slotId) {
    return (
      <div className="request-panel">
        <Badge tone={load.viewerDecision ? "info" : "warning"}>{load.viewerDecision ? "Not selected" : "Capacity filled"}</Badge>
        <strong>All {load.capacity.total} loads are committed.</strong>
        <p>
          {load.viewerDecision
            ? "The host chose another truck for this window. Find another open load now; this one can reopen if a truck drops."
            : "If a truck drops, the host reopens capacity here first. Keep your availability current so new work finds you."}
        </p>
        <div className="request-links">
          <Link className="action-link" href="/driver/messages">Message the host</Link>
          <Link className="action-link action-link--secondary" href="/driver/profile">Update availability</Link>
        </div>
      </div>
    )
  }

  const request = () => {
    setError(null)
    startTransition(async () => {
      const result = await requestCapacityAction({ loadPostingId: load.id, truckSlotId: slotId })

      if (!result.ok) {
        setError(result.error ?? "The request could not be sent. Try again.")
      } else {
        setRequested(true)
      }
    })
  }

  return (
    <div className="request-panel">
      <Badge tone={load.viewerDecision ? "info" : "success"}>{load.viewerDecision ? "Not selected before" : "Capacity open"}</Badge>
      <strong>{load.viewerDecision ? "This haul is open again" : "Request this haul"}</strong>
      {load.viewerDecision ? <p>{load.viewerDecision.reason ?? "The host selected another truck for the earlier request."}</p> : null}
      <div className="request-panel__meta">
        <span>{load.capacity.remaining} of {load.capacity.total} loads open</span>
        <span>{selectable.length > 1 ? "Your slot" : "Next window"}: {chosenWindow}</span>
      </div>
      {/* One posting can be a series of runs, so the driver picks which one
          they are taking. With a single slot there is no choice to make and a
          radio group would be a control that decides nothing. */}
      {selectable.length > 1 ? (
        <fieldset className="slot-picker">
          <legend>Which run are you taking?</legend>
          {selectable.map((slot) => (
            <label className="slot-picker__option" key={slot.id}>
              <input
                checked={slot.id === slotId}
                name={`slot-${load.id}`}
                onChange={() => setChosenSlotId(slot.id)}
                type="radio"
                value={slot.id}
              />
              <span className="slot-picker__window">{slot.window}</span>
              <em className="slot-picker__remaining">
                {slot.remaining} {slot.remaining === 1 ? "load" : "loads"} open
              </em>
            </label>
          ))}
        </fieldset>
      ) : null}
      <p>Exact access and the Route Pack unlock after the host accepts.</p>
      <button className="advance-button" disabled={pending} onClick={request} type="button">
        {pending ? "Sending request…" : load.viewerDecision ? "Request again" : "Request haul"}
      </button>
      {error ? <p className="action-error" role="alert">{error}</p> : null}
    </div>
  )
}

const CANCEL_COPY = {
  haul: {
    confirm: "Yes, cancel the haul",
    done: "Haul cancelled. The host has been notified and the truckload is open again.",
    prompt: "Cancel this haul? The host is notified and the truckload reopens for other drivers.",
    trigger: "Cancel haul"
  },
  request: {
    confirm: "Yes, withdraw it",
    done: "Request withdrawn. The truckload is open for other drivers.",
    prompt: "Withdraw this request? The host will see the truckload as open again.",
    trigger: "Withdraw request"
  }
} as const

/**
 * Two-step cancel so a pocket tap can't kill a booked haul: a quiet trigger,
 * then an explicit confirmation with an optional reason the host will see.
 */
export function CancelHaulControl({ assignmentId, kind }: { assignmentId: string; kind: keyof typeof CANCEL_COPY }) {
  const copy = CANCEL_COPY[kind]
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [reason, setReason] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [pending, startTransition] = useTransition()

  if (done) {
    return <p className="action-note">{copy.done}</p>
  }

  if (!confirming) {
    return (
      <button className="cancel-haul__trigger" onClick={() => setConfirming(true)} type="button">
        {copy.trigger}
      </button>
    )
  }

  const cancel = () => {
    setError(null)
    startTransition(async () => {
      const result = await cancelAssignmentAction({ assignmentId, reason: reason.trim() || null })

      if (!result.ok) {
        setError(result.error ?? "The haul could not be cancelled. Try again.")
      } else {
        setDone(true)
        // Keep the success copy on screen if a field connection drops while
        // the fresh server projection is loading. A router refresh can remove
        // the active card when online without throwing away the usable page.
        router.refresh()
      }
    })
  }

  return (
    <div aria-label={copy.prompt} className="cancel-haul" role="group">
      <p>{copy.prompt}</p>
      <label>
        <span className="sr-only">Reason the host sees (optional)</span>
        <input
          maxLength={140}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Reason (optional)"
          type="text"
          value={reason}
        />
      </label>
      <div className="cancel-haul__actions">
        <button className="cancel-haul__confirm" disabled={pending} onClick={cancel} type="button">
          {pending ? "Cancelling…" : copy.confirm}
        </button>
        <button
          className="cancel-haul__keep"
          disabled={pending}
          onClick={() => {
            setError(null)
            setConfirming(false)
          }}
          type="button"
        >
          Keep it
        </button>
      </div>
      {error ? <p className="action-error" role="alert">{error}</p> : null}
    </div>
  )
}

type AvailabilityPreset = "today" | "three_days" | "unavailable"

const PRESET_CONFIRMATION: Record<AvailabilityPreset, string> = {
  three_days: "Availability posted for the next 3 days.",
  today: "Availability posted for today.",
  unavailable: "Marked unavailable for the rest of today."
}

/** One-tap availability presets wired to the real availability window store. */
export function AvailabilityQuickSet({
  currentStatus,
  currentWindow,
  hasDriverProfile
}: {
  currentStatus: string | null
  currentWindow: string | null
  hasDriverProfile: boolean
}) {
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  if (!hasDriverProfile) {
    return (
      <p className="muted">
        Availability updates need a driver record on your account. Ask your organization admin to add you as a driver.
      </p>
    )
  }

  const apply = (preset: AvailabilityPreset) => {
    const now = new Date()
    const endOfDay = new Date(now)

    endOfDay.setHours(23, 59, 0, 0)

    const rawEnd = preset === "three_days" ? new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000) : endOfDay
    const end = rawEnd.getTime() - now.getTime() < 60 * 60 * 1000 ? new Date(now.getTime() + 12 * 60 * 60 * 1000) : rawEnd

    setError(null)
    setSaved(null)
    startTransition(async () => {
      const result = await updateDriverAvailabilityAction({
        endAt: end.toISOString(),
        startAt: now.toISOString(),
        status: preset === "unavailable" ? "unavailable" : "available"
      })

      if (!result.ok) {
        setError(
          result.error?.includes("overlaps")
            ? "This period overlaps a window you already posted. Your existing availability still stands."
            : result.error ?? "Availability could not be updated."
        )
      } else {
        setSaved(PRESET_CONFIRMATION[preset])
      }
    })
  }

  return (
    <div className="quickset-block">
      <p className="availability-now">
        <Icon aria-hidden name="load.schedule" size={18} />
        {currentStatus ? (
          <span>Now: {currentStatus.replaceAll("_", " ")}{currentWindow ? ` · ${currentWindow}` : ""}</span>
        ) : (
          <span>No availability posted for right now.</span>
        )}
      </p>
      <div className="quickset">
        <button disabled={pending} onClick={() => apply("today")} type="button">Available today</button>
        <button disabled={pending} onClick={() => apply("three_days")} type="button">Next 3 days</button>
        <button disabled={pending} onClick={() => apply("unavailable")} type="button">Unavailable today</button>
      </div>
      {pending ? <p className="muted">Saving…</p> : null}
      {saved ? <p className="action-note">{saved}</p> : null}
      {error ? <p className="action-error" role="alert">{error}</p> : null}
    </div>
  )
}

export function DriverEconomicsForm({
  currentFuelEconomyMpg,
  currentFuelPriceCentsPerGallon
}: {
  currentFuelEconomyMpg: number | null
  currentFuelPriceCentsPerGallon: number | null
}) {
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [pending, startTransition] = useTransition()

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const fuelEconomyMpg = Number(data.get("fuelEconomyMpg"))
    const fuelPrice = Number(data.get("fuelPrice"))

    setError(null)
    setSaved(false)
    startTransition(async () => {
      const result = await updateDriverEconomicsAction({
        fuelEconomyMpg,
        fuelPriceCentsPerGallon: Math.round(fuelPrice * 100)
      })

      if (!result.ok) {
        setError(result.error ?? "Fuel assumptions could not be saved.")
      } else {
        setSaved(true)
      }
    })
  }

  return (
    <form className="equipment-form" onSubmit={submit}>
      <label>
        Truck fuel economy (MPG)
        <input defaultValue={currentFuelEconomyMpg ?? 6.5} inputMode="decimal" max="15" min="3" name="fuelEconomyMpg" required step="0.1" type="number" />
      </label>
      <label>
        Diesel price per gallon
        <input defaultValue={((currentFuelPriceCentsPerGallon ?? 425) / 100).toFixed(2)} inputMode="decimal" max="10" min="1" name="fuelPrice" required step="0.01" type="number" />
      </label>
      <div className="equipment-form__actions">
        <button className="advance-button" disabled={pending} type="submit">{pending ? "Saving…" : "Save fuel assumptions"}</button>
        {saved ? <p className="action-note">Fuel estimates now use your truck and diesel price.</p> : null}
        {error ? <p className="action-error" role="alert">{error}</p> : null}
      </div>
    </form>
  )
}

interface SignedUploadResponse {
  apiKey: string
  parameters: Record<string, string | number>
  signature: string
  uploadUrl: string
}

/**
 * Reads a JSON body without letting a non-JSON one become the error the user
 * reads. Gateways and crashed functions answer with HTML; the caller's own
 * status check is what should decide the message.
 */
async function readJson<T>(response: Response): Promise<T | null> {
  try {
    return await response.json() as T
  } catch {
    return null
  }
}

export function MediaUpload({
  available,
  hasCurrent,
  kind,
  label
}: {
  available: boolean
  hasCurrent: boolean
  kind: "profile" | "truck" | "trailer"
  label: string
}) {
  const [error, setError] = useState<string | null>(null)
  const [photoAvailable, setPhotoAvailable] = useState(hasCurrent)
  const [cacheBust, setCacheBust] = useState(0)
  const [pending, startTransition] = useTransition()

  const upload = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    const file = new FormData(form).get("photo")

    if (!(file instanceof File) || file.size === 0) {
      setError("Choose a photo first.")
      return
    }

    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError("Use a JPG, PNG, or WebP photo.")
      return
    }

    if (file.size > 10_000_000) {
      setError("Photos must be 10 MB or smaller.")
      return
    }

    setError(null)
    startTransition(async () => {
      try {
        const signatureResponse = await fetch("/api/media/signature", {
          body: JSON.stringify({ kind }),
          headers: { "Content-Type": "application/json" },
          method: "POST"
        })
        const signature = await signatureResponse.json() as SignedUploadResponse & { error?: string }

        if (!signatureResponse.ok) {
          throw new Error(signature.error ?? "Photo uploads are not available yet.")
        }

        const uploadBody = new FormData()
        uploadBody.append("file", file)
        uploadBody.append("api_key", signature.apiKey)
        uploadBody.append("signature", signature.signature)
        for (const [key, value] of Object.entries(signature.parameters)) {
          uploadBody.append(key, String(value))
        }

        const cloudResponse = await fetch(signature.uploadUrl, { body: uploadBody, method: "POST" })
        const cloudAsset = await cloudResponse.json() as { error?: { message?: string }; public_id?: string }

        if (!cloudResponse.ok || !cloudAsset.public_id) {
          throw new Error(cloudAsset.error?.message ?? "The photo could not be uploaded.")
        }

        const saved = await saveDriverMediaAction({ kind, publicId: cloudAsset.public_id })

        if (!saved.ok) {
          throw new Error(saved.error ?? "The uploaded photo could not be attached to your profile.")
        }

        setPhotoAvailable(true)
        setCacheBust(Date.now())
        form.reset()
      } catch (uploadError) {
        setError(uploadError instanceof Error ? uploadError.message : "The photo could not be uploaded.")
      }
    })
  }

  return (
    <article className="media-upload-card">
      {available && photoAvailable ? (
        <Image alt={`${label} photo`} className="media-upload-card__image" height={360} src={`/api/media/asset?kind=${kind}&v=${cacheBust}`} unoptimized width={480} />
      ) : (
        <div className="media-upload-card__placeholder"><Icon aria-hidden name="ops.document" size={24} /> {photoAvailable ? "Photo on file · preview unavailable" : "No photo yet"}</div>
      )}
      {available ? <form onSubmit={upload}>
        <label>
          {label}
          <input accept="image/jpeg,image/png,image/webp" name="photo" required type="file" />
        </label>
        <button className="action-link action-link--secondary" disabled={pending} type="submit">{pending ? "Uploading…" : photoAvailable ? "Replace photo" : "Upload photo"}</button>
      </form> : (
        <p className="action-note" role="note">Photo uploads are currently unavailable.</p>
      )}
      {available ? <p>JPG, PNG, or WebP · 10 MB max · private to your authenticated account.</p> : null}
      {error ? <p className="action-error" role="alert">{error}</p> : null}
    </article>
  )
}

const PROOF_TYPES: Array<[string, string]> = [
  ["scale_ticket", "Scale ticket"],
  ["photo", "Photo"],
  ["delivery_record", "Delivery record"]
]

/**
 * Attaches proof of the haul: the file goes to Cloudinary under a signature
 * scoped to this trip, then the server reads the stored asset back and records
 * it. The evidence gate downstream trusts these records, so the record is only
 * written once the bytes are known to exist.
 */
export function LogProofControl({ available, tripId }: { available: boolean; tripId: string }) {
  const [type, setType] = useState("scale_ticket")
  const [error, setError] = useState<string | null>(null)
  const [logged, setLogged] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    const file = new FormData(form).get("proof")

    if (!(file instanceof File) || file.size === 0) {
      setError("Choose a photo of the ticket first.")
      return
    }

    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError("Use a JPG, PNG, or WebP photo.")
      return
    }

    if (file.size > 10_000_000) {
      setError("Photos must be 10 MB or smaller.")
      return
    }

    setError(null)
    setLogged(null)
    startTransition(async () => {
      try {
        const signatureResponse = await fetch("/api/trip-documents/signature", {
          body: JSON.stringify({ tripId }),
          headers: { "Content-Type": "application/json" },
          method: "POST"
        })
        // A crashed function or a gateway timeout answers with HTML, so parsing
        // before checking the status would put a JSON parser error in front of a
        // driver standing at a scale.
        const signature = await readJson<SignedUploadResponse & { error?: string }>(signatureResponse)

        if (!signatureResponse.ok || !signature) {
          throw new Error(signature?.error ?? "Proof uploads are not available right now.")
        }

        const uploadBody = new FormData()
        uploadBody.append("file", file)
        uploadBody.append("api_key", signature.apiKey)
        uploadBody.append("signature", signature.signature)
        for (const [key, value] of Object.entries(signature.parameters)) {
          uploadBody.append(key, String(value))
        }

        const cloudResponse = await fetch(signature.uploadUrl, { body: uploadBody, method: "POST" })
        const cloudAsset = await readJson<{ error?: { message?: string }; public_id?: string }>(cloudResponse)

        if (!cloudResponse.ok || !cloudAsset?.public_id) {
          throw new Error(cloudAsset?.error?.message ?? "The proof could not be uploaded.")
        }

        const result = await attachTripDocumentAction({
          filename: file.name,
          publicId: cloudAsset.public_id,
          tripId,
          type
        })

        if (!result.ok) {
          throw new Error(result.error ?? "The proof could not be attached to this trip.")
        }

        setLogged(file.name)
        form.reset()
      } catch (uploadError) {
        setError(uploadError instanceof Error ? uploadError.message : "The proof could not be uploaded.")
      }
    })
  }

  if (!available) {
    // A capability that is switched off is not good news: the muted tone keeps
    // it from reading as a success in the driver's green-means-go palette.
    // The delivery form only appears once the haul reaches a recordable state,
    // so this must not promise that recording is available now.
    return <p className="action-note action-note--muted" role="note">Photo proof is unavailable right now. Delivery details can be recorded when this haul reaches that step.</p>
  }

  return (
    <form className="proof-control" onSubmit={submit}>
      <label className="proof-control__type">
        <span className="sr-only">Proof type</span>
        <select onChange={(event) => setType(event.target.value)} value={type}>
          {PROOF_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <label className="proof-control__file">
        <span className="sr-only">Proof file</span>
        <input accept="image/jpeg,image/png,image/webp" name="proof" required type="file" />
      </label>
      <button className="proof-control__submit" disabled={pending} type="submit">
        <Icon aria-hidden name="ops.document" size={18} />
        {pending ? "Uploading…" : "Attach proof"}
      </button>
      <p className="proof-control__hint">JPG, PNG, or WebP · 10 MB max · visible to this haul only.</p>
      {logged ? <p className="action-note">{logged} attached to this trip.</p> : null}
      {error ? <p className="action-error" role="alert">{error}</p> : null}
    </form>
  )
}

const QUANTITY_UNITS: Array<[string, string]> = [
  ["tons", "Tons"],
  ["mbf", "MBF"],
  ["cords", "Cords"],
  ["units", "Units"],
  ["truckloads", "Truckloads"]
]

const EXCEPTION_TYPES: Array<[string, string]> = [
  ["", "No exception — the haul went as planned"],
  ["short_load", "Short load"],
  ["rejected_at_scale", "Rejected at the scale"],
  ["access_blocked", "Access blocked"],
  ["equipment_failure", "Equipment failure"],
  ["weather_hold", "Weather hold"],
  ["wait_time", "Excessive wait"],
  ["other", "Something else"]
]

/**
 * The driver's account of the haul: what came off the truck, and anything that
 * explains it. The host settles against this figure, so it is recorded before
 * the haul closes rather than reconstructed afterward.
 */
export function CompletionForm({
  completion,
  tripId
}: {
  completion: NetworkView["trips"][number]["completion"]
  tripId: string
}) {
  // Held as plain strings from the selects; the service parses both through zod.
  const [unit, setUnit] = useState<string>(completion.deliveredQuantity?.unit ?? "tons")
  const [exceptionType, setExceptionType] = useState<string>(completion.exception?.type ?? "")
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [pending, startTransition] = useTransition()

  if (completion.status === "confirmed") {
    const delivered = completion.deliveredQuantity

    return (
      <p className="action-note">
        <Icon aria-hidden name="status.verified" size={16} />{" "}
        {delivered ? `${delivered.value} ${delivered.unit} confirmed by the host.` : "Delivery confirmed by the host."}
      </p>
    )
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const rawValue = String(data.get("quantityValue") ?? "").trim()
    const note = String(data.get("exceptionNote") ?? "").trim()

    // A chosen exception with no note would otherwise be dropped silently and
    // the haul would record as clean — the opposite of what the driver said.
    if (exceptionType && !note) {
      setError("Say what happened, or set the exception back to none.")
      return
    }

    // "1e" and friends parse to NaN. Catch it here so the driver reads a
    // sentence rather than a schema error.
    if (rawValue !== "" && !Number.isFinite(Number(rawValue))) {
      setError("Enter the delivered amount as a number.")
      return
    }

    setError(null)
    setSaved(false)
    startTransition(async () => {
      try {
        const result = await submitHaulCompletionAction({
          exceptionNote: note || null,
          exceptionType: exceptionType || null,
          quantityUnit: unit,
          quantityValue: rawValue === "" ? null : Number(rawValue),
          ticketNumber: String(data.get("ticketNumber") ?? "").trim() || null,
          tripId
        })

        if (!result.ok) {
          setError(result.error ?? "The delivery could not be recorded. Try again.")
        } else {
          setSaved(true)
        }
      } catch {
        setError("The delivery could not be recorded. Check your connection and try again.")
      }
    })
  }

  return (
    <form className="completion-form" onSubmit={submit}>
      {completion.status === "disputed" && completion.disputeReason ? (
        <p className="action-error" role="alert">
          The host contests this record: {completion.disputeReason}
        </p>
      ) : null}
      {completion.requiredEvidence.length > 0 ? (
        <p className="completion-form__required">
          This haul needs: {completion.requiredEvidence.join("; ")}.{" "}
          {/* We know a proof record exists; we cannot know it is the right one.
              Say what is true and let the host check it. */}
          {completion.hasEvidence
            ? "A proof record is logged — the host checks it against this."
            : "Log the proof with the record control above before closing."}
        </p>
      ) : null}
      <div className="completion-form__row">
        <label>
          Delivered
          <input
            defaultValue={completion.deliveredQuantity?.value ?? ""}
            inputMode="decimal"
            min="0"
            name="quantityValue"
            step="0.1"
            type="number"
          />
        </label>
        <label>
          Unit
          <select onChange={(event) => setUnit(event.target.value)} value={unit}>
            {QUANTITY_UNITS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label>
          Ticket number
          <input
            defaultValue={completion.deliveredQuantity?.ticketNumber ?? ""}
            maxLength={60}
            name="ticketNumber"
            type="text"
          />
        </label>
      </div>
      <label>
        Exception
        <select onChange={(event) => setExceptionType(event.target.value)} value={exceptionType}>
          {EXCEPTION_TYPES.map(([value, label]) => <option key={value || "none"} value={value}>{label}</option>)}
        </select>
      </label>
      {exceptionType ? (
        <label>
          What happened
          <input
            defaultValue={completion.exception?.note ?? ""}
            maxLength={500}
            name="exceptionNote"
            placeholder="Say what the host needs to know."
            type="text"
          />
        </label>
      ) : null}
      <button className="advance-button" disabled={pending} type="submit">
        {pending ? "Recording…" : completion.status === "pending" ? "Record delivery" : "Update delivery"}
      </button>
      {saved ? <p className="action-note">Delivery recorded. The host will confirm it.</p> : null}
      {error ? <p className="action-error" role="alert">{error}</p> : null}
    </form>
  )
}

const TRUCK_TYPES: Array<[string, string]> = [
  ["log_truck", "Log truck"],
  ["chip_truck", "Chip truck"],
  ["service_truck", "Service truck"],
  ["lowboy", "Lowboy"],
  ["other", "Other"]
]

const TRAILER_TYPES: Array<[string, string]> = [
  ["", "No trailer / straight truck"],
  ["pole_trailer", "Pole trailer"],
  ["bunk_trailer", "Bunk trailer"],
  ["self_loader", "Self-loader"],
  ["flatbed", "Flatbed"],
  ["chip_van", "Chip van"],
  ["other", "Other"]
]

/** Real add-equipment form: creates a combination and assigns it to this driver. */
export function AddEquipmentForm() {
  const [error, setError] = useState<string | null>(null)
  const [savedLabel, setSavedLabel] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const form = event.currentTarget
    const data = new FormData(form)
    const label = String(data.get("label") ?? "").trim()
    const unitNumber = String(data.get("unitNumber") ?? "").trim()
    const truckType = String(data.get("truckType") ?? "log_truck")
    const trailerType = String(data.get("trailerType") ?? "")
    const maxPayloadTons = Number(data.get("maxPayloadTons") ?? 0)

    if (!label || !unitNumber) {
      setError("Give this combination a name and a unit number.")
      return
    }

    if (!Number.isFinite(maxPayloadTons) || maxPayloadTons <= 0) {
      setError("Enter the max payload in tons.")
      return
    }

    setError(null)
    setSavedLabel(null)
    startTransition(async () => {
      const result = await addEquipmentAction({
        assignToSelf: true,
        label,
        maxPayloadTons,
        trailerType: trailerType || null,
        truckType,
        unitNumber
      })

      if (!result.ok) {
        setError(result.error ?? "Equipment could not be added.")
      } else {
        setSavedLabel(label)
        form.reset()
      }
    })
  }

  return (
    <form className="equipment-form" onSubmit={submit}>
      <label>
        Combination name
        <input defaultValue="" name="label" placeholder="Kenworth + pole trailer" required type="text" />
      </label>
      <label>
        Unit number
        <input defaultValue="" name="unitNumber" placeholder="T-14" required type="text" />
      </label>
      <label>
        Truck type
        <select defaultValue="log_truck" name="truckType">
          {TRUCK_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <label>
        Trailer
        <select defaultValue="pole_trailer" name="trailerType">
          {TRAILER_TYPES.map(([value, label]) => <option key={value || "none"} value={value}>{label}</option>)}
        </select>
      </label>
      <label>
        Max payload (tons)
        <input defaultValue="30" inputMode="decimal" min="1" name="maxPayloadTons" required step="0.5" type="number" />
      </label>
      <div className="equipment-form__actions">
        <button className="advance-button" disabled={pending} type="submit">
          {pending ? "Adding…" : "Add equipment"}
        </button>
        {savedLabel ? <p className="action-note">{savedLabel} is in your garage and now powers matching.</p> : null}
        {error ? <p className="action-error" role="alert">{error}</p> : null}
      </div>
    </form>
  )
}

const EQUIPMENT_STATUSES: Array<[string, string]> = [
  ["available", "Available"],
  ["maintenance", "In shop"],
  ["inactive", "Parked"]
]

/** Per-combination status control wired to the equipment store. */
export function EquipmentStatusToggle({ combinationId, status }: { combinationId: string; status: string }) {
  const [error, setError] = useState<string | null>(null)
  const [consequence, setConsequence] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const setStatus = (next: string) => {
    if (next === status || pending) {
      return
    }

    setError(null)
    setConsequence(null)
    startTransition(async () => {
      const result = await updateEquipmentStatusAction({ combinationId, status: next })

      if (!result.ok) {
        setError(result.error ?? "Status could not be updated.")
      } else if (next === "maintenance" && (result.flaggedLoads ?? 0) > 0) {
        // Breakdowns happen mid-haul; the change goes through, and the driver
        // sees exactly what it set in motion rather than a silent success.
        setConsequence(
          result.flaggedLoads === 1
            ? "In shop recorded. Your active haul is flagged at risk and dispatch has been notified — reassignment is their call."
            : `In shop recorded. ${result.flaggedLoads} active hauls are flagged at risk and dispatch has been notified — reassignment is their call.`
        )
      }
    })
  }

  return (
    <div className="status-toggle-block">
      <div aria-label="Equipment status" className="status-toggle">
        {EQUIPMENT_STATUSES.map(([value, label]) => (
          <button
            aria-pressed={status === value}
            disabled={pending}
            key={value}
            onClick={() => setStatus(value)}
            type="button"
          >
            {label}
          </button>
        ))}
      </div>
      {consequence ? <p className="action-note" role="status">{consequence}</p> : null}
      {error ? <p className="action-error" role="alert">{error}</p> : null}
    </div>
  )
}

/**
 * The driver's choice to put their rig on their profile. The photo itself is
 * uploaded on the Equipment page; this only controls whether the people they
 * work with see it. The service refuses featuring when no photo exists.
 */
export function FeatureTruckPhotoToggle({ featured, hasPhoto }: { featured: boolean; hasPhoto: boolean }) {
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const toggle = () => {
    setError(null)
    startTransition(async () => {
      const result = await featureTruckPhotoAction({ featured: !featured })

      if (!result.ok) {
        setError(result.error ?? "The setting could not be saved. Try again.")
      }
    })
  }

  if (!hasPhoto && !featured) {
    return <p className="action-note action-note--muted">Upload a truck photo on the Equipment page, then feature it here.</p>
  }

  return (
    <div className="feature-toggle-block">
      <button aria-pressed={featured} className="feature-toggle" disabled={pending} onClick={toggle} type="button">
        {pending ? "Saving…" : featured ? "Featured on your profile — tap to remove" : "Feature your rig on your profile"}
      </button>
      {featured ? (
        <p className="action-note">Dispatchers and hosts you work with can see your truck photo.</p>
      ) : null}
      {error ? <p className="action-error" role="alert">{error}</p> : null}
    </div>
  )
}

/** Sign out for the mobile profile surface where the top-bar account menu is hidden. */
export function SignOutButton() {
  const [pending, startTransition] = useTransition()

  return (
    <button
      className="signout-button"
      disabled={pending}
      onClick={() => startTransition(async () => { await signOutAction() })}
      type="button"
    >
      {pending ? "Signing out…" : "Sign out"}
    </button>
  )
}
