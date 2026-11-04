import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  authoringLandings: vi.fn(),
  checkRateLimit: vi.fn(),
  getJob: vi.fn(),
  getSessionActor: vi.fn(),
  marketplaceV2Enabled: vi.fn(),
  postHaulerReply: vi.fn(),
  publishJob: vi.fn(),
  reconfirmJob: vi.fn(),
  redirect: vi.fn(),
  respondToInterest: vi.fn(),
  revalidatePath: vi.fn(),
  viewerAccess: vi.fn(),
  withdrawInterest: vi.fn(),
  withdrawInterestWithReason: vi.fn()
}))

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }))
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock("../rate-limit", () => ({ checkRateLimit: mocks.checkRateLimit }))
vi.mock("../services", () => ({
  serializeError: (error: unknown) => ({ error: error instanceof Error ? error.message : "Unknown error" })
}))
vi.mock("./v2-session", () => ({ getV2SessionActor: mocks.getSessionActor }))
vi.mock("./flag", () => ({ marketplaceV2Enabled: mocks.marketplaceV2Enabled }))
vi.mock("./pilot-adapter", () => ({
  pilotMarketplaceV2: {
    authoringLandings: mocks.authoringLandings,
    getJob: mocks.getJob,
    postHaulerReply: mocks.postHaulerReply,
    publishJob: mocks.publishJob,
    reconfirmJob: mocks.reconfirmJob,
    respondToInterest: mocks.respondToInterest,
    supportsPublishing: false,
    viewerAccess: mocks.viewerAccess,
    withdrawInterest: mocks.withdrawInterest,
    withdrawInterestWithReason: mocks.withdrawInterestWithReason
  }
}))

import {
  MARKETPLACE_AVAILABILITY_ATTESTATION,
  MARKETPLACE_PUBLISH_ATTESTATION_FIELDS,
  PUBLISH_ATTESTATION_REQUIRED
} from "@logloads/contracts"

import { haulerReplyAction, publishJobAction, reconfirmJobAction, respondToInterestAction, withdrawInterestAction } from "./actions"
import { MarketplaceOperationUnavailableError } from "./port"

const USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const ORGANIZATION_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const OTHER_ORGANIZATION_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
const OWN_LANDING_ID = "66666666-6666-4666-8666-666666666666"
const OTHER_LANDING_ID = "99999999-9999-4999-8999-999999999999"
const JOB_ID = "77777777-7777-4777-8777-777777777777"
const NOW = new Date("2026-11-02T17:30:00.000Z")
const VIEWER = { organizationId: ORGANIZATION_ID, userId: USER_ID }

const NEW_PATH = "/v2/landing/jobs/new"
const PREVIEW_PATH = "/v2/landing/jobs/preview"
const JOBS_PATH = "/v2/landing/jobs"
const ATTESTED = { [MARKETPLACE_AVAILABILITY_ATTESTATION.field]: MARKETPLACE_AVAILABILITY_ATTESTATION.value }
/** All three publish statements ticked (V2-DEC-03, UX 02 §B7). */
const PUBLISH_ATTESTED: Record<string, string> = Object.fromEntries(
  MARKETPLACE_PUBLISH_ATTESTATION_FIELDS.map((name) => [name, MARKETPLACE_AVAILABILITY_ATTESTATION.value])
)

/** A draft that passes every draft and publishing rule, on the viewer's own landing. */
const PUBLISHABLE = {
  durationDays: "10",
  landingId: OWN_LANDING_ID,
  payAmount: "525",
  payUnit: "per_load",
  product: "Saw logs",
  startsOn: "2026-11-10",
  title: "Oak saw logs to Cascade Mill",
  trucksRequested: "4"
}

function form(fields: Record<string, string>, equipment: string[] = ["log_truck"]): FormData {
  const formData = new FormData()
  for (const [name, value] of Object.entries(fields)) formData.set(name, value)
  for (const code of equipment) formData.append("equipment", code)
  return formData
}

/** Runs an action and returns where it redirected (every outcome of these actions is a redirect). */
async function redirectOf(action: (formData: FormData) => Promise<void>, formData: FormData) {
  try {
    await action(formData)
  } catch (error) {
    const match = /^NEXT_REDIRECT (.+)$/.exec(error instanceof Error ? error.message : "")
    if (!match) throw error
    const url = new URL(match[1]!, "https://logloads.test")
    return { path: url.pathname, query: Object.fromEntries(url.searchParams), raw: url.search }
  }
  throw new Error("expected the action to redirect")
}

