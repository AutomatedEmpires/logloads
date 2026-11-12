import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * #330: every server call site of the product events (docs/analytics/event-plan.md §6), driven through the real
 * action or adapter method with the port stubbed, and through the real capture path down to the PostHog request
 * (`fetch` stubbed). Each one sends exactly one event, only after its write succeeded and the response went, with no
 * personal data; and nothing when the request carries Do Not Track or Global Privacy Control, or when the write fails.
 */

const mocks = vi.hoisted(() => {
  // `@/lib/analytics` reads the key when it is imported.
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "phc_call_sites")

  return {
    getSessionActor: vi.fn(),
    port: {
      authoringLandings: vi.fn(),
      confirmHaulerAvailability: vi.fn(),
      expressInterest: vi.fn(),
      getJob: vi.fn(),
      listHaulerInterests: vi.fn(),
      listLandingInterests: vi.fn(),
      postHaulerReply: vi.fn(),
      publishJob: vi.fn(),
      reconfirmJob: vi.fn(),
      respondToInterest: vi.fn(),
      viewerAccess: vi.fn()
    },
    request: { headers: new Headers() },
    tasks: [] as Array<() => unknown>
  }
})

vi.mock("server-only", () => ({}))
vi.mock("next/navigation", () => ({
  redirect: (href: string) => {
    throw new Error(`NEXT_REDIRECT ${href}`)
  }
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("next/headers", () => ({ headers: async () => mocks.request.headers }))
// Next runs these once the response has been sent; `sendResponse` below does the same.
vi.mock("next/server", () => ({
  after: (task: () => unknown) => {
    mocks.tasks.push(task)
  }
}))
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: async () => undefined }))
vi.mock("@/lib/marketplace-v2/flag", () => ({ marketplaceV2Enabled: () => true }))
vi.mock("@/lib/marketplace-v2/v2-session", () => ({ getV2SessionActor: mocks.getSessionActor }))
vi.mock("@/lib/marketplace-v2/pilot-adapter", () => ({ pilotMarketplaceV2: mocks.port }))

import {
  attestAvailability,
  MARKETPLACE_AVAILABILITY_ATTESTATION,
  MARKETPLACE_PUBLISH_ATTESTATION_FIELDS,
  type MarketplaceInterestView,
  type MarketplaceJobDetailView,
  type MarketplaceJobStatus,
  type MarketplaceJobStopStatus
} from "@logloads/contracts"

import { expressInterestAction, haulerReplyAction, publishJobAction, reconfirmJobAction, respondToInterestAction } from "@/lib/marketplace-v2/actions"
import { confirmHaulerAvailabilityAction } from "@/lib/marketplace-v2/fleet-actions"
import { normalizedJobsMethods } from "@/lib/marketplace-v2/jobs/methods"
import type { NormalizedJobsStore, StoredOwnJob } from "@/lib/marketplace-v2/jobs/store"
import type { NormalizedFeatureContext } from "@/lib/marketplace-v2/normalized-adapter"
import type { MarketplaceCalls } from "@/lib/marketplace-v2/normalized-db"

import { COMMON_PROPERTY_KEYS, type ServerProductEventName } from "./events"
import { pseudonymousId } from "./server"

const NOW = new Date("2026-11-02T17:30:00.000Z")
const DAY = 86_400_000
const USER = "0b4f6c1d-2e3a-4b5c-9d6e-7f8091a2b3c4"
const LANDING_ORG = "1c5a7d2e-3f4b-4c6d-8e7f-8091a2b3c4d5"
const HAULER_ORG = "2d6b8e3f-4a5c-4d7e-9f80-91a2b3c4d5e6"
const INTEREST_ID = "3e7c9f40-5b6d-4e8f-8091-a2b3c4d5e6f7"
const LANDING_ID = "4f8d0a51-6c7e-4f90-8a1b-b3c4d5e6f7a8"
const JOB = "6f1c2a7e-3b4d-4c5e-8f60-718293a4b5c6"
const REPLY_ID = "5a9e1b62-7c8d-4e9f-a0b1-c2d3e4f5a6b7"
const MESSAGE = "Call Jo Hauler at (509) 555-0142 or jo.hauler@example.com. Gate code 4411."

