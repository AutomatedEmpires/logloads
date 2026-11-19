/**
 * notify (#253, #405): turn claimed email rows into a send or a suppression.
 *
 * Double sends: every send of one notice carries the same Resend Idempotency-Key (`logloads-notice/<id>`), and the
 * worker composes the same body for it on every attempt (stage 46 gives a stable unsubscribe link; the one-tap links
 * are derived from the notice id). A retry after a lost reply, a send whose report failed, and a second worker that
 * claimed a row after the first one's lease ran out all reach Resend with that key, and Resend returns the first send
 * instead of sending again. A batch stops before the lease runs out, and a failed report never stops the batch.
 */

import type { MarketplaceEmailNoticeClaim, MarketplaceEmailNoticeOutcome } from "@logloads/contracts"
import { isTestRecipient, notificationIdempotencyKey, type EmailDeliveryPlan, type EmailSendMessage } from "@logloads/services"

import { emailDeliveryConfig } from "./config"

export interface EmailBatchResult {
  sent: number
  suppressed: number
  retried: number
  failed: number
  /** Claims left claimed because the lease was too short to send them; they are claimed again after it runs out. */
  skipped: number
  /** Claims whose outcome could not be recorded (their lease ran out, or the store refused). */
  unconfirmed: number
}

/**
 * What Resend said. `retry`: nothing is known to have been accepted, or the same key is still being processed; send
 * again later with the same key. `duplicate`: an earlier attempt under this key was accepted with a body that differs,
 * so nothing is sent again. `rejected`: the request will not be accepted as it is. `not-sent`: Resend was not called.
 */
export type ResendSendResult =
  | { ok: true; id: string }
  | { ok: false; outcome: "not-sent"; reason: "not-configured" | "test-recipient" }
  | { ok: false; outcome: "retry"; retryAfterSeconds?: number }
  | { ok: false; outcome: "duplicate" }
  | { ok: false; outcome: "rejected" }

const RESEND_URL = "https://api.resend.com/emails"
const IDEMPOTENCY_KEY = /^[\x21-\x7e]{1,256}$/
const RETRY_FAILURE = "The email was not confirmed as accepted; it is retried with the same idempotency key."
const DUPLICATE_FAILURE = "An earlier attempt for this notice was already accepted by the provider; it was not sent again."
const REJECTED_FAILURE = "The provider rejected the email."
const COMPOSE_FAILURE = "The email could not be composed."

function retryAfter(response: Response): number | undefined {
  const value = Number.parseInt(response.headers.get("retry-after") ?? "", 10)

  return Number.isFinite(value) && value > 0 ? Math.min(value, 86_400) : undefined
}

async function errorName(response: Response): Promise<string> {
  try {
    const body = await response.json() as { name?: unknown }

    return typeof body.name === "string" ? body.name : ""
  } catch {
    return ""
  }
}

/**
 * Posts one already-planned message with its notice's idempotency key. The test-recipient list is checked here
 * again, from the environment, so no caller can send to anyone else. No key, no from address, or a recipient who is
 * not a test recipient means Resend is not called. The result carries no address and no key.
 */
export async function sendViaResend(input: {
  apiKey: string
  from: string
  message: EmailSendMessage
  idempotencyKey: string
  fetch?: (url: string, init: RequestInit) => Promise<Response>
}): Promise<ResendSendResult> {
  const apiKey = input.apiKey.trim()
  const from = input.from.trim()

  if (!isTestRecipient(input.message.to, emailDeliveryConfig().allowlist)) return { ok: false, outcome: "not-sent", reason: "test-recipient" }
  if (!apiKey || !from || !IDEMPOTENCY_KEY.test(input.idempotencyKey)) return { ok: false, outcome: "not-sent", reason: "not-configured" }

  let response: Response

  try {
    const post = input.fetch ?? fetch
    response = await post(RESEND_URL, {
      body: JSON.stringify({
        from,
        headers: {
          "List-Unsubscribe": input.message.listUnsubscribe,
          "List-Unsubscribe-Post": input.message.listUnsubscribePost
        },
        subject: input.message.subject,
        text: input.message.text,
        to: [input.message.to]
      }),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": input.idempotencyKey
      },
      method: "POST",
      signal: AbortSignal.timeout(8000)
    })
  } catch {
    // A timeout or a lost connection: Resend may have accepted it. The same key makes the retry safe.
    return { ok: false, outcome: "retry" }
  }

  if (response.ok) {
    try {
      const body = await response.json() as { id?: unknown }

      if (typeof body.id === "string" && body.id.trim()) return { id: body.id.trim(), ok: true }
    } catch {
      // Accepted but unreadable: the retry, with the same key, returns the id.
    }

    return { ok: false, outcome: "retry" }
  }

  if (response.status === 409) {
    const name = await errorName(response)

    if (name === "invalid_idempotent_request") return { ok: false, outcome: "duplicate" }
    return { ok: false, outcome: "retry", retryAfterSeconds: 30 }
  }

  if (response.status === 429) return { ok: false, outcome: "retry", ...(retryAfter(response) ? { retryAfterSeconds: retryAfter(response) } : {}) }
  if (response.status >= 500) return { ok: false, outcome: "retry" }

  return { ok: false, outcome: "rejected" }
}

