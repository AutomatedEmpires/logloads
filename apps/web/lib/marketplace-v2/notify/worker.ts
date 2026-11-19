/**
 * notify (#405): the email worker. It claims due email rows, reads the durable suppression list, composes each email
 * from the row and the store's context, and hands planned messages to the sender. It sends only to test recipients
 * (planEmailDelivery and sendViaResend both check), and claims nothing until every setting it needs is present.
 *
 * The same notice always composes to the same email: the unsubscribe link comes from stage 46, the no-account link is
 * signed with an expiry derived from the queue time, and the one-tap links take their ids and expiry from the notice.
 * With the per-notice Idempotency-Key, a second attempt returns the first send instead of sending again.
 *
 * Privacy: the address is used for the send and for its keyed hash only. Nothing here logs it, and no phone number,
 * inquiry message or contact preference is read: the payload carries none (stage 46-N).
 */

import type {
  MarketplaceEmailAction,
  MarketplaceEmailFacts,
  MarketplaceEmailFooter,
  MarketplaceEmailNoticeClaim,
  MarketplaceEmailNoticeOutcome
} from "@logloads/contracts"
import {
  derivedUuid,
  emailSuppressionHash,
  planEmailDelivery,
  signSuppressionToken,
  suppressionKeyUsable,
  type EmailDeliveryPlan,
  type EmailSendMessage
} from "@logloads/services"

import { readyReplyTexts } from "@/app/v2/landing/inquiries/_lib/ready-replies"
import { oneTapPagePath, signOneTapLink } from "@/app/v2/act/token"
import { deliverEmailBatch, type EmailBatchResult, type ResendSendResult } from "./deliver"

/** What the worker reads and writes in the store (service_role calls; `worker-db.ts`). */
export interface NotificationWorkerStore {
  claim(limit: number, leaseSeconds: number): Promise<MarketplaceEmailNoticeClaim[]>
  complete(notificationId: string, claimToken: string, outcome: MarketplaceEmailNoticeOutcome): Promise<string>
  /** Stage 46-U: the queue time, a stable unsubscribe token (null for a team invitation) and the invitation's send count. */
  emailContext(notificationId: string, claimToken: string): Promise<NotificationEmailContext>
  /** Which of these keyed hashes are on the suppression list. */
  suppressedHashes(hashes: readonly string[]): Promise<string[]>
}

export interface NotificationEmailContext {
  queuedAt: Date
  unsubscribeToken: string | null
  invitationSendCount: number | null
}

export interface EmailWorkerSettings {
  allowlist: readonly string[]
  apiKey: string
  from: string
  legalName: string
  /** The https origin links point at; null outside an https deployment. */
  origin: string | null
  postalAddress: string
  suppressionKey: string
  /** The one-tap signing key, or null: then the new-inquiry email carries the inquiry link without one-tap replies. */
  oneTapSecret: string | null
}

export type EmailWorkerResult =
  | { status: "not-ready"; missing: string[] }
  | ({ status: "ran"; claimed: number } & EmailBatchResult)

/** The lease a run asks for, the time one email may take (send, report and context), and the margin kept at the end. */
export const EMAIL_LEASE_SECONDS = 300
export const EMAIL_SEND_BUDGET_SECONDS = 15
export const EMAIL_LEASE_MARGIN_SECONDS = 30

const DAY_MS = 86_400_000
/** The no-account link and the stable unsubscribe link both last 31 days from the queue time (CAN-SPAM: 30 after sending). */
const LINK_DAYS = 31
/** One-tap links last 72 hours from the queue time, less a margin for clock skew between the store and this server. */
const ONE_TAP_MS = 72 * 3_600_000 - 5 * 60_000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DAY = /^\d{4}-\d{2}-\d{2}$/

/** How many claims fit in one lease when every send takes its whole budget. */
export function claimLimitForLease(leaseSeconds: number, budgetSeconds = EMAIL_SEND_BUDGET_SECONDS, marginSeconds = EMAIL_LEASE_MARGIN_SECONDS): number {
  return Math.max(1, Math.min(100, Math.floor((leaseSeconds - marginSeconds) / budgetSeconds)))
}

