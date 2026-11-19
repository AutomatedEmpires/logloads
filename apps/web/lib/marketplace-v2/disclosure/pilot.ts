import { MarketplaceOperationUnavailableError } from "../port"
import type { DisclosureAdapter } from "./port"

/** What the pilot store says for each phone-reveal operation. */
export const DISCLOSURE_PILOT_OPERATIONS = {
  clearHaulerRevealPause: "Clearing a phone-reveal pause",
  clearRevealPause: "Clearing a phone-reveal pause",
  haulerJobAccess: "Reading a landing's released access details",
  inquiryDisclosure: "Reading whether a landing's number is shown",
  revealPauses: "Listing phone-reveal pauses",
  sharePhone: "Showing or hiding a landing's number"
} as const satisfies Record<keyof DisclosureAdapter, string>

function refuse(operation: keyof DisclosureAdapter): never {
  throw new MarketplaceOperationUnavailableError(DISCLOSURE_PILOT_OPERATIONS[operation])
}

/**
 * The pilot store keeps no reveal pause and releases no private detail. Every method refuses before it looks at a
 * store, a hauler or a phone number, whatever it is given.
 */
export function pilotDisclosure(): DisclosureAdapter {
  return {
    clearHaulerRevealPause: async () => refuse("clearHaulerRevealPause"),
    clearRevealPause: async () => refuse("clearRevealPause"),
    haulerJobAccess: async () => refuse("haulerJobAccess"),
    inquiryDisclosure: async () => refuse("inquiryDisclosure"),
    revealPauses: async () => refuse("revealPauses"),
    sharePhone: async () => refuse("sharePhone")
  }
}
