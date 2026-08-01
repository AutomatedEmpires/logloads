import "server-only"

import {
  CREDENTIAL_EXPIRY_WARNING_DAYS,
  credentialGateFor,
  credentialIsValidAt,
  credentialKindSchema,
  credentialStatusSchema,
  HOST_VISIBLE_CREDENTIAL_PHOTO_KINDS,
  MANDATORY_CREDENTIAL_KINDS,
  type CredentialGate,
  type CredentialKind,
  type CredentialStatus,
  type DriverCredential
} from "@logloads/contracts"
import {
  credentialGateForEquipmentSelection,
  type CredentialEquipmentOption,
  type CredentialEquipmentSelectionOption,
  type CredentialViewer,
  type HostCredentialSummary
} from "@logloads/services"
import type { BadgeProps } from "@logloads/ui"

import { isDedicatedMediaConfigured } from "./media-config"
import { services } from "./services"

/**
 * ── What a driver sees in their vault, and what a host sees of it ──────────────
 *
 * Two surfaces, one reading. The driver's checklist and the host's summary are
 * projected from the SAME reading of the same rows, so they cannot describe one
 * record differently. A driver told "you're set" while the host reads "expired"
 * would mean one of the two screens lied, and neither of them would know which.
 *
 * WHAT DECIDES VALIDITY. Nothing here. `credentialGateFor` in
 * `@logloads/contracts` decides which records a driver currently holds, and this
 * module reads its answer. Every blocking flag below is derived from that gate's
 * `missing` list rather than recomputed: a second implementation of "is this good
 * enough to work" is a second safety rule, and the two would disagree the first
 * time one of them was edited.
 *
 * THE COPY IS THE FEATURE. A driver who cannot accept loads must be told exactly
 * that, with the outstanding records named. The worst failure this surface can
 * have is not a wrong badge — it is a driver watching a load board silently refuse
 * them and having to guess why. So `blockedNotice` is present whenever the vault
 * is incomplete, it names what is outstanding, and it states the consequence.
 *
 * WHAT LOGLOADS IS CLAIMING, HOST-SIDE. A document was submitted, checked for
 * consistency and expiry, and approved or refused. Nothing more.
 * `CREDENTIAL_ASSURANCE_STATEMENT` is passed through verbatim rather than reworded
 * here: LogLoads is orchestration, it does not certify anyone's legal right to
 * operate, and a stronger sentence written into a component would be a
 * representation the company cannot substantiate.
 *
 * WHAT A HOST NEVER RECEIVES. The CDL image, the insurance certificate image, the
 * policy or licence number, and the review notes. Every host-facing line is built
 * from `hostVisibleCredential`, whose four-field result has no expression for any
 * of them — and this module narrows further still, publishing only WHETHER an
 * equipment photo exists rather than any reference to it, so a host response
 * carries no media identifier at all.
 */

/** Badge renders the tone, so the union comes from Badge instead of being retyped. */
export type CredentialTone = NonNullable<BadgeProps["tone"]>

// ── What state one required record is in ──────────────────────────────────────

/**
 * The state of ONE required record, as a person reads it.
 *
 * Deliberately not the stored status. A stored `approved` that has lapsed, or one
 * whose document is not stored, counts for nothing — and a chip reading "Approved"
 * over a record that does not let the driver work is the exact divergence this
 * type exists to prevent. So `expired` and `document_missing` are first-class
 * states, and `satisfied` is reachable only when the gate says the kind is held.
 */
export const CREDENTIAL_SLOT_STATES = [
  "satisfied",
  "expiring_soon",
  "nothing_on_file",
  "in_review",
  "more_info_required",
  "not_approved",
  "expired",
  "document_missing"
] as const

export type CredentialSlotState = (typeof CREDENTIAL_SLOT_STATES)[number]

interface SlotStatePresentation {
  /**
   * Whether a driver in this state is blocked from accepting loads. Declared per
   * state rather than inferred, and proven against the gate's own `missing` list
   * in the test: if the two ever disagree, this checklist is telling a driver
   * something the acceptance guard will contradict.
   */
  blocksWork: boolean
  label: string
  tone: CredentialTone
}

const SLOT_STATE_PRESENTATION: Record<CredentialSlotState, SlotStatePresentation> = {
  document_missing: { blocksWork: true, label: "Document not stored", tone: "critical" },
  expired: { blocksWork: true, label: "Expired", tone: "critical" },
  // Valid today, so it does not block — and warned about precisely so it never
  // becomes a block the driver did not see coming.
  expiring_soon: { blocksWork: false, label: "Expires soon", tone: "warning" },
  in_review: { blocksWork: true, label: "In review", tone: "warning" },
  more_info_required: { blocksWork: true, label: "More needed", tone: "warning" },
  not_approved: { blocksWork: true, label: "Not approved", tone: "critical" },
  nothing_on_file: { blocksWork: true, label: "Nothing on file", tone: "critical" },
  satisfied: { blocksWork: false, label: "Approved", tone: "success" }
}

