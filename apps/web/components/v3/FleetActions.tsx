"use client"

import { useState, useTransition } from "react"
import { Badge, Button } from "@logloads/ui"

import {
  addEquipmentAction,
  assignDriverToEquipmentAction,
  publishFutureAvailabilityAction,
  updateEquipmentStatusAction,
  requestCapacityAction
} from "@/lib/cockpit-actions"
import type { DriverOption } from "@/lib/fleet-data"

// --- Dispatch: request capacity for a specific truck's driver ----------------

export function RequestForTruckButton({
  driverProfileId,
  loadPostingId,
  truckSlotId
}: {
  driverProfileId: string
  loadPostingId: string
  truckSlotId: string | null
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  if (sent) {
    return (
      <div className="fleet-action">
        <Badge tone="success">Request sent</Badge>
        <p className="fleet-action__hint">The publishing organization reviews it next.</p>
      </div>
    )
  }

  return (
    <div className="fleet-action">
      <Button
        disabled={pending || !truckSlotId}
        icon="action.request"
        onClick={() => {
          if (!truckSlotId) {
            return
          }

          setError(null)
          startTransition(async () => {
            const result = await requestCapacityAction({ driverProfileId, loadPostingId, truckSlotId })

            if (result.ok) {
              setSent(true)
            } else {
              setError(result.error ?? "The request could not be sent.")
            }
          })
        }}
      >
        {pending ? "Requesting…" : "Request for this truck"}
      </Button>
      {!truckSlotId ? <p className="fleet-action__hint">No open slot window on this load right now.</p> : null}
      {error ? <p className="fleet-action__error" role="alert">{error}</p> : null}
    </div>
  )
}

// --- Trucks: add equipment ----------------------------------------------------

const TRUCK_TYPES = [
  ["log_truck", "Log truck"],
  ["chip_truck", "Chip truck"],
  ["service_truck", "Service truck"],
  ["lowboy", "Lowboy"],
  ["other", "Other"]
] as const

const TRAILER_TYPES = [
  ["", "No trailer"],
  ["pole_trailer", "Pole trailer"],
  ["bunk_trailer", "Bunk trailer"],
  ["self_loader", "Self-loader"],
  ["flatbed", "Flatbed"],
  ["chip_van", "Chip van"],
  ["other", "Other"]
] as const

export function AddEquipmentForm() {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [label, setLabel] = useState("")
  const [unitNumber, setUnitNumber] = useState("")
  const [truckType, setTruckType] = useState<string>("log_truck")
  const [trailerType, setTrailerType] = useState<string>("pole_trailer")
  const [maxPayloadTons, setMaxPayloadTons] = useState("25")

  return (
    <form
      className="fleet-form"
      onSubmit={(event) => {
        event.preventDefault()
        setError(null)
        setSaved(false)

        const payload = Number(maxPayloadTons)

        if (!label.trim() || !unitNumber.trim()) {
          setError("Give the combination a label and a unit number.")
          return
        }

        if (!Number.isFinite(payload) || payload <= 0) {
          setError("Max payload must be a positive number of tons.")
          return
        }

        startTransition(async () => {
          const result = await addEquipmentAction({
            label: label.trim(),
            maxPayloadTons: payload,
            trailerType: trailerType || null,
            truckType,
            unitNumber: unitNumber.trim()
          })

          if (result.ok) {
            setSaved(true)
            setLabel("")
            setUnitNumber("")
          } else {
            setError(result.error ?? "The equipment could not be added.")
          }
        })
      }}
    >
      <div className="fleet-form__grid">
        <label>
          <span>Combination label</span>
          <input onChange={(event) => setLabel(event.target.value)} placeholder="Truck 12 — long log" value={label} />
        </label>
        <label>
          <span>Unit number</span>
          <input onChange={(event) => setUnitNumber(event.target.value)} placeholder="12" value={unitNumber} />
        </label>
        <label>
          <span>Truck type</span>
          <select onChange={(event) => setTruckType(event.target.value)} value={truckType}>
            {TRUCK_TYPES.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
          </select>
        </label>
        <label>
          <span>Trailer</span>
          <select onChange={(event) => setTrailerType(event.target.value)} value={trailerType}>
            {TRAILER_TYPES.map(([value, text]) => <option key={value || "none"} value={value}>{text}</option>)}
          </select>
        </label>
        <label>
          <span>Max payload (tons)</span>
          <input inputMode="decimal" onChange={(event) => setMaxPayloadTons(event.target.value)} value={maxPayloadTons} />
        </label>
      </div>
      <div className="fleet-form__footer">
        <Button disabled={pending} icon="load.equipment" type="submit">{pending ? "Adding…" : "Add equipment"}</Button>
        {saved ? <Badge tone="success">Equipment added</Badge> : null}
      </div>
      {error ? <p className="fleet-action__error" role="alert">{error}</p> : null}
    </form>
  )
}

// --- Trucks: status + driver assignment ---------------------------------------

const EQUIPMENT_STATUSES = [
  ["available", "Available"],
  ["committed", "Committed"],
  ["maintenance", "Maintenance"],
  ["inactive", "Inactive"]
] as const

export function EquipmentStatusSelect({ combinationId, status }: { combinationId: string; status: string }) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [value, setValue] = useState(status)

  return (
    <label className="fleet-select">
      <span>Status</span>
      <select
        disabled={pending}
        onChange={(event) => {
          const next = event.target.value
          const previous = value

          setValue(next)
          setError(null)
          startTransition(async () => {
            const result = await updateEquipmentStatusAction({ combinationId, status: next })

            if (!result.ok) {
              setValue(previous)
              setError(result.error ?? "The status could not be updated.")
            }
          })
        }}
        value={value}
      >
        {EQUIPMENT_STATUSES.map(([statusValue, text]) => <option key={statusValue} value={statusValue}>{text}</option>)}
      </select>
      {error ? <em className="fleet-action__error" role="alert">{error}</em> : null}
    </label>
  )
}

export function DriverAssignSelect({
  combinationId,
  driverProfileId,
  options
}: {
  combinationId: string
  driverProfileId: string | null
  options: DriverOption[]
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [value, setValue] = useState(driverProfileId ?? "")

  return (
    <label className="fleet-select">
      <span>Driver</span>
      <select
        disabled={pending}
        onChange={(event) => {
          const next = event.target.value
          const previous = value

          setValue(next)
          setError(null)
          startTransition(async () => {
            const result = await assignDriverToEquipmentAction({
              combinationId,
              driverProfileId: next || null
            })

            if (!result.ok) {
              setValue(previous)
              setError(result.error ?? "The driver could not be assigned.")
            }
          })
        }}
        value={value}
      >
        <option value="">Unassigned</option>
        {options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
      </select>
      {error ? <em className="fleet-action__error" role="alert">{error}</em> : null}
    </label>
  )
}

// --- Availability: publish future windows per combination ----------------------

const WINDOW_PRESETS = [
  ["today", "Today"],
  ["tomorrow", "Tomorrow"],
  ["week", "This week"]
] as const

type WindowPreset = (typeof WINDOW_PRESETS)[number][0]

function presetWindow(preset: WindowPreset): { startsAt: string; endsAt: string } {
  const now = new Date()
  const start = new Date(now)
  const end = new Date(now)

  if (preset === "today") {
    end.setHours(23, 59, 0, 0)
  } else if (preset === "tomorrow") {
    start.setDate(start.getDate() + 1)
    start.setHours(0, 0, 0, 0)
    end.setDate(end.getDate() + 1)
    end.setHours(23, 59, 0, 0)
  } else {
    end.setDate(end.getDate() + 7)
    end.setHours(23, 59, 0, 0)
  }

  return { endsAt: end.toISOString(), startsAt: start.toISOString() }
}

export function AvailabilityPublisher({ combinations }: { combinations: Array<{ id: string; label: string }> }) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [published, setPublished] = useState<string | null>(null)
  const [combinationId, setCombinationId] = useState(combinations.at(0)?.id ?? "")
  const [preset, setPreset] = useState<WindowPreset>("today")
  const [status, setStatus] = useState<"available" | "unavailable">("available")

  return (
    <div className="fleet-publisher">
      <div className="fleet-form__grid">
        <label>
          <span>Truck</span>
          <select onChange={(event) => setCombinationId(event.target.value)} value={combinationId}>
            {combinations.map((combination) => (
              <option key={combination.id} value={combination.id}>{combination.label}</option>
            ))}
          </select>
        </label>
        <div className="fleet-publisher__group" role="group" aria-label="Window">
          <span>Window</span>
          <div className="fleet-publisher__segments">
            {WINDOW_PRESETS.map(([value, text]) => (
              <button
                aria-pressed={preset === value}
                key={value}
                onClick={() => setPreset(value)}
                type="button"
              >
                {text}
              </button>
            ))}
          </div>
        </div>
        <div className="fleet-publisher__group" role="group" aria-label="Status">
          <span>Status</span>
          <div className="fleet-publisher__segments">
            {(["available", "unavailable"] as const).map((value) => (
              <button
                aria-pressed={status === value}
                key={value}
                onClick={() => setStatus(value)}
                type="button"
              >
                {value === "available" ? "Available" : "Unavailable"}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="fleet-form__footer">
        <Button
          disabled={pending || !combinationId}
          icon="load.schedule"
          onClick={() => {
            setError(null)
            setPublished(null)

            const window = presetWindow(preset)
            const combinationLabel = combinations.find((combination) => combination.id === combinationId)?.label ?? "Truck"
            const presetLabel = WINDOW_PRESETS.find(([value]) => value === preset)?.[1] ?? "Window"

            startTransition(async () => {
              const result = await publishFutureAvailabilityAction({
                endsAt: window.endsAt,
                equipmentCombinationId: combinationId,
                startsAt: window.startsAt,
                status
              })

              if (result.ok) {
                setPublished(`${combinationLabel} · ${presetLabel.toLowerCase()} · ${status}`)
              } else {
                setError(result.error ?? "The window could not be published.")
              }
            })
          }}
        >
          {pending ? "Publishing…" : "Publish window"}
        </Button>
        {published ? <Badge tone="success">Published: {published}</Badge> : null}
      </div>
      {error ? <p className="fleet-action__error" role="alert">{error}</p> : null}
    </div>
  )
}
