import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { attestAvailability, MARKETPLACE_AVAILABILITY_ATTESTATION } from "@logloads/contracts"

import { createNormalizedMarketplaceV2 } from "../normalized-adapter"
import {
  marketplaceCallStatement,
  type MarketplaceCalls,
  type MarketplaceDb,
  type MarketplaceFunctionName,
  type MarketplacePrincipal
} from "../normalized-db"
import { MarketplaceRefusalError, type MarketplaceV2Viewer } from "../port"
import { jobsStoreFromCalls, type OwnJobStatements } from "./calls"
import { storedOwnJob } from "./mapping"
import { CANNOT_MANAGE_JOBS, normalizedJobsMethods } from "./methods"

/**
 * The jobs group through the real normalized adapter (#247): its identity-bound transactions and the catalogued
 * functions (#269), over a fake database that records each statement exactly as it would be sent. The own-jobs
 * read and the edit are statements still to be catalogued, so the test supplies them.
 */

const ORG = "11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const OTHER_ORG = "22222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const LANDING = "33333333-cccc-4ccc-8ccc-cccccccccccc"
const JOB = "66666666-0000-4000-8000-000000000001"
const USER = "user_owner"
const PRINCIPAL: MarketplacePrincipal = { audience: "logloads-test-audience", issuer: "https://clerk.logloads.test", subject: "user_owner" }
const NOW = new Date("2026-11-10T12:00:00.000Z")
const viewer: MarketplaceV2Viewer = { organizationId: ORG, userId: USER }

interface Recorded {
  fn: MarketplaceFunctionName
  text: string
  values: Array<string | null>
  readOnly: boolean | undefined
}

let recorded: Recorded[]
let accessOrganization: string
let ownJobCalls: Array<{ organizationId: string; jobId: string | null; lock: boolean }>

const publicRow = (status: string) => ({
  accepting_interest: status === "active",
  description: null,
  destination_label: null,
  duration_days: 35,
  ends_on: "2026-12-20",
  equipment_codes: ["log_truck"],
  est_one_way_miles: null,
  estimated_daily_loads: null,
  estimated_loads_per_truck_per_day: null,
  estimated_tons_per_load: null,
  expires_at: null,
  job_id: JOB,
  last_confirmed_at: "2026-11-09T12:00:00+00:00",
  last_modified_at: "2026-11-09T12:00:00+00:00",
  origin_label: "Oakridge, OR",
  origin_lat: 43.7,
  origin_lng: -122.5,
  origin_state_code: "OR",
  pay_amount_cents: 52_500,
  pay_note: null,
  pay_unit: "per_load",
  poster_name: "Mill Creek Timber",
  poster_organization_id: ORG,
  poster_verified: false,
  product: "Saw logs",
  public_access_requirements: [],
  public_road_notes: null,
  schedule_note: null,
  slug: JOB,
  sponsored: false,
  starts_on: "2026-11-16",
  status,
  title: "North unit saw logs",
  trucks_per_day: null,
  trucks_total: 6
})

const facts = {
  boost_active: null,
  boost_ends_at: null,
  boost_starts_at: null,
  created_at: "2026-11-01T08:00:00+00:00",
  invitations_delivered: 0,
  job_id: JOB,
  landing_id: LANDING,
  landing_name: "North landing"
}

let jobStatus: string

const statements: OwnJobStatements = {
  editTerms: async () => ({ lastModifiedAt: NOW.toISOString() }),
  ownJobs: async (organizationId, options) => {
    ownJobCalls.push({ organizationId, ...options })
    return organizationId === ORG ? [storedOwnJob(publicRow(jobStatus), facts)] : []
  }
}

