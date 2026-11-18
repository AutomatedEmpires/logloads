import type { MarketplaceInterestView } from "@logloads/contracts"

/**
 * The two ready replies of flow C (#328, Figma 07 Flows C3 `124:390`): a landing answers an inquiry with one tap.
 *
 * The frame's first reply ends with "Call me."; that promise needs the phone release control (C4, LL-PILOT2), which
 * the store does not expose to the app yet, so the reply stops at the yes. The second names the hauler's own first
 * day when they gave one that has not passed, the way the frame's "Be here Monday" does; otherwise it asks for it.
 * No reply carries a phone number, an email or a link, so the same words can ride in a one-tap link (#292).
 */

export const READY_REPLY_YES = "Yes, we can use you."
export const READY_REPLY_ASK_DAY = "Yes. When can you start?"

const DAY = /^\d{4}-\d{2}-\d{2}$/
const DAY_FORMAT = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", timeZone: "UTC", weekday: "short" })

/** "Mon, Nov 16" for a calendar day (UTC, as the app formats days). */
export function readyReplyDay(day: string): string {
  return DAY_FORMAT.format(new Date(`${day}T00:00:00.000Z`))
}

/** The ready replies for one inquiry, in the order the bar shows them. `today` is the server's calendar day. */
export function readyReplyTexts(interest: Pick<MarketplaceInterestView, "availableFrom">, today: string): [string, string] {
  const from = interest.availableFrom && DAY.test(interest.availableFrom) ? interest.availableFrom : null

  return [READY_REPLY_YES, from && from >= today ? `Yes. Be here ${readyReplyDay(from)}.` : READY_REPLY_ASK_DAY]
}
