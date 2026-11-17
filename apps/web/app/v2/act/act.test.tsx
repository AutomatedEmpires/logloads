import { createHmac } from "node:crypto"

import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { OneTapEffects } from "./effects"

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

const captured = vi.hoisted(() => ({
  events: [] as Array<{ actor: unknown; name: string; properties: unknown }>
}))

vi.mock("@/lib/analytics/server", async () => {
  const actual = await vi.importActual<typeof import("@/lib/analytics/server")>("@/lib/analytics/server")

  return {
    ...actual,
    recordProductEvent: async (name: string, build: () => unknown, options: { actor: unknown }) => {
      captured.events.push({ actor: options.actor, name, properties: build() })
    }
  }
})

import { JOB_LIFECYCLE_PRODUCT_EVENTS, withoutJobLifecycleEvents } from "@/lib/marketplace-v2/jobs/methods"

import { GET } from "./[token]/press/route"
import { createOneTapLedger, resetOneTapLedger } from "./ledger"
import { openOneTapPage } from "./open"
import { postOneTap } from "./http"
import { inspectOneTap, pressOneTap, type OneTapRuntime } from "./perform"
import { OneTapScreen } from "@/app/v2/act/screen"
import { ONE_TAP_TTL_SECONDS, oneTapStatement } from "./statements"
import { ONE_TAP_PURPOSE, readOneTapLink, signOneTapLink, type OneTapMint } from "./token"
import { oneTapModel } from "./view"

const SECRET = "test-one-tap-secret-value"
const NOW = new Date("2026-11-17T18:00:00.000Z")
const USER = "11111111-1111-4111-8111-111111111111"
const ORG = "66666666-6666-4666-8666-666666666666"
const JOB = "33333333-3333-4333-8333-333333333333"
const INTEREST = "44444444-4444-4444-8444-444444444444"
const TOKEN_ID = "55555555-5555-4555-8555-555555555555"
const REPLY = "We can start Monday with two trucks."

function mint(partial: Partial<OneTapMint> & Pick<OneTapMint, "action">, options?: { expiresAt?: Date; tokenId?: string }) {
  const inquiry = partial.action === "reply" || partial.action === "decline"

  return signOneTapLink({
    interestId: inquiry ? INTEREST : null,
    jobId: partial.action === "confirm_availability" ? null : JOB,
    organizationId: ORG,
    replyBody: partial.action === "reply" ? REPLY : null,
    userId: USER,
    ...partial
  }, SECRET, NOW, options)
}

function harness(effects: OneTapEffects, ledger = createOneTapLedger()): OneTapRuntime {
  return { effects, ledger, now: () => NOW, secret: SECRET }
}

function store() {
  const directory = { reportedAt: "2026-11-01T00:00:00.000Z" }
  const calls = {
    confirm: [] as Array<{ confirmed: number; viewer: { organizationId: string; userId: string } }>,
    reconfirm: [] as Array<{ confirmedAt: string; jobId: string; viewer: { organizationId: string; userId: string } }>,
    reply: [] as Array<{ body?: string; decision: string; interestId: string; viewer: { organizationId: string; userId: string } }>,
    stop: [] as Array<{ jobId: string; status: string; viewer: { organizationId: string; userId: string } }>
  }
  let confirmed = 1
  let down = false
  let status: "active" | "filled" | "paused" = "active"
  const effects: OneTapEffects = {
    async confirmAvailability(viewer) {
      if (down) throw new Error("down")
      calls.confirm.push({ confirmed, viewer })
      if (confirmed > 0) directory.reportedAt = NOW.toISOString()
      return { confirmed }
    },
    async jobBefore(_viewer, jobId) {
      return {
        expiresAt: null,
        id: jobId,
        lastConfirmedAt: "2026-11-10T18:00:00.000Z",
        lastModifiedAt: "2026-11-01T18:00:00.000Z",
        status
      }
    },
    async reconfirmJob(viewer, jobId, attestation) {
      if (down) throw new Error("down")
      calls.reconfirm.push({ confirmedAt: attestation.confirmedAt, jobId, viewer })
    },
    async reply(viewer, input) {
      if (down) throw new Error("down")
      calls.reply.push({ ...input, viewer })
    },
    async stopJob(viewer, jobId, status) {
      if (down) throw new Error("down")
      calls.stop.push({ jobId, status, viewer })
    }
  }

  return {
    calls,
    directory,
    effects,
    fail(next: boolean) { down = next },
    setConfirmed(count: number) { confirmed = count },
    setStatus(next: "active" | "filled" | "paused") { status = next }
  }
}

