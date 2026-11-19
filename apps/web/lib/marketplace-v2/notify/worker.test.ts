import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import type { MarketplaceEmailNoticeClaim, MarketplaceEmailNoticeOutcome } from "@logloads/contracts"
import { emailSuppressionHash, type EmailSendMessage } from "@logloads/services"

import type { ResendSendResult } from "./deliver"
import {
  claimLimitForLease,
  emailFactsForClaim,
  emailWorkerReadiness,
  runEmailWorker,
  type EmailWorkerSettings,
  type NotificationEmailContext,
  type NotificationWorkerStore
} from "./worker"

const ADDRESS = "landing@example.com"
const KEY = "test-suppression-key-0123456789abcdef"
const ONE_TAP = "test-one-tap-secret-value"
const NOW = new Date("2026-11-18T18:00:00.000Z")
const QUEUED = new Date("2026-11-18T17:59:00.000Z")
const USER = "11111111-1111-4111-8111-111111111111"
const ORG = "66666666-6666-4666-8666-666666666666"
const JOB = "33333333-3333-4333-8333-333333333333"
const INTEREST = "44444444-4444-4444-8444-444444444444"
const DB_TOKEN = `${"A".repeat(200)}.${"0".repeat(64)}`

const SETTINGS: EmailWorkerSettings = {
  allowlist: [ADDRESS, "invitee@example.com"],
  apiKey: "test-key",
  from: "LogLoads <notifications@logloads.com>",
  legalName: "LogLoads",
  oneTapSecret: ONE_TAP,
  origin: "https://logloads.com",
  postalAddress: "Test mailbox 100",
  suppressionKey: KEY
}

function notice(id: string, category: MarketplaceEmailNoticeClaim["category"], payload: Record<string, unknown>, address = ADDRESS): MarketplaceEmailNoticeClaim {
  return {
    attemptCount: 1,
    category,
    claimToken: `55555555-5555-4555-8555-${id.slice(-12)}`,
    deliveryAddress: address,
    notificationId: id,
    payload,
    recipientOrganizationId: category === "team_invitation" ? null : ORG,
    recipientUserId: category === "team_invitation" ? null : USER
  }
}

const NEW_INQUIRY = notice("aaaaaaaa-0000-4000-8000-000000000001", "inquiry_reply", {
  available_from: null,
  event: "inquiry_submitted",
  from_organization_name: "New River Hauling",
  from_side: "hauler",
  interest_id: INTEREST,
  job_id: JOB,
  job_title: "Fir sawlogs to Bend",
  // A field no producer writes. If one ever did, the email still would not carry it.
  message: "Call me on 541 555 0199"
})
const INVITATION = notice("aaaaaaaa-0000-4000-8000-000000000002", "team_invitation", { organization_name: "Cedar Contractors" }, "invitee@example.com")
const ALERT = notice("aaaaaaaa-0000-4000-8000-000000000003", "job_alert", { job_id: JOB, job_title: "Fir sawlogs" })
const STRANGER = notice("aaaaaaaa-0000-4000-8000-000000000004", "inquiry_reply", { from_side: "landing", interest_id: INTEREST }, "stranger@example.com")
const SUPPRESSED = notice("aaaaaaaa-0000-4000-8000-000000000005", "job_alert", { job_id: JOB }, "invitee@example.com")

function context(claim: MarketplaceEmailNoticeClaim): NotificationEmailContext {
  return {
    invitationSendCount: claim.category === "team_invitation" ? 1 : null,
    queuedAt: QUEUED,
    unsubscribeToken: claim.category === "team_invitation" ? null : DB_TOKEN
  }
}

