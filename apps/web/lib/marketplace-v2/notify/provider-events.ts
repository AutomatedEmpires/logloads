/**
 * notify (#405): the provider's webhook. Resend signs each event with Svix (`svix-id`, `svix-timestamp`,
 * `svix-signature`: base64 HMAC-SHA-256 of `<id>.<timestamp>.<body>` under the decoded `whsec_` secret). A verified
 * delivery moves a sent notice to delivered; a verified hard bounce or spam complaint moves it to bounced and puts the
 * recipient's keyed hash on the durable suppression list (legal review §5.3 item 4). Addresses are hashed at once and
 * never stored, logged or returned.
 */

import { createHmac, timingSafeEqual } from "node:crypto"

import type { MarketplaceEmailSuppressionReason } from "@logloads/contracts"
import { emailSuppressionHash } from "@logloads/services"

/** How far an event's timestamp may be from this server's clock (Svix's default tolerance). */
export const WEBHOOK_TOLERANCE_SECONDS = 5 * 60
/** The largest body read. Resend's events are a few kilobytes. */
export const WEBHOOK_MAX_BYTES = 256 * 1024

export interface ProviderEvent {
  kind: "delivered" | "bounced" | "complained"
  providerMessageId: string
  recipients: string[]
  occurredAt: string | null
}

export interface ProviderEventStore {
  recordProviderEvent(providerMessageId: string, event: "delivered" | "bounced", occurredAt: string | null): Promise<number>
  suppress(hash: string, reason: MarketplaceEmailSuppressionReason): Promise<boolean>
}

const KINDS: Record<string, ProviderEvent["kind"]> = {
  "email.bounced": "bounced",
  "email.complained": "complained",
  "email.delivered": "delivered"
}

function secretBytes(secret: string): Buffer | null {
  const value = secret.trim()
  const encoded = value.startsWith("whsec_") ? value.slice("whsec_".length) : ""

  if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return null

  const bytes = Buffer.from(encoded, "base64")

  return bytes.length >= 16 ? bytes : null
}

/** True only for a body signed with this secret, with a fresh timestamp. */
export function verifyResendWebhook(input: {
  body: string
  id: string | null
  timestamp: string | null
  signature: string | null
  secret: string
  now: Date
}): boolean {
  const key = secretBytes(input.secret)

  if (!key || !input.id || !input.timestamp || !input.signature) return false
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(input.id) || !/^\d{1,12}$/.test(input.timestamp)) return false

  const sent = Number.parseInt(input.timestamp, 10)

  if (Math.abs(Math.floor(input.now.getTime() / 1000) - sent) > WEBHOOK_TOLERANCE_SECONDS) return false

  const expected = createHmac("sha256", key).update(`${input.id}.${input.timestamp}.${input.body}`).digest()

  return input.signature.split(" ").some((part) => {
    const [version, value] = part.split(",", 2)

    if (version !== "v1" || !value) return false

    const given = Buffer.from(value, "base64")

    return given.length === expected.length && timingSafeEqual(given, expected)
  })
}

/** The event this webhook acts on, or null for any other type or a body it cannot read. */
export function parseResendEvent(body: string): ProviderEvent | null {
  let parsed: unknown

  try {
    parsed = JSON.parse(body)
  } catch {
    return null
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null

  const record = parsed as { type?: unknown; created_at?: unknown; data?: unknown }
  const kind = typeof record.type === "string" ? KINDS[record.type] : undefined
  const data = record.data && typeof record.data === "object" && !Array.isArray(record.data) ? record.data as Record<string, unknown> : null

  if (!kind || !data) return null

  const id = typeof data.email_id === "string" ? data.email_id.trim() : ""

  if (!id || id.length > 200) return null

  const recipients = (Array.isArray(data.to) ? data.to : typeof data.to === "string" ? [data.to] : [])
    .filter((value): value is string => typeof value === "string" && value.includes("@"))
    .slice(0, 50)
  const at = typeof record.created_at === "string" && !Number.isNaN(Date.parse(record.created_at)) ? new Date(record.created_at).toISOString() : null

  return { kind, occurredAt: at, providerMessageId: id, recipients }
}

/**
 * Applies one verified event. A repeat changes no notice again; a suppression already on the list stays as it was
 * first recorded. Returns counts only.
 */
export async function applyProviderEvent(event: ProviderEvent, suppressionKey: string, store: ProviderEventStore): Promise<{ updated: number; suppressed: number }> {
  const updated = event.kind === "complained"
    ? 0
    : await store.recordProviderEvent(event.providerMessageId, event.kind, event.occurredAt)

  if (event.kind === "delivered") return { suppressed: 0, updated }

  let suppressed = 0

  for (const hash of new Set(event.recipients.map((address) => emailSuppressionHash(address, suppressionKey)))) {
    await store.suppress(hash, event.kind)
    suppressed += 1
  }

  return { suppressed, updated }
}
