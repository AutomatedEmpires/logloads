"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState, useTransition, type FormEvent } from "react"
import { rateTypeSchema, roadConditionSchema } from "@logloads/contracts"
import { Icon } from "@logloads/ui"

import {
  createHaulRouteAction,
  createLandingAction,
  createMillAction,
  createRateAction,
  setLandingActiveAction,
  setMillActiveAction,
  updateLandingAction,
  updateMillAction,
  upsertLandingDetailsAction
} from "@/lib/cockpit-actions"
import type {
  HostLandingDetailsDraft,
  HostLandingDraft,
  HostMillDraft,
  HostMillOption
} from "@/lib/host-data"
import { formatHuman } from "@/lib/v3-shared"

/**
 * Read from the domain enums, never typed out beside them.
 *
 * A hand-kept copy drifts, and both directions of drift are silent: a value the
 * form offers that the schema refuses fails every submission the host tries,
 * and a value the schema has that the form omits cannot be chosen at all — and
 * worse, has no matching option when an existing record carries it, so opening
 * the edit form on a landing shows the wrong condition and saving rewrites it.
 */
const ROAD_CONDITIONS = roadConditionSchema.options
const RATE_TYPES = rateTypeSchema.options

const EMPTY_LANDING: HostLandingDraft = {
  accessNotes: "",
  addressLine1: "",
  city: "",
  contactEmail: "",
  contactName: "",
  contactPhone: "",
  lat: 0,
  lng: 0,
  name: "",
  postalCode: "",
  roadCondition: "",
  state: ""
}

const EMPTY_MILL: HostMillDraft = {
  accessNotes: "",
  addressLine1: "",
  city: "",
  contactEmail: "",
  contactName: "",
  contactPhone: "",
  lat: 0,
  lng: 0,
  name: "",
  postalCode: "",
  roadCondition: "",
  state: ""
}

function numberOrNull(value: FormDataEntryValue | null): number | null {
  const text = String(value ?? "").trim()

  if (text === "") return null

  const parsed = Number(text)

  return Number.isFinite(parsed) ? parsed : null
}

function nonEmptyLines(value: FormDataEntryValue | null): string[] {
  return String(value ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

/**
 * Creates or edits a landing. Coordinates are typed rather than picked off a
 * map. This base pin supplies the public approximation and the driver fallback
 * until a landing manager verifies the exact truck entrance in the private
 * briefing. Inventing either coordinate from a postal code would put a truck
 * on the wrong spur, so both are typed until a geocoder is founder-approved.
 */
export function LandingForm({
  landing,
  landingId,
  onDone
}: {
  landing?: HostLandingDraft
  landingId?: string
  onDone?: () => void
}) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [pending, startTransition] = useTransition()
  const current = landing ?? EMPTY_LANDING
  const editing = Boolean(landingId)

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    const lat = numberOrNull(data.get("lat"))
    const lng = numberOrNull(data.get("lng"))

    if (lat === null || lng === null) {
      setError("Give the landing map coordinates.")
      return
    }

    setError(null)
    setSaved(false)
    startTransition(async () => {
      const payload = {
        accessNotes: String(data.get("accessNotes") ?? "").trim() || null,
        addressLine1: String(data.get("addressLine1") ?? "").trim(),
        city: String(data.get("city") ?? "").trim(),
        contactEmail: String(data.get("contactEmail") ?? "").trim() || null,
        contactName: String(data.get("contactName") ?? "").trim(),
        contactPhone: String(data.get("contactPhone") ?? "").trim(),
        lat,
        lng,
        name: String(data.get("name") ?? "").trim(),
        postalCode: String(data.get("postalCode") ?? "").trim(),
        roadCondition: String(data.get("roadCondition") ?? "").trim() || null,
        state: String(data.get("state") ?? "").trim()
      }

      const result = landingId
        ? await updateLandingAction({ ...payload, landingId })
        : await createLandingAction(payload)

      if (!result.ok) {
        setError(result.error ?? "The landing could not be saved.")
        return
      }

      setSaved(true)
      if (!editing) form.reset()
      onDone?.()
      router.refresh()
    })
  }

  return (
    <form className="workspace-form" onSubmit={submit}>
      <div className="workspace-form__grid">
        <label>
          Landing name
          <input defaultValue={current.name} name="name" placeholder="Blue River Spur" required type="text" />
        </label>
        <label>
          Address
          <input defaultValue={current.addressLine1} name="addressLine1" required type="text" />
        </label>
        <label>
          City
          <input defaultValue={current.city} name="city" required type="text" />
        </label>
        <label>
          State
          <input defaultValue={current.state} maxLength={2} name="state" required size={2} type="text" />
        </label>
        <label>
          Postal code
          <input defaultValue={current.postalCode} name="postalCode" required type="text" />
        </label>
        <label>
          Road condition
          <select defaultValue={current.roadCondition} name="roadCondition">
            <option value="">Not recorded</option>
            {ROAD_CONDITIONS.map((value) => (
              <option key={value} value={value}>{formatHuman(value)}</option>
            ))}
          </select>
        </label>
        <label>
          Landing map latitude
          <input defaultValue={editing ? current.lat : ""} name="lat" placeholder="44.05" required step="any" type="number" />
        </label>
        <label>
          Landing map longitude
          <input defaultValue={editing ? current.lng : ""} name="lng" placeholder="-121.31" required step="any" type="number" />
        </label>
        <label>
          Site contact
          <input defaultValue={current.contactName} name="contactName" required type="text" />
        </label>
        <label>
          Contact phone
          <input defaultValue={current.contactPhone} name="contactPhone" required type="tel" />
        </label>
        <label>
          Contact email
          <input defaultValue={current.contactEmail} name="contactEmail" type="email" />
        </label>
      </div>
      <label className="workspace-form__wide">
        Approach notes
        <textarea
          defaultValue={current.accessNotes}
          name="accessNotes"
          placeholder="Turn at the second gate; log truck turnaround at the top."
          rows={2}
        />
      </label>
      <div className="workspace-form__actions">
        <button className="action-link" disabled={pending} type="submit">
          {pending ? "Saving…" : editing ? "Save landing" : "Add landing"}
        </button>
        {saved ? <span className="action-note">Saved.</span> : null}
      </div>
      {error ? <p className="action-error" role="alert">{error}</p> : null}
    </form>
  )
}

