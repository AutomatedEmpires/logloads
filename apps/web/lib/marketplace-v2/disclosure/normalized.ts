import "server-only"

import { clearHaulerRevealPauseInputSchema } from "@logloads/contracts"

import type { MarketplaceDb, MarketplacePrincipal } from "../normalized-db"
import { MarketplaceRefusalError } from "../port"

/**
 * Staff clear of a phone-reveal pause (#325). The function dismisses the hold through the moderation path.
 * It never reads or returns a phone number.
 */
export function normalizedDisclosure(db: MarketplaceDb) {
  return {
    async clearHaulerRevealPause(principal: MarketplacePrincipal, input: unknown): Promise<void> {
      const parsed = clearHaulerRevealPauseInputSchema.safeParse(input)

      if (!parsed.success) {
        throw new MarketplaceRefusalError(parsed.error.issues[0]?.message ?? "Check the pause and try again.", "22023")
      }

      await db.asUser(principal, (calls) => calls.call("admin_clear_hauler_reveal_pause", {
        p_org_id: parsed.data.haulerOrgId,
        p_reason: parsed.data.reason
      }), { readOnly: false })
    }
  }
}