/**
 * How a stored status reads when the record is NOT currently covering the driver.
 *
 * Exhaustive over the status union, so adding a status to the schema will not
 * compile until somebody decides how a blocked driver is told about it. A fallback
 * would give an unknown status a friendly label and the driver a wrong explanation
 * of why they cannot work.
 *
 * `approved` maps to `expired` as its ordinary case and is refined to
 * `document_missing` below when no bytes are stored. Both block, and a driver
 * needs to know which one they are looking at, because only one of them is fixed
 * by sending the same document again.
 */
const BLOCKED_STATE_FOR_STATUS: Record<CredentialStatus, CredentialSlotState> = {
  approved: "expired",
  denied: "not_approved",
  more_info_required: "more_info_required",
  pending: "in_review"
}

interface KindPresentation {
  label: string
  /** What document satisfies this record, in the driver's words. */
  requirement: string
  /** For chips and lists, where the full label is too long to scan in a cab. */
  shortLabel: string
}

/**
 * Exhaustive over the kind union: a fifth mandatory record cannot be added to the
 * schema without somebody writing what a driver has to send for it.
 */
const KIND_PRESENTATION: Record<CredentialKind, KindPresentation> = {
  cdl: {
    label: "Commercial driver's licence",
    requirement: "A photo of your CDL with the class and the expiry date readable.",
    shortLabel: "CDL"
  },
  insurance: {
    label: "Insurance certificate",
    requirement:
      "Your certificate of liability insurance, with the insurer's name and the expiry date readable.",
    shortLabel: "Insurance"
  },
  trailer: {
    label: "Trailer photo",
    requirement: "A photo of the trailer you haul with, with the unit number readable.",
    shortLabel: "Trailer"
  },
  truck: {
    label: "Truck photo",
    requirement: "A photo of your truck, side on, with the unit number readable.",
    shortLabel: "Truck"
  }
}

const MILLISECONDS_PER_DAY = 86_400_000

/**
 * UTC, deliberately. An expiry is the date PRINTED on a document, resolved to an
 * instant when it was recorded. Rendering it in the reader's own zone would move
 * that printed date by a day for a driver west of UTC, and "expired on the 31st"
 * is not a fact to render approximately.
 *
 * NULL RATHER THAN A THROW. `Intl.format` raises on an unreadable instant, and one
 * corrupt date on one row would take down the whole vault page — for the driver
 * with the broken record, who is exactly the person who needs to read it. The gate
 * already treats an unreadable expiry as lapsed, so the surface has to survive one
 * too.
 */
function formatDay(instant: string): string | null {
  const parsed = new Date(instant)

  if (Number.isNaN(parsed.getTime())) {
    return null
  }

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    year: "numeric"
  }).format(parsed)
}

/**
 * A day inside a sentence. An unreadable stored date says so, because the
 * alternatives are both worse: guessing one puts a date in the driver's head that
 * no document carries, and dropping the clause leaves a sentence that reads as
 * though the record were fine.
 */
function dayText(instant: string): string {
  return formatDay(instant) ?? "a date we cannot read"
}

function wholeDaysBetween(fromIso: string, toIso: string): number {
  return Math.floor((Date.parse(toIso) - Date.parse(fromIso)) / MILLISECONDS_PER_DAY)
}

/** Floor, not round: "in 9 days" must never appear on a record that lapses in 9. */
function countdownPhrase(days: number): string {
  if (days <= 0) {
    return "today"
  }

  if (days === 1) {
    return "tomorrow"
  }

  return `in ${days} days`
}

function listSentence(items: readonly string[]): string {
  if (items.length <= 1) {
    return items[0] ?? ""
  }

  const last = items[items.length - 1] ?? ""

  return `${items.slice(0, -1).join(", ")} and ${last}`
}

/**
 * The stated expiry, normalized to one spelling of "none".
 *
 * `credentialIsValidAt` guards both `null` and `undefined` for the same reason: a
 * row that came from storage can be missing a key entirely, and reading a missing
 * expiry as "no expiry" would turn a gap in the data into a record that never
 * lapses.
 */
function statedExpiry(credential: DriverCredential): string | null {
  return credential.expiresOn ?? null
}

/**
 * When a record stops covering the driver, as a number. A record stating no expiry
 * cannot lapse, which is the furthest future there is — the same reading
 * `credentialGateFor` uses, so both agree about which valid record lasts longest.
 */
function expiryInstant(credential: DriverCredential): number {
  const expiry = statedExpiry(credential)

  return expiry === null ? Number.POSITIVE_INFINITY : Date.parse(expiry)
}

function bySubmittedAtDescending(left: DriverCredential, right: DriverCredential): number {
  // Instants compared as instants: one moment has several valid ISO spellings, so a
  // string sort would order two writers' records by their formatting.
  return Date.parse(right.submittedAt) - Date.parse(left.submittedAt) || right.id.localeCompare(left.id)
}

// ── One required record, read once for both surfaces ──────────────────────────

