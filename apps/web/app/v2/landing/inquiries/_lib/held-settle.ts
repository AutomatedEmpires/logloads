/**
 * Sign-out's held-answer work with everything it needs: the rules, the phone and the server action (#411).
 * `held-sign-out.ts` loads this module when the person signs out, so pages that never hold an answer (Find work,
 * a job page) do not download it (#447).
 */

import { sendHeldAnswerAction } from "@/lib/marketplace-v2/actions"

import { settleHeldOnSignOut } from "./held-phone"

/** Sends each held answer still due as the session's own person, then clears every held answer on the phone. */
export function settleHeld(): Promise<void> {
  return settleHeldOnSignOut(sendHeldAnswerAction)
}
