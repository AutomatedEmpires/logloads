import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const db = vi.hoisted(() => ({
  asAnon: vi.fn(async (work: (calls: { call: ReturnType<typeof vi.fn> }) => Promise<unknown>) => {
    const call = vi.fn(async () => undefined)
    db.lastCall = call
    await work({ call })
  }),
  close: vi.fn(async () => undefined),
  created: 0,
  kind: "pilot" as "pilot" | "normalized",
  lastCall: null as null | ReturnType<typeof vi.fn>
}))

const worker = vi.hoisted(() => ({
  created: 0,
  suppress: vi.fn<(hash: string, reason: string) => Promise<boolean>>(async () => true)
}))

const limits = vi.hoisted(() => ({
  checkRateLimit: vi.fn<(bucket: string, key: string, limit: number, windowMs: number) => Promise<void>>(async () => undefined),
  requestClientKey: vi.fn(async () => "client-key")
}))

vi.mock("@/lib/marketplace-v2/adapter", () => ({
  marketplaceV2AdapterKind: () => db.kind,
  normalizedAdapterConfiguration: () => ({
    databaseUrl: "postgres://example.invalid/logloads-test",
    identity: { audience: "logloads-test", issuer: "https://issuer.example" },
    identitySyncDatabaseUrl: null
  })
}))

vi.mock("@/lib/marketplace-v2/normalized-db", () => ({
  createPostgresMarketplaceDb: () => {
    db.created += 1
    return { asAnon: db.asAnon, close: db.close }
  }
}))

vi.mock("@/lib/marketplace-v2/notify/worker-db", () => ({
  createPostgresNotificationWorker: () => {
    worker.created += 1
    return { suppress: worker.suppress }
  }
}))

vi.mock("@/lib/rate-limit", async () => {
  class RateLimitError extends Error {
    constructor(public readonly retryAfterSeconds: number) {
      super("Too many attempts.")
    }
  }
  class RateLimitUnavailableError extends Error {
    constructor(public readonly retryAfterSeconds = 5) {
      super("Unavailable.")
    }
  }

  return { RateLimitError, RateLimitUnavailableError, checkRateLimit: limits.checkRateLimit, requestClientKey: limits.requestClientKey }
})

import type { MarketplaceEmailNoticeClaim } from "@logloads/contracts"
import { emailSuppressionHash, planEmailDelivery, signSuppressionToken, type EmailDeliveryPlan, type EmailSendMessage } from "@logloads/services"

import { GET as deliverGet } from "@/app/api/v2/notify/deliver/route"
import { GET, POST } from "@/app/api/v2/notify/unsubscribe/route"
import { RateLimitError, RateLimitUnavailableError } from "@/lib/rate-limit"
import { MarketplaceFeatureUnavailableError } from "../port"
import { emailDeliveryConfig } from "./config"
import { deliverEmailBatch, sendViaResend, type ResendSendResult } from "./deliver"
import { normalizedNotify } from "./index"
import { applyEmailUnsubscribe, UNSUBSCRIBE_CONFIRMATION, UNSUBSCRIBE_RATE_LIMIT, unsubscribePage } from "./unsubscribe"

const ADDRESS = "hauler@example.com"
const KEY = "test-suppression-key-0123456789abcdef"
const NOW = new Date("2026-11-17T18:00:00.000Z")
const NOTICE = "11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const NOTICE_2 = "11111111-aaaa-4aaa-8aaa-bbbbbbbbbbbb"
const CLAIM = "55555555-dddd-4ddd-8ddd-dddddddddddd"
const ORG = "33333333-bbbb-4bbb-8bbb-333333333333"

const FOOTER = {
  legalName: "LogLoads",
  postalAddress: "Test mailbox 100",
  reason: "You saved a search for jobs like this one.",
  unsubscribeUrl: "https://logloads.com/api/v2/notify/unsubscribe?token=abc"
}

const MESSAGE: EmailSendMessage = {
  listUnsubscribe: "<https://logloads.com/api/v2/notify/unsubscribe?token=abc>",
  listUnsubscribePost: "List-Unsubscribe=One-Click",
  subject: "A job matches a search you saved",
  text: "A job matches a search you saved on LogLoads.",
  to: ADDRESS
}