/** The settings that are missing, by environment name. The worker claims nothing while any is missing. */
export function emailWorkerReadiness(settings: EmailWorkerSettings): string[] {
  return [
    settings.allowlist.length === 0 && "LOGLOADS_EMAIL_TEST_RECIPIENTS",
    !settings.apiKey && "RESEND_API_KEY",
    !settings.from && "RESEND_FROM",
    !suppressionKeyUsable(settings.suppressionKey) && "LOGLOADS_EMAIL_SUPPRESSION_KEY",
    !settings.origin && "NEXT_PUBLIC_APP_URL"
  ].filter((name): name is string => typeof name === "string")
}

function text(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key]

  return typeof value === "string" && value.trim() ? value.trim() : null
}

function uuid(payload: Record<string, unknown>, key: string): string | null {
  const value = text(payload, key)

  return value && UUID.test(value) ? value.toLowerCase() : null
}

function unsubscribeUrl(origin: string, token: string): string {
  return `${origin}/api/v2/notify/unsubscribe?${new URLSearchParams({ token }).toString()}`
}

/** The landing desk's thread for a landing recipient, the hauler's inquiry for a hauler recipient. */
function inquiryUrl(origin: string, interestId: string, landingSide: boolean): string {
  return landingSide
    ? `${origin}/v2/landing/inquiries?${new URLSearchParams({ inquiry: interestId }).toString()}#conversation`
    : `${origin}/v2/inquiries?${new URLSearchParams({ inquiry: interestId }).toString()}`
}

/**
 * The ready replies of flow C as signed one-tap links for the recipient and the landing business on this inquiry.
 * Ids and expiry are derived from the notice, so composing it again gives the same links. Empty when there is no
 * signing key, the links would already be close to expiring, or a link cannot be signed.
 */
export function readyReplyLinks(input: {
  claim: MarketplaceEmailNoticeClaim
  interestId: string
  jobId: string
  availableFrom: string | null
  queuedAt: Date
  origin: string
  secret: string | null
  now: Date
}): MarketplaceEmailAction[] {
  const { claim, secret } = input

  if (!secret || !claim.recipientUserId || !claim.recipientOrganizationId) return []

  const expiresAt = new Date(input.queuedAt.getTime() + ONE_TAP_MS)

  if (expiresAt.getTime() - input.now.getTime() < 3_600_000) return []

  const queuedDay = input.queuedAt.toISOString().slice(0, 10)
  const replies = readyReplyTexts({ availableFrom: input.availableFrom && DAY.test(input.availableFrom) ? input.availableFrom : null }, queuedDay)

  try {
    return replies.map((label, index) => ({
      label,
      url: `${input.origin}${oneTapPagePath(signOneTapLink({
        action: "reply",
        interestId: input.interestId,
        jobId: input.jobId,
        organizationId: claim.recipientOrganizationId as string,
        replyBody: label,
        userId: claim.recipientUserId as string
      }, secret, input.now, {
        expiresAt,
        replyId: derivedUuid(secret, `${claim.notificationId}:ready-reply:${index}:reply`),
        tokenId: derivedUuid(secret, `${claim.notificationId}:ready-reply:${index}:token`)
      }))}`
    }))
  } catch {
    return []
  }
}

/**
 * The facts one claimed row composes to. Names come from the row's payload as queued; ids are checked; no address is
 * read. Throws for a row it cannot compose (an unknown category, or a member's notice without its unsubscribe token),
 * which the batch records as a retry.
 */
