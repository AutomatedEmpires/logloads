import type { AssignmentStatus, LoadStatus, TruckSlotStatus } from "./enums"

const loadPostingTransitions: Record<LoadStatus, LoadStatus[]> = {
  archived: [],
  cancelled: ["archived"],
  completed: ["archived"],
  draft: ["open", "cancelled"],
  // filled -> open: a cancellation or decline returns committed capacity.
  // filled -> completed: the final truckload delivered (mirrors the v2
  // opportunity machine, which never required passing through in_transit).
  filled: ["open", "in_transit", "completed", "cancelled"],
  in_transit: ["completed", "cancelled"],
  open: ["scheduled", "filled", "cancelled"],
  scheduled: ["filled", "cancelled"]
}

const truckSlotTransitions: Record<TruckSlotStatus, TruckSlotStatus[]> = {
  cancelled: [],
  completed: [],
  filled: ["reserved", "completed", "cancelled"],
  open: ["requested", "reserved", "cancelled"],
  requested: ["open", "reserved", "cancelled"],
  reserved: ["open", "filled", "cancelled"]
}

const assignmentTransitions: Record<AssignmentStatus, AssignmentStatus[]> = {
  accepted: ["checked_in", "cancelled"],
  cancelled: [],
  checked_in: ["loading", "cancelled"],
  completed: [],
  declined: [],
  hauled: ["completed", "cancelled"],
  loading: ["hauled", "cancelled"],
  offered: ["accepted", "declined", "cancelled"],
  requested: ["offered", "declined", "cancelled"]
}

function transitionOrThrow<T extends string>(current: T, next: T, allowed: Record<T, T[]>): T {
  if (!allowed[current].includes(next)) {
    throw new Error(`Invalid transition from ${current} to ${next}`)
  }

  return next
}

export function canTransitionLoadPostingStatus(current: LoadStatus, next: LoadStatus): boolean {
  return loadPostingTransitions[current].includes(next)
}

export function transitionLoadPostingStatus(current: LoadStatus, next: LoadStatus): LoadStatus {
  return transitionOrThrow(current, next, loadPostingTransitions)
}

export function canTransitionTruckSlotStatus(current: TruckSlotStatus, next: TruckSlotStatus): boolean {
  return truckSlotTransitions[current].includes(next)
}

export function transitionTruckSlotStatus(current: TruckSlotStatus, next: TruckSlotStatus): TruckSlotStatus {
  return transitionOrThrow(current, next, truckSlotTransitions)
}

export function canTransitionAssignmentStatus(current: AssignmentStatus, next: AssignmentStatus): boolean {
  return assignmentTransitions[current].includes(next)
}

export function transitionAssignmentStatus(current: AssignmentStatus, next: AssignmentStatus): AssignmentStatus {
  return transitionOrThrow(current, next, assignmentTransitions)
}

export const stateMachines = {
  assignmentTransitions,
  loadPostingTransitions,
  truckSlotTransitions
}