function claim(notificationId = NOTICE, address = ADDRESS): MarketplaceEmailNoticeClaim {
  return {
    attemptCount: 1,
    category: "job_alert",
    claimToken: CLAIM,
    deliveryAddress: address,
    notificationId,
    payload: { job_id: NOTICE },
    recipientOrganizationId: ORG,
    recipientUserId: null
  }
}

function plan(address = ADDRESS, suppressed: string[] = []): EmailDeliveryPlan {
  return planEmailDelivery({
    address,
    allowlist: [ADDRESS],
    facts: { attempt: 1, footer: FOOTER, invitationSendCount: null, landingName: null, organizationName: null, promotion: null, template: "job_alert" },
    suppression: { hashes: suppressed, key: KEY }
  })
}

describe("email delivery config", () => {
  it("allows nobody when the list is empty, does not invent a footer, and never uses the session secret", () => {
    expect(emailDeliveryConfig({}).allowlist).toEqual([])
    expect(emailDeliveryConfig({ LOGLOADS_EMAIL_TEST_RECIPIENTS: " Hauler@Example.com, , no " }).allowlist).toEqual([ADDRESS])
    expect(emailDeliveryConfig({ LOGLOADS_LEGAL_NAME: "  ", LOGLOADS_POSTAL_ADDRESS: "" }).legalName).toBe("")
    expect(emailDeliveryConfig({ LOGLOADS_LEGAL_NAME: "  ", LOGLOADS_POSTAL_ADDRESS: "" }).postalAddress).toBe("")
    expect(emailDeliveryConfig({ LOGLOADS_SESSION_SECRET: KEY } as never).suppressionKey).toBe("")
    expect(emailDeliveryConfig({ LOGLOADS_EMAIL_SUPPRESSION_KEY: KEY }).suppressionKey).toBe(KEY)
  })

  it("links only to an https origin", () => {
    expect(emailDeliveryConfig({ NEXT_PUBLIC_APP_URL: "https://logloads.com/some/path" }).origin).toBe("https://logloads.com")
    expect(emailDeliveryConfig({ NEXT_PUBLIC_APP_URL: "http://localhost:3002" }).origin).toBeNull()
    expect(emailDeliveryConfig({}).origin).toBeNull()
    expect(emailDeliveryConfig({ RESEND_FROM: " ", LOGLOADS_EMAIL_FROM: "LogLoads <n@logloads.com>" }).from).toBe("LogLoads <n@logloads.com>")
  })
})

