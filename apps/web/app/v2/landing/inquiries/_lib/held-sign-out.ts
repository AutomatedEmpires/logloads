/**
 * What the V2 sign-out button does with flow C's held answers (#411), kept small because every V2 page carries the
 * button (#447). The rules, the storage format and the server action are in `held-settle.ts`, loaded on sign-out.
 */

import { clearAllHeld } from "./held-keys"

type LoadSettle = () => Promise<{ settleHeld: () => Promise<void> }>

/**
 * Before the session ends: a held reply or decline still in its minute goes now, as its own person (the server
 * refuses anyone else's), and then every held answer is cleared from the phone, so the next person to sign in on
 * this computer never sends or reads one (#411). It never stops the sign-out.
 *
 * When the code that sends them cannot load (no signal, a blocked request), nothing is sent, as when a send fails,
 * and the phone is still cleared.
 */
export async function settleHeldAnswers(load: LoadSettle = () => import("./held-settle")): Promise<void> {
  try {
    const { settleHeld } = await load()
    await settleHeld()
  } catch {
    try {
      clearAllHeld(window.localStorage)
    } catch {
      // No storage: nothing could have been kept there either.
    }
  }
}
