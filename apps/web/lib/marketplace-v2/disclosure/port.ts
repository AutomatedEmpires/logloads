import type {
  MarketplaceHaulerJobAccess,
  MarketplaceInquiryDisclosure,
  MarketplaceRevealPause,
  PhoneShareResult
} from "@logloads/contracts"

import type { MarketplacePrincipal } from "../normalized-db"

/**
 * The phone reveal's methods (#325, #403), on either store. The normalized store implements them (`./normalized.ts`);
 * the pilot store refuses every one before it reads anything (`./pilot.ts`). `principal` is the session's own person,
 * from the server session only; `organizationId` is that session's active business.
 */
export interface DisclosureAdapter {
  /** 40's clear by hauling business; it clears that business's open pause (44). Moderators only. */
  clearHaulerRevealPause(principal: MarketplacePrincipal, input: unknown): Promise<void>
  /** Clears one pause by its id, a business or a person. Moderators only; the reason is audited. */
  clearRevealPause(principal: MarketplacePrincipal, input: unknown): Promise<void>
  /** The open pauses, oldest first. Moderators and support only. */
  revealPauses(principal: MarketplacePrincipal): Promise<MarketplaceRevealPause[]>
  /** One inquiry of the active landing business: whether its number is shown, and that number. `null` when not theirs. */
  inquiryDisclosure(principal: MarketplacePrincipal, organizationId: string, interestId: string): Promise<MarketplaceInquiryDisclosure | null>
  /**
   * Show (`share: true`) or hide the active landing business's number on one replied inquiry. `shared` is what the
   * hauler can read afterwards: false after a hide, and false when a show did not reach the hauler.
   */
  sharePhone(principal: MarketplacePrincipal, organizationId: string, input: unknown, share: boolean): Promise<PhoneShareResult>
  /** What the active hauling business reads on one job while a release is live; `null` otherwise. */
  haulerJobAccess(principal: MarketplacePrincipal, organizationId: string, jobId: string): Promise<MarketplaceHaulerJobAccess | null>
}