describe("sendViaResend", () => {
  beforeEach(() => {
    vi.stubEnv("LOGLOADS_EMAIL_TEST_RECIPIENTS", ADDRESS)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  const send = (fetch: (url: string, init: RequestInit) => Promise<Response>, message = MESSAGE) =>
    sendViaResend({ apiKey: "test-key", fetch, from: "LogLoads <notifications@logloads.com>", idempotencyKey: `logloads-notice/${NOTICE}`, message })

  it("posts the planned message with the notice's idempotency key and returns the provider id", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const result = await send(async (url, init) => {
      calls.push({ init: init ?? {}, url: String(url) })
      return new Response(JSON.stringify({ id: "re_1" }), { status: 200 })
    })

    expect(result).toEqual({ id: "re_1", ok: true })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe("https://api.resend.com/emails")
    expect(calls[0]?.init.headers).toMatchObject({ Authorization: "Bearer test-key", "Idempotency-Key": `logloads-notice/${NOTICE}` })
    expect(JSON.parse(String(calls[0]?.init.body))).toMatchObject({
      headers: {
        "List-Unsubscribe": MESSAGE.listUnsubscribe,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"
      },
      subject: MESSAGE.subject,
      to: [ADDRESS]
    })
  })

  it("checks the test-recipient list itself, from the environment, before it calls Resend", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ id: "re_1" }), { status: 200 }))

    expect(await send(fetch, { ...MESSAGE, to: "someone@example.com" })).toEqual({ ok: false, outcome: "not-sent", reason: "test-recipient" })
    vi.stubEnv("LOGLOADS_EMAIL_TEST_RECIPIENTS", "")
    expect(await send(fetch)).toEqual({ ok: false, outcome: "not-sent", reason: "test-recipient" })
    expect(fetch).not.toHaveBeenCalled()
  })

  it("does not call Resend without a key, a from address or an idempotency key", async () => {
    const fetch = vi.fn(async () => new Response("no", { status: 422 }))

    expect(await sendViaResend({ apiKey: "", fetch, from: "LogLoads <notifications@logloads.com>", idempotencyKey: "k", message: MESSAGE })).toMatchObject({ outcome: "not-sent" })
    expect(await sendViaResend({ apiKey: "test-key", fetch, from: "  ", idempotencyKey: "k", message: MESSAGE })).toMatchObject({ outcome: "not-sent" })
    expect(await sendViaResend({ apiKey: "test-key", fetch, from: "LogLoads <n@logloads.com>", idempotencyKey: "", message: MESSAGE })).toMatchObject({ outcome: "not-sent" })
    expect(fetch).not.toHaveBeenCalled()
  })

  it("treats a lost or unreadable reply as a retry, a reused key as a duplicate, and a 4xx as a rejection", async () => {
    expect(await send(async () => {
      throw new DOMException("The operation timed out.", "TimeoutError")
    })).toEqual({ ok: false, outcome: "retry" })
    expect(await send(async () => new Response("not json", { status: 200 }))).toEqual({ ok: false, outcome: "retry" })
    expect(await send(async () => new Response("down", { status: 503 }))).toEqual({ ok: false, outcome: "retry" })
    expect(await send(async () => new Response("slow", { headers: { "retry-after": "12" }, status: 429 }))).toEqual({ ok: false, outcome: "retry", retryAfterSeconds: 12 })
    expect(await send(async () => new Response(JSON.stringify({ name: "concurrent_idempotent_requests" }), { status: 409 })))
      .toEqual({ ok: false, outcome: "retry", retryAfterSeconds: 30 })
    expect(await send(async () => new Response(JSON.stringify({ name: "invalid_idempotent_request" }), { status: 409 })))
      .toEqual({ ok: false, outcome: "duplicate" })
    expect(await send(async () => new Response(JSON.stringify({ name: "validation_error" }), { status: 422 }))).toEqual({ ok: false, outcome: "rejected" })
  })
})

/** A fake Resend that keeps what it accepted by idempotency key, as the real one does for 24 hours. */
function fakeResend() {
  const accepted = new Map<string, { id: string; body: string }>()
  const delivered: string[] = []

  return {
    accepted,
    delivered,
    async send(message: EmailSendMessage, key: string, options: { loseReply?: boolean } = {}): Promise<ResendSendResult> {
      const body = JSON.stringify(message)
      const earlier = accepted.get(key)

      if (earlier) return earlier.body === body ? { id: earlier.id, ok: true } : { ok: false, outcome: "duplicate" }

      const id = `re_${accepted.size + 1}`
      accepted.set(key, { body, id })
      delivered.push(message.to)
      return options.loseReply ? { ok: false, outcome: "retry" } : { id, ok: true }
    }
  }
}