interface CredentialKindReading {
  /** The record covering this kind now: the valid one that lasts longest. */
  current: DriverCredential | null
  daysUntilExpiry: number | null
  /** When this kind stops being covered; null when covered indefinitely or not at all. */
  expiresOn: string | null
  kind: CredentialKind
  /** An approved record of this kind that has lapsed, when nothing covers it now. */
  lapsed: DriverCredential | null
  /** The most recent submission of this kind, whatever became of it. */
  latest: DriverCredential | null
  /** A newer submission still awaiting a decision — the renewal a driver is waiting on. */
  pendingRenewal: DriverCredential | null
  satisfied: boolean
  state: CredentialSlotState
}

function furthestExpiry(credentials: readonly DriverCredential[]): DriverCredential | null {
  return credentials.reduce<DriverCredential | null>((furthest, candidate) => {
    if (furthest === null) {
      return candidate
    }

    const candidateAt = expiryInstant(candidate)
    const furthestAt = expiryInstant(furthest)

    // Id break, so two records sharing an expiry always pick the same winner and
    // the same sentence renders on every request.
    return candidateAt > furthestAt || (candidateAt === furthestAt && candidate.id > furthest.id)
      ? candidate
      : furthest
  }, null)
}

function readKind(
  kind: CredentialKind,
  credentials: readonly DriverCredential[],
  gate: CredentialGate,
  atIso: string
): CredentialKindReading {
  const at = Date.parse(atIso)
  const ofKind = credentials.filter((credential) => credential.kind === kind)
  // The gate is the authority on whether this kind is held. Recomputing it here
  // would be a second rule wearing the same name.
  const satisfied = !gate.missing.includes(kind)
  const expiringEntry = gate.expiring.find((entry) => entry.kind === kind) ?? null

  const current = furthestExpiry(ofKind.filter((credential) => credentialIsValidAt(credential, atIso)))
  const latest = [...ofKind].sort(bySubmittedAtDescending)[0] ?? null
  const expiresOn = current === null ? null : statedExpiry(current)

  // Only interesting while nothing covers the kind: a lapse behind a valid renewal
  // is history, and history is not what a blocked driver needs read back to them.
  const lapsed =
    current !== null
      ? null
      : furthestExpiry(
          ofKind.filter((credential) => {
            const expiry = statedExpiry(credential)

            return (
              credential.status === "approved" &&
              Boolean(credential.documentMedia) &&
              expiry !== null &&
              Date.parse(expiry) <= at
            )
          })
        )

  const pendingRenewal =
    current !== null
      ? null
      : [...ofKind].sort(bySubmittedAtDescending).find((credential) => credential.status === "pending") ?? null

  let state: CredentialSlotState

  if (satisfied) {
    state = expiringEntry === null ? "satisfied" : "expiring_soon"
  } else if (latest === null) {
    state = "nothing_on_file"
  } else {
    // The state describes the driver's most recent submission, because that is what
    // they are waiting on or must act on. Cover lost behind it — a lapsed
    // certificate under a pending renewal — is carried in the detail sentence
    // instead: the driver needs the whole story, not two chips competing to be the
    // headline.
    state = BLOCKED_STATE_FOR_STATUS[latest.status]

    if (state === "expired" && !latest.documentMedia) {
      state = "document_missing"
    }
  }

  const countdownFrom = expiringEntry === null ? expiresOn : expiringEntry.expiresOn

  return {
    current,
    daysUntilExpiry: countdownFrom === null ? null : wholeDaysBetween(atIso, countdownFrom),
    expiresOn,
    kind,
    lapsed,
    latest,
    pendingRenewal,
    satisfied,
    state
  }
}

// ── The driver's vault ────────────────────────────────────────────────────────

export interface DriverCredentialSlotView {
  /** True while this record is one of the reasons the driver cannot accept loads. */
  blocksWork: boolean
  /** Whether asking for another look is a real option on this record right now. */
  canRequestReview: boolean
  /** The whole state of this record, in one or two plain sentences. */
  detail: string
  expiresOnLabel: string | null
  /** True while this record is valid and inside the warning window. */
  expiringSoon: boolean
  /** Whether a booking host receives this photo. Derived, never asserted in copy. */
  hostSeesPhoto: boolean
  /** Exact assigned equipment this kind of photo can be filed against. */
  equipmentOptions: readonly CredentialEquipmentOption[]
  kind: CredentialKind
  kindLabel: string
  /** The day cover was lost, when a lapsed record is why this kind is not held. */
  lapsedOnLabel: string | null
  /** What the driver must send. Empty unless more was asked for. */
  requestedEvidence: readonly string[]
  requirement: string
  /** The record another look would be requested on. null when that is not an option. */
  reviewCredentialId: string | null
  /** Present when asking for another look plainly cannot fix the refusal today. */
  reviewLimitation: string | null
  /** What the reviewer told the driver, verbatim. Driver-facing by contract. */
  reviewNote: string | null
  shortLabel: string
  state: CredentialSlotState
  stateLabel: string
  submittedOnLabel: string | null
  tone: CredentialTone
}

/** The credential-only upload route; storage readiness is still checked separately. */
const CREDENTIAL_DOCUMENT_SIGNATURE_ENDPOINT: string | null = "/api/credentials/signature"

