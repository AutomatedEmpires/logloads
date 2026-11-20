/**
 * Where flow C's held answers are kept on the phone, and how to remove them all (#411).
 *
 * This is apart from `held-send.ts` so the sign-out button, which every V2 page carries, can still clear the phone
 * when the rest of the held-answer code did not load (#447). It imports nothing.
 */

/** Every held answer's storage key starts with this. */
export const HELD_PREFIX = "logloads:flow-c:held:"

/** The part of the browser's storage needed to find and remove held answers. */
export interface HeldKeyStore {
  key(index: number): string | null
  readonly length: number
  removeItem(key: string): void
}

/** The storage keys of every held answer on this phone, whoever held it. */
export function heldNames(storage: Pick<HeldKeyStore, "key" | "length">): string[] {
  const names: string[] = []

  for (let index = 0; index < storage.length; index += 1) {
    const name = storage.key(index)
    if (name?.startsWith(HELD_PREFIX)) names.push(name)
  }

  return names
}

/** Sign-out (#411): every held answer on this phone goes, whoever held it, older records included. */
export function clearAllHeld(storage: HeldKeyStore): void {
  for (const name of heldNames(storage)) storage.removeItem(name)
}
