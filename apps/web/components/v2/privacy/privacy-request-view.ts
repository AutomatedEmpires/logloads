import {
  MARKETPLACE_PRIVACY_DETAILS_MAX,
  MARKETPLACE_PRIVACY_REQUEST_ADDRESS,
  MARKETPLACE_PRIVACY_REQUEST_KINDS,
  MARKETPLACE_PRIVACY_RESPONSE_DAYS,
  marketplacePrivacyRequestInputSchema,
  type MarketplacePrivacyRequestKind,
  type MarketplacePrivacyRequestReceipt
} from "@logloads/contracts"
import { formatDay } from "@logloads/ui/marketplace"

import type { PrivacyRequestFormState } from "@/lib/marketplace-v2/privacy/form-state"

/**
 * The privacy request form's words and rules (#424), drawn on Figma 04 Settings (#336): form `362:5445` / `362:5666` /
 * `362:5831`, nothing chosen `362:5995` / `362:6177` / `362:6352`, sent `362:6527` / `362:6695` / `362:6854`, offline
 * `362:7013` / `362:7196` / `362:7371` and dark `362:7546`. Pure, so the tests read it without a browser.
 *
 * Two lines differ from the frames, because the frames describe an email the app does not send. In the app the
 * signed-in session is the identity check (`planInAppPrivacyRequest` records `signed_in_session` and starts the
 * request at once), and nothing emails the person to confirm. So the form says the request comes from the signed-in
 * account, and "sent" never says "we emailed you". Counsel's review of these words is still a launch gate.
 */

/** The choices in the frames' order. Their titles are the person's words; the contracts hold the staff wording. */
export const PRIVACY_REQUEST_CHOICES: ReadonlyArray<{ value: MarketplacePrivacyRequestKind; title: string; description: string }> = [
  { description: "We send you a list of the information we hold about you and why we hold it.", title: "See what LogLoads holds about me", value: "access" },
  { description: "A file of your account and business information.", title: "Get a copy to download", value: "export" },
  { description: "Tell us what is wrong and what it should say.", title: "Correct something", value: "correction" },
  { description: "We delete what we can and tell you what we must keep, and why.", title: "Delete my information", value: "deletion" }
]

export const PRIVACY_REQUEST_COPY = {
  breadcrumbs: ["Settings", "Account", "Privacy request"],
  cancel: "Cancel",
  description: "Ask to see, copy, correct or delete the personal information LogLoads holds about you.",
  detailsHint: "Anything that helps us find the right records, such as a job or a date.",
  detailsLabel: "Details",
  kept: "What you typed is kept.",
  legend: "What do you want us to do?",
  nothingChosen: "Choose one request so we know what to do.",
  offline: "You're offline, so nothing can be sent yet. Your choice and details stay here.",
  offlineQueued: "You're offline. Your request goes once the signal is back, and your choice and details stay here.",
  retry: "Retry",
  send: "Send request",
  sending: "Sending…",
  sendingStatus: "Sending your request.",
  sentTitle: "Request sent",
  title: "Privacy request",
  unreachable: "We couldn't reach LogLoads. Your choice and details are still here, so you can send again.",
  /** Before anything is typed, while no store keeps requests (`privacyRequestStore()` is null until #415). */
  unavailableBefore: `Requests in the app aren't connected yet, so this form can't send one. Email ${MARKETPLACE_PRIVACY_REQUEST_ADDRESS} from the address on your account instead, and we'll answer within ${MARKETPLACE_PRIVACY_RESPONSE_DAYS} days.`
} as const

export const PRIVACY_REQUEST_FIELD_IDS = { details: "privacy-request-details", kind: "privacy-request-kind" } as const

/** The DOM id of a choice's radio, so the error summary and the tests can point at it. */
export function privacyChoiceId(kind: MarketplacePrivacyRequestKind): string {
  return `${PRIVACY_REQUEST_FIELD_IDS.kind}-${kind}`
}

export function privacyKindTitle(kind: MarketplacePrivacyRequestKind): string {
  return PRIVACY_REQUEST_CHOICES.find((choice) => choice.value === kind)?.title ?? kind
}

/** A known kind, or "" (nothing chosen). Anything else from a form or a state is dropped. */
export function knownPrivacyKind(value: string): MarketplacePrivacyRequestKind | "" {
  return (MARKETPLACE_PRIVACY_REQUEST_KINDS as readonly string[]).includes(value) ? (value as MarketplacePrivacyRequestKind) : ""
}

