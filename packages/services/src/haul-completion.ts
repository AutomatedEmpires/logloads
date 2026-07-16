import {
  deliveredQuantitySchema,
  haulExceptionSchema,
  tripSchemaV2,
  type DeliveredQuantity,
  type HaulException,
  type TripDocument,
  type TripV2
} from "@logloads/contracts"

import type { LogLoadsDatabaseState } from "@logloads/db"

import { assertCondition, assertFound, nowIso } from "./utils"

/** Documents a driver may offer as proof a haul was delivered. */
const EVIDENCE_TYPES: ReadonlyArray<TripDocument["type"]> = [
  "scale_ticket",
  "load_slip",
  "delivery_record",
  "photo"
]

/**
 * Exceptions where no ticket can exist because no delivery happened. Anything
 * else — a short load, a long wait, an unexplained "other" — was still weighed
 * and ticketed, so it owes the same proof as a clean haul. The exception is
 * written by the driver, the party the evidence exists to check, so it cannot
 * be a blanket key to the gate.
 */
const EXCEPTIONS_WITHOUT_EVIDENCE: ReadonlyArray<HaulException["type"]> = [
  "rejected_at_scale",
  "access_blocked",
  "equipment_failure",
  "weather_hold"
]

export function exceptionWaivesEvidence(exception: HaulException | null | undefined): boolean {
  return Boolean(exception) && EXCEPTIONS_WITHOUT_EVIDENCE.includes(exception!.type)
}

export function listTripDocuments(state: LogLoadsDatabaseState, tripId: string): TripDocument[] {
  return state.tripDocuments
    .filter((document) => document.tripId === tripId)
    .sort((left, right) => left.uploadedAt.localeCompare(right.uploadedAt))
}

export function hasCompletionEvidence(state: LogLoadsDatabaseState, tripId: string): boolean {
  return listTripDocuments(state, tripId).some((document) => EVIDENCE_TYPES.includes(document.type))
}

/**
 * What the host asked the driver to come away with, as it was written into the
 * Route Pack the driver accepted — not as the destination record reads today.
 * The requirement a driver was given is the requirement they are held to.
 *
 * Falls back to the host's load-level source the same way getRoutePackForAssignment
 * does, so the gate reads whichever pack the driver is actually looking at. A
 * haul booked before packs carried snapshots has no recorded requirement and so
 * no gate — the host establishes one by re-issuing the pack, which mints a
 * snapshot. Inventing a requirement from today's destination record would hold
 * a driver to something they were never told.
 */
export function requiredCompletionEvidence(state: LogLoadsDatabaseState, trip: TripV2): string[] {
  const assignmentPack = state.routePacks
    .filter((candidate) => candidate.assignmentId === trip.assignmentId && !candidate.supersededAt)
    .sort((left, right) => right.version - left.version)[0]
  const pack = assignmentPack ??
    state.routePacks.find(
      (candidate) => candidate.loadPostingId === trip.loadPostingId && !candidate.assignmentId
    )

  return pack?.snapshot?.completionEvidence ?? []
}

export interface SubmitHaulCompletionInput {
  deliveredQuantity?: DeliveredQuantity | null
  exception?: Omit<HaulException, "reportedAt"> | null
  actorUserId: string
  trip: TripV2
}

export interface HaulCompletionResult {
  trip: TripV2
  previousStatus: TripV2["completionStatus"]
}

/**
 * The driver's account of the haul: what came off the truck, and any exception
 * that explains it. Delivering nothing is a real outcome (rejected at the
 * scale, access blocked), so a zero quantity is allowed — but it must be
 * explained, otherwise "0" is indistinguishable from a mis-tap.
 */
