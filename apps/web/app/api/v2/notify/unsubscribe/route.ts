import { marketplaceV2AdapterKind, normalizedAdapterConfiguration } from "@/lib/marketplace-v2/adapter"
import { createPostgresMarketplaceDb } from "@/lib/marketplace-v2/normalized-db"
import { emailDeliveryConfig } from "@/lib/marketplace-v2/notify/config"
import { rememberSuppression } from "@/lib/marketplace-v2/notify/suppression"
import {
  applyEmailUnsubscribe,
  UNSUBSCRIBE_CONFIRMATION,
  unsubscribePage,
  unsubscribeToken
} from "@/lib/marketplace-v2/notify/unsubscribe"

export const dynamic = "force-dynamic"

const HEADERS = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex"
}

async function forgetInDatabase(token: string): Promise<void> {
  if (marketplaceV2AdapterKind() !== "normalized") return

  const db = createPostgresMarketplaceDb({ url: normalizedAdapterConfiguration().databaseUrl })

  try {
    await db.asAnon((calls) => calls.call("unsubscribe_with_token", { p_token: token }), { readOnly: false })
  } finally {
    await db.close()
  }
}

export async function GET(request: Request): Promise<Response> {
  const token = unsubscribeToken(request.url, "")

  return new Response(unsubscribePage(token), {
    headers: { ...HEADERS, "Content-Type": "text/html; charset=utf-8" },
    status: 200
  })
}

export async function POST(request: Request): Promise<Response> {
  const body = (await request.text()).slice(0, 2000)
  const token = unsubscribeToken(request.url, body)
  const { secret } = emailDeliveryConfig()

  try {
    await applyEmailUnsubscribe(token, secret, new Date(), { forgetInDatabase, remember: rememberSuppression })
  } catch {
    // The confirmation stays the same. The database's refusal names nothing this response can repeat.
  }

  return new Response(UNSUBSCRIBE_CONFIRMATION, {
    headers: { ...HEADERS, "Content-Type": "text/plain; charset=utf-8" },
    status: 200
  })
}