export function emailFactsForClaim(
  claim: MarketplaceEmailNoticeClaim,
  context: NotificationEmailContext,
  settings: EmailWorkerSettings,
  now: Date
): MarketplaceEmailFacts {
  const origin = settings.origin

  if (!origin) throw new Error("No https origin.")

  const payload = claim.payload ?? {}
  const linkExpiry = new Date(context.queuedAt.getTime() + LINK_DAYS * DAY_MS)
  const base = { attempt: claim.attemptCount, invitationSendCount: null, landingName: null, organizationName: null, promotion: null }

  function footer(reason: string, token: string | null): MarketplaceEmailFooter {
    if (!token) throw new Error("No unsubscribe token.")

    return { legalName: settings.legalName, postalAddress: settings.postalAddress, reason, unsubscribeUrl: unsubscribeUrl(origin as string, token) }
  }

  switch (claim.category) {
    case "team_invitation":
      return {
        ...base,
        footer: footer(
          "Someone at a business you work with asked LogLoads to invite you.",
          signSuppressionToken(claim.deliveryAddress, settings.suppressionKey, linkExpiry, now)
        ),
        invitationSendCount: context.invitationSendCount,
        organizationName: text(payload, "organization_name"),
        template: "team_invitation"
      }

    case "inquiry_reply": {
      const interestId = uuid(payload, "interest_id")
      const landingSide = text(payload, "from_side") === "hauler"
      const link = interestId ? inquiryUrl(origin, interestId, landingSide) : null
      const notice = footer("You turned on email about inquiries for this business.", context.unsubscribeToken)

      if (landingSide && text(payload, "event") === "inquiry_submitted") {
        const jobId = uuid(payload, "job_id")

        return {
          ...base,
          footer: notice,
          inquiryUrl: link,
          jobTitle: text(payload, "job_title"),
          organizationName: text(payload, "from_organization_name"),
          readyReplies: interestId && jobId
            ? readyReplyLinks({
              availableFrom: text(payload, "available_from"),
              claim,
              interestId,
              jobId,
              now,
              origin,
              queuedAt: context.queuedAt,
              secret: settings.oneTapSecret
            })
            : [],
          template: "inquiry_received"
        }
      }

      return { ...base, footer: notice, inquiryUrl: link, template: "inquiry_reply" }
    }

    case "job_alert":
      return {
        ...base,
        footer: footer("You saved a job search on LogLoads and turned on email alerts for it.", context.unsubscribeToken),
        template: "job_alert"
      }

    default:
      throw new Error("Unknown notice category.")
  }
}

/** One run: claim what fits in the lease, check the suppression list once, then send one claim at a time. */
export async function runEmailWorker(input: {
  store: NotificationWorkerStore
  settings: EmailWorkerSettings
  send: (message: EmailSendMessage, idempotencyKey: string) => Promise<ResendSendResult>
  now?: () => Date
  leaseSeconds?: number
}): Promise<EmailWorkerResult> {
  const missing = emailWorkerReadiness(input.settings)

  if (missing.length > 0) return { missing, status: "not-ready" }

  const now = input.now ?? (() => new Date())
  const lease = input.leaseSeconds ?? EMAIL_LEASE_SECONDS
  const started = now().getTime()
  const claims = await input.store.claim(claimLimitForLease(lease), lease)
  const key = input.settings.suppressionKey
  const hashes = [...new Set(claims.map((claim) => emailSuppressionHash(claim.deliveryAddress, key)))]
  // Read before anything is sent. A failed read throws: nothing is sent, and the rows are claimed again later.
  const suppressed = hashes.length > 0 ? await input.store.suppressedHashes(hashes) : []
  const deadline = started + (lease - EMAIL_LEASE_MARGIN_SECONDS) * 1000

  const result = await deliverEmailBatch({
    canSend: () => now().getTime() + EMAIL_SEND_BUDGET_SECONDS * 1000 <= deadline,
    claims,
    complete: (notificationId, claimToken, outcome) => input.store.complete(notificationId, claimToken, outcome),
    async plan(claim): Promise<EmailDeliveryPlan> {
      const context = await input.store.emailContext(claim.notificationId, claim.claimToken)

      return planEmailDelivery({
        address: claim.deliveryAddress,
        allowlist: input.settings.allowlist,
        facts: emailFactsForClaim(claim, context, input.settings, now()),
        suppression: { hashes: suppressed, key }
      })
    },
    send: input.send
  })

  return { claimed: claims.length, status: "ran", ...result }
}