export function applyHaulCompletionSubmission(
  state: LogLoadsDatabaseState,
  input: SubmitHaulCompletionInput,
  timestamp = nowIso()
): HaulCompletionResult {
  const { actorUserId, trip } = input

  assertCondition(
    trip.completionStatus !== "confirmed",
    "This haul is confirmed; ask the host to reopen it before changing the record"
  )

  const quantity = input.deliveredQuantity ? deliveredQuantitySchema.parse(input.deliveredQuantity) : null
  const exception = input.exception
    ? haulExceptionSchema.parse({ ...input.exception, reportedAt: timestamp })
    : null

  assertCondition(
    Boolean(quantity) || Boolean(exception),
    "Record what was delivered, or report the exception that explains why nothing was"
  )
  assertCondition(
    !quantity || quantity.value > 0 || Boolean(exception),
    "A zero delivery needs an exception explaining it"
  )

  const updated = tripSchemaV2.parse({
    ...trip,
    completionDisputeReason: null,
    completionStatus: "submitted",
    completionSubmittedAt: timestamp,
    completionSubmittedByUserId: actorUserId,
    deliveredQuantity: quantity,
    haulException: exception,
    updatedAt: timestamp
  })

  state.tripsV2 = state.tripsV2.map((current) => (current.id === trip.id ? updated : current))

  return { previousStatus: trip.completionStatus, trip: updated }
}

export interface ConfirmHaulCompletionInput {
  actorUserId: string
  trip: TripV2
}

/** The host accepting the driver's account. Terminal: the record is settled. */
export function applyHaulCompletionConfirmation(
  state: LogLoadsDatabaseState,
  input: ConfirmHaulCompletionInput,
  timestamp = nowIso()
): HaulCompletionResult {
  const { actorUserId, trip } = input

  // Only from `submitted`. Confirming straight out of `disputed` would settle
  // the very figure the host contested, without the driver ever answering.
  assertCondition(
    trip.completionStatus === "submitted",
    `Only a submitted haul can be confirmed, and this one is ${trip.completionStatus}`
  )

  const updated = tripSchemaV2.parse({
    ...trip,
    completionConfirmedAt: timestamp,
    completionConfirmedByUserId: actorUserId,
    completionDisputeReason: null,
    completionStatus: "confirmed",
    updatedAt: timestamp
  })

  state.tripsV2 = state.tripsV2.map((current) => (current.id === trip.id ? updated : current))

  return { previousStatus: trip.completionStatus, trip: updated }
}

export interface DisputeHaulCompletionInput {
  actorUserId: string
  reason: string
  trip: TripV2
}

/**
 * The host contesting the account. Not terminal and not a rejection of the
 * haul: the driver's figures stay on the record, the reason is attached, and
 * the driver can resubmit.
 */
export function applyHaulCompletionDispute(
  state: LogLoadsDatabaseState,
  input: DisputeHaulCompletionInput,
  timestamp = nowIso()
): HaulCompletionResult {
  // The disputing actor is deliberately not recorded on the trip: nobody
  // confirmed anything. Who disputed, and why, lives on the audit event and
  // the dispute reason.
  const { trip } = input
  const reason = input.reason.trim()

  assertCondition(reason.length > 0, "Say what is wrong with the delivered record")
  assertCondition(reason.length <= 500, "Keep the dispute reason under 500 characters")
  assertCondition(
    trip.completionStatus === "submitted",
    `Only a submitted haul can be disputed, and this one is ${trip.completionStatus}`
  )

  // Nobody confirmed anything, so the confirmed-by fields stay empty rather
  // than naming the disputer as the confirmer. Who disputed, and why, is on
  // the audit event and the dispute reason.
  const updated = tripSchemaV2.parse({
    ...trip,
    completionConfirmedAt: null,
    completionConfirmedByUserId: null,
    completionDisputeReason: reason,
    completionStatus: "disputed",
    updatedAt: timestamp
  })

  state.tripsV2 = state.tripsV2.map((current) => (current.id === trip.id ? updated : current))

  return { previousStatus: trip.completionStatus, trip: updated }
}

export function getTripById(state: LogLoadsDatabaseState, tripId: string): TripV2 {
  return assertFound(
    state.tripsV2.find((current) => current.id === tripId),
    `Trip ${tripId} was not found`
  )
}
