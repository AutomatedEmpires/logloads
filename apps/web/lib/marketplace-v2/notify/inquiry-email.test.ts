import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

vi.mock("next/headers", () => ({
  cookies: async () => ({ set: () => { throw new Error("session cookie") } }),
  headers: async () => new Headers()
}))

vi.mock("next/server", () => ({
  after: (task: () => unknown) => { void task() }
}))

const port = vi.hoisted(() => ({
  confirmHaulerAvailability: vi.fn(async () => ({ confirmed: 0 })),
  getJob: vi.fn(async () => null),
  reconfirmJob: vi.fn(async () => undefined),
  respondToInterest: vi.fn(async () => undefined),
  setJobStatus: vi.fn(async () => undefined)
}))

vi.mock("@/lib/marketplace-v2/pilot-adapter", () => ({ pilotMarketplaceV2: port }))

vi.mock("@/lib/analytics/server", async () => {
  const actual = await vi.importActual<typeof import("@/lib/analytics/server")>("@/lib/analytics/server")

  return { ...actual, recordProductEvent: async () => undefined }
})

import type { MarketplaceEmailNoticeClaim } from "@logloads/contracts"
import { planEmailDelivery } from "@logloads/services"

import { resetOneTapLedger } from "@/app/v2/act/ledger"
import { openOneTapPage } from "@/app/v2/act/open"
import { inspectOneTap, pressOneTap, productionRuntime } from "@/app/v2/act/perform"
import { oneTapModel } from "@/app/v2/act/view"
import { emailFactsForClaim, type EmailWorkerSettings } from "./worker"

/**
 * Flow C's two taps start in the landing's inbox, not on a page the test opens (#405, review of PR 401). This test
 * composes the email a landing gets when a hauler sends interest, reads the one-tap link out of the message text,
 * opens it, presses it, and follows it to the inquiry.
 */

const ADDRESS = "landing@example.com"
const KEY = "test-suppression-key-0123456789abcdef"
const SECRET = "test-one-tap-secret-value"
const NOW = new Date("2026-11-18T18:00:00.000Z")
const USER = "11111111-1111-4111-8111-111111111111"
const ORG = "66666666-6666-4666-8666-666666666666"
const JOB = "33333333-3333-4333-8333-333333333333"
const INTEREST = "44444444-4444-4444-8444-444444444444"
const INQUIRY_PATH = `/v2/landing/inquiries?inquiry=${INTEREST}#conversation`

const SETTINGS: EmailWorkerSettings = {
  allowlist: [ADDRESS],
  apiKey: "test-key",
  from: "LogLoads <notifications@logloads.com>",
  legalName: "LogLoads",
  oneTapSecret: SECRET,
  origin: "https://logloads.com",
  postalAddress: "Test mailbox 100",
  suppressionKey: KEY
}

const CLAIM: MarketplaceEmailNoticeClaim = {
  attemptCount: 1,
  category: "inquiry_reply",
  claimToken: "55555555-5555-4555-8555-555555555555",
  deliveryAddress: ADDRESS,
  notificationId: "aaaaaaaa-0000-4000-8000-000000000001",
  payload: {
    available_from: "2026-11-23",
    event: "inquiry_submitted",
    from_organization_name: "New River Hauling",
    from_side: "hauler",
    interest_id: INTEREST,
    job_id: JOB,
    job_title: "Fir sawlogs to Bend"
  },
  recipientOrganizationId: ORG,
  recipientUserId: USER
}

/** The message as the worker would hand it to Resend. */
function composedMessage() {
  const facts = emailFactsForClaim(CLAIM, { invitationSendCount: null, queuedAt: new Date(NOW.getTime() - 60_000), unsubscribeToken: `${"A".repeat(200)}.${"0".repeat(64)}` }, SETTINGS, NOW)
  const planned = planEmailDelivery({ address: ADDRESS, allowlist: SETTINGS.allowlist, facts, suppression: { hashes: [], key: KEY } })

  if (planned.action !== "send") throw new Error(`the new-inquiry email was not sent: ${planned.reason}`)
  return planned.message
}

/** Every one-tap link in the text, as the landing's mail app would show it. */
function oneTapLinks(text: string): string[] {
  return [...text.matchAll(/https:\/\/logloads\.com\/v2\/act\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g)].map((match) => match[0])
}

describe("the email a landing gets when a hauler sends interest", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    vi.stubEnv("LOGLOADS_ONE_TAP_SECRET", SECRET)
    resetOneTapLedger()
    port.respondToInterest.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  it("carries a signed one-tap link that opens a ready reply on the inquiry (tap 1)", () => {
    const message = composedMessage()
    const links = oneTapLinks(message.text)

    expect(message.subject).toBe("New River Hauling sent interest in your job on LogLoads")
    expect(links).toHaveLength(2)

    const token = new URL(links[0] as string).pathname.slice("/v2/act/".length)
    const page = openOneTapPage(token, undefined)

    expect(page.model.kind).toBe("ready")
    expect(page.model.replyBody).toBe("Yes, we can use you.")
    expect(page.model.button).toBe("Send reply")
    expect(page.pressHref).toBe(`/v2/act/${token}/press`)
    expect(inspectOneTap(new URL(links[1] as string).pathname.slice("/v2/act/".length), productionRuntime()))
      .toEqual({ action: "reply", kind: "ready", replyBody: "Yes. Be here Mon, Nov 23." })
  })

  it("sends the reply on the press (tap 2) as the landing member, then leads to the inquiry", async () => {
    const token = new URL(oneTapLinks(composedMessage().text)[0] as string).pathname.slice("/v2/act/".length)
    const runtime = productionRuntime()

    expect(await pressOneTap(token, runtime)).toEqual({ kind: "done" })
    expect(port.respondToInterest).toHaveBeenCalledOnce()
    expect(port.respondToInterest).toHaveBeenCalledWith(
      { organizationId: ORG, userId: USER },
      expect.objectContaining({ body: "Yes, we can use you.", decision: "replied", interestId: INTEREST })
    )

    // The used link opens the inquiry's thread, and a second press sends nothing.
    const used = oneTapModel(inspectOneTap(token, runtime), null)

    expect(used.kind).toBe("used")
    expect(used.nextHref).toBe(INQUIRY_PATH)
    expect(await pressOneTap(token, runtime)).toEqual({ kind: "used" })
    expect(port.respondToInterest).toHaveBeenCalledOnce()
  })

  it("also carries the plain link to the inquiry, and nothing private", () => {
    const message = composedMessage()

    expect(message.text).toContain(`Open the inquiry:\nhttps://logloads.com${INQUIRY_PATH}`)

    const words = message.text.split(/\r?\n/).filter((line) => !line.startsWith("https://")).join(" ")

    expect(words).not.toMatch(/\d{3}[\s.-]?\d{3}[\s.-]?\d{4}/)
    expect(message.text).not.toContain(ADDRESS)
    expect(composedMessage()).toEqual(message)
  })

  it("is refused by a link signed with another key", () => {
    const token = new URL(oneTapLinks(composedMessage().text)[0] as string).pathname.slice("/v2/act/".length)

    vi.stubEnv("LOGLOADS_ONE_TAP_SECRET", "another-one-tap-secret-value")
    expect(openOneTapPage(token, undefined).model.kind).toBe("invalid")
  })
})
