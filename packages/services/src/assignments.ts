import {
  assignmentSchema,
  deterministicUuidV5,
  requestAssignmentInputSchema,
  transitionAssignmentStatus,
  type Assignment
} from "@logloads/contracts"
import type { LogLoadsDatabaseState } from "@logloads/db"

import { listDriverAvailability } from "./availability"
import { getLoadById } from "./loads"
import { getTruckSlotById, releaseTruckSlotReservation, reserveTruckSlot } from "./truck-slots"
import { assertCondition, assertFound, createUuid, nowIso } from "./utils"

const TRUCK_SLOT_MOVEMENT_NAMESPACE = "bff3cff1-680d-43d5-9f3c-afd50c06ad7e"

function movementIdForAssignmentRequest(
  state: LogLoadsDatabaseState,
  truckSlotId: string
): string {
  const slotAssignments = state.assignments.filter(
    (assignment) => assignment.truckSlotId === truckSlotId
  )
  const activeMovementIds = new Set(
    slotAssignments
      .filter((assignment) =>
        !["cancelled", "declined"].includes(assignment.status)
      )
      .map((assignment) => assignment.loadMovementId)
      .filter((movementId): movementId is string => Boolean(movementId))
  )
  const settledMovementIds = new Set([
    ...state.networkUsageEvents.map((event) => event.loadMovementId),
    ...state.platformFeeEvents
      .filter((event) => event.status !== "voided")
      .flatMap((event) =>
        slotAssignments
          .filter((assignment) => assignment.id === event.assignmentId)
          .map((assignment) => assignment.loadMovementId)
          .filter((movementId): movementId is string => Boolean(movementId))
      )
  ])
  const reusable = [...slotAssignments]
    .filter(
      (assignment) =>
        ["cancelled", "declined"].includes(assignment.status) &&
        Boolean(assignment.loadMovementId) &&
        !activeMovementIds.has(assignment.loadMovementId as string) &&
        !settledMovementIds.has(assignment.loadMovementId as string)
    )
    .sort(
      (left, right) =>
        Date.parse(right.updatedAt) - Date.parse(left.updatedAt) ||
        right.id.localeCompare(left.id)
    )[0]?.loadMovementId

  if (reusable) return reusable
  if (slotAssignments.length === 0) return truckSlotId

  const existingMovementIds = new Set(
    slotAssignments
      .map((assignment) => assignment.loadMovementId)
      .filter((movementId): movementId is string => Boolean(movementId))
  )
  let ordinal = existingMovementIds.size + 1
  let candidate = deterministicUuidV5(
    TRUCK_SLOT_MOVEMENT_NAMESPACE,
    `${truckSlotId}:${ordinal}`
  )

  while (existingMovementIds.has(candidate)) {
    ordinal += 1
    candidate = deterministicUuidV5(
      TRUCK_SLOT_MOVEMENT_NAMESPACE,
      `${truckSlotId}:${ordinal}`
    )
  }

  return candidate
}

export function requestAssignment(state: LogLoadsDatabaseState, input: unknown): Assignment {
  const parsed = requestAssignmentInputSchema.parse(input)
  const load = assertFound(getLoadById(state, parsed.loadPostingId), `Load posting ${parsed.loadPostingId} was not found`)
  const slot = assertFound(getTruckSlotById(state, parsed.truckSlotId), `Truck slot ${parsed.truckSlotId} was not found`)

  assertCondition(
    slot.loadPostingId === load.id,
    `Truck slot ${slot.id} does not belong to load posting ${load.id}`
  )

  assertCondition(slot.reservedCount < slot.capacity, `Truck slot ${slot.id} is already at capacity`)

  const availability = listDriverAvailability(state, parsed.driverProfileId).find(
    (window) => window.startAt <= slot.startAt && window.endAt >= slot.endAt && window.status !== "unavailable"
  )

  assertCondition(Boolean(availability), `Driver ${parsed.driverProfileId} is not available for slot ${slot.id}`)

  reserveTruckSlot(state, slot.id)

  const timestamp = nowIso()
  const assignmentId = createUuid()
  const entity = assignmentSchema.parse({
    ...parsed,
    assignedAt: null,
    billingCommittedAt: null,
    billingModel: null,
    billingPlanCodeAtCommitment: null,
    billingSubscriptionIdAtCommitment: null,
    cancelledAt: null,
    capacitySource: null,
    completedAt: null,
    createdAt: timestamp,
    id: assignmentId,
    // The reservation identity survives a cancelled/released assignment. The
    // first capacity position uses the slot id itself; multi-capacity slots get
    // deterministic additional identities, and a replacement reclaims the
    // released identity instead of minting a second billable truck movement.
    loadMovementId: movementIdForAssignmentRequest(state, slot.id),
    requestedAt: timestamp,
    status: "requested",
    updatedAt: timestamp
  })

  state.assignments.push(entity)

  return entity
}

export function declineAssignment(
  state: LogLoadsDatabaseState,
  assignmentId: string,
  reason: string
): Assignment {
  const assignment = assertFound(
    state.assignments.find((current) => current.id === assignmentId),
    `Assignment ${assignmentId} was not found`
  )

  assertCondition(
    ["requested", "offered"].includes(assignment.status),
    "Only a requested or offered assignment can be declined"
  )

  const timestamp = nowIso()
  const updated = assignmentSchema.parse({
    ...assignment,
    cancelledAt: timestamp,
    cancellationReason: reason,
    status: transitionAssignmentStatus(assignment.status, "declined"),
    updatedAt: timestamp
  })

  releaseTruckSlotReservation(state, assignment.truckSlotId)
  state.assignments = state.assignments.map((current) => current.id === assignmentId ? updated : current)

  return updated
}
