import {
  assignmentSchema,
  requestAssignmentInputSchema,
  transitionAssignmentStatus,
  type Assignment
} from "@logloads/contracts"
import type { LogLoadsDatabaseState } from "@logloads/db"

import { listDriverAvailability } from "./availability"
import { getLoadById } from "./loads"
import { confirmTruckSlot, getTruckSlotById, releaseTruckSlotReservation, reserveTruckSlot } from "./truck-slots"
import { assertCondition, assertFound, createUuid, nowIso } from "./utils"

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
  const entity = assignmentSchema.parse({
    ...parsed,
    assignedAt: null,
    cancelledAt: null,
    completedAt: null,
    createdAt: timestamp,
    id: createUuid(),
    requestedAt: timestamp,
    status: "requested",
    updatedAt: timestamp
  })

  state.assignments.push(entity)

  return entity
}

export function assignDriverToSlot(state: LogLoadsDatabaseState, assignmentId: string): Assignment {
  const assignment = assertFound(
    state.assignments.find((current) => current.id === assignmentId),
    `Assignment ${assignmentId} was not found`
  )

  assertCondition(
    ["requested", "offered"].includes(assignment.status),
    "Only a requested or offered assignment can be approved"
  )

  const offered = assignment.status === "requested"
    ? transitionAssignmentStatus("requested", "offered")
    : assignment.status
  const accepted = offered === "offered" ? transitionAssignmentStatus("offered", "accepted") : offered

  confirmTruckSlot(state, assignment.truckSlotId)

  const updated = assignmentSchema.parse({
    ...assignment,
    assignedAt: nowIso(),
    status: accepted,
    updatedAt: nowIso()
  })

  state.assignments = state.assignments.map((current) =>
    current.id === assignmentId ? updated : current
  )

  return updated
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

export function cancelAssignment(
  state: LogLoadsDatabaseState,
  assignmentId: string,
  cancellationReason: string
): Assignment {
  const assignment = assertFound(
    state.assignments.find((current) => current.id === assignmentId),
    `Assignment ${assignmentId} was not found`
  )

  const updated = assignmentSchema.parse({
    ...assignment,
    cancelledAt: nowIso(),
    cancellationReason,
    status: transitionAssignmentStatus(assignment.status, "cancelled"),
    updatedAt: nowIso()
  })

  releaseTruckSlotReservation(state, assignment.truckSlotId)

  state.assignments = state.assignments.map((current) =>
    current.id === assignmentId ? updated : current
  )

  return updated
}
