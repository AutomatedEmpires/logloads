import { type LogLoadsDatabaseState } from "@logloads/db"

import { assignDriverToSlot, cancelAssignment, requestAssignment } from "./assignments"
import { listDriverAvailability, upsertAvailabilityWindow } from "./availability"
import { createLoadPosting, getLoadById, listOpenLoads, updateLoadPosting } from "./loads"
import { createNotification, listNotificationsForUser } from "./notifications"
import { getRouteById, listRoutes } from "./routes"
import { createTruckSlot, listTruckSlotsForDate } from "./truck-slots"
import { createServiceState } from "./utils"

export function createLogLoadsServices(seed?: LogLoadsDatabaseState) {
  const state = createServiceState(seed)

  return {
    state,
    assignDriverToSlot: (assignmentId: string) => assignDriverToSlot(state, assignmentId),
    cancelAssignment: (assignmentId: string, cancellationReason: string) =>
      cancelAssignment(state, assignmentId, cancellationReason),
    createLoadPosting: (input: unknown) => createLoadPosting(state, input),
    createNotification: (input: unknown) => createNotification(state, input),
    createTruckSlot: (input: unknown) => createTruckSlot(state, input),
    getLoadById: (loadId: string) => getLoadById(state, loadId),
    getRouteById: (routeId: string) => getRouteById(state, routeId),
    listDriverAvailability: (driverProfileId?: string) => listDriverAvailability(state, driverProfileId),
    listNotificationsForUser: (userId: string) => listNotificationsForUser(state, userId),
    listOpenLoads: () => listOpenLoads(state),
    listRoutes: () => listRoutes(state),
    listTruckSlotsForDate: (date: string) => listTruckSlotsForDate(state, date),
    requestAssignment: (input: unknown) => requestAssignment(state, input),
    updateLoadPosting: (input: unknown) => updateLoadPosting(state, input),
    upsertAvailabilityWindow: (input: unknown) => upsertAvailabilityWindow(state, input)
  }
}

export type LogLoadsServices = ReturnType<typeof createLogLoadsServices>