/**
 * Maintains the private site briefing copied into future assignment Route
 * Packs. Exact entrance facts stay assignment-only; this form deliberately has
 * no visibility selector that could imply a wider access policy the product
 * does not safely serve.
 */
export function LandingDetailsForm({
  details,
  landingId
}: {
  details: HostLandingDetailsDraft
  landingId: string
}) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [pending, startTransition] = useTransition()

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const entranceLat = numberOrNull(data.get("entranceLat"))
    const entranceLng = numberOrNull(data.get("entranceLng"))

    if (entranceLat === null || entranceLng === null) {
      setError("Give the exact entrance coordinates drivers should use.")
      return
    }

    setError(null)
    setSaved(false)
    startTransition(async () => {
      const result = await upsertLandingDetailsAction({
        communicationInstructions: String(data.get("communicationInstructions") ?? "").trim() || null,
        entranceLat,
        entranceLng,
        gateInstructions: String(data.get("gateInstructions") ?? "").trim() || null,
        landingId,
        loadingEquipment: nonEmptyLines(data.get("loadingEquipment")),
        privateRoadNotes: String(data.get("privateRoadNotes") ?? "").trim() || null,
        publicApproximateArea: String(data.get("publicApproximateArea") ?? "").trim(),
        safetyRequirements: nonEmptyLines(data.get("safetyRequirements")),
        stagingInstructions: String(data.get("stagingInstructions") ?? "").trim() || null,
        turnaroundConstraints: nonEmptyLines(data.get("turnaroundConstraints"))
      })

      if (!result.ok) {
        setError(result.error ?? "The driver briefing could not be saved.")
        return
      }

      setSaved(true)
      router.refresh()
    })
  }

  return (
    <form className="workspace-form" onSubmit={submit}>
      <p className="workspace-hint">
        Exact entrance, gate, road, and staging facts unlock only after an assignment is approved. Saving verifies them now for future Route Packs; existing assignment snapshots do not change. Re-issue an active driver&apos;s pack from the <Link href="/host/live-board">Live Board</Link> when a changed instruction applies to their haul.
      </p>
      <div className="workspace-form__grid">
        <label>
          Public approximate area
          <input defaultValue={details.publicApproximateArea} name="publicApproximateArea" required type="text" />
        </label>
        <label>
          Exact entrance latitude
          <input defaultValue={details.entranceLat} name="entranceLat" required step="any" type="number" />
        </label>
        <label>
          Exact entrance longitude
          <input defaultValue={details.entranceLng} name="entranceLng" required step="any" type="number" />
        </label>
      </div>
      <label className="workspace-form__wide">
        Gate instructions
        <textarea defaultValue={details.gateInstructions} name="gateInstructions" rows={2} />
      </label>
      <label className="workspace-form__wide">
        Private road notes
        <textarea defaultValue={details.privateRoadNotes} name="privateRoadNotes" rows={2} />
      </label>
      <label className="workspace-form__wide">
        Loading equipment (one per line)
        <textarea defaultValue={details.loadingEquipment.join("\n")} name="loadingEquipment" rows={3} />
      </label>
      <label className="workspace-form__wide">
        Turnaround constraints (one per line)
        <textarea defaultValue={details.turnaroundConstraints.join("\n")} name="turnaroundConstraints" rows={3} />
      </label>
      <label className="workspace-form__wide">
        Staging instructions
        <textarea defaultValue={details.stagingInstructions} name="stagingInstructions" rows={2} />
      </label>
      <label className="workspace-form__wide">
        Communication instructions
        <textarea defaultValue={details.communicationInstructions} name="communicationInstructions" rows={2} />
      </label>
      <label className="workspace-form__wide">
        Safety and PPE requirements (one per line)
        <textarea defaultValue={details.safetyRequirements.join("\n")} name="safetyRequirements" rows={3} />
      </label>
      <div className="workspace-form__actions">
        <button className="action-link" disabled={pending} type="submit">
          {pending ? "Saving…" : "Save and verify briefing"}
        </button>
        {saved ? <span className="action-note">Verified for future Route Packs.</span> : null}
      </div>
      {error ? <p className="action-error" role="alert">{error}</p> : null}
    </form>
  )
}

