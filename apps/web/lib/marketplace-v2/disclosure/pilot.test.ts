import { describe, expect, it } from "vitest"

import { MarketplaceOperationUnavailableError } from "../port"
import { DISCLOSURE_PILOT_OPERATIONS, pilotDisclosure } from "./pilot"

describe("the pilot disclosure adapter", () => {
  it("refuses to clear a phone-reveal pause and does not need a store", async () => {
    await expect(pilotDisclosure().clearHaulerRevealPause()).rejects.toThrow(MarketplaceOperationUnavailableError)
    await expect(pilotDisclosure().clearHaulerRevealPause()).rejects.toThrow(DISCLOSURE_PILOT_OPERATIONS.clearHaulerRevealPause)
  })
})
