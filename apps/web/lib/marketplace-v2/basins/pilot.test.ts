import { describe, expect, it } from "vitest"

import { MarketplaceOperationUnavailableError } from "../port"
import { BASIN_PILOT_OPERATIONS, pilotBasins } from "./pilot"

describe("the pilot basin adapter", () => {
  it("refuses every basin operation and does not need a store", async () => {
    const basins = pilotBasins()

    await expect(basins.areaNotice()).rejects.toThrow(MarketplaceOperationUnavailableError)
    await expect(basins.createBasin()).rejects.toThrow(BASIN_PILOT_OPERATIONS.createBasin)
    await expect(basins.listBasins()).rejects.toThrow(MarketplaceOperationUnavailableError)
    await expect(basins.readiness()).rejects.toThrow(MarketplaceOperationUnavailableError)
    await expect(basins.setBasinStatus()).rejects.toThrow(MarketplaceOperationUnavailableError)
  })
})