describe("deliverEmailBatch", () => {
  it("sends only a planned message, and records a suppression or a retry without the address", async () => {
    const sent: string[] = []
    const outcomes: string[] = []

    const result = await deliverEmailBatch({
      canSend: () => true,
      claims: [claim(NOTICE), claim(NOTICE_2, "other@example.com"), claim("11111111-aaaa-4aaa-8aaa-cccccccccccc")],
      complete: async (_id, _token, outcome) => {
        outcomes.push(outcome.outcome)
        if (outcome.outcome !== "sent") expect(outcome.failure).not.toContain("@")
      },
      plan: async (row) => plan(row.deliveryAddress),
      send: async (message) => {
        sent.push(message.to)
        return sent.length === 1 ? { id: "provider-1", ok: true as const } : { ok: false as const, outcome: "retry" as const }
      }
    })

    expect(sent).toEqual([ADDRESS, ADDRESS])
    expect(outcomes).toEqual(["sent", "suppressed", "retry"])
    expect(result).toEqual({ failed: 0, retried: 1, sent: 1, skipped: 0, suppressed: 1, unconfirmed: 0 })
  })

  it("suppresses an address whose keyed hash is on the list", async () => {
    const send = vi.fn(async () => ({ id: "provider-1", ok: true as const }))
    const complete = vi.fn(async () => undefined)

    await deliverEmailBatch({ canSend: () => true, claims: [claim()], complete, plan: async () => plan(ADDRESS, [emailSuppressionHash(ADDRESS, KEY)]), send })

    expect(send).not.toHaveBeenCalled()
    expect(complete).toHaveBeenCalledWith(NOTICE, CLAIM, { failure: "suppressed", outcome: "suppressed" })
  })

  it("(a) a send whose reply was lost is retried with the same key, and Resend returns the first send", async () => {
    const resend = fakeResend()
    const outcomes: Array<{ outcome: string; providerMessageId?: string }> = []
    const complete = async (_id: string, _token: string, outcome: { outcome: string; providerMessageId?: string }) => {
      outcomes.push(outcome)
    }

    await deliverEmailBatch({ canSend: () => true, claims: [claim()], complete, plan: async () => plan(), send: (message, key) => resend.send(message, key, { loseReply: true }) })
    // The row went back to pending. The next claim composes the same email and sends it with the same key.
    await deliverEmailBatch({ canSend: () => true, claims: [{ ...claim(), attemptCount: 2 }], complete, plan: async () => plan(), send: (message, key) => resend.send(message, key) })

    expect(resend.delivered).toEqual([ADDRESS])
    expect(outcomes.map((row) => row.outcome)).toEqual(["retry", "sent"])
    expect(outcomes[1]?.providerMessageId).toBe("re_1")
    expect([...resend.accepted.keys()]).toEqual([`logloads-notice/${NOTICE}`])
  })

  it("(b) a failed report after a good send does not stop the batch, and the re-claim does not send twice", async () => {
    const resend = fakeResend()
    const reports: string[] = []
    let refuse = true

    const first = await deliverEmailBatch({
      canSend: () => true,
      claims: [claim(NOTICE), claim(NOTICE_2)],
      async complete(id, _token, outcome) {
        if (id === NOTICE && refuse) throw Object.assign(new Error("lease ran out"), { code: "55000" })
        reports.push(`${id}:${outcome.outcome}`)
      },
      plan: async () => plan(),
      send: (message, key) => resend.send(message, key)
    })

    expect(first).toMatchObject({ sent: 1, unconfirmed: 1 })
    expect(reports).toEqual([`${NOTICE_2}:sent`])

    refuse = false
    // After the lease, the first row is claimed again (possibly by another worker) and sent with the same key.
    const second = await deliverEmailBatch({
      canSend: () => true,
      claims: [{ ...claim(NOTICE), attemptCount: 2 }],
      async complete(id, _token, outcome) {
        reports.push(`${id}:${outcome.outcome}`)
      },
      plan: async () => plan(),
      send: (message, key) => resend.send(message, key)
    })

    expect(second).toMatchObject({ sent: 1, unconfirmed: 0 })
    expect(resend.delivered).toEqual([ADDRESS, ADDRESS])
    expect(resend.accepted.size).toBe(2)
  })

  it("(c) stops sending before the lease runs out and leaves the rest claimed", async () => {
    const send = vi.fn(async () => ({ id: "re_1", ok: true as const }))
    const complete = vi.fn(async () => undefined)
    let budget = 1

    const result = await deliverEmailBatch({
      canSend: () => budget-- > 0,
      claims: [claim(NOTICE), claim(NOTICE_2)],
      complete,
      plan: async () => plan(),
      send
    })

    expect(send).toHaveBeenCalledOnce()
    expect(complete).toHaveBeenCalledOnce()
    expect(result).toMatchObject({ sent: 1, skipped: 1 })
  })

  it("does not send again when the key was already used with another body, and records why without an address", async () => {
    const complete = vi.fn(async () => undefined)

    await deliverEmailBatch({
      canSend: () => true,
      claims: [claim()],
      complete,
      plan: async () => plan(),
      send: async () => ({ ok: false, outcome: "duplicate" })
    })

    expect(complete).toHaveBeenCalledWith(NOTICE, CLAIM, expect.objectContaining({ outcome: "failed" }))
    expect(JSON.stringify(complete.mock.calls)).not.toContain("@")
  })
})