/** Everything private the call sites hold. None of it may reach PostHog. */
const PRIVATE_VALUES = [
  USER,
  LANDING_ORG,
  HAULER_ORG,
  INTEREST_ID,
  LANDING_ID,
  "Jo Hauler",
  "(509) 555-0142",
  "jo.hauler@example.com",
  "Gate code",
  "Cascade Landing",
  "Landing 7",
  "Oakridge",
  "Oak saw logs"
]

const viewerOf = (organizationId: string) => ({ organizationId, userId: USER })

function signedInFor(organizationId: string) {
  mocks.getSessionActor.mockResolvedValue({ activeOrganization: { id: organizationId }, profile: { id: USER }, workspaceSelectionInvalid: false })
}

function form(fields: Record<string, string>, lists: Record<string, string[]> = {}): FormData {
  const data = new FormData()
  for (const [name, value] of Object.entries(fields)) data.set(name, value)
  for (const [name, values] of Object.entries(lists)) for (const value of values) data.append(name, value)
  return data
}

const PUBLISH_FORM = () =>
  form(
    {
      durationDays: "10",
      landingId: LANDING_ID,
      payAmount: "525",
      payUnit: "per_load",
      product: "Saw logs",
      startsOn: "2026-11-10",
      title: "Oak saw logs out of Oakridge",
      trucksRequested: "4",
      ...Object.fromEntries(MARKETPLACE_PUBLISH_ATTESTATION_FIELDS.map((name) => [name, MARKETPLACE_AVAILABILITY_ATTESTATION.value]))
    },
    { equipment: ["log_truck"] }
  )

/** The public listing as it was before the poster acted: confirmed 9 days ago, so aging. */
function listing(status: MarketplaceJobStatus): MarketplaceJobDetailView {
  return {
    acceptingInterest: status === "active",
    destinationLabel: "Oakridge mill",
    endsOn: "2026-12-20",
    equipment: ["log_truck"],
    estimatedDailyLoads: null,
    estimatedLoadsPerTruckPerDay: null,
    estimatedTonsPerLoad: null,
    expiresAt: null,
    haulDistance: null,
    id: JOB,
    lastConfirmedAt: new Date(NOW.getTime() - 9 * DAY).toISOString(),
    lastModifiedAt: new Date(NOW.getTime() - 3 * DAY).toISOString(),
    origin: { approximatePoint: { lat: 43.7, lng: -122.4 }, label: "Oakridge, OR", stateCode: "OR" },
    pay: { amountCents: 52_500, note: null, unit: "per_load" },
    posterName: "Cascade Landing Co",
    posterOrganizationId: LANDING_ORG,
    posterVerification: null,
    product: "Saw logs",
    publicAccessRequirements: [],
    publicRoadNotes: "Gate code 4411 at the Oakridge spur",
    scheduleNote: null,
    slug: JOB,
    sponsored: false,
    startsOn: "2026-11-10",
    status,
    title: "Oak saw logs out of Oakridge",
    trucks: { perDay: null, total: 4 }
  }
}

function interestView(createdAt: string): MarketplaceInterestView {
  return {
    availableFrom: "2026-11-12",
    availableUntil: null,
    contactPreference: "phone",
    createdAt,
    equipment: [{ configurationKey: "log_truck|pole_trailer", count: 3, label: "Jo Hauler's long-log setup" }],
    haulerOrganization: { id: HAULER_ORG, name: "Jo Hauler Trucking", type: "hauler" },
    id: INTEREST_ID,
    job: { acceptingInterest: true, id: JOB, slug: JOB, status: "active", title: "Oak saw logs out of Oakridge" },
    landingOrganization: { id: LANDING_ORG, name: "Cascade Landing Co" },
    message: MESSAGE,
    replies: [],
    status: "submitted",
    submittedBy: { name: "Jo Hauler", userId: USER },
    trucksOffered: 3,
    updatedAt: createdAt
  }
}