function posted(press: string | null, token = "token") {
  const form = new FormData()

  if (press !== null) form.set("press", press)
  return new Request(`https://logloads.test/v2/act/${token}/press`, { body: form, method: "POST" })
}

function expectNoSession(response: Response) {
  expect(response.headers.get("set-cookie")).toBeNull()
  expect(JSON.stringify([...response.headers.entries()])).not.toMatch(/ll_session/i)
}

beforeEach(() => {
  captured.events.length = 0
  resetOneTapLedger()
  vi.clearAllMocks()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("one-tap tokens", () => {
  it("lasts 72 hours, bound to one person, one listing and one action", () => {
    expect(ONE_TAP_TTL_SECONDS).toBe(72 * 60 * 60)

    const token = mint({ action: "reconfirm" }, { tokenId: TOKEN_ID })
    const read = readOneTapLink(token, SECRET, NOW)

    expect(read).toEqual({
      ok: true,
      link: expect.objectContaining({
        action: "reconfirm",
        interestId: null,
        jobId: JOB,
        organizationId: ORG,
        statementVersion: "v1",
        tokenId: TOKEN_ID,
        userId: USER
      })
    })
  })

  it("refuses a link longer than 72 hours, a contact in the reply, and a job on an availability link", () => {
    expect(() => mint({ action: "pause" }, { expiresAt: new Date(NOW.getTime() + 73 * 60 * 60 * 1000) })).toThrow()
    expect(() => mint({ action: "reply", replyBody: "Write me at a@b.co" })).toThrow()
    expect(() => mint({ action: "reply", replyBody: "Call 555-123-4567" })).toThrow()
    expect(() => mint({ action: "confirm_availability", jobId: JOB })).toThrow()
    expect(() => mint({ action: "reply", replyBody: null })).toThrow()
  })

  it("treats a tampered token as invalid, including a mac made for another purpose, and an old one as expired", () => {
    const token = mint({ action: "fill" })
    const [payload, signature] = token.split(".")

    if (!signature) throw new Error("missing mac")

    // The last base64url character can change without changing the decoded mac, so flip the first one.
    const flipped = `${payload}.${signature.startsWith("A") ? "B" : "A"}${signature.slice(1)}`
    const otherPurpose = createHmac("sha256", SECRET).update("logloads.alert-unsubscribe.v1").update(Buffer.from(payload!, "base64url")).digest("base64url")

    expect(readOneTapLink(flipped, SECRET, NOW)).toEqual({ ok: false, reason: "invalid" })
    expect(readOneTapLink(`${payload}.${otherPurpose}`, SECRET, NOW)).toEqual({ ok: false, reason: "invalid" })
    expect(readOneTapLink(token, SECRET, new Date(NOW.getTime() + ONE_TAP_TTL_SECONDS * 1000 + 1000))).toEqual({ ok: false, reason: "expired" })
    expect(ONE_TAP_PURPOSE).toBe("logloads.one-tap.v1")
  })
})

describe("one-tap press", () => {
  it("does not change anything when the link is only read", () => {
    const held = store()
    const runtime = harness(held.effects)
    const token = mint({ action: "reply" })

    expect(inspectOneTap(token, runtime)).toMatchObject({ action: "reply", kind: "ready", replyBody: REPLY })
    expect(held.calls.reply).toEqual([])
    expect(runtime.ledger.attestations()).toEqual([])
    expect(captured.events).toEqual([])
  })

  it("sends the bound reply once, records the statement, and emits interest_replied", async () => {
    const held = store()
    const runtime = harness(held.effects)
    const token = mint({ action: "reply" }, { tokenId: TOKEN_ID })

    expect(await pressOneTap(token, runtime)).toEqual({ kind: "done" })
    expect(await pressOneTap(token, runtime)).toEqual({ kind: "used" })
    expect(held.calls.reply).toEqual([{
      body: REPLY,
      decision: "replied",
      interestId: INTEREST,
      replyId: expect.any(String),
      viewer: { organizationId: ORG, userId: USER }
    }])
    expect(runtime.ledger.attestations()).toEqual([{
      action: "reply",
      jobId: JOB,
      organizationId: ORG,
      recordedAt: NOW.toISOString(),
      statementText: oneTapStatement("reply").text,
      statementVersion: "v1",
      tokenId: TOKEN_ID,
      userId: USER
    }])
    expect(captured.events).toEqual([{
      actor: { organizationId: ORG },
      name: "interest_replied",
      properties: expect.objectContaining({ outcome: "replied", side: "landing" })
    }])
    expect(JSON.stringify(captured.events)).not.toContain(REPLY)
  })

  it("lets only one of two simultaneous presses through", async () => {
    const held = store()
    const runtime = harness(held.effects)
    const token = mint({ action: "decline" })
    const [first, second] = await Promise.all([pressOneTap(token, runtime), pressOneTap(token, runtime)])

    expect([first.kind, second.kind].sort()).toEqual(["done", "pending"])
    expect(held.calls.reply).toHaveLength(1)
    expect(held.calls.reply[0]).toMatchObject({ decision: "declined", interestId: INTEREST, viewer: { organizationId: ORG, userId: USER } })
    expect(runtime.ledger.attestations()).toHaveLength(1)
    expect(captured.events).toHaveLength(1)
    expect(captured.events[0]).toMatchObject({ name: "interest_replied", properties: { outcome: "declined", side: "landing" } })
  })

  it("keeps the link after a failed press, then records the next one", async () => {
    const held = store()
    const runtime = harness(held.effects)
    const token = mint({ action: "pause" })

    held.fail(true)
    expect(await pressOneTap(token, runtime)).toEqual({ kind: "error" })
    expect(runtime.ledger.attestations()).toEqual([])
    expect(captured.events).toEqual([])

    held.fail(false)
    expect(await pressOneTap(token, runtime)).toEqual({ kind: "done" })
    expect(held.calls.stop).toEqual([{ jobId: JOB, status: "paused", viewer: { organizationId: ORG, userId: USER } }])
    expect(captured.events[0]).toMatchObject({
      actor: { organizationId: ORG },
      name: "job_stopped",
      properties: expect.objectContaining({ status: "paused", via: "one_tap_link" })
    })
  })

  it("refuses an expired token and a tampered token before the store", async () => {
    const held = store()
    const runtime = harness(held.effects)
    const token = mint({ action: "fill" }, { expiresAt: new Date(NOW.getTime() + 60_000) })
    const later = harness(held.effects, runtime.ledger)

    later.now = () => new Date(NOW.getTime() + 120_000)
    expect(await pressOneTap(token, later)).toEqual({ kind: "expired" })

    const [payload, signature] = mint({ action: "fill" }).split(".")
    expect(await pressOneTap(`${payload}.${signature!.startsWith("A") ? "B" : "A"}${signature!.slice(1)}`, runtime)).toEqual({ kind: "invalid" })
    expect(held.calls.stop).toEqual([])
    expect(captured.events).toEqual([])
  })

  it("updates the availability timestamp Find Trucks shows and emits the one-tap event", async () => {
    const held = store()
    const runtime = harness(held.effects)

    expect(await pressOneTap(mint({ action: "confirm_availability" }), runtime)).toEqual({ kind: "done" })
    expect(held.directory.reportedAt).toBe(NOW.toISOString())
    expect(held.calls.confirm).toEqual([{ confirmed: 1, viewer: { organizationId: ORG, userId: USER } }])
    expect(captured.events).toEqual([{
      actor: { organizationId: ORG },
      name: "availability_reconfirmed",
      properties: expect.objectContaining({ signed_in: false, truck_types: 1, via: "one_tap_link" })
    }])
  })

  it("does not consume a link that confirms nothing", async () => {
    const held = store()
    held.setConfirmed(0)
    const runtime = harness(held.effects)
    const token = mint({ action: "confirm_availability" })

    expect(await pressOneTap(token, runtime)).toEqual({ kind: "empty" })
    expect(held.directory.reportedAt).toBe("2026-11-01T00:00:00.000Z")
    expect(runtime.ledger.attestations()).toEqual([])
    expect(captured.events).toEqual([])
    expect(inspectOneTap(token, runtime).kind).toBe("ready")
  })

  it("reconfirms and fills only the listing in the token", async () => {
    const held = store()
    const runtime = harness(held.effects)

    expect(await pressOneTap(mint({ action: "reconfirm" }, { tokenId: TOKEN_ID }), runtime)).toEqual({ kind: "done" })
    expect(held.calls.reconfirm).toEqual([{
      confirmedAt: NOW.toISOString(),
      jobId: JOB,
      viewer: { organizationId: ORG, userId: USER }
    }])
    expect(captured.events[0]).toMatchObject({
      name: "job_reconfirmed",
      properties: expect.objectContaining({ resumed: false, via: "one_tap_link" })
    })
    expect(runtime.ledger.attestations()[0]?.statementText).toBe("I confirm this job is currently available as described.")

    captured.events.length = 0
    const filled = harness(held.effects)
    expect(await pressOneTap(mint({ action: "fill" }), filled)).toEqual({ kind: "done" })
    expect(held.calls.stop).toEqual([{ jobId: JOB, status: "filled", viewer: { organizationId: ORG, userId: USER } }])
    expect(captured.events[0]).toMatchObject({
      name: "job_stopped",
      properties: expect.objectContaining({ status: "filled", via: "one_tap_link" })
    })
  })

  it("records a fill that the listing already shows, without a second stop or a stop event", async () => {
    const held = store()
    held.setStatus("filled")
    const runtime = harness(held.effects)

    expect(await pressOneTap(mint({ action: "fill" }), runtime)).toEqual({ kind: "done" })
    expect(held.calls.stop).toEqual([])
    expect(captured.events).toEqual([])
    expect(runtime.ledger.attestations()).toHaveLength(1)
  })

  it("lets the jobs desk stay quiet while a one-tap press records the stop", async () => {
    const listing = {
      expiresAt: null,
      id: JOB,
      lastConfirmedAt: "2026-11-10T18:00:00.000Z",
      lastModifiedAt: "2026-11-01T18:00:00.000Z"
    } as never

    await JOB_LIFECYCLE_PRODUCT_EVENTS.stopped({ organizationId: ORG, userId: USER }, listing, "paused", NOW)
    expect(captured.events).toHaveLength(1)
    captured.events.length = 0

    await withoutJobLifecycleEvents(() => JOB_LIFECYCLE_PRODUCT_EVENTS.stopped({ organizationId: ORG, userId: USER }, listing, "paused", NOW))
    expect(captured.events).toEqual([])
  })
})

describe("one-tap HTTP", () => {
  it("does not act, and sets no session cookie, unless the button field is posted", async () => {
    const held = store()
    const runtime = harness(held.effects)
    const token = mint({ action: "reply" })
    const ignored = await postOneTap(posted(null, token), token, runtime)

    expect(ignored.status).toBe(400)
    expectNoSession(ignored)
    expect(held.calls.reply).toEqual([])

    const acted = await postOneTap(posted("1", token), token, runtime)

    expect(acted.status).toBe(303)
    expectNoSession(acted)
    expect(acted.headers.get("location")).toContain(`/v2/act/${token}`)
    expect(acted.headers.get("location")).not.toContain("notice")
    expect(held.calls.reply).toHaveLength(1)
    expect(GET().status).toBe(405)
    expectNoSession(GET())
  })

  it("renders the statement and a POST button, and a read calls no store method", () => {
    vi.stubEnv("LOGLOADS_ONE_TAP_SECRET", SECRET)
    const token = signOneTapLink({
      action: "reconfirm",
      jobId: JOB,
      organizationId: ORG,
      userId: USER
    }, SECRET, new Date())
    const opened = openOneTapPage(token, undefined)
    const html = renderToStaticMarkup(<OneTapScreen model={opened.model} pressHref={opened.pressHref} />)

    expect(port.confirmHaulerAvailability).not.toHaveBeenCalled()
    expect(port.getJob).not.toHaveBeenCalled()
    expect(port.reconfirmJob).not.toHaveBeenCalled()
    expect(port.respondToInterest).not.toHaveBeenCalled()
    expect(port.setJobStatus).not.toHaveBeenCalled()
    expect(opened.model.statement).toBe("I confirm this job is currently available as described.")
    expect(html).toContain("method=\"post\"")
    expect(html).toContain("type=\"submit\"")
    expect(html).toContain("Still need trucks")
    expect(html).toContain("Opening this page changes nothing.")
    expect(html).not.toContain("@")
    expect(html).not.toMatch(/<a [^>]*\/press/)
    expect(opened.pressHref).toBe(`/v2/act/${token}/press`)
  })

  it("shows an expired link with no button and no contact", () => {
    const model = oneTapModel({ kind: "expired" }, null)
    const html = renderToStaticMarkup(<OneTapScreen model={model} pressHref="" />)

    expect(html).toContain("This link has expired")
    expect(html).toContain("Each link works once, for 72 hours.")
    expect(html).toContain("href=\"/sign-in\"")
    expect(html).not.toContain("<form")
    expect(html).not.toContain("@")
  })

  it("escapes the reply text", () => {
    const model = oneTapModel({ action: "reply", kind: "ready", replyBody: "<script>alert(1)</script>" }, null)
    const html = renderToStaticMarkup(<OneTapScreen model={model} pressHref="/v2/act/example/press" />)

    expect(html).not.toContain("<script>alert")
    expect(html).toContain("&lt;script&gt;")
  })
})