/**
 * What the driver is told when they cannot add a document.
 *
 * Deliberately NOT the operator-facing refusal from `media-config`: that message
 * names storage providers, which is infrastructure detail a driver in a truck can
 * do nothing with. What a driver needs is that it is off, that it is not their
 * fault, and that nothing is being expected of them meanwhile.
 */
const INTAKE_UNAVAILABLE_NOTICE =
  "Document uploads are temporarily unavailable. Nothing has been accepted or lost — try again " +
  "after LogLoads storage is restored."

export interface CredentialIntakeView {
  /** True only when a document sent from this surface would actually be stored. */
  available: boolean
  /** Present whenever `available` is false. States what is true, never "try again". */
  notice: string | null
  /** Where the client requests an upload signature. null while intake is off. */
  signatureEndpoint: string | null
}

/**
 * Whether a driver can store a document right now.
 *
 * Media being configured is NECESSARY and NOT SUFFICIENT — see
 * `CREDENTIAL_DOCUMENT_SIGNATURE_ENDPOINT`. Both conditions are checked here, in
 * one place, so no surface can decide on its own that half of them is enough.
 */
export function credentialIntakeFor(mediaReady: boolean): CredentialIntakeView {
  if (!mediaReady || CREDENTIAL_DOCUMENT_SIGNATURE_ENDPOINT === null) {
    return { available: false, notice: INTAKE_UNAVAILABLE_NOTICE, signatureEndpoint: null }
  }

  return { available: true, notice: null, signatureEndpoint: CREDENTIAL_DOCUMENT_SIGNATURE_ENDPOINT }
}

export interface OutstandingCredentialView {
  kind: CredentialKind
  kindLabel: string
  stateLabel: string
}

export interface CredentialVaultView {
  /**
   * The sentence a blocked driver must never have to infer from an empty load
   * board. Null only when the vault is complete.
   */
  blockedNotice: string | null
  /** Warning about a record that is valid now and lapsing inside the window. */
  expiryNotice: string | null
  headline: string
  /** Acceptance truth for each exact assigned truck/trailer combination. */
  equipmentReadiness: CredentialEquipmentReadinessView[]
  /** Explains that equipment evidence clears only the photographed unit. */
  equipmentNotice: string | null
  /** What a booking host does and does not receive. Derived from the contract. */
  hostDisclosure: string
  intake: CredentialIntakeView
  /**
   * Present when the driver is blocked and there is genuinely nothing they can do
   * from here yet. Saying so is the honest alternative to a control that pretends.
   */
  noActionAvailableNotice: string | null
  /** The records blocking work, in schema order. Empty when the vault is complete. */
  outstanding: OutstandingCredentialView[]
  requiredCount: number
  /** The one field an acceptance guard would read. Taken from the gate. */
  satisfied: boolean
  satisfiedCount: number
  slots: DriverCredentialSlotView[]
}

export interface CredentialEquipmentReadinessView {
  combinationId: string
  label: string
  missingLabels: string[]
  satisfied: boolean
}

function slotDetail(reading: CredentialKindReading, presentation: KindPresentation): string {
  const { daysUntilExpiry, expiresOn, lapsed, latest, pendingRenewal, state } = reading
  const lapsedExpiry = lapsed === null ? null : statedExpiry(lapsed)
  const lapseSentence =
    lapsedExpiry === null
      ? ""
      : ` Your approved record expired on ${dayText(lapsedExpiry)}, and stopped counting that day.`
  const renewalSentence =
    pendingRenewal === null
      ? ""
      : ` The replacement you sent on ${dayText(pendingRenewal.submittedAt)} is being checked.`

  switch (state) {
    case "satisfied":
      return expiresOn === null
        ? "Approved. This record states no expiry date, so it does not lapse."
        : `Approved and in date until ${dayText(expiresOn)}.`

    case "expiring_soon":
      return (
        `Approved, and it expires ${countdownPhrase(daysUntilExpiry ?? 0)}` +
        `${expiresOn === null ? "" : ` (${dayText(expiresOn)})`}. Send the replacement before then — ` +
        "an expired record stops you accepting loads the day it lapses."
      )

    case "nothing_on_file":
      return `Nothing on file. ${presentation.requirement}`

    case "in_review":
      return (
        `Sent ${latest === null ? "recently" : `on ${dayText(latest.submittedAt)}`}. Nobody has decided ` +
        `yet; the decision and the reason for it appear here.${lapseSentence}`
      )

    case "not_approved":
      return latest?.reviewNotes
        ? `Not approved: ${latest.reviewNotes}`
        : "Not approved, and no reason was recorded. Ask for another look so a reason goes on the record."

    case "more_info_required":
      return latest?.reviewNotes
        ? `${latest.reviewNotes} Send what is listed below, then ask for another look.`
        : "The check could not be finished. Send what is listed below, then ask for another look."

    case "expired": {
      // In this state the driver's most recent submission IS the lapsed record, so
      // its own expiry is the date to lead with.
      const ownExpiry = latest === null ? null : statedExpiry(latest)

      return (
        `This was approved${ownExpiry === null ? "" : `, and it expired on ${dayText(ownExpiry)}`}. An ` +
        `expired record stops counting the day it lapses.${renewalSentence}`
      )
    }

    case "document_missing":
      return (
        "This record says approved, but the document itself is not stored, so it counts for nothing. " +
        "It has to be sent again."
      )
  }
}