/** The jobs group (#247) over a one-job store: records its writes, and can be made to fail. */
function jobsGroup(status: MarketplaceJobStatus) {
  const writes: string[] = []
  const failing = { write: false }
  const stored: StoredOwnJob = {
    boost: null,
    createdAt: new Date(NOW.getTime() - 20 * DAY).toISOString(),
    draft: null,
    invitationsDelivered: 0,
    job: listing(status),
    landing: { id: LANDING_ID, name: "Landing 7" },
    moderationHold: false
  }
  const store: NormalizedJobsStore = {
    capabilities: async () => ["job.publish"],
    editTerms: async () => null,
    landingInquiries: async () => [],
    ownJobs: async () => [structuredClone(stored)],
    reactivate: async () => {
      if (failing.write) throw new Error("connection reset")
      writes.push("reactivate")
    },
    setStatus: async (_jobId, to) => {
      if (failing.write) throw new Error("connection reset")
      writes.push(`setStatus:${to}`)
    }
  }
  const context: NormalizedFeatureContext = {
    asAccount: async () => {
      throw new Error("the jobs group never acts for no business")
    },
    asViewer: async (_viewer, work) => work({} as MarketplaceCalls),
    now: () => NOW
  }

  return { failing, port: normalizedJobsMethods(context, () => store), writes }
}

const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () => new Response(null, { status: 200 }))

async function sendResponse(): Promise<void> {
  const tasks = mocks.tasks.splice(0)
  for (const task of tasks) await task()
}

/** The bodies PostHog received. */
function sent(): Array<{ distinct_id: string; event: string; properties: Record<string, unknown> }> {
  return fetchMock.mock.calls.map(([url, init]) => {
    expect(url).toBe("https://us.i.posthog.com/capture/")
    return JSON.parse(String(init.body))
  })
}

/** Runs an action or a method to its end: an action always answers with a redirect. */
async function settle(run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run()
    return null
  } catch (error) {
    const match = /^NEXT_REDIRECT (.+)$/.exec(error instanceof Error ? error.message : "")
    return match ? match[1]! : `threw ${(error as Error).message}`
  }
}

interface CallSite {
  site: string
  event: ServerProductEventName
  /** The session's business. */
  organizationId: string
  run(): Promise<unknown>
  /** Makes the write fail. */
  fail(): void
  expected: Record<string, unknown>
}

const freshness = { days_since_confirmed: 9, freshness_before: "confirmed_aging" }

