import { timingSafeEqual } from "node:crypto"

import { oneTapSecret } from "@/app/v2/act/token"
import { marketplaceV2AdapterKind } from "@/lib/marketplace-v2/adapter"
import { emailDeliveryConfig } from "@/lib/marketplace-v2/notify/config"
import { sendViaResend } from "@/lib/marketplace-v2/notify/deliver"
import { notifyWorkerDb } from "@/lib/marketplace-v2/notify/stores"
import { runEmailWorker } from "@/lib/marketplace-v2/notify/worker"

/**
 * notify (#405): one pass of the email worker. Only a caller with CRON_SECRET may start it. Nothing schedules it yet,
 * and it does nothing on the pilot store (production always uses the pilot store). When it runs, it claims nothing
 * until every setting is present, and it sends only to LOGLOADS_EMAIL_TEST_RECIPIENTS. The answer carries counts and
 * environment names only.
 */
export const dynamic = "force-dynamic"

const HEADERS = { "Cache-Control": "private, no-store" }

function json(body: unknown, status = 200): Response {
  return Response.json(body, { headers: HEADERS, status })
}

function refusal(request: Request): Response | null {
  const secret = process.env.CRON_SECRET?.trim()

  if (!secret) return json({ error: "The email worker is not configured" }, 503)

  const expected = Buffer.from(`Bearer ${secret}`)
  const received = Buffer.from(request.headers.get("authorization") ?? "")

  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return json({ error: "Unauthorized" }, 401)

  return null
}

async function deliver(request: Request): Promise<Response> {
  const refused = refusal(request)

  if (refused) return refused

  try {
    if (marketplaceV2AdapterKind() !== "normalized") return json({ status: "off" })

    const config = emailDeliveryConfig()

    if (!config.workerDatabaseUrl) return json({ missing: ["LOGLOADS_NORMALIZED_EMAIL_WORKER_DATABASE_URL"], status: "not-ready" })

    const result = await runEmailWorker({
      send: (message, idempotencyKey) => sendViaResend({ apiKey: config.apiKey, from: config.from, idempotencyKey, message }),
      settings: {
        allowlist: config.allowlist,
        apiKey: config.apiKey,
        from: config.from,
        legalName: config.legalName,
        // A link in an email is never signed with the built-in development key: without a configured secret the
        // email carries the inquiry link and no one-tap replies.
        oneTapSecret: oneTapSecret({ ...process.env, NODE_ENV: "production" }),
        origin: config.origin,
        postalAddress: config.postalAddress,
        suppressionKey: config.suppressionKey
      },
      store: notifyWorkerDb(config.workerDatabaseUrl)
    })

    return json(result)
  } catch {
    return json({ status: "error" }, 500)
  }
}

export async function GET(request: Request): Promise<Response> {
  return deliver(request)
}

export async function POST(request: Request): Promise<Response> {
  return deliver(request)
}