function store(claims: MarketplaceEmailNoticeClaim[], suppressed: string[] = []) {
  const completed: Array<{ id: string; outcome: MarketplaceEmailNoticeOutcome }> = []
  const asked: number[] = []
  const fake: NotificationWorkerStore = {
    async claim(limit) {
      asked.push(limit)
      return claims
    },
    async complete(id, _token, outcome) {
      completed.push({ id, outcome })
      return outcome.outcome
    },
    async emailContext(id) {
      const claim = claims.find((row) => row.notificationId === id)

      if (!claim) throw new Error("unknown notice")
      return context(claim)
    },
    async suppressedHashes(hashes) {
      return hashes.filter((hash) => suppressed.includes(hash))
    }
  }

  return { asked, completed, fake }
}

function resend() {
  const accepted = new Map<string, { body: string; id: string }>()
  const messages: EmailSendMessage[] = []

  return {
    accepted,
    messages,
    async send(message: EmailSendMessage, key: string): Promise<ResendSendResult> {
      const body = JSON.stringify(message)
      const earlier = accepted.get(key)

      if (earlier) return earlier.body === body ? { id: earlier.id, ok: true } : { ok: false, outcome: "duplicate" }

      accepted.set(key, { body, id: `re_${accepted.size + 1}` })
      messages.push(message)
      return { id: `re_${accepted.size}`, ok: true }
    }
  }
}

describe("emailWorkerReadiness", () => {
  it("names every missing setting by its environment name, and the worker then claims nothing", async () => {
    expect(emailWorkerReadiness(SETTINGS)).toEqual([])
    expect(emailWorkerReadiness({ ...SETTINGS, allowlist: [], apiKey: "", from: "", origin: null, suppressionKey: "short" })).toEqual([
      "LOGLOADS_EMAIL_TEST_RECIPIENTS",
      "RESEND_API_KEY",
      "RESEND_FROM",
      "LOGLOADS_EMAIL_SUPPRESSION_KEY",
      "NEXT_PUBLIC_APP_URL"
    ])

    const { asked, fake } = store([NEW_INQUIRY])
    const send = vi.fn()

    expect(await runEmailWorker({ now: () => NOW, send, settings: { ...SETTINGS, suppressionKey: "" }, store: fake }))
      .toEqual({ missing: ["LOGLOADS_EMAIL_SUPPRESSION_KEY"], status: "not-ready" })
    expect(asked).toEqual([])
    expect(send).not.toHaveBeenCalled()
  })
})

describe("runEmailWorker", () => {
  it("claims what fits in the lease, sends only to test recipients not on the suppression list, and reports each claim", async () => {
    const { asked, completed, fake } = store([NEW_INQUIRY, INVITATION, ALERT, STRANGER, SUPPRESSED], [emailSuppressionHash("Invitee@Example.com", KEY)])
    const provider = resend()

    const result = await runEmailWorker({ now: () => NOW, send: (message, key) => provider.send(message, key), settings: SETTINGS, store: fake })

    expect(asked).toEqual([claimLimitForLease(300)])
    expect(claimLimitForLease(300)).toBe(18)
    // The suppressed address is the invitee: both of its notices stop, the invitation included.
    expect(provider.messages.map((message) => message.to)).toEqual([ADDRESS, ADDRESS])
    expect(completed.map((row) => `${row.id.slice(-1)}:${row.outcome.outcome}`)).toEqual(["1:sent", "2:suppressed", "3:sent", "4:suppressed", "5:suppressed"])
    expect(result).toMatchObject({ claimed: 5, sent: 2, status: "ran", suppressed: 3 })
    expect(JSON.stringify(completed)).not.toContain("@")
  })

  it("composes the same email for the same notice on every attempt, so the idempotency key returns the first send", async () => {
    const provider = resend()

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const { fake } = store([{ ...NEW_INQUIRY, attemptCount: attempt }, { ...ALERT, attemptCount: attempt }, { ...INVITATION, attemptCount: attempt }])
      await runEmailWorker({ now: () => new Date(NOW.getTime() + attempt * 120_000), send: (message, key) => provider.send(message, key), settings: SETTINGS, store: fake })
    }

    expect(provider.messages).toHaveLength(3)
    expect([...provider.accepted.keys()].sort()).toEqual([
      `logloads-notice/${ALERT.notificationId}`,
      `logloads-notice/${INVITATION.notificationId}`,
      `logloads-notice/${NEW_INQUIRY.notificationId}`
    ].sort())
  })

  it("stops sending when the lease is nearly over", async () => {
    let clock = NOW.getTime()
    const { completed, fake } = store([NEW_INQUIRY, ALERT])
    const result = await runEmailWorker({
      leaseSeconds: 60,
      now: () => new Date(clock),
      async send(message, key) {
        clock += 20_000
        return resend().send(message, key)
      },
      settings: SETTINGS,
      store: fake
    })

    // A 60 s lease leaves 30 s after the margin; one 15 s send fits, and after it 20 s have gone.
    expect(completed).toHaveLength(1)
    expect(result).toMatchObject({ sent: 1, skipped: 1 })
  })

  it("sends nothing when the suppression list cannot be read", async () => {
    const { fake } = store([NEW_INQUIRY])
    const send = vi.fn()

    await expect(runEmailWorker({
      now: () => NOW,
      send,
      settings: SETTINGS,
      store: { ...fake, suppressedHashes: async () => { throw new Error("down") } }
    })).rejects.toThrow("down")
    expect(send).not.toHaveBeenCalled()
  })
})