describe("unsubscribe", () => {
  beforeEach(() => {
    db.kind = "pilot"
    db.created = 0
    db.lastCall = null
    db.asAnon.mockClear()
    db.close.mockClear()
    worker.created = 0
    worker.suppress.mockClear()
    limits.checkRateLimit.mockReset()
    limits.checkRateLimit.mockResolvedValue(undefined)
    vi.stubEnv("LOGLOADS_EMAIL_SUPPRESSION_KEY", KEY)
    vi.stubEnv("LOGLOADS_NORMALIZED_EMAIL_WORKER_DATABASE_URL", "postgres://example.invalid/worker")
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  const form = (token: string) => new Request("http://127.0.0.1:3002/api/v2/notify/unsubscribe", {
    body: `token=${encodeURIComponent(token)}`,
    headers: { "content-type": "application/x-www-form-urlencoded" },
    method: "POST"
  })

  it("shows a button and changes nothing when the page is opened", async () => {
    const token = signSuppressionToken(ADDRESS, KEY, new Date(NOW.getTime() + 86_400_000), NOW)
    const response = await GET(new Request(`http://127.0.0.1:3002/api/v2/notify/unsubscribe?token=${token}`))

    expect(response.status).toBe(200)
    expect(response.headers.get("set-cookie")).toBeNull()
    expect(await response.text()).toContain("Opening this page changes nothing.")
    expect(db.created).toBe(0)
    expect(worker.suppress).not.toHaveBeenCalled()
    expect(unsubscribePage(`"><script>`)).toContain('value=""')
    expect(unsubscribePage(`"><script>`)).not.toContain("<script>")
  })

  it("puts a no-account address on the durable list on the button, and shows the same confirmation for any token", async () => {
    db.kind = "normalized"
    const clock = new Date()
    const token = signSuppressionToken(ADDRESS, KEY, new Date(clock.getTime() + 86_400_000), clock)
    const response = await POST(form(token))

    expect(response.status).toBe(200)
    expect(response.headers.get("set-cookie")).toBeNull()
    expect(await response.text()).toBe(UNSUBSCRIBE_CONFIRMATION)
    expect(worker.suppress).toHaveBeenCalledWith(emailSuppressionHash(ADDRESS, KEY), "unsubscribed")
    expect(db.asAnon).not.toHaveBeenCalled()

    const oneClick = await POST(new Request(`http://127.0.0.1:3002/api/v2/notify/unsubscribe?token=${encodeURIComponent(token)}`, {
      body: "List-Unsubscribe=One-Click",
      method: "POST"
    }))

    expect(await oneClick.text()).toBe(UNSUBSCRIBE_CONFIRMATION)
    expect(worker.suppress).toHaveBeenCalledTimes(2)
    // At most one worker connection for both requests (none if an earlier test opened it): reused, not opened per POST.
    expect(worker.created).toBeLessThanOrEqual(1)
  })

  it("does not accept a no-account link signed with the session secret", async () => {
    db.kind = "normalized"
    vi.stubEnv("LOGLOADS_SESSION_SECRET", "session-secret-0123456789abcdef-long")
    const clock = new Date()
    const forged = signSuppressionToken(ADDRESS, "session-secret-0123456789abcdef-long", new Date(clock.getTime() + 86_400_000), clock)

    expect(await (await POST(form(forged))).text()).toBe(UNSUBSCRIBE_CONFIRMATION)
    expect(worker.suppress).not.toHaveBeenCalled()
  })

  it("asks the database to apply its own token, over one reused connection", async () => {
    db.kind = "normalized"
    const token = "abc.def"

    expect(await (await POST(form(token))).text()).toBe(UNSUBSCRIBE_CONFIRMATION)
    expect(await (await POST(form(token))).text()).toBe(UNSUBSCRIBE_CONFIRMATION)
    expect(db.created).toBeLessThanOrEqual(1)
    expect(db.close).not.toHaveBeenCalled()
    expect(db.asAnon).toHaveBeenCalledWith(expect.any(Function), { readOnly: false })
    expect(db.lastCall).toHaveBeenCalledWith("unsubscribe_with_token", { p_token: token })
    expect(worker.suppress).not.toHaveBeenCalled()
  })

  it("keeps the confirmation when the database refuses", async () => {
    db.kind = "normalized"
    db.asAnon.mockRejectedValueOnce(new Error("refused"))

    const response = await POST(new Request("http://127.0.0.1:3002/api/v2/notify/unsubscribe?token=abc.def", { method: "POST" }))

    expect(response.status).toBe(200)
    expect(await response.text()).toBe(UNSUBSCRIBE_CONFIRMATION)
  })

  it("rate-limits POSTs per client, and an outage of the limiter does not block an opt-out", async () => {
    db.kind = "normalized"
    limits.checkRateLimit.mockRejectedValueOnce(new RateLimitError(42))

    const limited = await POST(form("abc.def"))

    expect(limited.status).toBe(429)
    expect(limited.headers.get("retry-after")).toBe("42")
    expect(limits.checkRateLimit).toHaveBeenCalledWith(UNSUBSCRIBE_RATE_LIMIT.bucket, "client-key", UNSUBSCRIBE_RATE_LIMIT.limit, UNSUBSCRIBE_RATE_LIMIT.windowMs)
    expect(db.asAnon).not.toHaveBeenCalled()

    limits.checkRateLimit.mockRejectedValueOnce(new RateLimitUnavailableError(5))

    const allowed = await POST(form("abc.def"))

    expect(allowed.status).toBe(200)
    expect(db.asAnon).toHaveBeenCalledOnce()
  })

  it("hands a token that is not a no-account link to the database, and nothing for an empty token", async () => {
    const forgotten: string[] = []
    const suppressed: string[] = []
    const effects = {
      forgetInDatabase: async (value: string) => {
        forgotten.push(value)
      },
      suppress: async (hash: string) => {
        suppressed.push(hash)
      }
    }

    await applyEmailUnsubscribe("abc.def", KEY, NOW, effects)
    await applyEmailUnsubscribe("", KEY, NOW, effects)

    expect(forgotten).toEqual(["abc.def"])
    expect(suppressed).toEqual([])
  })
})

describe("the worker route", () => {
  beforeEach(() => {
    db.kind = "normalized"
    vi.stubEnv("CRON_SECRET", "cron-test-secret")
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  const call = (authorization?: string) => deliverGet(new Request("http://127.0.0.1:3002/api/v2/notify/deliver", {
    headers: authorization ? { authorization } : {}
  }))

  it("refuses without the cron secret", async () => {
    expect((await call()).status).toBe(401)
    expect((await call("Bearer wrong")).status).toBe(401)
    vi.stubEnv("CRON_SECRET", "")
    expect((await call("Bearer ")).status).toBe(503)
  })

  it("does nothing on the pilot store, and claims nothing while a setting is missing", async () => {
    db.kind = "pilot"
    expect(await (await call("Bearer cron-test-secret")).json()).toEqual({ status: "off" })

    db.kind = "normalized"
    vi.stubEnv("LOGLOADS_NORMALIZED_EMAIL_WORKER_DATABASE_URL", "")
    const before = worker.created
    const body = await (await call("Bearer cron-test-secret")).json() as { status: string; missing: string[] }

    expect(body.status).toBe("not-ready")
    expect(body.missing).toContain("LOGLOADS_NORMALIZED_EMAIL_WORKER_DATABASE_URL")
    expect(worker.created).toBe(before)
  })
})

describe("in-app notices", () => {
  it("stay unavailable and do not claim the group is supported", async () => {
    expect(normalizedNotify.supported).toBe(false)

    const methods = normalizedNotify.methods({} as never)

    await expect(methods.listNotifications({ organizationId: ORG, userId: "user_test" })).rejects.toBeInstanceOf(MarketplaceFeatureUnavailableError)
    await expect(methods.markNotificationsRead({ organizationId: ORG, userId: "user_test" }, [NOTICE])).rejects.toBeInstanceOf(MarketplaceFeatureUnavailableError)
  })
})