function slotFor(
  reading: CredentialKindReading,
  options: {
    equipmentOptions: readonly CredentialEquipmentOption[]
    intakeAvailable: boolean
  }
): DriverCredentialSlotView {
  const presentation = KIND_PRESENTATION[reading.kind]
  const statePresentation = SLOT_STATE_PRESENTATION[reading.state]
  const latest = reading.latest
  // Another look is worth asking for on a DECIDED refusal. A pending record is
  // already in the queue, and offering to re-check a queue position would tell the
  // driver something happened when nothing did.
  const canRequestReview =
    latest !== null && (latest.status === "denied" || latest.status === "more_info_required")
  const requestedEvidence = latest?.requestedEvidence ?? []
  const lapsedExpiry = reading.lapsed === null ? null : statedExpiry(reading.lapsed)

  return {
    blocksWork: statePresentation.blocksWork,
    canRequestReview,
    detail: slotDetail(reading, presentation),
    // A label is a field on its own, so an unreadable date renders as no label
    // rather than as a phrase pretending to be one.
    expiresOnLabel: reading.expiresOn === null ? null : formatDay(reading.expiresOn),
    expiringSoon: reading.state === "expiring_soon",
    hostSeesPhoto: HOST_VISIBLE_CREDENTIAL_PHOTO_KINDS.includes(reading.kind),
    equipmentOptions: options.equipmentOptions.filter(
      (candidate) => candidate.kind === reading.kind
    ),
    kind: reading.kind,
    kindLabel: presentation.label,
    lapsedOnLabel: lapsedExpiry === null ? null : formatDay(lapsedExpiry),
    requestedEvidence,
    requirement: presentation.requirement,
    // Named, so the action can only be aimed at the record the driver was shown.
    reviewCredentialId: canRequestReview && latest !== null ? latest.id : null,
    // The honest caveat: a refusal that asked for a better photo cannot be answered
    // by asking again, because no photo can be added while intake is off.
    reviewLimitation:
      canRequestReview && !options.intakeAvailable && requestedEvidence.length > 0
        ? "Another look does not add a photo, and photos cannot be added yet — if the refusal was " +
          "about the image, a second look lands the same way."
        : null,
    reviewNote: latest?.reviewNotes ?? null,
    shortLabel: presentation.shortLabel,
    state: reading.state,
    stateLabel: statePresentation.label,
    submittedOnLabel: latest === null ? null : formatDay(latest.submittedAt),
    tone: statePresentation.tone
  }
}

/**
 * What a booking host will and will not be sent, in the driver's words.
 *
 * Both halves are derived from `HOST_VISIBLE_CREDENTIAL_PHOTO_KINDS`, so this
 * promise cannot drift from what `hostVisibleCredential` actually hands over. A
 * hand-written sentence would go on saying "hosts never see your licence" for
 * exactly as long as it took somebody to add `cdl` to that list.
 */
function hostDisclosureSentence(): string {
  const shared = HOST_VISIBLE_CREDENTIAL_PHOTO_KINDS.map((kind) =>
    KIND_PRESENTATION[kind].label.toLowerCase()
  )
  const withheld = MANDATORY_CREDENTIAL_KINDS.filter(
    (kind) => !HOST_VISIBLE_CREDENTIAL_PHOTO_KINDS.includes(kind)
  ).map((kind) => KIND_PRESENTATION[kind].label.toLowerCase())

  return (
    `A host you haul for is told whether each of these ${MANDATORY_CREDENTIAL_KINDS.length} records is ` +
    `approved and when it expires, and is sent your ${listSentence(shared)}. Your ` +
    `${listSentence(withheld)} stays in this vault — LogLoads does not send either one to a host.`
  )
}

/**
 * The rows these views need, declared as an input rather than reached for. The
 * seeded bench clears exactly one driver on purpose, so a view that could only be
 * exercised against it could prove nothing about a blocked one.
 *
 * `credentialReviews` is deliberately absent: what the driver is told lives on the
 * credential itself (`reviewNotes`, `requestedEvidence`) and is driver-facing by
 * contract, so neither surface has to read the decision history to explain a
 * refusal.
 */
export interface DriverCredentialSource {
  driverCredentials: readonly DriverCredential[]
  equipmentOptions: readonly CredentialEquipmentOption[]
  equipmentSelections: readonly CredentialEquipmentSelectionOption[]
}

export interface CredentialViewOptions {
  /** The caller's clock. Passed in so expiry is testable against fixed instants. */
  at: string
  /** Whether LogLoads can store media at all. Never assumed true. */
  mediaReady: boolean
}

