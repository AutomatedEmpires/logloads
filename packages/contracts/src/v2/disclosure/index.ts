/**
 * Phone reveal (#325, #403). A landing shares its number with one hauler only after it replies and opts in.
 * The share that reaches the threshold is kept and the hauler is paused for staff review. Further shares from
 * new landings are withheld (the reply still goes) until a moderator clears that pause. These two numbers are the
 * same ones `marketplace.phone_reveal_pause_limit()` returns. Reveals are counted from an append-only ledger, per
 * hauling business and per person, so withdrawing, revoking or declining never lowers the count.
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

const reasonSchema = z.string().trim().min(5, "Give a reason of at least 5 characters.").max(500, "Keep the reason under 500 characters.")

/** A moderator's reason for letting releases resume. The database stores it on the audit row, never a phone number. */
export const clearHaulerRevealPauseInputSchema = z.object({
  haulerOrgId: z.string().uuid(),
  reason: reasonSchema
})

/** Clearing one pause by its id (#403): a business pause or a person pause, from the staff list. */
export const clearRevealPauseInputSchema = z.object({
  pauseId: z.string().uuid(),
  reason: reasonSchema
})
export type ClearRevealPauseInput = z.infer<typeof clearRevealPauseInputSchema>

/** One inquiry the landing desk shows or hides its number on (flow C, C4 and C5). */
export const phoneShareInputSchema = z.object({
  interestId: z.string().uuid()
})
export type PhoneShareInput = z.infer<typeof phoneShareInputSchema>

/**
 * What the landing sees when its number was not shared. The same words whatever the reason (a reveal pause, or a
 * change on the inquiry), so it never tells a landing that a hauler is under review.
 */
export const PHONE_NOT_SHARED_MESSAGE = "Your number was not shared"

export const REVEAL_PAUSE_SUBJECTS = ["organization", "person"] as const
export type RevealPauseSubject = (typeof REVEAL_PAUSE_SUBJECTS)[number]

export const REVEAL_PAUSE_REPORT_STATUSES = ["open", "reviewing", "actioned", "dismissed"] as const
export type RevealPauseReportStatus = (typeof REVEAL_PAUSE_REPORT_STATUSES)[number]

/** An open reveal pause, as staff see it. No phone, landing or job. */
export interface MarketplaceRevealPause {
  id: string
  subjectKind: RevealPauseSubject
  subjectId: string
  /** The business's or the person's display name. */
  subjectName: string
  openedAt: string
  reportId: string
  reportStatus: RevealPauseReportStatus
  /** Distinct landings that revealed to this subject in the last `PHONE_REVEAL_PAUSE_WINDOW_HOURS` hours. */
  landingsInWindow: number
}

/** The landing desk's view of one of its inquiries: whether its details are shared, and its own site number. */
export interface MarketplaceInquiryDisclosure {
  interestId: string
  /** The inquiry's status; a number can be shown only on a replied inquiry. */
  status: string
  shared: boolean
  sharedAt: string | null
  /** The landing's own site phone (E.164), or `null` when the landing has none on file. */
  phone: string | null
}

/** What a hauling business reads on a job while the landing's release is live. `null` otherwise. */
export interface MarketplaceHaulerJobAccess {
  landingId: string
  directions: string | null
  gateInstructions: string | null
  siteContactName: string | null
  /** E.164, as the landing stored it. */
  siteContactPhone: string | null
  sharedAt: string
}

/** The landing's answer to Show my number: `shared` is false when the number did not reach the hauler. */
export interface PhoneShareResult {
  shared: boolean
}

/**
 * A stored E.164 number as people read it: "(541) 555-0188" for a North American number, otherwise the number as
 * stored. Display only; nothing is parsed back from it.
 */
export function formatPhoneForDisplay(e164: string): string {
  const nanp = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164.trim())

  return nanp ? `(${nanp[1]}) ${nanp[2]}-${nanp[3]}` : e164.trim()
}

/** The number as a `tel:` link target. */
export function phoneHref(e164: string): string {
  return `tel:${e164.trim().replace(/[^+\d]/g, "")}`
}
