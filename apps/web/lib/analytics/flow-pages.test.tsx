import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * #330: the flow A and B timing beacons on their pages (docs/analytics/event-plan.md §6), rendered on the server with
 * the port and the session stubbed. The beacons are replaced by markers that show which ones a page renders and with
 * what props; what each beacon does in the browser is tested in beacons.test.tsx and flow-clock.test.ts.
 */

const mocks = vi.hoisted(() => ({
  authoringLandings: vi.fn(),
  getJob: vi.fn(),
  getSessionActor: vi.fn(),
  haulerEquipment: vi.fn(),
  haulerFleet: vi.fn(),
  interestForJob: vi.fn(),
  listHaulerInterests: vi.fn(),
  listJobs: vi.fn(),
  resolveV2Viewer: vi.fn(),
  viewerAccess: vi.fn()
}))

vi.mock("server-only", () => ({}))
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND")
  },
  redirect: (href: string) => {
    throw new Error(`NEXT_REDIRECT ${href}`)
  }
}))
vi.mock("@/lib/marketplace-v2/flag", () => ({ marketplaceV2Enabled: () => true }))
vi.mock("@/lib/session", () => ({ getSessionActor: mocks.getSessionActor }))
vi.mock("@/lib/marketplace-v2/viewer", () => ({
  resolveV2Viewer: mocks.resolveV2Viewer,
  withBusinessSwitchNote: (refusal: string) => refusal
}))
vi.mock("@/lib/marketplace-v2/actions", () => ({
  expressInterestAction: async () => undefined,
  publishJobAction: async () => undefined
}))
vi.mock("@/lib/marketplace-v2/report-actions", () => ({ reportListingAction: async () => ({ status: "idle" }) }))
vi.mock("@/lib/app-url", () => ({ resolvePublicAppUrl: () => "https://logloads.example" }))
vi.mock("@/lib/marketplace-v2/pilot-adapter", () => ({
  pilotMarketplaceV2: {
    authoringLandings: mocks.authoringLandings,
    getJob: mocks.getJob,
    haulerEquipment: mocks.haulerEquipment,
    haulerFleet: mocks.haulerFleet,
    interestForJob: mocks.interestForJob,
    listHaulerInterests: mocks.listHaulerInterests,
    listJobs: mocks.listJobs,
    supportsPublishing: true,
    viewerAccess: mocks.viewerAccess
  }
}))
vi.mock("@/lib/analytics/beacons", async () => {
  const { createElement } = await import("react")
  const marker = (beacon: string) => (props: Record<string, unknown>) =>
    createElement("i", {
      "data-beacon": beacon,
      "data-flow": String(props.flow),
      "data-job": String(props.jobId ?? ""),
      "data-step": String(props.step ?? "")
    })

  return {
    FlowClockStart: marker("start"),
    FlowClockStop: marker("stop"),
    FlowTapCounter: marker("taps"),
    ShareLinkOpenedBeacon: marker("share")
  }
})

import type { MarketplaceInterestView, MarketplaceJobDetailView } from "@logloads/contracts"

import NewJobPage from "@/app/v2/landing/jobs/new/page"
import JobPreviewPage from "@/app/v2/landing/jobs/preview/page"
import JobDetailPage from "@/app/v2/work/[jobId]/page"

const HAULER_ORG = "33333333-bbbb-4bbb-8bbb-333333333333"
const LANDING_ORG = "22222222-aaaa-4aaa-8aaa-222222222222"
const USER_ID = "55555555-dddd-4ddd-8ddd-555555555555"
const JOB_ID = "11111111-1111-4111-8111-111111111111"
const INTEREST_ID = "66666666-6666-4666-8666-666666666666"
const LANDING_ID = "77777777-7777-4777-8777-777777777777"

const COMPLETE_DRAFT = {
  durationDays: "10",
  equipment: "log_truck",
  landingId: LANDING_ID,
  payAmount: "525",
  payUnit: "per_load",
  product: "Saw logs",
  startsOn: "2026-11-30",
  title: "Oak saw logs to Cascade Mill",
  trucksRequested: "4"
}

function job(): MarketplaceJobDetailView {
  return {
    acceptingInterest: true,
    destinationLabel: "Example mill · Riverton, OR",
    endsOn: "2026-12-30",
    equipment: ["log_truck"],
    estimatedDailyLoads: null,
    estimatedLoadsPerTruckPerDay: null,
    estimatedTonsPerLoad: null,
    expiresAt: null,
    haulDistance: null,
    id: JOB_ID,
    lastConfirmedAt: null,
    lastModifiedAt: "2026-11-01T09:00:00.000Z",
    origin: { approximatePoint: null, label: "Riverton, OR", stateCode: "OR" },
    pay: { amountCents: 52_500, note: null, unit: "per_load" },
    posterName: "Example Timber Co",
    posterOrganizationId: LANDING_ORG,
    posterVerification: null,
    product: "Saw logs",
    publicAccessRequirements: [],
    publicRoadNotes: null,
    scheduleNote: null,
    slug: JOB_ID,
    sponsored: false,
    startsOn: "2026-11-30",
    status: "active",
    title: "Saw logs to the river mill",
    trucks: { perDay: 3, total: 6 }
  }
}

