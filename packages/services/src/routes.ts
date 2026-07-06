import type { HaulRoute } from "@logloads/contracts"
import type { LogLoadsDatabaseState } from "@logloads/db"

export function listRoutes(state: LogLoadsDatabaseState): HaulRoute[] {
  return state.haulRoutes
}

export function getRouteById(state: LogLoadsDatabaseState, routeId: string): HaulRoute | undefined {
  return state.haulRoutes.find((route) => route.id === routeId)
}