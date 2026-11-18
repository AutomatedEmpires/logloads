/**
 * Phone reveal pause (#325). A landing shares its number with one hauler only after it replies and opts in.
 * The share that reaches the threshold is kept and the hauler is paused for staff review. Further shares from
 * new landings wait until a moderator clears that pause. These two numbers are the same ones
 * `marketplace.phone_reveal_pause_limit()` returns.
 */

import { z } from "zod"

/** Distinct landings that share a number with one hauler inside the window, counting the share that opens the pause. */
export const PHONE_REVEAL_PAUSE_THRESHOLD = 5

/** How long a share keeps counting, in hours. Not a calendar day. */
export const PHONE_REVEAL_PAUSE_WINDOW_HOURS = 24

/** True when this many distinct landings in the window is enough to open the pause. */
export function revealPauseTrips(distinctLandingsInWindow: number): boolean {
  return Number.isInteger(distinctLandingsInWindow) && distinctLandingsInWindow >= PHONE_REVEAL_PAUSE_THRESHOLD
}

/** A moderator's reason for letting releases resume. The database stores it on the audit row, never a phone number. */
export const clearHaulerRevealPauseInputSchema = z.object({
  haulerOrgId: z.string().uuid(),
  reason: z.string().trim().min(5).max(500)
})
