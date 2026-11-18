/**
 * notify (#253): turn claimed email rows into a send or a suppression.
 * The caller supplies the claims, the facts it just read, and the sender. This function does not open a connection
 * and does not call Resend itself. A planned send is the only message handed to `send`.
 */

import type { MarketplaceEmailFacts, MarketplaceEmailNoticeClaim, MarketplaceEmailNoticeOutcome } from "@logloads/contracts"
import { planEmailDelivery, type EmailSendMessage } from "@logloads/services"

export interface EmailBatchResult {
  sent: number
  suppressed: number
  retried: number
}

const FAILURE = "The email was not accepted."
const RESEND_URL = "https://api.resend.com/emails"

/**
 * Posts one already-planned message. No key, no from address, or a rejected request is a failure.
 * The failure carries no address and no key. Nothing here chooses a from address of its own.
 */
export async function sendViaResend(input: {
  apiKey: string
  from: string
  message: EmailSendMessage
  fetch?: (url: string, init: RequestInit) => Promise<Response>
}): Promise<{ ok: true; id: string } | { ok: false }> {
  const apiKey = input.apiKey.trim()
  const from = input.from.trim()

  if (!apiKey || !from) return { ok: false }

  try {
    const post = input.fetch ?? fetch
    const response = await post(RESEND_URL, {
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
        "Content-Type": "application/json"
      },
      method: "POST",
      signal: AbortSignal.timeout(8000)
    })

    if (!response.ok) return { ok: false }

    const body = await response.json() as { id?: unknown }

    return typeof body.id === "string" && body.id.trim() ? { id: body.id.trim(), ok: true } : { ok: false }
  } catch {
    return { ok: false }
  }
}

export async function deliverEmailBatch(input: {
  claims: readonly MarketplaceEmailNoticeClaim[]
  factsFor: (claim: MarketplaceEmailNoticeClaim) => Promise<MarketplaceEmailFacts>
  allowlist: readonly string[]
  suppressedHashes: readonly string[]
  send: (message: EmailSendMessage) => Promise<{ ok: true; id: string } | { ok: false }>
  complete: (notificationId: string, claimToken: string, outcome: MarketplaceEmailNoticeOutcome) => Promise<void>
}): Promise<EmailBatchResult> {
  const result: EmailBatchResult = { retried: 0, sent: 0, suppressed: 0 }

  for (const claim of input.claims) {
    let facts: MarketplaceEmailFacts

    try {
      facts = await input.factsFor(claim)
    } catch {
      await input.complete(claim.notificationId, claim.claimToken, { failure: FAILURE, outcome: "retry" })
      result.retried += 1
      continue
    }

    const planned = planEmailDelivery({
      address: claim.deliveryAddress,
      allowlist: input.allowlist,
      facts,
      suppressedHashes: input.suppressedHashes
    })

    if (planned.action === "suppress") {
      await input.complete(claim.notificationId, claim.claimToken, { failure: planned.reason, outcome: "suppressed" })
      result.suppressed += 1
      continue
    }

    const sent = await input.send(planned.message)

    if (sent.ok && sent.id.trim()) {
      await input.complete(claim.notificationId, claim.claimToken, { outcome: "sent", providerMessageId: sent.id.trim() })
      result.sent += 1
      continue
    }

    await input.complete(claim.notificationId, claim.claimToken, { failure: FAILURE, outcome: "retry" })
    result.retried += 1
  }

  return result
}