/**
 * Retires or restores a landing. Retiring frees the plan's active-landing slot.
 *
 * Sends the id and the flag, nothing else. Resubmitting the whole record from
 * the snapshot this page was rendered with would make retiring a landing revert
 * any edit somebody made to it in the meantime.
 */
export function LandingActiveToggle({
  isActive,
  landingId
}: {
  isActive: boolean
  landingId: string
}) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const toggle = () => {
    setError(null)
    startTransition(async () => {
      const result = await setLandingActiveAction({ isActive: !isActive, landingId })

      if (!result.ok) {
        setError(result.error ?? "That could not be changed.")
        return
      }

      router.refresh()
    })
  }

  return (
    <>
      <button className="action-link action-link--secondary" disabled={pending} onClick={toggle} type="button">
        {pending ? "Working…" : isActive ? "Retire landing" : "Restore landing"}
      </button>
      {error ? <p className="action-error" role="alert">{error}</p> : null}
    </>
  )
}

/**
 * Adds an organization-owned mill or destination. It becomes available to
 * this workspace immediately and never appears in another outfit's builder.
 */
export function MillForm({
  mill,
  millId,
  onDone
}: {
  mill?: HostMillDraft
  millId?: string
  onDone?: () => void
}) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [pending, startTransition] = useTransition()
  const current = mill ?? EMPTY_MILL
  const editing = Boolean(millId)

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    const lat = numberOrNull(data.get("lat"))
    const lng = numberOrNull(data.get("lng"))

    if (lat === null || lng === null) {
      setError("Give the destination map coordinates.")
      return
    }

    setError(null)
    setSaved(false)
    startTransition(async () => {
      const payload = {
        accessNotes: String(data.get("accessNotes") ?? "").trim() || null,
        addressLine1: String(data.get("addressLine1") ?? "").trim(),
        city: String(data.get("city") ?? "").trim(),
        contactEmail: String(data.get("contactEmail") ?? "").trim() || null,
        contactName: String(data.get("contactName") ?? "").trim(),
        contactPhone: String(data.get("contactPhone") ?? "").trim(),
        lat,
        lng,
        name: String(data.get("name") ?? "").trim(),
        postalCode: String(data.get("postalCode") ?? "").trim(),
        roadCondition: String(data.get("roadCondition") ?? "").trim(),
        state: String(data.get("state") ?? "").trim()
      }

      const result = millId
        ? await updateMillAction({ ...payload, millId })
        : await createMillAction(payload)

      if (!result.ok) {
        setError(result.error ?? "The destination could not be saved.")
        return
      }

      setSaved(true)
      if (!editing) form.reset()
      onDone?.()
      router.refresh()
    })
  }

  return (
    <form autoComplete="off" className="workspace-form" onSubmit={submit}>
      {editing ? (
        <p className="workspace-hint">
          Saving corrects this destination for new lanes and future snapshots. Existing assignment Route Packs stay frozen; re-issue an active driver&apos;s pack from the <Link href="/host/live-board">Live Board</Link> when the correction applies to their haul.
        </p>
      ) : null}
      <div className="workspace-form__grid">
        <label>
          Destination name
          <input autoComplete="off" defaultValue={current.name} maxLength={120} name="name" placeholder="Cascade Mill" required type="text" />
        </label>
        <label>
          Street address
          <input autoComplete="off" defaultValue={current.addressLine1} maxLength={200} name="addressLine1" required type="text" />
        </label>
        <label>
          City
          <input autoComplete="off" defaultValue={current.city} maxLength={100} name="city" required type="text" />
        </label>
        <label>
          State
          <input autoComplete="off" defaultValue={current.state} maxLength={2} minLength={2} name="state" pattern="[A-Za-z]{2}" required size={2} type="text" />
        </label>
        <label>
          Postal code
          <input autoComplete="off" defaultValue={current.postalCode} maxLength={20} name="postalCode" required type="text" />
        </label>
        <label>
          Current road condition
          <select defaultValue={current.roadCondition} name="roadCondition" required>
            <option disabled value="">Select current condition</option>
            {ROAD_CONDITIONS.map((value) => (
              <option key={value} value={value}>{formatHuman(value)}</option>
            ))}
          </select>
        </label>
        <label>
          Map latitude
          <input defaultValue={editing ? current.lat : ""} inputMode="decimal" name="lat" placeholder="44.05" required step="any" type="number" />
        </label>
        <label>
          Map longitude
          <input defaultValue={editing ? current.lng : ""} inputMode="decimal" name="lng" placeholder="-121.31" required step="any" type="number" />
        </label>
        <label>
          Scale house or site contact
          <input autoComplete="off" defaultValue={current.contactName} maxLength={120} name="contactName" required type="text" />
        </label>
        <label>
          Contact phone
          <input autoComplete="off" defaultValue={current.contactPhone} inputMode="tel" maxLength={40} minLength={7} name="contactPhone" required type="tel" />
        </label>
        <label>
          Contact email
          <input autoComplete="off" defaultValue={current.contactEmail} inputMode="email" maxLength={254} name="contactEmail" type="email" />
        </label>
      </div>
      <label className="workspace-form__wide">
        Check-in notes
        <textarea defaultValue={current.accessNotes} maxLength={500} name="accessNotes" placeholder="Check in at gate 2; scale is on the left." rows={2} />
      </label>
      <div className="workspace-form__actions">
        <button className="action-link" disabled={pending} type="submit">
          {pending ? "Saving…" : editing ? "Save destination" : "Add destination"}
        </button>
        {saved ? (
          <span aria-live="polite" className="action-note" role="status">
            Saved.
          </span>
        ) : null}
      </div>
      {error ? <p className="action-error" role="alert">{error}</p> : null}
    </form>
  )
}

