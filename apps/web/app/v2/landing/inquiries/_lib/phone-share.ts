import { formatPhoneForDisplay, PHONE_NOT_SHARED_MESSAGE, type MarketplaceInquiryDisclosure } from "@logloads/contracts"

/**
 * Flow C, C4 and C5 (#403, Figma 07 Flows `124:509` and `124:541`): what the inquiry offers about the landing's number.
 *
 * - `offer` (C4): the landing replied, has a number on file, and it is not showing. "Let them see your phone number?"
 * - `showing` (C5): the number is showing to this one hauling business, with Hide my number.
 * - `none`: nothing to offer (no reply yet, no number on file, the store keeps no reveal, or "Not now").
 *
 * Pure, so the inbox test can check every state without a store.
 */

export type PhoneShareState =
  | { kind: "none" }
  | { kind: "offer"; number: string }
  | { kind: "showing"; number: string }

export function phoneShareState(
  disclosure: MarketplaceInquiryDisclosure | null,
  options: { notNow: boolean }
): PhoneShareState {
  if (!disclosure || disclosure.status !== "replied" || !disclosure.phone) {
    return { kind: "none" }
  }

  const number = formatPhoneForDisplay(disclosure.phone)

  if (disclosure.shared) return { kind: "showing", number }

  return options.notNow ? { kind: "none" } : { kind: "offer", number }
}

/** Ready reply 1 may say "Call me." only when this landing can actually show its number on the inquiry (#403). */
export function numberCanBeShared(disclosure: MarketplaceInquiryDisclosure | null): boolean {
  return Boolean(disclosure?.phone) && ["submitted", "viewed", "replied"].includes(disclosure?.status ?? "")
}

/** The one line after a Show or Hide, from the redirect's `updated`; `null` for anything else. Never says why. */
export function phoneShareNotice(updated: string, haulerName: string): string | null {
  if (updated === "phone_not_shared") return `${PHONE_NOT_SHARED_MESSAGE}.`
  if (updated === "phone_hidden") return `Your number is hidden from ${haulerName}.`

  return null
}
