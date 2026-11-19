import { suppressionKeyUsable } from "@logloads/services"

import { marketplaceV2AdapterKind } from "@/lib/marketplace-v2/adapter"
import { emailDeliveryConfig } from "@/lib/marketplace-v2/notify/config"
import { applyProviderEvent, parseResendEvent, verifyResendWebhook, WEBHOOK_MAX_BYTES } from "@/lib/marketplace-v2/notify/provider-events"
import { notifyWorkerDb } from "@/lib/marketplace-v2/notify/stores"

/**
 * notify (#405): Resend's webhook. Only a body signed with RESEND_WEBHOOK_SECRET is read. A delivery moves its notice
 * to delivered; a hard bounce or a spam complaint puts the recipient's keyed hash on the suppression list. Until the
 * store and keys are configured it answers 503, so the provider keeps the event and tries again. Answers carry counts
 * only, never an address.
 */
export const dynamic = "force-dynamic"

const HEADERS = { "Cache-Control": "private, no-store" }

function json(body: unknown, status = 200): Response {
  return Response.json(body, { headers: HEADERS, status })
}

export async function POST(request: Request): Promise<Response> {
  const config = emailDeliveryConfig()

  if (!config.webhookSecret) return json({ error: "The provider webhook is not configured" }, 503)

  const body = await request.text()

  if (Buffer.byteLength(body, "utf8") > WEBHOOK_MAX_BYTES) return json({ error: "Too large" }, 413)

  const verified = verifyResendWebhook({
    body,
    id: request.headers.get("svix-id"),
    now: new Date(),
    secret: config.webhookSecret,
    signature: request.headers.get("svix-signature"),
    timestamp: request.headers.get("svix-timestamp")
  })

  if (!verified) return json({ error: "Unauthorized" }, 401)

  const event = parseResendEvent(body)

  if (!event) return json({ status: "ignored" })

  try {
    if (marketplaceV2AdapterKind() !== "normalized" || !config.workerDatabaseUrl || !suppressionKeyUsable(config.suppressionKey)) {
      return json({ error: "The suppression list is not configured" }, 503)
    }

    const applied = await applyProviderEvent(event, config.suppressionKey, notifyWorkerDb(config.workerDatabaseUrl))

    return json({ status: "applied", ...applied })
  } catch {
    return json({ status: "error" }, 500)
  }
}