describe("emailFactsForClaim", () => {
  it("builds the landing's new-inquiry email from ids and names only, with the stable unsubscribe link", () => {
    const facts = emailFactsForClaim(NEW_INQUIRY, context(NEW_INQUIRY), SETTINGS, NOW)

    expect(facts.template).toBe("inquiry_received")
    expect(facts.organizationName).toBe("New River Hauling")
    expect(facts.inquiryUrl).toBe(`https://logloads.com/v2/landing/inquiries?inquiry=${INTEREST}#conversation`)
    expect(facts.footer?.unsubscribeUrl).toBe(`https://logloads.com/api/v2/notify/unsubscribe?token=${DB_TOKEN}`)
    expect(facts.readyReplies?.map((reply) => reply.label)).toEqual(["Yes, we can use you.", "Yes. When can you start?"])
    expect(JSON.stringify(facts)).not.toContain("541")
  })

  it("leaves out the one-tap replies without a signing key, or when the links would expire soon", () => {
    expect(emailFactsForClaim(NEW_INQUIRY, context(NEW_INQUIRY), { ...SETTINGS, oneTapSecret: null }, NOW).readyReplies).toEqual([])
    expect(emailFactsForClaim(NEW_INQUIRY, context(NEW_INQUIRY), SETTINGS, new Date(QUEUED.getTime() + 71 * 3_600_000)).readyReplies).toEqual([])
  })

  it("points a hauler's reply notice at the hauler's inquiry, and an invitation at the no-account link", () => {
    const reply = emailFactsForClaim(STRANGER, context(STRANGER), SETTINGS, NOW)
    const invitation = emailFactsForClaim(INVITATION, context(INVITATION), SETTINGS, NOW)

    expect(reply.template).toBe("inquiry_reply")
    expect(reply.inquiryUrl).toBe(`https://logloads.com/v2/inquiries?inquiry=${INTEREST}`)
    expect(invitation.template).toBe("team_invitation")
    expect(invitation.invitationSendCount).toBe(1)
    expect(invitation.footer?.unsubscribeUrl).toMatch(/^https:\/\/logloads\.com\/api\/v2\/notify\/unsubscribe\?token=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
    expect(invitation.footer?.unsubscribeUrl).not.toContain("invitee")
  })

  it("refuses a member's notice without its unsubscribe token, and an unknown category", () => {
    expect(() => emailFactsForClaim(ALERT, { ...context(ALERT), unsubscribeToken: null }, SETTINGS, NOW)).toThrow()
    expect(() => emailFactsForClaim({ ...ALERT, category: "other" as never }, context(ALERT), SETTINGS, NOW)).toThrow()
  })
})
