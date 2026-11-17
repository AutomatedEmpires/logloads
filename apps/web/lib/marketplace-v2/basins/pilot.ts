import { MarketplaceOperationUnavailableError } from "../port"

/** What the pilot store says when a basin operation is asked of it. The normalized store is the one that has basins. */
export const BASIN_PILOT_OPERATIONS = {
  areaNotice: "Checking whether an area is open",
  createBasin: "Recording a basin",
  listBasins: "Reading basins",
  readiness: "Reading basin readiness",
  setBasinStatus: "Setting a basin's launch status"
} as const

/**
 * The pilot store has no basins. Every method refuses before it looks at a store, a job or a person, so a closed area
 * is not invented on top of the JSON board and a staff call cannot write one.
 */
export function pilotBasins() {
  const refuse = (operation: string) => async () => {
    throw new MarketplaceOperationUnavailableError(operation)
  }

  return {
    areaNotice: refuse(BASIN_PILOT_OPERATIONS.areaNotice),
    createBasin: refuse(BASIN_PILOT_OPERATIONS.createBasin),
    listBasins: refuse(BASIN_PILOT_OPERATIONS.listBasins),
    readiness: refuse(BASIN_PILOT_OPERATIONS.readiness),
    setBasinStatus: refuse(BASIN_PILOT_OPERATIONS.setBasinStatus)
  }
}
