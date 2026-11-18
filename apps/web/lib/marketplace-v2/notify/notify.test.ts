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

import type { MarketplaceEmailFacts, MarketplaceEmailNoticeClaim } from "@logloads/contracts"
import { emailSuppressionHash, signSuppressionToken } from "@logloads/services"

import { GET, POST } from "@/app/api/v2/notify/unsubscribe/route"
import { MarketplaceFeatureUnavailableError } from "../port"
import { emailDeliveryConfig } from "./config"
import { deliverEmailBatch, sendViaResend } from "./deliver"
import { normalizedNotify } from "./index"
import { resetSuppressions, suppressionHashes } from "./suppression"
import { applyEmailUnsubscribe, UNSUBSCRIBE_CONFIRMATION, unsubscribePage } from "./unsubscribe"

const ADDRESS = "hauler@example.com"
const SECRET = "test-suppression-secret"
const NOW = new Date("2026-11-17T18:00:00.000Z")
const NOTICE = "11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const CLAIM = "55555555-dddd-4ddd-8ddd-dddddddddddd"
const ORG = "33333333-bbbb-4bbb-8bbb-333333333333"

const FOOTER = {
  legalName: "LogLoads",
  postalAddress: "Test mailbox 100",
  reason: "You saved a search for jobs like this one.",
  unsubscribeUrl: "https://logloads.com/api/v2/notify/unsubscribe?token=abc"
}

function claim(address = ADDRESS): MarketplaceEmailNoticeClaim {
  return {
    attemptCount: 1,
    category: "job_alert",
    claimToken: CLAIM,
    deliveryAddress: address,
    notificationId: NOTICE,
    payload: { job_id: NOTICE },
    recipientOrganizationId: ORG,
    recipientUserId: null
  }
}

function facts(): MarketplaceEmailFacts {
  return {
    attempt: 1,
    footer: FOOTER,
    invitationSendCount: null,
    landingName: null,
    organizationName: null,
    promotion: null,
    template: "job_alert"
  }
}

describe("email delivery config", () => {
  it("allows nobody when the list is empty, and does not invent a footer", () => {
    expect(emailDeliveryConfig({}).allowlist).toEqual([])
    expect(emailDeliveryConfig({ LOGLOADS_EMAIL_TEST_RECIPIENTS: " Hauler@Example.com, , no " }).allowlist).toEqual([ADDRESS])
    expect(emailDeliveryConfig({ LOGLOADS_LEGAL_NAME: "  ", LOGLOADS_POSTAL_ADDRESS: "" }).legalName).toBe("")
    expect(emailDeliveryConfig({ LOGLOADS_LEGAL_NAME: "  ", LOGLOADS_POSTAL_ADDRESS: "" }).postalAddress).toBe("")
  })
})

describe("deliverEmailBatch", () => {
  it("sends only a planned message, and records a suppression or a retry without the address", async () => {
    const sent: string[] = []
    const outcomes: string[] = []

    const result = await deliverEmailBatch({
      allowlist: [ADDRESS],
      claims: [claim(), claim("other@example.com"), claim()],
      complete: async (_id, _token, outcome) => {
        outcomes.push(outcome.outcome)
        if (outcome.outcome !== "sent") expect(outcome.failure).not.toContain("@")
      },
      factsFor: async () => facts(),
      send: async (message) => {
        sent.push(message.to)
        return sent.length === 1 ? { id: "provider-1", ok: true as const } : { ok: false as const }
      },
      suppressedHashes: []
    })

    expect(sent).toEqual([ADDRESS, ADDRESS])
    expect(outcomes).toEqual(["sent", "suppressed", "retry"])
    expect(result).toEqual({ retried: 1, sent: 1, suppressed: 1 })
  })

  it("suppresses an address whose hash is already on the list", async () => {
    const send = vi.fn(async () => ({ id: "provider-1", ok: true as const }))
    const complete = vi.fn(async () => undefined)

    await deliverEmailBatch({
      allowlist: [ADDRESS],
      claims: [claim()],
      complete,
      factsFor: async () => facts(),
      send,
      suppressedHashes: [emailSuppressionHash(ADDRESS)]
    })

    expect(send).not.toHaveBeenCalled()
    expect(complete).toHaveBeenCalledWith(NOTICE, CLAIM, { failure: "suppressed", outcome: "suppressed" })
  })
})