function ownJob(overrides: Record<string, unknown> = {}) {
  return { acceptingInterest: true, id: JOB_ID, posterOrganizationId: ORGANIZATION_ID, slug: JOB_ID, status: "active", ...overrides }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(NOW)
  mocks.marketplaceV2Enabled.mockReturnValue(true)
  mocks.getSessionActor.mockResolvedValue({
    activeOrganization: { id: ORGANIZATION_ID },
    profile: { id: USER_ID },
    workspaceSelectionInvalid: false
  })
  mocks.checkRateLimit.mockResolvedValue(undefined)
  mocks.viewerAccess.mockResolvedValue({ capabilities: ["job.publish", "landing.manage", "inquiry.respond"], organizationName: "North Pine" })
  mocks.authoringLandings.mockResolvedValue([{ areaLabel: "Oakridge, OR", id: OWN_LANDING_ID, name: "Landing 7", stateCode: "OR" }])
  mocks.getJob.mockResolvedValue(ownJob())
  mocks.publishJob.mockRejectedValue(new MarketplaceOperationUnavailableError("Publishing a V2 job"))
  mocks.reconfirmJob.mockRejectedValue(new MarketplaceOperationUnavailableError("Reconfirming a V2 job"))
  mocks.redirect.mockImplementation((href: string) => {
    throw new Error(`NEXT_REDIRECT ${href}`)
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe("publishJobAction server-side checks", () => {
  it("does nothing while V2 is disabled", async () => {
    mocks.marketplaceV2Enabled.mockReturnValue(false)

    await expect(redirectOf(publishJobAction, form({ ...PUBLISHABLE, ...PUBLISH_ATTESTED }))).resolves.toMatchObject({ path: "/" })
    expect(mocks.checkRateLimit).not.toHaveBeenCalled()
    expect(mocks.publishJob).not.toHaveBeenCalled()
  })

  it("sends a request without a session to sign-in", async () => {
    mocks.getSessionActor.mockResolvedValue(null)

    await expect(redirectOf(publishJobAction, form({ ...PUBLISHABLE, ...PUBLISH_ATTESTED }))).resolves.toMatchObject({ path: "/sign-in" })
    expect(mocks.publishJob).not.toHaveBeenCalled()
  })

  it("rate-limits every attempt per session user, before any other check", async () => {
    mocks.checkRateLimit.mockRejectedValue(new Error("Too many attempts. Wait a moment and try again."))

    const target = await redirectOf(publishJobAction, form({ ...PUBLISHABLE, ...PUBLISH_ATTESTED }))

    expect(mocks.checkRateLimit).toHaveBeenCalledExactlyOnceWith("marketplace-publish", USER_ID, 20, 3_600_000)
    expect(target).toMatchObject({ path: PREVIEW_PATH, query: { error: "Too many attempts. Wait a moment and try again.", title: PUBLISHABLE.title } })
    expect(mocks.viewerAccess).not.toHaveBeenCalled()
    expect(mocks.authoringLandings).not.toHaveBeenCalled()
    expect(mocks.publishJob).not.toHaveBeenCalled()
  })

  it("refuses a role without job.publish", async () => {
    mocks.viewerAccess.mockResolvedValue({ capabilities: ["interest.express", "interest.withdraw", "interest.reply"], organizationName: "North Pine" })

    const target = await redirectOf(publishJobAction, form({ ...PUBLISHABLE, ...PUBLISH_ATTESTED }))

    expect(target).toMatchObject({ path: PREVIEW_PATH, query: { error: "Your role cannot publish jobs for this organization" } })
    expect(mocks.viewerAccess).toHaveBeenCalledWith(VIEWER)
    expect(mocks.authoringLandings).not.toHaveBeenCalled()
    expect(mocks.publishJob).not.toHaveBeenCalled()
  })

  it.each([
    ["a gate code in road notes", { publicRoadNotes: "Gate code 4471 at the spur" }],
    ["coordinates in the description", { description: "Meet at 44.12345, -122.45678" }],
    ["a phone number in the pay note", { payNote: "Call 541-555-0142 for the rate" }],
    ["an email address in the title", { title: "Oak logs, dispatch@cedarfork.example" }],
    ["no pay at all", { payAmount: "", payUnit: "" }],
    ["an amount without a basis", { payUnit: "" }],
    ["negotiable pay without a note", { payAmount: "", payNote: "", payUnit: "negotiable" }],
    ["no product", { product: "" }],
    ["no start date", { durationDays: "", startsOn: "" }],
    ["no end date, duration or Ongoing", { durationDays: "" }],
    ["two ways of stating the end", { endsOn: "2026-11-20" }]
  ])("re-validates the draft on the server and refuses %s", async (_label, change) => {
    const target = await redirectOf(publishJobAction, form({ ...PUBLISHABLE, ...change, ...PUBLISH_ATTESTED }))

    expect(target).toMatchObject({ path: NEW_PATH, query: { error: "Fix the highlighted fields before publishing" } })
    expect(mocks.publishJob).not.toHaveBeenCalled()
  })

  it("refuses another organization's landing (cross-organization attempt)", async () => {
    const target = await redirectOf(publishJobAction, form({ ...PUBLISHABLE, ...PUBLISH_ATTESTED, landingId: OTHER_LANDING_ID }))

    expect(target).toMatchObject({ path: NEW_PATH, query: { error: "Choose one of your organization's landings", landingId: OTHER_LANDING_ID } })
    // Ownership is resolved for the session's organization, not one the form names.
    expect(mocks.authoringLandings).toHaveBeenCalledExactlyOnceWith(VIEWER)
    expect(mocks.publishJob).not.toHaveBeenCalled()
  })

  it("refuses a cross-organization attempt even when the form claims the other organization", async () => {
    const target = await redirectOf(publishJobAction, form({
      ...PUBLISHABLE,
      ...PUBLISH_ATTESTED,
      actorUserId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      landingId: OTHER_LANDING_ID,
      organizationId: OTHER_ORGANIZATION_ID
    }))

    expect(target.path).toBe(NEW_PATH)
    expect(mocks.viewerAccess).toHaveBeenCalledWith(VIEWER)
    expect(mocks.authoringLandings).toHaveBeenCalledWith(VIEWER)
    expect(mocks.publishJob).not.toHaveBeenCalled()
  })

  it.each([
    ["missing", {}],
    ["blank", { ...PUBLISH_ATTESTED, attestAccurate: "" }],
    ["a generic checkbox value", { ...PUBLISH_ATTESTED, attestRealJob: "on" }],
    ["a truthy string", { ...PUBLISH_ATTESTED, attestMaintained: "true" }],
    ["only the old single confirmation", ATTESTED]
  ])("requires all three explicit attestations (%s)", async (_label, attestation) => {
    const target = await redirectOf(publishJobAction, form({ ...PUBLISHABLE, ...attestation }))

    expect(target).toMatchObject({ path: PREVIEW_PATH, query: { error: PUBLISH_ATTESTATION_REQUIRED, title: PUBLISHABLE.title } })
    expect(mocks.publishJob).not.toHaveBeenCalled()
  })

  it("passes the session viewer and a server-generated attestation, ignoring identity and timestamps in the form", async () => {
    await redirectOf(publishJobAction, form({
      ...PUBLISHABLE,
      ...PUBLISH_ATTESTED,
      confirmedAt: "2020-01-01T00:00:00.000Z",
      lastConfirmedAt: "2020-01-01T00:00:00.000Z",
      organizationId: OTHER_ORGANIZATION_ID,
      userId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
    }))

    expect(mocks.publishJob).toHaveBeenCalledOnce()
    const [viewer, draft, attestation] = mocks.publishJob.mock.calls[0]!
    expect(viewer).toEqual(VIEWER)
    expect(draft).toMatchObject({ landingId: OWN_LANDING_ID, payAmount: 525, payUnit: "per_load", product: "Saw logs", startsOn: "2026-11-10" })
    expect(draft).not.toHaveProperty("lastConfirmedAt")
    expect(draft).not.toHaveProperty("confirmedAt")
    expect(draft).not.toHaveProperty("organizationId")
    expect(attestation).toEqual({ action: "publish", confirmedAt: NOW.toISOString() })
  })

  it("returns to the preview with the draft intact, and without the attestation, when the store cannot publish", async () => {
    const target = await redirectOf(publishJobAction, form({ ...PUBLISHABLE, ...PUBLISH_ATTESTED }))

    expect(target).toMatchObject({ path: PREVIEW_PATH, query: { landingId: OWN_LANDING_ID, title: PUBLISHABLE.title, unavailable: "publish" } })
    for (const name of MARKETPLACE_PUBLISH_ATTESTATION_FIELDS) expect(target.raw).not.toContain(name)
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it("opens the published job once an adapter can publish", async () => {
    mocks.publishJob.mockResolvedValue({ jobId: JOB_ID })

    await expect(redirectOf(publishJobAction, form({ ...PUBLISHABLE, ...PUBLISH_ATTESTED }))).resolves.toMatchObject({
      path: `/v2/work/${JOB_ID}`,
      query: { published: "1" }
    })
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/v2", "layout")
  })
})

describe("reconfirmJobAction server-side checks", () => {
  it("rate-limits every attempt per session user, before any other check", async () => {
    mocks.checkRateLimit.mockRejectedValue(new Error("Too many attempts. Wait a moment and try again."))

    const target = await redirectOf(reconfirmJobAction, form({ jobId: JOB_ID, ...ATTESTED }, []))

    expect(mocks.checkRateLimit).toHaveBeenCalledExactlyOnceWith("marketplace-reconfirm", USER_ID, 120, 3_600_000)
    expect(target).toMatchObject({ path: JOBS_PATH, query: { error: "Too many attempts. Wait a moment and try again." } })
    expect(mocks.viewerAccess).not.toHaveBeenCalled()
    expect(mocks.getJob).not.toHaveBeenCalled()
    expect(mocks.reconfirmJob).not.toHaveBeenCalled()
  })

  it("refuses a role without job.publish", async () => {
    mocks.viewerAccess.mockResolvedValue({ capabilities: ["interest.express"], organizationName: "North Pine" })

    const target = await redirectOf(reconfirmJobAction, form({ jobId: JOB_ID, ...ATTESTED }, []))

    expect(target).toMatchObject({ path: JOBS_PATH, query: { error: "Your role cannot confirm jobs for this organization" } })
    expect(mocks.getJob).not.toHaveBeenCalled()
    expect(mocks.reconfirmJob).not.toHaveBeenCalled()
  })

  it("refuses another organization's job (cross-organization attempt), whatever the form claims", async () => {
    mocks.getJob.mockResolvedValue(ownJob({ posterOrganizationId: OTHER_ORGANIZATION_ID }))

    const target = await redirectOf(reconfirmJobAction, form({ jobId: JOB_ID, organizationId: OTHER_ORGANIZATION_ID, ...ATTESTED }, []))

    expect(target).toMatchObject({ path: JOBS_PATH, query: { error: "You can only confirm your organization's own job postings" } })
    expect(mocks.viewerAccess).toHaveBeenCalledWith(VIEWER)
    expect(mocks.reconfirmJob).not.toHaveBeenCalled()
  })

  it("refuses an unknown or missing job id", async () => {
    mocks.getJob.mockResolvedValue(null)

    await expect(redirectOf(reconfirmJobAction, form({ jobId: JOB_ID, ...ATTESTED }, []))).resolves.toMatchObject({
      query: { error: "You can only confirm your organization's own job postings" }
    })
    await expect(redirectOf(reconfirmJobAction, form({ jobId: "  ", ...ATTESTED }, []))).resolves.toMatchObject({
      query: { error: "You can only confirm your organization's own job postings" }
    })
    expect(mocks.getJob).toHaveBeenCalledTimes(1)
    expect(mocks.reconfirmJob).not.toHaveBeenCalled()
  })

  it("refuses a listing that is not accepting interest", async () => {
    mocks.getJob.mockResolvedValue(ownJob({ acceptingInterest: false, status: "closed" }))

    await expect(redirectOf(reconfirmJobAction, form({ jobId: JOB_ID, ...ATTESTED }, []))).resolves.toMatchObject({
      query: { error: "Only a job that is accepting interest can be confirmed as still available" }
    })
    expect(mocks.reconfirmJob).not.toHaveBeenCalled()
  })

  it.each([
    ["missing", {}],
    ["a generic checkbox value", { availabilityAttestation: "on" }]
  ])("requires the explicit attestation (%s)", async (_label, attestation) => {
    const target = await redirectOf(reconfirmJobAction, form({ jobId: JOB_ID, ...attestation }, []))

    expect(target).toMatchObject({ path: JOBS_PATH, query: { error: "Tick the availability confirmation to record that this job is still available" } })
    expect(mocks.reconfirmJob).not.toHaveBeenCalled()
  })

  it("passes the session viewer and a server-generated attestation, ignoring a timestamp in the form", async () => {
    const target = await redirectOf(reconfirmJobAction, form({ jobId: ` ${JOB_ID} `, lastConfirmedAt: "2020-01-01T00:00:00.000Z", ...ATTESTED }, []))

    expect(mocks.getJob).toHaveBeenCalledWith(JOB_ID)
    expect(mocks.reconfirmJob).toHaveBeenCalledExactlyOnceWith(VIEWER, JOB_ID, { action: "reconfirm", confirmedAt: NOW.toISOString() })
    expect(target).toMatchObject({ path: JOBS_PATH, query: { unavailable: "reconfirm" } })
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })
})

describe("inquiry actions keep the inquiry selected (DS-04 list and conversation pages)", () => {
  const INTEREST_ID = "44444444-4444-4444-8444-444444444444"
  const REPLY_ID = "55555555-5555-4555-8555-555555555555"

  it.each([
    ["a hauler reply", haulerReplyAction, { body: "Both trucks", interestId: INTEREST_ID, replyId: REPLY_ID }, "/v2/inquiries", "reply"],
    ["a withdrawal", withdrawInterestAction, { interestId: INTEREST_ID }, "/v2/inquiries", "withdrawn"],
    ["a landing reply", respondToInterestAction, { body: "Start Tuesday", decision: "replied", interestId: INTEREST_ID, replyId: REPLY_ID }, "/v2/landing/inquiries", "replied"],
    ["a decline", respondToInterestAction, { decision: "declined", interestId: INTEREST_ID }, "/v2/landing/inquiries", "declined"]
  ])("returns to the list with %s's inquiry selected", async (_label, action, fields, path, updated) => {
    const target = await redirectOf(action, form(fields, []))

    expect(target).toEqual({ path, query: { inquiry: INTEREST_ID, updated }, raw: expect.any(String) })
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/v2", "layout")
  })

  it("keeps the inquiry selected when the service refuses, and passes only the form's ids to the port", async () => {
    mocks.respondToInterest.mockRejectedValueOnce(new Error("This inquiry is already closed"))

    const target = await redirectOf(respondToInterestAction, form({ decision: "declined", interestId: INTEREST_ID, organizationId: "x" }, []))

    expect(target).toMatchObject({ path: "/v2/landing/inquiries", query: { error: "This inquiry is already closed", inquiry: INTEREST_ID } })
    expect(mocks.respondToInterest).toHaveBeenCalledExactlyOnceWith(VIEWER, { body: "", decision: "declined", interestId: INTEREST_ID, replyId: undefined })
  })

  it("carries only a well-formed inquiry id", async () => {
    const target = await redirectOf(withdrawInterestAction, form({ interestId: "../../workspace?x=1" }, []))

    expect(target.query).toEqual({ updated: "withdrawn" })
  })
})

describe("closing an inquiry with a reason the other side sees (UX-09, #132)", () => {
  const INTEREST_ID = "44444444-4444-4444-8444-444444444444"
  const REPLY_ID = "55555555-5555-4555-8555-555555555555"

  it("withdraws with the hauler's reason and the form's reply id, rate-limited like a reply", async () => {
    await redirectOf(withdrawInterestAction, form({ interestId: INTEREST_ID, reason: "Booked elsewhere", replyId: REPLY_ID, userId: "x" }, []))

    expect(mocks.withdrawInterestWithReason).toHaveBeenCalledExactlyOnceWith(VIEWER, { interestId: INTEREST_ID, reason: "Booked elsewhere", replyId: REPLY_ID })
    expect(mocks.withdrawInterest).not.toHaveBeenCalled()
    expect(mocks.checkRateLimit).toHaveBeenCalledWith("marketplace-reply", USER_ID, 60, 60 * 60_000)
  })

  it("withdraws without a reason, and without spending the reply rate limit", async () => {
    await redirectOf(withdrawInterestAction, form({ interestId: INTEREST_ID, reason: " " }, []))

    expect(mocks.withdrawInterestWithReason).toHaveBeenCalledExactlyOnceWith(VIEWER, { interestId: INTEREST_ID, reason: " ", replyId: expect.stringMatching(/^[0-9a-f-]{36}$/) })
    expect(mocks.checkRateLimit).not.toHaveBeenCalled()
  })

  it("shows the landing's closure when the inquiry was declined (#194 HF-03)", async () => {
    mocks.withdrawInterestWithReason.mockRejectedValueOnce(new Error("The landing has closed this inquiry"))

    const target = await redirectOf(withdrawInterestAction, form({ interestId: INTEREST_ID, reason: "Never mind", replyId: REPLY_ID }, []))
    expect(target).toMatchObject({ path: "/v2/inquiries", query: { error: "The landing has closed this inquiry", inquiry: INTEREST_ID } })
  })

  it("declines with the landing's reason and the form's reply id", async () => {
    await redirectOf(respondToInterestAction, form({ body: "We've filled this job", decision: "declined", interestId: INTEREST_ID, replyId: REPLY_ID }, []))

    expect(mocks.respondToInterest).toHaveBeenCalledExactlyOnceWith(VIEWER, {
      body: "We've filled this job",
      decision: "declined",
      interestId: INTEREST_ID,
      replyId: REPLY_ID
    })
  })
})
