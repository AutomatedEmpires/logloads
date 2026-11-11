import type { MarketplaceInterestView, MarketplaceJobCardView, MarketplaceJobDraft } from "@logloads/contracts"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { COMMON_PROPERTY_KEYS, type ServerProductEventName } from "./events"
import { FIXTURE_JOB, VALID_PROPERTIES } from "./fixtures"

vi.mock("server-only", () => ({}))

const request = vi.hoisted(() => ({ headers: new Headers() as Headers | null, throws: false }))

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => {
    if (request.throws) throw new Error("headers() called outside a request scope")
    return request.headers
  })
}))

const NOW = "2026-11-10T18:00:00.000Z"
const USER = "0b4f6c1d-2e3a-4b5c-9d6e-7f8091a2b3c4"
const LANDING_ORG = "1c5a7d2e-3f4b-4c6d-8e7f-8091a2b3c4d5"
const HAULER_ORG = "2d6b8e3f-4a5c-4d7e-9f80-91a2b3c4d5e6"
const INTEREST_ID = "3e7c9f40-5b6d-4e8f-8091-a2b3c4d5e6f7"

/** Everything private the call sites hold. None of it may appear in what PostHog receives. */
const PRIVATE_VALUES = [
  USER,
  LANDING_ORG,
  HAULER_ORG,
  INTEREST_ID,
  "Jo Hauler",
  "Cascade Landing",
  "(509) 555-0142",
  "jo.hauler@example.com",
  "Oakridge",
  "Gate code",
  "cousin's cedar"
]

const draft = {
  description: "Call Jo Hauler at (509) 555-0142 for the Oakridge unit.",
  destinationLabel: "Oakridge mill",
  equipment: ["pole_trailer", "onboard_scales"],
  landingId: "4f8d0a51-6c7e-4f90-8a1b-b3c4d5e6f7a8",
  ongoing: false,
  payAmount: 12.5,
  payNote: "jo.hauler@example.com for questions",
  payUnit: "per_ton",
  product: "Saw logs",
  productOther: "cousin's cedar",
  publicRoadNotes: "Gate code 4411 at the second spur",
  title: "Saw logs out of Oakridge",
  trucksRequested: 4
} as MarketplaceJobDraft

const interest: MarketplaceInterestView = {
  availableFrom: "2026-11-12",
  availableUntil: null,
  contactPreference: "phone",
  createdAt: NOW,
  equipment: [{ configurationKey: "cfg-1", count: 3, label: "Jo Hauler's long-log setup" }],
  haulerOrganization: { id: HAULER_ORG, name: "Jo Hauler Trucking", type: "independent_hauler" },
  id: INTEREST_ID,
  job: { acceptingInterest: true, id: FIXTURE_JOB, slug: "saw-logs-oakridge", status: "active", title: "Saw logs out of Oakridge" },
  landingOrganization: { id: LANDING_ORG, name: "Cascade Landing Co" },
  message: "Call me at (509) 555-0142 or jo.hauler@example.com",
  replies: [],
  status: "submitted",
  submittedBy: { name: "Jo Hauler", userId: USER },
  trucksOffered: 3,
  updatedAt: NOW
}

const agingJob: Pick<MarketplaceJobCardView, "expiresAt" | "id" | "lastConfirmedAt" | "lastModifiedAt"> = {
  expiresAt: null,
  id: FIXTURE_JOB,
  lastConfirmedAt: "2026-11-01T09:00:00.000Z",
  lastModifiedAt: "2026-11-03T09:00:00.000Z"
}

const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () => new Response(null, { status: 200 }))