describe("sendViaResend", () => {
  const message = {
    listUnsubscribe: "<https://logloads.com/api/v2/notify/unsubscribe?token=abc>",
    listUnsubscribePost: "List-Unsubscribe=One-Click" as const,
    subject: "A job matches a search you saved",
    text: "A job matches a search you saved on LogLoads.",
    to: ADDRESS
  }

  it("posts the planned message and returns the provider id", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const result = await sendViaResend({
      apiKey: "test-key",
      fetch: async (url, init) => {
        calls.push({ init: init ?? {}, url: String(url) })
        return new Response(JSON.stringify({ id: "re_1" }), { status: 200 })
      },
      from: "LogLoads <notifications@logloads.com>",
      message
    })

    expect(result).toEqual({ id: "re_1", ok: true })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe("https://api.resend.com/emails")
    expect(calls[0]?.init.headers).toMatchObject({ Authorization: "Bearer test-key" })
    expect(JSON.parse(String(calls[0]?.init.body))).toMatchObject({
      headers: {
        "List-Unsubscribe": message.listUnsubscribe,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"
      },
      subject: message.subject,
      to: [ADDRESS]
    })
  })

  it("does not call Resend without a key or a from address, and a rejection is not a send", async () => {
    const fetch = vi.fn(async () => new Response("no", { status: 422 }))

    expect(await sendViaResend({ apiKey: "", fetch, from: "LogLoads <notifications@logloads.com>", message })).toEqual({ ok: false })
    expect(await sendViaResend({ apiKey: "test-key", fetch, from: "  ", message })).toEqual({ ok: false })
    expect(fetch).not.toHaveBeenCalled()
    expect(await sendViaResend({ apiKey: "test-key", fetch, from: "LogLoads <notifications@logloads.com>", message })).toEqual({ ok: false })
    expect(fetch).toHaveBeenCalledOnce()
  })
})

describe("unsubscribe", () => {
  beforeEach(() => {
    db.kind = "pilot"
    db.created = 0
    db.lastCall = null
    db.asAnon.mockClear()
    db.close.mockClear()
    resetSuppressions()
    vi.stubEnv("LOGLOADS_SESSION_SECRET", SECRET)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("shows a button and changes nothing when the page is opened", async () => {
    const token = signSuppressionToken(ADDRESS, SECRET, new Date(NOW.getTime() + 86_400_000), NOW)
    const response = await GET(new Request(`http://127.0.0.1:3002/api/v2/notify/unsubscribe?token=${token}`))

    expect(response.status).toBe(200)
    expect(response.headers.get("set-cookie")).toBeNull()
    expect(await response.text()).toContain("Opening this page changes nothing.")
    expect(db.created).toBe(0)
    expect(suppressionHashes()).toEqual([])
    expect(unsubscribePage(`"><script>`)).toContain('value=""')
    expect(unsubscribePage(`"><script>`)).not.toContain("<script>")
  })

  it("stops a no-account address on the button, and shows the same confirmation for any token", async () => {
    const clock = new Date()
    const token = signSuppressionToken(ADDRESS, SECRET, new Date(clock.getTime() + 86_400_000), clock)
    const response = await POST(new Request("http://127.0.0.1:3002/api/v2/notify/unsubscribe", {
      body: `token=${encodeURIComponent(token)}`,
      headers: { "content-type": "application/x-www-form-urlencoded" },
      method: "POST"
    }))

    expect(response.status).toBe(200)
    expect(response.headers.get("set-cookie")).toBeNull()
    expect(await response.text()).toBe(UNSUBSCRIBE_CONFIRMATION)
    expect(suppressionHashes()).toEqual([emailSuppressionHash(ADDRESS)])
    expect(db.created).toBe(0)

    const oneClick = await POST(new Request(`http://127.0.0.1:3002/api/v2/notify/unsubscribe?token=${encodeURIComponent(token)}`, {
      body: "List-Unsubscribe=One-Click",
      method: "POST"
    }))

    expect(await oneClick.text()).toBe(UNSUBSCRIBE_CONFIRMATION)
  })

  it("asks the database to apply its own token when the normalized adapter is selected", async () => {
    db.kind = "normalized"
    const token = "abc.def"
    const response = await POST(new Request("http://127.0.0.1:3002/api/v2/notify/unsubscribe", {
      body: `token=${token}`,
      method: "POST"
    }))

    expect(await response.text()).toBe(UNSUBSCRIBE_CONFIRMATION)
    expect(db.created).toBe(1)
    expect(db.asAnon).toHaveBeenCalledWith(expect.any(Function), { readOnly: false })
    expect(db.lastCall).toHaveBeenCalledWith("unsubscribe_with_token", { p_token: token })
    expect(db.close).toHaveBeenCalledOnce()
    expect(suppressionHashes()).toEqual([])
  })

  it("keeps the confirmation when the database refuses", async () => {
    db.kind = "normalized"
    db.asAnon.mockRejectedValueOnce(new Error("refused"))

    const response = await POST(new Request("http://127.0.0.1:3002/api/v2/notify/unsubscribe?token=abc.def", { method: "POST" }))

    expect(response.status).toBe(200)
    expect(await response.text()).toBe(UNSUBSCRIBE_CONFIRMATION)
    expect(db.close).toHaveBeenCalledOnce()
  })

  it("records a hash and still hands the token to the database", async () => {
    const token = signSuppressionToken(ADDRESS, SECRET, new Date(NOW.getTime() + 86_400_000), NOW)
    const forgotten: string[] = []

    await applyEmailUnsubscribe(token, SECRET, NOW, {
      forgetInDatabase: async (value) => {
        forgotten.push(value)
      },
      remember: () => undefined
    })

    expect(forgotten).toEqual([token])
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
