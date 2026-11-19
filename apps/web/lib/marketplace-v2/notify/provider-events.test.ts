import { createHmac, randomBytes } from "node:crypto"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const adapter = vi.hoisted(() => ({ kind: "normalized" as "pilot" | "normalized" }))

const worker = vi.hoisted(() => ({
  recordProviderEvent: vi.fn<(id: string, event: string, at: string | null) => Promise<number>>(async () => 1),
  suppress: vi.fn<(hash: string, reason: string) => Promise<boolean>>(async () => true)
}))

vi.mock("@/lib/marketplace-v2/adapter", () => ({
  marketplaceV2AdapterKind: () => adapter.kind,
  normalizedAdapterConfiguration: () => ({ databaseUrl: "postgres://example.invalid/logloads-test" })
}))

vi.mock("@/lib/marketplace-v2/notify/worker-db", () => ({
  createPostgresNotificationWorker: () => ({ recordProviderEvent: worker.recordProviderEvent, suppress: worker.suppress })
}))

import { emailSuppressionHash } from "@logloads/services"

import { POST } from "@/app/api/v2/notify/provider-events/route"
import { applyProviderEvent, parseResendEvent, verifyResendWebhook } from "./provider-events"

const KEY = "test-suppression-key-0123456789abcdef"
const SECRET = `whsec_${randomBytes(24).toString("base64")}`
const NOW = new Date("2026-11-18T18:00:00.000Z")
const STAMP = String(Math.floor(NOW.getTime() / 1000))
const ADDRESS = "bounced@example.com"

function sign(id: string, timestamp: string, body: string, secret = SECRET): string {
  const key = Buffer.from(secret.slice("whsec_".length), "base64")

  return `v1,${createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64")}`
}

function event(type: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    created_at: "2026-11-18T17:59:30.000Z",
    data: { created_at: "2026-11-18T17:59:00.000Z", email_id: "re_123", from: "LogLoads <n@logloads.com>", subject: "s", to: [ADDRESS], ...extra },
    type
  })
}

describe("verifyResendWebhook", () => {
  const body = event("email.bounced")
  const verify = (overrides: Partial<Parameters<typeof verifyResendWebhook>[0]> = {}) => verifyResendWebhook({
    body,
    id: "msg_1",
    now: NOW,
    secret: SECRET,
    signature: sign("msg_1", STAMP, body),
    timestamp: STAMP,
    ...overrides
  })

  it("accepts a body signed with the secret and a fresh timestamp", () => {
    expect(verify()).toBe(true)
    expect(verify({ signature: `v1,${Buffer.alloc(32).toString("base64")} ${sign("msg_1", STAMP, body)}` })).toBe(true)
  })

  it("refuses a changed body, another secret, an old or future timestamp, and missing parts", () => {
    expect(verify({ body: body.replace(ADDRESS, "someone@example.com") })).toBe(false)
    expect(verify({ signature: sign("msg_1", STAMP, body, `whsec_${randomBytes(24).toString("base64")}`) })).toBe(false)
    expect(verify({ now: new Date(NOW.getTime() + 6 * 60_000) })).toBe(false)
    expect(verify({ now: new Date(NOW.getTime() - 6 * 60_000) })).toBe(false)
    expect(verify({ id: null })).toBe(false)
    expect(verify({ signature: "v2,abc" })).toBe(false)
    expect(verify({ secret: "" })).toBe(false)
    expect(verify({ secret: "not-a-whsec-secret" })).toBe(false)
  })
})

describe("parseResendEvent and applyProviderEvent", () => {
  it("reads deliveries, bounces and complaints, and nothing else", () => {
    expect(parseResendEvent(event("email.delivered"))).toEqual({ kind: "delivered", occurredAt: "2026-11-18T17:59:30.000Z", providerMessageId: "re_123", recipients: [ADDRESS] })
    expect(parseResendEvent(event("email.bounced"))?.kind).toBe("bounced")
    expect(parseResendEvent(event("email.complained"))?.kind).toBe("complained")
    expect(parseResendEvent(event("email.opened"))).toBeNull()
    expect(parseResendEvent(event("email.delivery_delayed"))).toBeNull()
    expect(parseResendEvent(event("email.bounced", { email_id: "" }))).toBeNull()
    expect(parseResendEvent("not json")).toBeNull()
  })

  it("moves a delivered notice, and puts a bounced or complaining address's keyed hash on the list", async () => {
    const store = { recordProviderEvent: vi.fn(async () => 1), suppress: vi.fn(async () => true) }

    expect(await applyProviderEvent(parseResendEvent(event("email.delivered"))!, KEY, store)).toEqual({ suppressed: 0, updated: 1 })
    expect(store.suppress).not.toHaveBeenCalled()

    expect(await applyProviderEvent(parseResendEvent(event("email.bounced", { to: [ADDRESS, "Bounced@Example.com"] }))!, KEY, store)).toEqual({ suppressed: 1, updated: 1 })
    expect(store.recordProviderEvent).toHaveBeenLastCalledWith("re_123", "bounced", "2026-11-18T17:59:30.000Z")
    expect(store.suppress).toHaveBeenCalledWith(emailSuppressionHash(ADDRESS, KEY), "bounced")

    store.recordProviderEvent.mockClear()
    await applyProviderEvent(parseResendEvent(event("email.complained"))!, KEY, store)
    expect(store.recordProviderEvent).not.toHaveBeenCalled()
    expect(store.suppress).toHaveBeenLastCalledWith(emailSuppressionHash(ADDRESS, KEY), "complained")
    expect(JSON.stringify(store.suppress.mock.calls)).not.toContain("@")
  })
})

describe("the provider-events route", () => {
  beforeEach(() => {
    adapter.kind = "normalized"
    worker.recordProviderEvent.mockClear()
    worker.suppress.mockClear()
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    vi.stubEnv("RESEND_WEBHOOK_SECRET", SECRET)
    vi.stubEnv("LOGLOADS_EMAIL_SUPPRESSION_KEY", KEY)
    vi.stubEnv("LOGLOADS_NORMALIZED_EMAIL_WORKER_DATABASE_URL", "postgres://example.invalid/worker")
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  const post = (body: string, signature = sign("msg_1", STAMP, body)) => POST(new Request("http://127.0.0.1:3002/api/v2/notify/provider-events", {
    body,
    headers: { "svix-id": "msg_1", "svix-signature": signature, "svix-timestamp": STAMP },
    method: "POST"
  }))

  it("applies a signed bounce and answers with counts only", async () => {
    const response = await post(event("email.bounced"))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: "applied", suppressed: 1, updated: 1 })
    expect(worker.suppress).toHaveBeenCalledWith(emailSuppressionHash(ADDRESS, KEY), "bounced")
  })

  it("refuses an unsigned or forged event, and changes nothing", async () => {
    expect((await post(event("email.bounced"), "v1,AAAA")).status).toBe(401)
    expect(worker.recordProviderEvent).not.toHaveBeenCalled()
    expect(worker.suppress).not.toHaveBeenCalled()
  })

  it("acknowledges an event type it does not act on, and asks for a retry while it is not configured", async () => {
    expect(await (await post(event("email.opened"))).json()).toEqual({ status: "ignored" })

    vi.stubEnv("LOGLOADS_NORMALIZED_EMAIL_WORKER_DATABASE_URL", "")
    expect((await post(event("email.bounced"))).status).toBe(503)

    vi.stubEnv("RESEND_WEBHOOK_SECRET", "")
    expect((await post(event("email.bounced"))).status).toBe(503)
    expect(worker.suppress).not.toHaveBeenCalled()
  })
})
