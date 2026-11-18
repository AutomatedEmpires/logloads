import { MarketplaceOperationUnavailableError } from "../port"

/** What the pilot store says when staff ask it to clear a phone-reveal pause. */
export const DISCLOSURE_PILOT_OPERATIONS = {
  clearHaulerRevealPause: "Clearing a phone-reveal pause"
} as const

/**
 * The pilot store has no reveal pause. The method refuses before it looks at a store, a hauler or a phone number.
 */
export function pilotDisclosure() {
  return {
    clearHaulerRevealPause: async () => {
      throw new MarketplaceOperationUnavailableError(DISCLOSURE_PILOT_OPERATIONS.clearHaulerRevealPause)
    }
  }
}