/** The identity line under the form: the signed-in account is the check, so no email is promised. */
export function privacyIdentityNote(accountEmail: string | null): string {
  const who = accountEmail ? `You're signed in as ${accountEmail}, so we know this request is yours.` : "You're signed in, so we know this request is yours."
  return `${who} We answer within ${MARKETPLACE_PRIVACY_RESPONSE_DAYS} days.`
}

export type PrivacyRequestField = "kind" | "details"

export interface PrivacyRequestIssue {
  field: PrivacyRequestField
  message: string
}

/**
 * The contract's own rules (`marketplacePrivacyRequestInputSchema`), checked before sending so the person sees which
 * field to fix. The server action checks again and stays the authority. A missing choice reads as the frames say.
 */
export function privacyRequestIssues(input: { kind: string; details: string; submissionId: string }): PrivacyRequestIssue[] {
  const parsed = marketplacePrivacyRequestInputSchema.safeParse({ details: input.details, kind: input.kind, submissionId: input.submissionId })

  if (parsed.success) return []

  const issues: PrivacyRequestIssue[] = []

  for (const issue of parsed.error.issues) {
    const field = issue.path[0]

    if (field === "kind" && !issues.some((known) => known.field === "kind")) {
      issues.push({ field: "kind", message: PRIVACY_REQUEST_COPY.nothingChosen })
    } else if (field === "details" && !issues.some((known) => known.field === "details")) {
      issues.push({ field: "details", message: issue.message })
    }
  }

  // The kind first, as on the page.
  return issues.sort((a, b) => (a.field === b.field ? 0 : a.field === "kind" ? -1 : 1))
}

/** The textarea's limit: the contract's, so a pasted note is cut where the server would refuse it. */
export const PRIVACY_DETAILS_MAX = MARKETPLACE_PRIVACY_DETAILS_MAX

/**
 * What the form shows. The server action's states, plus three the browser decides before or instead of sending:
 * `invalid` (a field to fix), `offline` (no signal) and `unreachable` (the send failed with a signal). The person's
 * choice and words are held by the form itself, so every state keeps them.
 */
export type PrivacyRequestView =
  | PrivacyRequestFormState
  | { status: "invalid"; issues: PrivacyRequestIssue[] }
  | { status: "offline"; queued: boolean }
  | { status: "unreachable" }

export interface PrivacyReceiptFact {
  label: string
  value: string
}

/** The sent screen's facts, from the receipt the action returned: the request, when it arrived and when it is due. */
export function privacyReceiptFacts(receipt: MarketplacePrivacyRequestReceipt): PrivacyReceiptFact[] {
  return [
    { label: "Request", value: privacyKindTitle(receipt.kind) },
    { label: "Sent", value: formatDay(receipt.receivedAt) ?? receipt.receivedAt.slice(0, 10) },
    { label: "Answer due", value: `By ${formatDay(receipt.dueOn) ?? receipt.dueOn}` }
  ]
}

/** The sent notice. A new request was made by the signed-in person; an open one of the same kind is answered instead. */
export function privacySentNotice(receipt: MarketplacePrivacyRequestReceipt, alreadyOpen: boolean): { title: string; body: string } {
  const due = formatDay(receipt.dueOn) ?? receipt.dueOn

  if (alreadyOpen) {
    const since = formatDay(receipt.receivedAt) ?? receipt.receivedAt.slice(0, 10)
    return {
      body: `Your request from ${since}, "${privacyKindTitle(receipt.kind)}", is still open, so we didn't start a second one. We answer it by ${due}.`,
      title: "You already asked for this"
    }
  }

  return {
    body: `You were signed in, so we know it is yours. We answer within ${MARKETPLACE_PRIVACY_RESPONSE_DAYS} days, by ${due}.`,
    title: PRIVACY_REQUEST_COPY.sentTitle
  }
}

/** A message split around the support address, so the page can make it a mail link. Nothing is added to the link. */
export function withSupportAddress(message: string): Array<{ text: string; address: boolean }> {
  const parts: Array<{ text: string; address: boolean }> = []
  const pieces = message.split(MARKETPLACE_PRIVACY_REQUEST_ADDRESS)

  pieces.forEach((piece, index) => {
    if (piece) parts.push({ address: false, text: piece })
    if (index < pieces.length - 1) parts.push({ address: true, text: MARKETPLACE_PRIVACY_REQUEST_ADDRESS })
  })

  return parts
}

/** The support mail link: the address only, never a subject or body, so nothing the person typed goes in a URL. */
export const PRIVACY_SUPPORT_HREF = `mailto:${MARKETPLACE_PRIVACY_REQUEST_ADDRESS}`