function standingInterest(): MarketplaceInterestView {
  return {
    availableFrom: "2026-11-30",
    availableUntil: null,
    contactPreference: "in_app",
    createdAt: "2026-11-04T18:00:00.000Z",
    equipment: [],
    haulerOrganization: { id: HAULER_ORG, name: "Example Hauling LLC", type: "hauler" },
    id: INTEREST_ID,
    job: { acceptingInterest: true, id: JOB_ID, slug: JOB_ID, status: "active", title: "Saw logs to the river mill" },
    landingOrganization: { id: LANDING_ORG, name: "Example Timber Co" },
    message: null,
    replies: [],
    status: "submitted",
    submittedBy: { name: "Sam Hauler", userId: USER_ID },
    trucksOffered: 2,
    updatedAt: "2026-11-04T18:00:00.000Z"
  }
}

function signedInFor(organizationId: string | null) {
  mocks.getSessionActor.mockResolvedValue(
    organizationId ? { activeOrganization: { id: organizationId }, memberships: [], profile: { id: USER_ID }, workspaceSelectionInvalid: false } : null
  )
  mocks.viewerAccess.mockResolvedValue(
    organizationId === HAULER_ORG
      ? { capabilities: ["interest.express"], organizationName: "Example Hauling LLC" }
      : { capabilities: ["job.publish", "inquiry.respond"], organizationName: "Example Timber Co" }
  )
}

/** The beacons a page rendered, as `kind flow step job` lines. */
function beacons(html: string): string[] {
  return [...html.matchAll(/<i data-beacon="([^"]+)" data-flow="([^"]*)" data-job="([^"]*)" data-step="([^"]*)"><\/i>/g)].map(
    ([, kind, flow, jobId, step]) => [kind, flow, step, jobId].filter(Boolean).join(" ")
  )
}

async function jobPage(query: Record<string, string> = {}) {
  return beacons(renderToStaticMarkup(await JobDetailPage({ params: Promise.resolve({ jobId: JOB_ID }), searchParams: Promise.resolve(query) })))
}

type SearchPage = (props: { searchParams: Promise<Record<string, string>> }) => Promise<React.ReactElement>

async function editorPage(page: SearchPage, query: Record<string, string> = {}) {
  return beacons(renderToStaticMarkup(await page({ searchParams: Promise.resolve(query) })))
}

beforeEach(() => {
  vi.clearAllMocks()
  // The app compiles JSX with the classic runtime under Vitest, as in v2-pages.test.tsx.
  vi.stubGlobal("React", React)
  signedInFor(HAULER_ORG)
  mocks.getJob.mockResolvedValue(job())
  mocks.interestForJob.mockResolvedValue(null)
  mocks.haulerEquipment.mockResolvedValue([])
  mocks.haulerFleet.mockResolvedValue(null)
  mocks.listHaulerInterests.mockResolvedValue([])
  mocks.listJobs.mockResolvedValue([])
  mocks.resolveV2Viewer.mockResolvedValue({
    access: { capabilities: ["job.publish"], organizationName: "Example Timber Co" },
    ok: true,
    viewer: { organizationId: LANDING_ORG, userId: USER_ID }
  })
  mocks.authoringLandings.mockResolvedValue([{ areaLabel: "Riverton, OR", id: LANDING_ID, name: "Landing 7", stateCode: "OR" }])
})

describe("flow A on the job page: a hauler sends interest", () => {
  it("counts taps while the interest sheet is open, and stops no clock", async () => {
    expect(await jobPage()).toEqual(["taps A"])
  })

  it("stops flow A's clock for this job on the sent answer, once the form has gone", async () => {
    mocks.interestForJob.mockResolvedValue(standingInterest())

    expect(await jobPage({ sent: "1" })).toEqual([`stop A first_send ${JOB_ID}`])
  })

  it("renders no flow A beacon for a hauler whose interest stands, for a person signed out, or for the poster", async () => {
    mocks.interestForJob.mockResolvedValue(standingInterest())
    expect(await jobPage()).toEqual([])

    signedInFor(null)
    expect(await jobPage({ sent: "1" })).toEqual([])

    signedInFor(LANDING_ORG)
    expect(await jobPage({ sent: "1" })).toEqual([])
  })
})

describe("flow B: a landing posts a job", () => {
  it("starts flow B's clock when the job editor opens, on every step", async () => {
    expect(await editorPage(NewJobPage)).toEqual(["start B"])
    expect(await editorPage(NewJobPage, { landingId: LANDING_ID, title: "Oak saw logs to Cascade Mill" })).toEqual(["start B"])
  })

  it("starts no clock where there is no editor: a role that cannot post, or no active landing", async () => {
    mocks.authoringLandings.mockResolvedValue([])
    expect(await editorPage(NewJobPage)).toEqual([])

    mocks.resolveV2Viewer.mockResolvedValue({ access: { capabilities: [], organizationName: "Example Timber Co" }, ok: true, viewer: { organizationId: LANDING_ORG, userId: USER_ID } })
    expect(await editorPage(NewJobPage)).toEqual([])
  })

  it("counts taps on the review step", async () => {
    expect(await editorPage(JobPreviewPage, COMPLETE_DRAFT)).toEqual(["taps B"])
  })

  it("stops flow B's clock on the poster's published answer, and only there", async () => {
    signedInFor(LANDING_ORG)
    expect(await jobPage({ published: "1" })).toEqual(["stop B published"])
    expect(await jobPage()).toEqual([])

    signedInFor(HAULER_ORG)
    expect(await jobPage({ published: "1" })).toEqual(["taps A"])
  })
})