function outcomeOf(planned: EmailDeliveryPlan & { action: "suppress" }): MarketplaceEmailNoticeOutcome {
  // A missing suppression key is the operator's to fix, not the recipient's: the notice waits instead of closing.
  if (planned.reason === "suppression-key") return { failure: "The suppression list could not be checked.", outcome: "retry", retryAfterSeconds: 3600 }

  return { failure: planned.reason, outcome: "suppressed" }
}

function outcomeOfSend(sent: ResendSendResult): MarketplaceEmailNoticeOutcome {
  if (sent.ok) return { outcome: "sent", providerMessageId: sent.id }

  switch (sent.outcome) {
    case "not-sent":
      return sent.reason === "test-recipient"
        ? { failure: "test-recipient", outcome: "suppressed" }
        : { failure: "Email delivery is not configured.", outcome: "retry", retryAfterSeconds: 3600 }
    case "retry":
      return { failure: RETRY_FAILURE, outcome: "retry", ...(sent.retryAfterSeconds ? { retryAfterSeconds: sent.retryAfterSeconds } : {}) }
    case "duplicate":
      return { failure: DUPLICATE_FAILURE, outcome: "failed" }
    case "rejected":
      return { failure: REJECTED_FAILURE, outcome: "failed" }
  }
}

function tally(result: EmailBatchResult, outcome: MarketplaceEmailNoticeOutcome): void {
  if (outcome.outcome === "sent") result.sent += 1
  else if (outcome.outcome === "suppressed") result.suppressed += 1
  else if (outcome.outcome === "retry") result.retried += 1
  else result.failed += 1
}

export async function deliverEmailBatch(input: {
  claims: readonly MarketplaceEmailNoticeClaim[]
  /** Composes and plans one claim. A throw is a retry. */
  plan: (claim: MarketplaceEmailNoticeClaim) => Promise<EmailDeliveryPlan>
  send: (message: EmailSendMessage, idempotencyKey: string) => Promise<ResendSendResult>
  complete: (notificationId: string, claimToken: string, outcome: MarketplaceEmailNoticeOutcome) => Promise<unknown>
  /** False once the lease has too little time left to send one more email and report it. */
  canSend: () => boolean
}): Promise<EmailBatchResult> {
  const result: EmailBatchResult = { failed: 0, retried: 0, sent: 0, skipped: 0, suppressed: 0, unconfirmed: 0 }

  async function finish(claim: MarketplaceEmailNoticeClaim, outcome: MarketplaceEmailNoticeOutcome): Promise<void> {
    try {
      await input.complete(claim.notificationId, claim.claimToken, outcome)
      tally(result, outcome)
    } catch {
      // The lease ran out and another worker holds the row, or the store refused. The row stays as the store has it;
      // a later claim sends with the same key, so an email already accepted is not sent twice.
      result.unconfirmed += 1
    }
  }

  for (const [index, claim] of input.claims.entries()) {
    if (!input.canSend()) {
      result.skipped += input.claims.length - index
      break
    }

    let planned: EmailDeliveryPlan

    try {
      planned = await input.plan(claim)
    } catch {
      await finish(claim, { failure: COMPOSE_FAILURE, outcome: "retry" })
      continue
    }

    if (planned.action === "suppress") {
      await finish(claim, outcomeOf(planned))
      continue
    }

    let sent: ResendSendResult

    try {
      sent = await input.send(planned.message, notificationIdempotencyKey(claim.notificationId))
    } catch {
      sent = { ok: false, outcome: "retry" }
    }

    await finish(claim, outcomeOfSend(sent))
  }

  return result
}
