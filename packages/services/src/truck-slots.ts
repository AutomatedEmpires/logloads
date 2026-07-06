import {
  createTruckSlotInputSchema,
  toDateKey,
  truckSlotSchema,
  transitionTruckSlotStatus,
  type TruckSlot
} from "@logloads/contracts"
import type { LogLoadsDatabaseState } from "@logloads/db"

import { assertFound, createUuid, nowIso } from "./utils"

export function listTruckSlotsForDate(state: LogLoadsDatabaseState, date: string): TruckSlot[] {
  return state.truckSlots.filter((slot) => toDateKey(slot.startAt) === date || slot.slotDate === date)
}

export function getTruckSlotById(state: LogLoadsDatabaseState, slotId: string): TruckSlot | undefined {
  return state.truckSlots.find((slot) => slot.id === slotId)
}

export function createTruckSlot(state: LogLoadsDatabaseState, input: unknown): TruckSlot {
  const parsed = createTruckSlotInputSchema.parse(input)
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