"use client"

import Link from "next/link"
import { useState, useTransition, type FormEvent } from "react"
import { Badge, Icon } from "@logloads/ui"

import {
  addEquipmentAction,
  attachTripDocumentAction,
  progressTripAction,
  requestCapacityAction,
  updateDriverAvailabilityAction,
  updateEquipmentStatusAction
} from "@/lib/cockpit-actions"
import type { NetworkLoadView, NetworkView } from "@/lib/network"
import { signOutAction } from "@/lib/session-actions"

type TripStatus = NetworkView["trips"][number]["status"]

const TRIP_STEPS: Partial<Record<TripStatus, { label: string; next: TripStatus }>> = {
  assigned: { label: "Head to landing", next: "en_route_to_landing" },
  at_destination: { label: "Start unloading", next: "unloading" },
  checked_in: { label: "Start loading", next: "loading" },
  en_route_to_destination: { label: "Arrived at mill", next: "at_destination" },
  en_route_to_landing: { label: "Arrived at landing", next: "checked_in" },
  loaded: { label: "Head to mill", next: "en_route_to_destination" },
  loading: { label: "Confirm loaded", next: "loaded" },
  unloading: { label: "Confirm delivery", next: "completed" }
}

/** The single next field action for a trip, wired to the real trip state machine. */
export function TripProgressButton({ status, tone = "row", tripId }: { status: TripStatus; tone?: "hero" | "row"; tripId: string }) {
  const step = TRIP_STEPS[status]
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  if (!step) {
    return null
  }

  const advance = () => {
    setError(null)
    startTransition(async () => {
      const result = await progressTripAction({ nextStatus: step.next, tripId })

      if (!result.ok) {
        setError(result.error ?? "The trip could not be updated. Try again.")
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

const ASSIGNMENT_STATE: Record<string, { badge: string; body: string; tone: "success" | "warning" | "info" }> = {
  accepted: { badge: "Assigned to you", body: "Route Pack and exact access are unlocked. Your next action lives in Trips.", tone: "success" },
  checked_in: { badge: "At the landing", body: "You are checked in on this load. Keep the trip record moving from Trips.", tone: "success" },
  hauled: { badge: "Hauled", body: "Close out the delivery record from Trips.", tone: "success" },
  loading: { badge: "Loading", body: "Loading is underway. Confirm loaded from Trips when the wood is on.", tone: "success" },
  offered: { badge: "Offered to you", body: "The host sent this to you directly. Coordinate acceptance in Messages.", tone: "info" },
  requested: { badge: "Requested", body: "Waiting for host approval. You will see the assignment here once it is accepted.", tone: "warning" }
}

/** Sticky decision panel for the load detail page: request, requested, or filled. */
export function RequestCapacityPanel({ load }: { load: NetworkLoadView }) {
  const [error, setError] = useState<string | null>(null)
  const [requested, setRequested] = useState(false)
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
          <Link className="action-link" href="/driver/trips">Open Trips</Link>
          <Link className="action-link action-link--secondary" href="/driver/messages">Message the host</Link>
        </div>
      </div>
    )
  }

  if (requested) {
    return (
      <div className="request-panel">
        <Badge tone="warning">Requested</Badge>
        <strong>
          {load.allocationMode === "request_approval"
            ? "Requested — waiting for host approval."
            : "Requested — the host confirms your slot next."}
        </strong>
        <p>You can keep hauling other work. The assignment shows in Trips once it is accepted.</p>
        <div className="request-links">
          <Link className="action-link action-link--secondary" href="/driver/loads">Back to loads</Link>
        </div>
      </div>
    )
  }

  const slotId = load.slots.requestableSlotId

  if (load.capacity.remaining <= 0 || !slotId) {
    return (
      <div className="request-panel">
        <Badge tone="warning">Capacity filled</Badge>
        <strong>All {load.capacity.total} loads are committed.</strong>
        <p>
          If a truck drops, the host reopens capacity here first. Tell the host you can cover overflow, or keep your
          availability current so new work finds you.
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
      <Badge tone="success">Capacity open</Badge>
      <strong>Request 1 load</strong>
      <div className="request-panel__meta">
        <span>{load.capacity.remaining} of {load.capacity.total} loads open</span>
        <span>Next window: {load.slots.nextWindow}</span>
      </div>
      <p>Exact access and the Route Pack unlock after the host accepts.</p>
      <button className="advance-button" disabled={pending} onClick={request} type="button">
        {pending ? "Sending request…" : "Request 1 load"}
      </button>
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

const PROOF_TYPES: Array<[string, string]> = [
  ["scale_ticket", "Scale ticket"],
  ["photo", "Photo"],
  ["delivery_record", "Delivery record"]
]

/**
 * Logs a proof record against the trip. File upload infrastructure is not wired
 * yet, so this records the proof type honestly with a generated reference name.
 */
export function LogProofControl({ tripId }: { tripId: string }) {
  const [type, setType] = useState("scale_ticket")
  const [error, setError] = useState<string | null>(null)
  const [logged, setLogged] = useState(false)
  const [pending, startTransition] = useTransition()

  const submit = () => {
    setError(null)
    setLogged(false)
    startTransition(async () => {
      const result = await attachTripDocumentAction({
        filename: `proof-${type.replaceAll("_", "-")}-${Date.now()}.jpg`,
        tripId,
        type
      })

      if (!result.ok) {
        setError(result.error ?? "The proof record could not be logged.")
      } else {
        setLogged(true)
      }
    })
  }

  return (
    <div className="proof-control">
      <label className="proof-control__type">
        <span className="sr-only">Proof type</span>
        <select onChange={(event) => setType(event.target.value)} value={type}>
          {PROOF_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <button className="proof-control__submit" disabled={pending} onClick={submit} type="button">
        <Icon aria-hidden name="ops.document" size={18} />
        {pending ? "Logging…" : "Log proof record"}
      </button>
      {logged ? <p className="action-note">Proof record added to this trip.</p> : null}
      {error ? <p className="action-error" role="alert">{error}</p> : null}
    </div>
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
  const [pending, startTransition] = useTransition()

  const setStatus = (next: string) => {
    if (next === status || pending) {
      return
    }

    setError(null)
    startTransition(async () => {
      const result = await updateEquipmentStatusAction({ combinationId, status: next })

      if (!result.ok) {
        setError(result.error ?? "Status could not be updated.")
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