function fakeDb(): MarketplaceDb {
  const calls = (readOnly: boolean | undefined): MarketplaceCalls => ({
    async call(fn, args) {
      // The real catalogue builds the statement, so an uncatalogued name or a wrong argument fails here.
      const { text, values } = marketplaceCallStatement(fn, args)
      recorded.push({ fn, readOnly, text, values })

      if (fn === "get_viewer_marketplace_access") {
        return [{
          capabilities: ["job.publish", "landing.manage", "inquiry.respond"],
          hauler_profile: false,
          landing_workspace_seat: true,
          organization_id: accessOrganization,
          organization_name: "Mill Creek Timber",
          role: "owner"
        }]
      }

      return []
    },
    fileListingReport: async () => {
      throw new Error("not used")
    },
    inquiryJobs: async () => [],
    inquiryParties: async () => null,
    landingStatement: async () => [],
    query: async () => [],
    standingListingReport: async () => null,
    viewerSession: async () => ({ memberships: [], person: null })
  })

  return {
    asAnon: async () => {
      throw new Error("the jobs group never runs anonymously")
    },
    asUser: async (_principal, work, options) => work(calls(options?.readOnly)),
    close: async () => undefined
  }
}

const port = () =>
  createNormalizedMarketplaceV2({
    db: fakeDb(),
    features: {
      jobs: { methods: (context) => normalizedJobsMethods(context, (calls) => jobsStoreFromCalls(calls, statements)), supported: false }
    },
    now: () => NOW,
    principal: async () => PRINCIPAL
  })

beforeEach(() => {
  recorded = []
  ownJobCalls = []
  accessOrganization = ORG
  jobStatus = "active"
})

describe("jobs store over the catalogued functions (#247, #269)", () => {
  it("closes a job with set_job_posting_status, in one write transaction as the person", async () => {
    await port().setJobStatus(viewer, JOB, "closed")

    expect(recorded.map((entry) => [entry.fn, entry.readOnly])).toEqual([
      ["get_viewer_marketplace_access", false],
      ["set_job_posting_status", false]
    ])
    expect(recorded[1]).toMatchObject({
      text: "select 1 as done from marketplace.set_job_posting_status(p_job_id => $1::text::uuid, p_status => $2::text) as r",
      values: [JOB, "closed"]
    })
    expect(ownJobCalls).toEqual([{ jobId: JOB, lock: true, organizationId: ORG }])
  })

  it("puts a paused job back with reactivate_job_posting and an explicit attestation", async () => {
    jobStatus = "paused"
    await port().resumeJob(viewer, JOB, attestAvailability(MARKETPLACE_AVAILABILITY_ATTESTATION.value, "reconfirm", NOW)!)

    expect(recorded.at(-1)).toMatchObject({
      fn: "reactivate_job_posting",
      readOnly: false,
      text: "select to_jsonb(marketplace.reactivate_job_posting(p_attest_available => $1::text::boolean, p_job_id => $2::text::uuid)) as value",
      values: ["true", JOB]
    })
  })

  it("reads the desk's inquiries read-only, for all jobs or for one", async () => {
    await port().listOwnJobs(viewer)
    await port().getOwnJob(viewer, JOB)

    const inquiries = recorded.filter((entry) => entry.fn === "list_marketplace_interests")
    expect(inquiries.map((entry) => [entry.readOnly, entry.values])).toEqual([
      [true, [ORG, "landing"]],
      [true, [JOB, ORG, "landing"]]
    ])
  })

  it("grants nothing from an access row of another business", async () => {
    accessOrganization = OTHER_ORG

    const outcome = await port().setJobStatus(viewer, JOB, "closed").then(() => null, (error: unknown) => error)
    expect(outcome).toBeInstanceOf(MarketplaceRefusalError)
    expect((outcome as Error).message).toBe(CANNOT_MANAGE_JOBS)
    expect(ownJobCalls).toEqual([])
    expect(recorded.map((entry) => entry.fn)).toEqual(["get_viewer_marketplace_access"])
  })

  it("writes nothing when the plan refuses", async () => {
    jobStatus = "closed"

    await expect(port().setJobStatus(viewer, JOB, "paused")).rejects.toBeInstanceOf(MarketplaceRefusalError)
    expect(recorded.map((entry) => entry.fn)).toEqual(["get_viewer_marketplace_access"])
  })
})