function callSites(): CallSite[] {
  return [
    {
      event: "job_published",
      expected: {
        equipment_count: 1,
        job: JOB,
        org: pseudonymousId("organization", LANDING_ORG),
        pay_stated: true,
        pay_unit: "per_load",
        product: "saw_logs",
        state: "OR",
        trucks_requested: 4
      },
      fail: () => mocks.port.publishJob.mockRejectedValue(new Error("connection reset")),
      organizationId: LANDING_ORG,
      run: () => publishJobAction(PUBLISH_FORM()),
      site: "publishJobAction"
    },
    {
      event: "interest_submitted",
      expected: {
        contact_route: "phone",
        equipment_lines: 1,
        interest: pseudonymousId("interest", INTEREST_ID),
        job: JOB,
        org: pseudonymousId("organization", HAULER_ORG),
        renewed: false,
        trucks_offered: 3
      },
      fail: () => mocks.port.expressInterest.mockRejectedValue(new Error("connection reset")),
      organizationId: HAULER_ORG,
      run: () =>
        expressInterestAction(
          form({ contactPreference: "phone", loadPostingId: JOB, message: MESSAGE, trucksOffered: "3" }, { equipmentCount: ["3"], equipmentKey: ["log_truck|pole_trailer"] })
        ),
      site: "expressInterestAction"
    },
    {
      event: "interest_replied",
      expected: { interest: pseudonymousId("interest", INTEREST_ID), org: pseudonymousId("organization", LANDING_ORG), outcome: "replied", side: "landing" },
      fail: () => mocks.port.respondToInterest.mockRejectedValue(new Error("connection reset")),
      organizationId: LANDING_ORG,
      run: () => respondToInterestAction(form({ body: MESSAGE, decision: "replied", interestId: INTEREST_ID, replyId: REPLY_ID })),
      site: "respondToInterestAction"
    },
    {
      event: "interest_replied",
      expected: { interest: pseudonymousId("interest", INTEREST_ID), org: pseudonymousId("organization", HAULER_ORG), outcome: "replied", side: "hauler" },
      fail: () => mocks.port.postHaulerReply.mockRejectedValue(new Error("connection reset")),
      organizationId: HAULER_ORG,
      run: () => haulerReplyAction(form({ body: MESSAGE, interestId: INTEREST_ID, replyId: REPLY_ID })),
      site: "haulerReplyAction"
    },
    {
      event: "job_reconfirmed",
      expected: { ...freshness, job: JOB, org: pseudonymousId("organization", LANDING_ORG), resumed: false, via: "in_app" },
      fail: () => mocks.port.reconfirmJob.mockRejectedValue(new Error("connection reset")),
      organizationId: LANDING_ORG,
      run: () => reconfirmJobAction(form({ jobId: JOB, [MARKETPLACE_AVAILABILITY_ATTESTATION.field]: MARKETPLACE_AVAILABILITY_ATTESTATION.value })),
      site: "reconfirmJobAction"
    },
    {
      event: "availability_reconfirmed",
      expected: { org: pseudonymousId("organization", HAULER_ORG), signed_in: true, truck_types: 3, via: "in_app" },
      fail: () => mocks.port.confirmHaulerAvailability.mockRejectedValue(new Error("connection reset")),
      organizationId: HAULER_ORG,
      run: () => confirmHaulerAvailabilityAction(form({})),
      site: "confirmHaulerAvailabilityAction"
    },
    ...(["paused", "filled", "closed"] as const).map((status): CallSite => {
      const jobs = jobsGroup("active")
      return {
        event: "job_stopped",
        expected: { ...freshness, job: JOB, org: pseudonymousId("organization", LANDING_ORG), status, via: "in_app" },
        fail: () => {
          jobs.failing.write = true
        },
        organizationId: LANDING_ORG,
        run: () => jobs.port.setJobStatus(viewerOf(LANDING_ORG), JOB, status),
        site: `jobs setJobStatus(${status})`
      }
    }),
    (() => {
      const jobs = jobsGroup("paused")
      return {
        event: "job_reconfirmed",
        expected: { ...freshness, job: JOB, org: pseudonymousId("organization", LANDING_ORG), resumed: true, via: "in_app" },
        fail: () => {
          jobs.failing.write = true
        },
        organizationId: LANDING_ORG,
        run: () => jobs.port.resumeJob(viewerOf(LANDING_ORG), JOB, attestAvailability(MARKETPLACE_AVAILABILITY_ATTESTATION.value, "reconfirm", NOW)!),
        site: "jobs resumeJob"
      } satisfies CallSite
    })()
  ]
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(NOW)
  vi.stubGlobal("fetch", fetchMock)
  fetchMock.mockImplementation(async () => new Response(null, { status: 200 }))
  mocks.tasks = []
  mocks.request.headers = new Headers()
  signedInFor(LANDING_ORG)
  mocks.port.viewerAccess.mockResolvedValue({ capabilities: ["job.publish", "inquiry.respond", "interest.express"], organizationName: "Cascade Landing Co" })
  mocks.port.authoringLandings.mockResolvedValue([{ areaLabel: "Oakridge, OR", id: LANDING_ID, name: "Landing 7", stateCode: "OR" }])
  mocks.port.publishJob.mockResolvedValue({ jobId: JOB })
  mocks.port.expressInterest.mockResolvedValue(interestView(NOW.toISOString()))
  mocks.port.respondToInterest.mockResolvedValue(undefined)
  mocks.port.postHaulerReply.mockResolvedValue(undefined)
  // The inquiry as it is before an answer: sent a day ago, not yet answered.
  mocks.port.listHaulerInterests.mockResolvedValue([interestView(new Date(NOW.getTime() - DAY).toISOString())])
  mocks.port.listLandingInterests.mockResolvedValue([interestView(new Date(NOW.getTime() - DAY).toISOString())])
  mocks.port.getJob.mockResolvedValue(listing("active"))
  mocks.port.reconfirmJob.mockResolvedValue(undefined)
  mocks.port.confirmHaulerAvailability.mockResolvedValue({ confirmed: 3 })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

afterAll(() => {
  vi.unstubAllEnvs()
})

describe("every call site sends exactly one event, after the write and the response, with no personal data", () => {
  it.each(callSites().map((site) => [site.site, site] as const))("%s", async (_site, site) => {
    signedInFor(site.organizationId)

    const answer = await settle(() => site.run())
    expect(answer ?? "", "the write succeeded").not.toMatch(/error=|threw/)
    expect(fetchMock, "nothing is sent before the response").not.toHaveBeenCalled()
    expect(mocks.tasks).toHaveLength(1)

    await sendResponse()

    const [body, ...more] = sent()
    expect(more).toHaveLength(0)
    expect(body!.event).toBe(site.event)
    expect(body!.distinct_id).toBe(pseudonymousId("user", USER))
    expect(body!.properties).toMatchObject({ ...site.expected, $geoip_disable: true, $process_person_profile: false, event_version: 1 })
    expect(Object.keys(body!.properties).sort()).toEqual(
      [...Object.keys(site.expected), ...COMMON_PROPERTY_KEYS, "$geoip_disable", "$lib", "$process_person_profile"].sort()
    )

    const serialized = JSON.stringify(body)
    for (const value of PRIVATE_VALUES) {
      expect(serialized, `${site.site} leaked ${value}`).not.toContain(value)
    }
  })
})

describe("every call site sends nothing when the request asks not to be tracked", () => {
  it.each(callSites().flatMap((site) => [
    [site.site, "Do Not Track", { DNT: "1" }, site] as const,
    [site.site, "Global Privacy Control", { "Sec-GPC": "1" }, site] as const
  ]))("%s with %s", async (_site, _signal, headers, site) => {
    signedInFor(site.organizationId)
    mocks.request.headers = new Headers(headers)

    expect((await settle(() => site.run())) ?? "").not.toMatch(/error=|threw/)
    await sendResponse()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe("every call site sends nothing when its write fails", () => {
  it.each(callSites().map((site) => [site.site, site] as const))("%s", async (_site, site) => {
    // The failure is logged by reportV2Error (codes and class names only); that log is not under test here.
    vi.spyOn(console, "error").mockImplementation(() => undefined)
    signedInFor(site.organizationId)
    site.fail()

    await settle(() => site.run())
    await sendResponse()
    expect(mocks.tasks).toHaveLength(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe("a replayed answer is not another event (the stores treat it as no change)", () => {
  const before = (changes: Partial<MarketplaceInterestView>) => [{ ...interestView(new Date(NOW.getTime() - DAY).toISOString()), ...changes }]
  const answered = (authorSide: "hauler" | "landing") => ({
    replies: [{ authorName: "Jo Hauler", authorSide, authorUserId: USER, body: MESSAGE, createdAt: new Date(NOW.getTime() - 60_000).toISOString(), id: REPLY_ID }]
  })

  it("sends nothing when a hauler resubmits a reply the inquiry already holds (the same replyId)", async () => {
    signedInFor(HAULER_ORG)
    mocks.port.listHaulerInterests.mockResolvedValue(before(answered("hauler")))

    await settle(() => haulerReplyAction(form({ body: MESSAGE, interestId: INTEREST_ID, replyId: REPLY_ID })))
    await sendResponse()
    expect(mocks.port.postHaulerReply).toHaveBeenCalledTimes(1)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("sends nothing when a landing resubmits its reply, or declines an inquiry it already declined", async () => {
    mocks.port.listLandingInterests.mockResolvedValue(before({ ...answered("landing"), status: "replied" }))
    await settle(() => respondToInterestAction(form({ body: MESSAGE, decision: "replied", interestId: INTEREST_ID, replyId: REPLY_ID })))

    mocks.port.listLandingInterests.mockResolvedValue(before({ status: "declined" }))
    await settle(() => respondToInterestAction(form({ decision: "declined", interestId: INTEREST_ID })))

    await sendResponse()
    expect(mocks.port.respondToInterest).toHaveBeenCalledTimes(2)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("still sends a new reply on an inquiry that already has others", async () => {
    mocks.port.listLandingInterests.mockResolvedValue(before({ ...answered("landing"), status: "replied" }))

    await settle(() => respondToInterestAction(form({ body: MESSAGE, decision: "replied", interestId: INTEREST_ID, replyId: "6b0f2c73-8d9e-4fa0-b1c2-d3e4f5a6b7c8" })))
    await sendResponse()
    expect(sent().map((body) => body.event)).toEqual(["interest_replied"])
  })

  it("counts the answer as new when the inquiry cannot be read first", async () => {
    signedInFor(HAULER_ORG)
    mocks.port.listHaulerInterests.mockRejectedValue(new Error("connection reset"))

    await settle(() => haulerReplyAction(form({ body: MESSAGE, interestId: INTEREST_ID, replyId: REPLY_ID })))
    await sendResponse()
    expect(sent().map((body) => body.event)).toEqual(["interest_replied"])
  })

  it("makes no extra read when no event would be sent (Do Not Track, Global Privacy Control)", async () => {
    for (const headers of [{ DNT: "1" }, { "Sec-GPC": "1" }] as Array<Record<string, string>>) {
      mocks.request.headers = new Headers(headers)
      await settle(() => respondToInterestAction(form({ body: MESSAGE, decision: "replied", interestId: INTEREST_ID, replyId: REPLY_ID })))
      signedInFor(HAULER_ORG)
      await settle(() => haulerReplyAction(form({ body: MESSAGE, interestId: INTEREST_ID, replyId: REPLY_ID })))
      signedInFor(LANDING_ORG)
    }

    expect(mocks.port.listLandingInterests).not.toHaveBeenCalled()
    expect(mocks.port.listHaulerInterests).not.toHaveBeenCalled()
    expect(mocks.port.respondToInterest).toHaveBeenCalledTimes(2)
  })
})

describe("what is not an event", () => {
  it("sends nothing when a landing only marks an inquiry viewed", async () => {
    await settle(() => respondToInterestAction(form({ decision: "viewed", interestId: INTEREST_ID })))
    await sendResponse()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("records a landing's decline as an answer", async () => {
    await settle(() => respondToInterestAction(form({ body: "", decision: "declined", interestId: INTEREST_ID })))
    await sendResponse()
    expect(sent().map((body) => [body.event, body.properties.outcome, body.properties.side])).toEqual([["interest_replied", "declined", "landing"]])
  })

  it("marks a re-send of an inquiry that already existed as renewed", async () => {
    signedInFor(HAULER_ORG)
    mocks.port.expressInterest.mockResolvedValue(interestView(new Date(NOW.getTime() - DAY).toISOString()))

    await settle(() => expressInterestAction(form({ loadPostingId: JOB, trucksOffered: "3" })))
    await sendResponse()
    expect(sent()[0]!.properties.renewed).toBe(true)
  })

  it("sends nothing when there was no truck type to confirm", async () => {
    signedInFor(HAULER_ORG)
    mocks.port.confirmHaulerAvailability.mockResolvedValue({ confirmed: 0 })

    await settle(() => confirmHaulerAvailabilityAction(form({})))
    await sendResponse()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each(["paused", "filled", "closed"] as const)("sends nothing, and writes nothing, when the job is already %s", async (status: MarketplaceJobStopStatus) => {
    const jobs = jobsGroup(status)

    await jobs.port.setJobStatus(viewerOf(LANDING_ORG), JOB, status)
    await sendResponse()
    expect(jobs.writes).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("sends nothing for a refused lifecycle change (pausing a filled job, resuming a listed one)", async () => {
    await expect(jobsGroup("filled").port.setJobStatus(viewerOf(LANDING_ORG), JOB, "paused")).rejects.toThrow()
    await expect(
      jobsGroup("active").port.resumeJob(viewerOf(LANDING_ORG), JOB, attestAvailability(MARKETPLACE_AVAILABILITY_ATTESTATION.value, "reconfirm", NOW)!)
    ).rejects.toThrow()
    await sendResponse()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe("analytics never breaks a flow", () => {
  it("answers the action exactly as without analytics when PostHog cannot be reached", async () => {
    signedInFor(HAULER_ORG)
    fetchMock.mockRejectedValue(new Error("offline"))

    const answer = await settle(() =>
      expressInterestAction(form({ contactPreference: "phone", loadPostingId: JOB, trucksOffered: "3" }))
    )
    await expect(sendResponse()).resolves.toBeUndefined()
    expect(answer).toBe(`/v2/work/${JOB}?sent=1#interest`)
  })
})