function readingsFor(
  source: DriverCredentialSource,
  driverProfileId: string | null,
  atIso: string
): CredentialKindReading[] {
  // Scoped to one driver before anything is read. A record belonging to another
  // driver must never reach this driver's checklist or a host's summary, and
  // scoping once here is what makes that true of every field below.
  const owned =
    driverProfileId === null
      ? []
      : source.driverCredentials.filter((credential) => credential.driverProfileId === driverProfileId)
  const gate = credentialGateFor(owned, atIso)

  return MANDATORY_CREDENTIAL_KINDS.map((kind) => readKind(kind, owned, gate, atIso))
}

export function buildDriverCredentialVaultView(
  source: DriverCredentialSource,
  driverProfileId: string | null,
  options: CredentialViewOptions
): CredentialVaultView {
  const readings = readingsFor(source, driverProfileId, options.at)
  const intake = credentialIntakeFor(options.mediaReady)
  const equipmentOptions = source.equipmentOptions
  const slots = readings.map((reading) =>
    slotFor(reading, {
      equipmentOptions,
      intakeAvailable: intake.available
    })
  )
  const blocking = slots.filter((slot) => slot.blocksWork)
  const equipmentReadiness = source.equipmentSelections.map((selection) => {
    if (!selection.equipmentUnitNumbersUnique) {
      return {
        combinationId: selection.combinationId,
        label: selection.label,
        missingLabels: ["unique truck and trailer unit numbers"],
        satisfied: false
      }
    }

    const gate = credentialGateForEquipmentSelection(
      source.driverCredentials,
      driverProfileId,
      selection,
      options.at
    )

    return {
      combinationId: selection.combinationId,
      label: selection.label,
      missingLabels: gate.missing.map((kind) => KIND_PRESENTATION[kind].label),
      satisfied: gate.satisfied
    }
  })
  const satisfied = equipmentReadiness.some((selection) => selection.satisfied)
  const requiredCount = MANDATORY_CREDENTIAL_KINDS.length
  const expiring = slots.filter((slot) => slot.expiringSoon)

  const blockedNotice = satisfied
    ? null
    : equipmentReadiness.length === 0
      ? "You cannot accept loads yet. Add and assign a truck and trailer first, then file the " +
        "equipment photos against those exact units."
      : "You cannot accept loads yet. No assigned rig has every required record approved and " +
        `current. ${equipmentReadiness
          .map(
            (rig) =>
              `${rig.label} still needs ${listSentence(rig.missingLabels)}`
          )
          .join("; ")}. Review the exact-rig rows below; a photo of one truck or trailer never clears another.`

  const expiryNotice =
    expiring.length === 0
      ? null
      : `${listSentence(expiring.map((slot) => `${slot.kindLabel} expires ${slot.expiresOnLabel ?? "soon"}`))}. ` +
        `You are warned ${CREDENTIAL_EXPIRY_WARNING_DAYS} days ahead so a renewal never turns into a day ` +
        "you cannot work."

  // Blocked, with no way to upload and nothing to ask another look at, is a real
  // state today: it is what every seeded driver but one is in. It gets its own
  // sentence because "do something" advice with nothing behind it would be worse
  // than silence.
  const noActionAvailableNotice =
    satisfied || intake.available || slots.some((slot) => slot.canRequestReview)
      ? null
      : "There is nothing for you to do here yet. LogLoads cannot store documents at all right now, so " +
        "nobody is waiting on you — and you will not be able to accept loads until that is fixed and " +
        "your records are approved."

  return {
    blockedNotice,
    equipmentReadiness,
    equipmentNotice:
      "Truck and trailer photos clear only the exact unit named with the upload. LogLoads checks " +
      "the truck and trailer selected for every load; a photo of one rig never clears another. " +
      "Duplicate unit numbers must be corrected before either rig can clear.",
    expiryNotice,
    headline: satisfied
      ? "At least one assigned rig is cleared to request loads."
      : "You can't accept loads yet.",
    hostDisclosure: hostDisclosureSentence(),
    intake,
    noActionAvailableNotice,
    outstanding: blocking.map((slot) => ({
      kind: slot.kind,
      kindLabel: slot.kindLabel,
      stateLabel: slot.stateLabel
    })),
    requiredCount,
    satisfied,
    satisfiedCount: requiredCount - blocking.length,
    slots
  }
}

// ── What the host is sent ─────────────────────────────────────────────────────

/**
 * How a host reads one record. THREE values, deliberately fewer than the driver's
 * eight.
 *
 * A host is entitled to status and expiry. They are not entitled to a driver's
 * refusal history: whether a record is absent, queued, sent back for a better photo
 * or refused outright are all the same fact to a host — this driver is not cleared
 * for that record — and routing the difference to every booking host would be
 * exposure with nothing behind it. The service's summary withholds it at source, so
 * this narrowing is enforced by not having the data rather than by remembering not
 * to render it.
 */
export const HOST_CREDENTIAL_STATES = ["approved", "expires_soon", "not_current"] as const

export type HostCredentialState = (typeof HOST_CREDENTIAL_STATES)[number]

const HOST_STATE_PRESENTATION: Record<HostCredentialState, { label: string; tone: CredentialTone }> = {
  approved: { label: "Approved", tone: "success" },
  expires_soon: { label: "Expires soon", tone: "warning" },
  not_current: { label: "Not current", tone: "critical" }
}