beforeEach(() => {
  request.headers = new Headers()
  request.throws = false
  fetchMock.mockClear()
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function load(key: string | null = "phc_test") {
  vi.resetModules()

  if (key) {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", key)
  } else {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "")
  }

  return import("./server")
}

function sentBody(): { api_key: string; distinct_id: string; event: string; properties: Record<string, unknown> } {
  expect(fetchMock).toHaveBeenCalledTimes(1)
  const [url, init] = fetchMock.mock.calls[0]!
  expect(url).toBe("https://us.i.posthog.com/capture/")
  return JSON.parse(String(init.body))
}

describe("server product events", () => {
  it("builds every server event from its call site's real views and sends only declared, non-personal properties", async () => {
    const server = await load()
    const landingActor = { organizationId: LANDING_ORG, userId: USER }
    const haulerActor = { organizationId: HAULER_ORG, userId: USER }

    const cases: Array<{ name: ServerProductEventName; properties: Record<string, unknown> | null; actor: typeof landingActor }> = [
      {
        actor: landingActor,
        name: "job_published",
        properties: server.jobPublishedProperties({ draft, jobId: FIXTURE_JOB, landing: { stateCode: "or" }, organizationId: LANDING_ORG })
      },
      { actor: haulerActor, name: "interest_submitted", properties: server.interestSubmittedProperties({ interest, now: NOW }) },
      {
        actor: landingActor,
        name: "interest_replied",
        properties: server.interestRepliedProperties({ decision: "replied", interestId: INTEREST_ID, organizationId: LANDING_ORG, side: "landing" })
      },
      {
        actor: haulerActor,
        name: "availability_reconfirmed",
        properties: server.availabilityReconfirmedProperties({ confirmed: 3, organizationId: HAULER_ORG, signedIn: true, via: "in_app" })
      },
      {
        actor: landingActor,
        name: "job_reconfirmed",
        properties: server.jobReconfirmedProperties({ job: agingJob, now: NOW, organizationId: LANDING_ORG, resumed: false, via: "in_app" })
      },
      {
        actor: landingActor,
        name: "job_stopped",
        properties: server.jobStoppedProperties({ job: agingJob, now: NOW, organizationId: LANDING_ORG, status: "filled", via: "in_app" })
      }
    ]

    expect(cases.map((entry) => entry.name).sort()).toEqual(
      Object.keys(VALID_PROPERTIES).filter((name) => !["flow_timed", "share_link_opened"].includes(name)).sort()
    )

    for (const entry of cases) {
      fetchMock.mockClear()

      await expect(server.captureProductEvent(entry.name, entry.properties as never, { actor: entry.actor })).resolves.toBe("sent")

      const body = sentBody()
      expect(body.event).toBe(entry.name)
      expect(body.distinct_id).toBe(server.pseudonymousId("user", USER))
      expect(body.distinct_id).toMatch(/^u_[0-9a-f]{32}$/)
      expect(Object.keys(body.properties).sort()).toEqual(
        [...Object.keys(VALID_PROPERTIES[entry.name]), ...COMMON_PROPERTY_KEYS, "$geoip_disable", "$lib", "$process_person_profile"].sort()
      )
      expect(body.properties).toMatchObject({ $geoip_disable: true, $process_person_profile: false, event_version: 1 })

      const serialized = JSON.stringify(body)
      for (const value of PRIVATE_VALUES) {
        expect(serialized, `${entry.name} leaked ${value}`).not.toContain(value)
      }
    }
  })

  it("sends the shapes the event plan describes", async () => {
    const server = await load()

    expect(server.jobPublishedProperties({ draft, jobId: FIXTURE_JOB, landing: { stateCode: " or " }, organizationId: LANDING_ORG })).toEqual({
      equipment_count: 2,
      job: FIXTURE_JOB,
      org: server.pseudonymousId("organization", LANDING_ORG),
      pay_stated: true,
      pay_unit: "per_ton",
      product: "saw_logs",
      state: "OR",
      trucks_requested: 4
    })
    expect(server.interestSubmittedProperties({ interest, now: NOW })).toEqual({
      contact_route: "phone",
      equipment_lines: 1,
      interest: server.pseudonymousId("interest", INTEREST_ID),
      job: FIXTURE_JOB,
      org: server.pseudonymousId("organization", HAULER_ORG),
      renewed: false,
      trucks_offered: 3
    })
    expect(server.jobReconfirmedProperties({ job: agingJob, now: NOW, organizationId: LANDING_ORG, resumed: true, via: "one_tap_link" })).toEqual({
      days_since_confirmed: 9,
      freshness_before: "confirmed_aging",
      job: FIXTURE_JOB,
      org: server.pseudonymousId("organization", LANDING_ORG),
      resumed: true,
      via: "one_tap_link"
    })
  })

  it("gives both sides of an inquiry the same pseudonym, so time to first reply can be joined", async () => {
    const server = await load()
    const sent = server.interestSubmittedProperties({ interest, now: NOW })
    const replied = server.interestRepliedProperties({ decision: "declined", interestId: INTEREST_ID.toUpperCase(), organizationId: LANDING_ORG, side: "landing" })

    expect(replied?.interest).toBe(sent.interest)
    expect(replied?.outcome).toBe("declined")
  })

  it("records nothing when a landing only marks an inquiry viewed, and treats every hauler message as a reply", async () => {
    const server = await load()

    expect(server.interestRepliedProperties({ decision: "viewed", interestId: INTEREST_ID, organizationId: LANDING_ORG, side: "landing" })).toBeNull()
    await expect(server.captureProductEvent("interest_replied", null, { actor: { userId: USER } })).resolves.toBe("skipped")
    expect(fetchMock).not.toHaveBeenCalled()

    expect(server.interestRepliedProperties({ decision: "", interestId: INTEREST_ID, organizationId: HAULER_ORG, side: "hauler" })?.outcome).toBe("replied")
  })

  it("marks a re-send of an existing inquiry as renewed", async () => {
    const server = await load()

    expect(server.interestSubmittedProperties({ interest: { ...interest, createdAt: "2026-11-09T18:00:00.000Z" }, now: NOW }).renewed).toBe(true)
    expect(server.interestSubmittedProperties({ interest: { ...interest, createdAt: "2026-11-10T17:59:30.000Z" }, now: NOW }).renewed).toBe(false)
  })

  it("reports a never-confirmed listing as unconfirmed, and skips a listing whose timestamps cannot be read", async () => {
    const server = await load()
    const never = { ...agingJob, lastConfirmedAt: null }

    expect(server.jobStoppedProperties({ job: never, now: NOW, organizationId: LANDING_ORG, status: "paused", via: "in_app" })).toMatchObject({
      days_since_confirmed: null,
      freshness_before: "unconfirmed"
    })
    expect(server.jobReconfirmedProperties({ job: { ...agingJob, lastConfirmedAt: "not a date" }, now: NOW, organizationId: LANDING_ORG, resumed: false, via: "in_app" })).toBeNull()
  })

  it("keeps a state code only when it is two letters, and the pay basis without the amount", async () => {
    const server = await load()

    expect(server.jobPublishedProperties({ draft, jobId: FIXTURE_JOB, landing: null, organizationId: LANDING_ORG }).state).toBeNull()
    expect(server.jobPublishedProperties({ draft, jobId: FIXTURE_JOB, landing: { stateCode: "Oregon" }, organizationId: LANDING_ORG }).state).toBeNull()

    const negotiable = server.jobPublishedProperties({
      draft: { ...draft, payAmount: undefined, payUnit: "negotiable", product: undefined },
      jobId: FIXTURE_JOB,
      organizationId: LANDING_ORG
    })
    expect(negotiable).toMatchObject({ pay_stated: false, pay_unit: "negotiable", product: null })
    expect(JSON.stringify(negotiable)).not.toContain("12.5")
  })

  it("sends nothing when the request carries Do Not Track or Global Privacy Control", async () => {
    const server = await load()
    const properties = server.availabilityReconfirmedProperties({ confirmed: 2, organizationId: HAULER_ORG, signedIn: true, via: "in_app" })

    await expect(server.captureProductEvent("availability_reconfirmed", properties, { actor: { userId: USER }, headers: new Headers({ DNT: "1" }) })).resolves.toBe("declined")
    await expect(server.captureProductEvent("availability_reconfirmed", properties, { actor: { userId: USER }, headers: new Headers({ "Sec-GPC": "1" }) })).resolves.toBe("declined")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("reads the current request's headers when none are passed", async () => {
    const server = await load()
    const properties = server.availabilityReconfirmedProperties({ confirmed: 2, organizationId: HAULER_ORG, signedIn: true, via: "in_app" })

    request.headers = new Headers({ "sec-gpc": "1" })
    await expect(server.captureProductEvent("availability_reconfirmed", properties, { actor: { userId: USER } })).resolves.toBe("declined")
    expect(fetchMock).not.toHaveBeenCalled()

    request.headers = new Headers()
    await expect(server.captureProductEvent("availability_reconfirmed", properties, { actor: { userId: USER } })).resolves.toBe("sent")

    request.throws = true
    fetchMock.mockClear()
    await expect(server.captureProductEvent("availability_reconfirmed", properties, { actor: { userId: USER } })).resolves.toBe("sent")
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("uses the business's pseudonym when no one is signed in (a one-tap link), and a fixed id when there is neither", async () => {
    const server = await load()
    const properties = server.availabilityReconfirmedProperties({ confirmed: 1, organizationId: HAULER_ORG, signedIn: false, via: "one_tap_link" })

    await server.captureProductEvent("availability_reconfirmed", properties, { actor: { organizationId: HAULER_ORG }, headers: null })
    expect(sentBody().distinct_id).toBe(server.pseudonymousId("organization", HAULER_ORG))
    expect(server.productEventDistinctId({})).toBe(server.SERVER_DISTINCT_ID)
  })

  it("is inert without a PostHog key", async () => {
    const server = await load(null)
    const properties = server.availabilityReconfirmedProperties({ confirmed: 1, organizationId: HAULER_ORG, signedIn: true, via: "in_app" })

    await expect(server.captureProductEvent("availability_reconfirmed", properties, { actor: { userId: USER } })).resolves.toBe("disabled")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("drops properties that fail the schema, logging keys and rules but never values", async () => {
    const server = await load()
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const properties = { ...server.availabilityReconfirmedProperties({ confirmed: 1, organizationId: HAULER_ORG, signedIn: true, via: "in_app" }), email: "jo.hauler@example.com" }

    await expect(server.captureProductEvent("availability_reconfirmed", properties as never, { actor: { userId: USER } })).resolves.toBe("invalid")
    expect(fetchMock).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]?.[0])).toContain("email:unrecognized_key")
    expect(String(warn.mock.calls[0]?.[0])).not.toContain("example.com")
  })

  it("refuses a client event on the server", async () => {
    const server = await load()
    vi.spyOn(console, "warn").mockImplementation(() => undefined)

    await expect(server.captureProductEvent("share_link_opened" as never, VALID_PROPERTIES.share_link_opened as never, { actor: { userId: USER } })).resolves.toBe("invalid")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("never makes the action fail when PostHog cannot be reached", async () => {
    const server = await load()
    fetchMock.mockRejectedValueOnce(new Error("offline"))
    const properties = server.availabilityReconfirmedProperties({ confirmed: 1, organizationId: HAULER_ORG, signedIn: true, via: "in_app" })

    await expect(server.captureProductEvent("availability_reconfirmed", properties, { actor: { userId: USER } })).resolves.toBe("sent")
  })

  it("clamps the availability count to the schema's range", async () => {
    const server = await load()

    expect(server.availabilityReconfirmedProperties({ confirmed: 999, organizationId: HAULER_ORG, signedIn: true, via: "in_app" }).truck_types).toBe(200)
    expect(server.availabilityReconfirmedProperties({ confirmed: -3, organizationId: HAULER_ORG, signedIn: true, via: "in_app" }).truck_types).toBe(0)
  })
})

describe("pseudonymousId", () => {
  it("is stable, kind-separated and case-insensitive, and never contains the raw id", async () => {
    const { pseudonymousId } = await load()

    expect(pseudonymousId("user", USER)).toBe(pseudonymousId("user", USER.toUpperCase()))
    expect(pseudonymousId("user", USER)).not.toBe(pseudonymousId("organization", USER))
    expect(pseudonymousId("user", USER)).toMatch(/^u_[0-9a-f]{32}$/)
    expect(pseudonymousId("organization", LANDING_ORG)).toMatch(/^o_[0-9a-f]{32}$/)
    expect(pseudonymousId("interest", INTEREST_ID)).toMatch(/^i_[0-9a-f]{32}$/)
    expect(pseudonymousId("user", USER)).not.toContain(USER.slice(0, 8))
  })
})