export function MillActiveToggle({
  isActive,
  millId
}: {
  isActive: boolean
  millId: string
}) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const toggle = () => {
    setError(null)
    startTransition(async () => {
      const result = await setMillActiveAction({ isActive: !isActive, millId })

      if (!result.ok) {
        setError(result.error ?? "That destination could not be changed.")
        return
      }

      router.refresh()
    })
  }

  return (
    <>
      <button className="action-link action-link--secondary" disabled={pending} onClick={toggle} type="button">
        {pending ? "Working…" : isActive ? "Retire destination" : "Restore destination"}
      </button>
      {error ? <p className="action-error" role="alert">{error}</p> : null}
    </>
  )
}

/** Adds a lane from this landing to a destination. */
export function HaulRouteForm({ landingId, mills }: { landingId: string; mills: HostMillOption[] }) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [pending, startTransition] = useTransition()

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    const distance = numberOrNull(data.get("estimatedDistanceMiles"))
    const runTime = numberOrNull(data.get("estimatedRunTimeMinutes"))
    const roadCondition = String(data.get("roadCondition") ?? "").trim()

    if (distance === null || runTime === null || !roadCondition) {
      setError("Give the distance, run time, and current road condition a driver should expect.")
      return
    }

    setError(null)
    setSaved(false)
    startTransition(async () => {
      const result = await createHaulRouteAction({
        estimatedDistanceMiles: distance,
        estimatedRunTimeMinutes: Math.round(runTime),
        landingId,
        millId: String(data.get("millId") ?? ""),
        roadCondition,
        roadNotes: String(data.get("roadNotes") ?? "").trim() || null,
        routeName: String(data.get("routeName") ?? "").trim()
      })

      if (!result.ok) {
        setError(result.error ?? "The lane could not be added.")
        return
      }

      form.reset()
      setSaved(true)
      router.refresh()
    })
  }

  if (mills.length === 0) {
    return (
      <div>
        <p className="workspace-hint">
          No destinations are on file yet, so a lane has nowhere to end. Add the
          mill or destination you haul to — it is usable in your lanes the
          moment it saves.
        </p>
        <MillForm />
      </div>
    )
  }

  return (
    <form className="workspace-form workspace-form--inline" onSubmit={submit}>
      <div className="workspace-form__grid">
        <label>
          Lane name
          <input name="routeName" placeholder="Blue River to Cascade" required type="text" />
        </label>
        <label>
          Destination
          <select defaultValue={mills[0]?.id} name="millId" required>
            {mills.map((mill) => <option key={mill.id} value={mill.id}>{mill.label}</option>)}
          </select>
        </label>
        <label>
          Distance (miles)
          <input min="0.1" name="estimatedDistanceMiles" required step="0.1" type="number" />
        </label>
        <label>
          Run time (minutes)
          <input min="1" name="estimatedRunTimeMinutes" required step="1" type="number" />
        </label>
        <label>
          Road condition
          <select defaultValue="" name="roadCondition" required>
            <option disabled value="">Select current condition</option>
            {ROAD_CONDITIONS.map((value) => (
              <option key={value} value={value}>{formatHuman(value)}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="workspace-form__actions">
        <button className="action-link action-link--secondary" disabled={pending} type="submit">
          <Icon aria-hidden name="nav.map" size={16} />
          {pending ? "Adding…" : "Add lane"}
        </button>
        {saved ? <span className="action-note">Lane added.</span> : null}
      </div>
      {error ? <p className="action-error" role="alert">{error}</p> : null}
    </form>
  )
}

/** The lane builder plus an intentional path for an unlisted destination. */
export function LaneBuilder({ landingId, mills }: { landingId: string; mills: HostMillOption[] }) {
  return (
    <div>
      <HaulRouteForm landingId={landingId} mills={mills} />
      {mills.length > 0 ? (
        <details className="workspace-details">
          <summary>Haul somewhere not listed? Add a destination</summary>
          <MillForm />
        </details>
      ) : null}
    </div>
  )
}

/** Adds a rate the organization can publish work at. */
export function RateForm() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [pending, startTransition] = useTransition()

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    const amount = numberOrNull(data.get("amount"))
    const fuel = numberOrNull(data.get("fuel")) ?? 0

    if (amount === null || amount <= 0) {
      setError("Give the amount you pay.")
      return
    }

    setError(null)
    setSaved(false)
    startTransition(async () => {
      const result = await createRateAction({
        // Money is entered in dollars and stored in cents; rounding here keeps a
        // typed "42.505" from becoming a fraction of a cent nobody can pay.
        amountCents: Math.round(amount * 100),
        effectiveDate: String(data.get("effectiveDate") ?? ""),
        fuelSurchargeCents: Math.round(fuel * 100),
        notes: String(data.get("notes") ?? "").trim() || null,
        rateType: String(data.get("rateType") ?? "per_ton")
      })

      if (!result.ok) {
        setError(result.error ?? "The rate could not be added.")
        return
      }

      form.reset()
      setSaved(true)
      router.refresh()
    })
  }

  return (
    <form className="workspace-form workspace-form--inline" onSubmit={submit}>
      <div className="workspace-form__grid">
        <label>
          Pay basis
          <select defaultValue="per_ton" name="rateType">
            {RATE_TYPES.map((value) => <option key={value} value={value}>{formatHuman(value)}</option>)}
          </select>
        </label>
        <label>
          Amount (USD)
          <input min="0.01" name="amount" placeholder="42.50" required step="0.01" type="number" />
        </label>
        <label>
          Fuel surcharge (USD)
          <input defaultValue="0" min="0" name="fuel" step="0.01" type="number" />
        </label>
        <label>
          Effective from
          <input name="effectiveDate" required type="date" />
        </label>
      </div>
      <label className="workspace-form__wide">
        Note
        <input name="notes" placeholder="Standard saw log rate" type="text" />
      </label>
      <div className="workspace-form__actions">
        <button className="action-link action-link--secondary" disabled={pending} type="submit">
          {pending ? "Adding…" : "Add rate"}
        </button>
        {saved ? <span className="action-note">Rate added.</span> : null}
      </div>
      {error ? <p className="action-error" role="alert">{error}</p> : null}
    </form>
  )
}
