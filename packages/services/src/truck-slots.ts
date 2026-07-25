import {
  createTruckSlotInputSchema,
  toDateKey,
  truckSlotSchema,
  transitionTruckSlotStatus,
  type TruckSlot
} from "@logloads/contracts"
import type { LogLoadsDatabaseState } from "@logloads/db"

import { assertOrganizationAction, getActiveOrganizationContext } from "./operating-network"
import { assertFound, createUuid, nowIso } from "./utils"

export function listTruckSlotsForDate(state: LogLoadsDatabaseState, date: string): TruckSlot[] {
  return state.truckSlots.filter((slot) => toDateKey(slot.startAt) === date || slot.slotDate === date)
}

export function getTruckSlotById(state: LogLoadsDatabaseState, slotId: string): TruckSlot | undefined {
  return state.truckSlots.find((slot) => slot.id === slotId)
}

/**
 * Creating a slot writes to a specific load posting, so the caller must own
 * that posting — membership in the organization they *name* is not the same
 * question.
 *
 * `POST /api/truck-slots` guarded only with `requireApiActor(payload.organizationId)`,
 * which asks "are you a member of the org you claimed?" and never "does this
 * posting belong to it". A member of one organization could therefore pass
 * their own organization id alongside another organization's `loadPostingId`
 * and add slots to that stranger's work. The gate lives here rather than in
 * the route because the route is not the only possible caller.
 */
export function createTruckSlot(
  state: LogLoadsDatabaseState,
  input: unknown,
  context: { actorUserId: string; organizationId: string }
): TruckSlot {
  const parsed = createTruckSlotInputSchema.parse(input)

  const posting = assertFound(
    state.loadPostings.find((entry) => entry.id === parsed.loadPostingId),
    `Load posting ${parsed.loadPostingId} was not found`
  )

  if (posting.companyId !== context.organizationId) {
    throw new Error("You cannot add slots to another organization's load posting")
  }

  // Belonging to the organization is not permission to act for it. A slot is
  // the capacity a posting offers, so adding one is publishing work —
  // `viewer` holds only view_network and maps to no cockpit anywhere.
  assertOrganizationAction(
    getActiveOrganizationContext(state, context.actorUserId, context.organizationId),
    "publish_load"
  )

  const timestamp = nowIso()
  const entity = truckSlotSchema.parse({
    ...parsed,
    createdAt: timestamp,
    id: createUuid(),
    reservedCount: 0,
    updatedAt: timestamp
  })

  state.truckSlots.push(entity)

  return entity
}

export function reserveTruckSlot(state: LogLoadsDatabaseState, slotId: string): TruckSlot {
  const slot = assertFound(getTruckSlotById(state, slotId), `Truck slot ${slotId} was not found`)

  if (!["open", "requested", "reserved"].includes(slot.status)) {
    throw new Error(`Truck slot ${slotId} cannot be reserved while ${slot.status}`)
  }

  if (slot.reservedCount >= slot.capacity) {
    throw new Error(`Truck slot ${slotId} is already at capacity`)
  }

  const nextStatus = slot.status === "open" ? transitionTruckSlotStatus("open", "requested") : slot.status
  const updated = truckSlotSchema.parse({
    ...slot,
    reservedCount: slot.reservedCount + 1,
    status: nextStatus,
    updatedAt: nowIso()
  })

  state.truckSlots = state.truckSlots.map((current) => (current.id === slotId ? updated : current))

  return updated
}

export function confirmTruckSlot(state: LogLoadsDatabaseState, slotId: string): TruckSlot {
  const slot = assertFound(getTruckSlotById(state, slotId), `Truck slot ${slotId} was not found`)
  const nextStatus = slot.status === "requested" ? transitionTruckSlotStatus("requested", "reserved") : slot.status
  const updated = truckSlotSchema.parse({
    ...slot,
    status: nextStatus,
    updatedAt: nowIso()
  })

  state.truckSlots = state.truckSlots.map((current) => (current.id === slotId ? updated : current))

  return updated
}

export function releaseTruckSlotReservation(state: LogLoadsDatabaseState, slotId: string): TruckSlot {
  const slot = assertFound(getTruckSlotById(state, slotId), `Truck slot ${slotId} was not found`)
  const reservedCount = Math.max(0, slot.reservedCount - 1)
  const status = reservedCount === 0 && ["requested", "reserved"].includes(slot.status)
    ? "open"
    : slot.status

  const updated = truckSlotSchema.parse({
    ...slot,
    reservedCount,
    status,
    updatedAt: nowIso()
  })

  state.truckSlots = state.truckSlots.map((current) => (current.id === slotId ? updated : current))

  return updated
}