export interface HostCredentialLineView {
  /** True when this record is approved and in date right now. */
  current: boolean
  expiresOnLabel: string | null
  kind: CredentialKind
  kindLabel: string
  /** What the host needs to know about this record, and nothing more. */
  note: string | null
  /**
   * Whether an equipment photo is stored. A BOOLEAN, not a reference: the host is
   * entitled to see the truck and the trailer, and publishing the media identifier
   * is not what that requires. A host-facing photo route would resolve the asset
   * server-side from the assignment and the kind, so nothing in this response has
   * to carry one.
   */
  photoOnFile: boolean
  /**
   * Where the host's browser fetches that photo. null while nothing can serve it —
   * see `CREDENTIAL_PHOTO_ROUTE`. A surface renders an image only when this is set,
   * so it can never point at an endpoint that does not exist.
   */
  photoSrc: string | null
  state: HostCredentialState
  stateLabel: string
  tone: CredentialTone
}

export interface HostDriverCredentialSummaryView {
  /** Set when something is not current now. Says only what LogLoads can stand behind. */
  attentionNotice: string | null
  /** The exact claim LogLoads makes, from the contract. Never reworded on a surface. */
  assurance: string
  /** True when every mandatory record is approved and in date at this instant. */
  complete: boolean
  headline: string
  lines: HostCredentialLineView[]
  /** Present when equipment photos exist but cannot be shown yet. */
  photoNotice: string | null
  /** What LogLoads withheld, and why, so the host is not left guessing. */
  withheldNote: string
}

/**
 * Where a host-visible equipment photo would be fetched from — and why it is null.
 *
 * The same two conditions as document intake (a LogLoads media account, and a route
 * that exists) with a third: no HOST-facing credential photo route has been built.
 * `/api/media/asset` serves the VIEWER's own profile photos, so pointing a host at
 * it would either 404 or hand them a picture of their own truck — the second being
 * the failure nobody would report as a bug.
 *
 * Kept as a value for the same reason as the intake endpoint: the surface renders an
 * image only when a src exists, so it cannot show a broken one. Set it in the same
 * change that adds the route.
 */
const CREDENTIAL_PHOTO_ROUTE: string | null = null

function photoSrcFor(
  driverProfileId: string,
  kind: CredentialKind,
  options: { mediaReady: boolean; photoOnFile: boolean }
): string | null {
  if (!options.photoOnFile || !options.mediaReady || CREDENTIAL_PHOTO_ROUTE === null) {
    return null
  }

  return `${CREDENTIAL_PHOTO_ROUTE}?driverProfileId=${encodeURIComponent(driverProfileId)}&kind=${kind}`
}

function hostLineFor(
  kind: CredentialKind,
  summary: HostCredentialSummary,
  options: { mediaReady: boolean }
): HostCredentialLineView {
  const presentation = KIND_PRESENTATION[kind]
  // The service hands over one entry per kind the driver CURRENTLY holds valid, each
  // already through `hostVisibleCredential`. An absent entry is the whole of what a
  // host is told about a record that is not clearing the driver.
  const clearing = summary.credentials.find((entry) => entry.kind === kind) ?? null
  const expiring = summary.expiring.find((entry) => entry.kind === kind) ?? null
  const state: HostCredentialState =
    clearing === null ? "not_current" : expiring === null ? "approved" : "expires_soon"
  const statePresentation = HOST_STATE_PRESENTATION[state]
  const photoOnFile = clearing !== null && clearing.photo !== null
  const expiresOn = clearing?.expiresOn ?? null

  return {
    current: clearing !== null,
    expiresOnLabel: expiresOn === null ? null : formatDay(expiresOn),
    kind,
    kindLabel: presentation.label,
    note:
      state === "not_current"
        ? "LogLoads has no current approved record for this."
        : state === "expires_soon" && expiresOn !== null
          ? `Approved, and expires on ${dayText(expiresOn)}.`
          : null,
    photoOnFile,
    photoSrc: photoSrcFor(summary.driverProfileId, kind, {
      mediaReady: options.mediaReady,
      photoOnFile
    }),
    state,
    stateLabel: statePresentation.label,
    tone: statePresentation.tone
  }
}

/**
 * The host's view, built on the SERVICE's projection rather than on the rows.
 *
 * `hostCredentialSummary` is where the four-field projection and the
 * currently-clearing-only rule live, and where the acceptance path builds the same
 * summary inside its own mutation. Taking its output as the input here is what makes
 * the host surface and the summary that travels with an acceptance the same thing:
 * this function cannot disclose a refusal history, an image or an identifier, because
 * it is never handed one.
 */
