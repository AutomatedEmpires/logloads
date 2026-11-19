import { marketplaceV2AdapterKind } from "@/lib/marketplace-v2/adapter"
import { emailDeliveryConfig } from "@/lib/marketplace-v2/notify/config"
import { notifyAnonDb, notifyWorkerDb } from "@/lib/marketplace-v2/notify/stores"
import {
  applyEmailUnsubscribe,
  UNSUBSCRIBE_CONFIRMATION,
  UNSUBSCRIBE_RATE_LIMIT,
  UNSUBSCRIBE_TOO_MANY,
  unsubscribePage,
  unsubscribeToken
} from "@/lib/marketplace-v2/notify/unsubscribe"
import { checkRateLimit, RateLimitError, requestClientKey } from "@/lib/rate-limit"

export const dynamic = "force-dynamic"

const HEADERS = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex"
}

async function forgetInDatabase(token: string): Promise<void> {
  if (marketplaceV2AdapterKind() !== "normalized") return

  await notifyAnonDb().asAnon((calls) => calls.call("unsubscribe_with_token", { p_token: token }), { readOnly: false })
}

/** The durable list lives in the normalized store; the pilot store has no worker and so no such link to honour. */
async function suppress(hash: string): Promise<void> {
  const { workerDatabaseUrl } = emailDeliveryConfig()

  if (marketplaceV2AdapterKind() !== "normalized" || !workerDatabaseUrl) throw new Error("The suppression list is not configured.")

  await notifyWorkerDb(workerDatabaseUrl).suppress(hash, "unsubscribed")
}

export async function GET(request: Request): Promise<Response> {
  const token = unsubscribeToken(request.url, "")

  return new Response(unsubscribePage(token), {
    headers: { ...HEADERS, "Content-Type": "text/html; charset=utf-8" },
    status: 200
  })
}

export async function POST(request: Request): Promise<Response> {
  try {
    await checkRateLimit(UNSUBSCRIBE_RATE_LIMIT.bucket, await requestClientKey(), UNSUBSCRIBE_RATE_LIMIT.limit, UNSUBSCRIBE_RATE_LIMIT.windowMs)
  } catch (error) {
    if (error instanceof RateLimitError) {
      return new Response(UNSUBSCRIBE_TOO_MANY, {
        headers: { ...HEADERS, "Content-Type": "text/plain; charset=utf-8", "Retry-After": String(Math.max(1, Math.ceil(error.retryAfterSeconds || 60))) },
        status: 429
      })
    }
    // The limiter is down. An opt-out must still work (CAN-SPAM, legal review §5.3), so the request goes on.
  }

  const body = (await request.text()).slice(0, 2000)
  const token = unsubscribeToken(request.url, body)

  try {
    await applyEmailUnsubscribe(token, emailDeliveryConfig().suppressionKey, new Date(), { forgetInDatabase, suppress })
  } catch {
    // The confirmation stays the same. The store's refusal names nothing this response can repeat.
  }

  return new Response(UNSUBSCRIBE_CONFIRMATION, {
    headers: { ...HEADERS, "Content-Type": "text/plain; charset=utf-8" },
    status: 200
  })
}
