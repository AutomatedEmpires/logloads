/**
 * The phone's side of flow C's held answers (#328, #411): where they are kept, and what sign-out does with them.
 * Client-only helpers; the pure rules are in `held-send.ts`.
 */

import { allHeld, clearAllHeld, heldFields, heldIsStale, type HeldStore } from "./held-send"

/** The browser's local storage, or `null` where it is blocked (a private window, a locked-down browser). */
export function heldPhone(): HeldStore | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

/** Writes to the phone, ignoring a full or blocked storage: the answer then stays held in this page until it closes. */
export function keepHeld(write: (storage: HeldStore) => void): void {
  const storage = heldPhone()
  if (!storage) return
  try {
    write(storage)
  } catch {
    // Storage full or blocked.
  }
}

/** A decline's reason that is one of the ready reasons (C7), as opposed to words the landing typed. */
export function presetReason(body: string, reasons: readonly string[]): boolean {
  return body !== "" && reasons.includes(body)
}

/**
 * Sign-out (#411). Signing out ends the page, as closing it does, so an answer still within its minute (or waiting for
 * a signal) goes now, as the person who held it: the server sends only the session's own and refuses anyone else's.
 * A week-old one is not sent; the inbox has been saying it was not sent. Then every held answer on the phone is
 * cleared, so nothing is left for the next person who signs in on this computer.
 */
export async function settleHeldOnSignOut(send: (formData: FormData) => Promise<unknown>, now: number = Date.now()): Promise<void> {
  const storage = heldPhone()
  if (!storage) return

  let found: ReturnType<typeof allHeld> = []
  try {
    found = allHeld(storage).filter((held) => !heldIsStale(held, now))
  } catch {
    found = []
  }

  for (const held of found) {
    const data = new FormData()
    for (const [name, value] of Object.entries(heldFields(held))) data.set(name, value)
    try {
      await send(data)
    } catch {
      // Offline or refused: sign-out still goes ahead, and the answer is cleared with the rest.
    }
  }

  try {
    clearAllHeld(storage)
  } catch {
    // Storage blocked: nothing could have been kept there either.
  }
}