export function buildHostDriverCredentialSummary(
  summary: HostCredentialSummary,
  options: { mediaReady: boolean }
): HostDriverCredentialSummaryView {
  const lines = MANDATORY_CREDENTIAL_KINDS.map((kind) =>
    hostLineFor(kind, summary, { mediaReady: options.mediaReady })
  )
  const notCurrent = lines.filter((line) => !line.current)
  const complete = notCurrent.length === 0
  const withheld = MANDATORY_CREDENTIAL_KINDS.filter(
    (kind) => !HOST_VISIBLE_CREDENTIAL_PHOTO_KINDS.includes(kind)
  ).map((kind) => KIND_PRESENTATION[kind].label.toLowerCase())
  const photosOnFile = lines.filter((line) => line.photoOnFile)

  return {
    // Present tense only. This module can see what is on file now; it cannot see
    // what was true when the driver accepted the load, so it does not say.
    attentionNotice: complete
      ? null
      : `Not current right now: ${listSentence(notCurrent.map((line) => line.kindLabel))}. LogLoads has ` +
        "not approved those as in date today, so treat them as unconfirmed.",
    // The service's copy of the contract's sentence, passed through untouched. Taking
    // it from the summary rather than importing it again means the words a host reads
    // are the same ones the acceptance summary carried.
    assurance: summary.assurance,
    complete,
    headline: complete
      ? `${listSentence(MANDATORY_CREDENTIAL_KINDS.map((kind) => KIND_PRESENTATION[kind].label))} — each ` +
        "one submitted, checked for consistency and expiry, and approved."
      : `${notCurrent.length} of ${MANDATORY_CREDENTIAL_KINDS.length} records are not current.`,
    lines,
    // Said out loud, because a photo silently missing from an equipment record reads
    // as a driver who did not send one.
    photoNotice:
      photosOnFile.length > 0 && photosOnFile.every((line) => line.photoSrc === null)
        ? "The equipment photos on file cannot be displayed yet: LogLoads has no document storage of " +
          "its own switched on, so there is nothing to fetch them from."
        : null,
    withheldNote:
      `LogLoads does not send you the driver's ${listSentence(withheld)}. Those carry personal ` +
      "identifiers nobody needs in order to know the records were checked."
  }
}

// ── Server helpers ────────────────────────────────────────────────────────────

/**
 * The live vault for one driver. Never call from a client component.
 *
 * AUTHORIZATION IS THE SERVICE'S. `listDriverCredentials` decides who may read a
 * vault — the driver themselves, or a member of their own outfit holding
 * `manage_drivers` — and THROWS otherwise. Reading `services.state` here instead
 * would be a second, weaker answer to the same question, in the place least likely
 * to be reviewed. The page is expected to let that throw rather than catch it into
 * an empty vault: a driver shown four blank records would read them as "you have
 * submitted nothing", which is a different and much worse claim than "you are not
 * allowed to see this".
 *
 * Reads state synchronously, like every other cockpit read helper, so it must run
 * AFTER the request has awaited its cockpit context — that await is what refreshes
 * the operating-state document. Called before it, this would show a driver last
 * request's vault, which on this surface means telling somebody they are blocked
 * after they were cleared.
 */
export function getDriverCredentialVaultView(
  driverProfileId: string,
  viewer: CredentialViewer
): CredentialVaultView {
  const at = new Date().toISOString()
  const view = services.listDriverCredentials(driverProfileId, viewer, at)

  if (view.audience === "host") {
    // Unreachable for a driver or fleet viewer, and refused rather than rendered if
    // it ever happens: the host branch carries no documents, so a vault built from it
    // would tell a driver they had submitted nothing.
    throw new Error("A host audience cannot read a driver's vault")
  }

  return buildDriverCredentialVaultView(
    {
      driverCredentials: view.credentials,
      equipmentOptions: view.equipmentOptions,
      equipmentSelections: view.equipmentSelections
    },
    driverProfileId,
    {
      at,
      mediaReady: isDedicatedMediaConfigured(process.env)
    }
  )
}

/**
 * The credential summary a host receives for a driver on their work.
 *
 * Authorization is the service's here too: `listDriverCredentials` asserts that this
 * driver actually hauls for the host's organization before it will project anything,
 * and it returns the host shape — which has no field for an image, an identifier or a
 * review note — rather than filtering a fuller object down. A caller cannot ask for
 * the vault by passing a different audience, because the audience decides the return
 * shape and the compiler knows it.
 */
export function getHostDriverCredentialSummary(
  driverProfileId: string,
  viewer: Extract<CredentialViewer, { audience: "host" }>
): HostDriverCredentialSummaryView {
  const view = services.listDriverCredentials(driverProfileId, viewer, new Date().toISOString())

  if (view.audience !== "host") {
    throw new Error("Expected the host projection for a host audience")
  }

  return buildHostDriverCredentialSummary(view, {
    mediaReady: isDedicatedMediaConfigured(process.env)
  })
}

/**
 * What these surfaces claim to cover, taken from the schemas rather than listed by
 * hand. Exported for the test that proves the presentation records stay exhaustive
 * at runtime as well as at compile time: a `Record` keyed by a union is checked by
 * the compiler, and a union widened somewhere else is not.
 */
export const CREDENTIAL_PRESENTATION_COVERAGE = {
  kinds: credentialKindSchema.options,
  slotStates: CREDENTIAL_SLOT_STATES,
  statuses: credentialStatusSchema.options
} as const
