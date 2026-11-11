import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { attestAvailability, MARKETPLACE_AVAILABILITY_ATTESTATION, marketplaceJobDraftSchema, marketplaceV2FeatureSupport } from "@logloads/contracts"

import { createNormalizedMarketplaceV2 } from "../normalized-adapter"
import {
  marketplaceCallStatement,
  type MarketplaceCalls,
  type MarketplaceDb,
  type MarketplaceFunctionName,
  type MarketplacePrincipal
} from "../normalized-db"
import { MARKETPLACE_QUERIES, marketplaceQueryStatement, type MarketplaceQueryName } from "../normalized-queries"
import { MarketplaceRefusalError, MarketplaceStoreError, type MarketplaceV2Viewer } from "../port"
import { jobsStoreFromCalls, ownJobStatementsFromCalls, type OwnJobStatements } from "./calls"
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
let queried: Array<{ name: MarketplaceQueryName; values: Array<string | null>; readOnly: boolean | undefined }>
let queryRows: Partial<Record<MarketplaceQueryName, unknown[]>>

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
  boost: null,
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
    async query(name, values) {
      // The real catalogue binds the values, so a wrong count or type fails here as it would against the database.
      queried.push({ name, readOnly, values: marketplaceQueryStatement(name, values).values })
      return queryRows[name] ?? []
    },
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
  queried = []
  queryRows = {}
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

describe("the own-job statements (#247)", () => {
  const draft = marketplaceJobDraftSchema.parse({
    description: "Fir and hemlock.",
    durationDays: "35",
    equipment: ["log_truck", "pole_trailer"],
    landingId: LANDING,
    payAmount: "525",
    payUnit: "per_load",
    product: "Saw logs",
    startsOn: "2026-11-16",
    title: "North unit saw logs",
    trucksRequested: "6"
  })
  const wired = () => createNormalizedMarketplaceV2({ db: fakeDb(), now: () => NOW, principal: async () => PRINCIPAL })
  const ownRow = (status: string) => ({ ...publicRow(status), ...facts })

  it("turns the jobs group on in the adapter", () => {
    expect(wired().supports).toEqual(marketplaceV2FeatureSupport(["billing", "jobs"]))
  })

  it("locks the job, reads it and closes it, in one write transaction as the person", async () => {
    queryRows = { own_job_lock: [{ id: JOB }], own_jobs: [ownRow("active")] }

    await wired().setJobStatus(viewer, JOB, "closed")

    expect(queried).toEqual([
      { name: "own_job_lock", readOnly: false, values: [ORG, JOB] },
      { name: "own_jobs", readOnly: false, values: [ORG, JOB] }
    ])
    expect(recorded.map((entry) => entry.fn)).toEqual(["get_viewer_marketplace_access", "set_job_posting_status"])
  })

  it("reads nothing more and writes nothing when the lock finds no job of the business", async () => {
    queryRows = { own_jobs: [ownRow("active")] }

    await expect(wired().setJobStatus(viewer, JOB, "closed")).rejects.toBeInstanceOf(MarketplaceRefusalError)
    expect(queried.map((entry) => entry.name)).toEqual(["own_job_lock"])
    expect(recorded.map((entry) => entry.fn)).toEqual(["get_viewer_marketplace_access"])
  })

  it("lists the business's jobs read-only, without a lock", async () => {
    queryRows = { own_jobs: [ownRow("paused")] }

    const jobs = await wired().listOwnJobs(viewer)

    expect(jobs.map((job) => [job.job.id, job.job.status, job.landing.name])).toEqual([[JOB, "paused", "North landing"]])
    expect(queried).toEqual([{ name: "own_jobs", readOnly: true, values: [ORG, null] }])
  })

  it("saves an edit with the values publishing stores, and its new updated_at", async () => {
    const calls = { query: async (name: MarketplaceQueryName, values: readonly unknown[]) => {
      queried.push({ name, readOnly: false, values: marketplaceQueryStatement(name, values as never).values })
      return [{ id: JOB, updated_at: "2026-11-11T09:30:00+00:00" }]
    } } as unknown as MarketplaceCalls

    await expect(ownJobStatementsFromCalls(calls).editTerms(ORG, JOB, draft)).resolves.toEqual({ lastModifiedAt: "2026-11-11T09:30:00.000Z" })
    expect(queried[0]).toEqual({
      name: "own_job_edit",
      readOnly: false,
      values: [
        ORG, JOB, "North unit saw logs", "Fir and hemlock.", "Saw logs", null, null, null, null, null,
        "52500", "per_load", null, null, "6", null, "2026-11-16", "35", JSON.stringify(["log_truck", "pole_trailer"])
      ]
    })
  })

  it("reports an edit that changed no row as null, and a row of another job as a store error", async () => {
    const answering = (rows: unknown[]) => ({ query: async () => rows } as unknown as MarketplaceCalls)

    await expect(ownJobStatementsFromCalls(answering([])).editTerms(ORG, JOB, draft)).resolves.toBeNull()
    await expect(ownJobStatementsFromCalls(answering([{ id: "66666666-0000-4000-8000-000000000002", updated_at: "2026-11-11T09:30:00+00:00" }])).editTerms(ORG, JOB, draft))
      .rejects.toBeInstanceOf(MarketplaceStoreError)
  })

  it("never locks more than one job", async () => {
    await expect(ownJobStatementsFromCalls({ query: async () => [] } as unknown as MarketplaceCalls).ownJobs(ORG, { jobId: null, lock: true }))
      .rejects.toThrow(TypeError)
  })

  it("keeps each statement to the person's role, landings and business, and never writes the landing, status or confirmation", () => {
    for (const name of ["own_jobs", "own_job_lock", "own_job_edit"] as const) {
      const { text } = MARKETPLACE_QUERIES[name]

      expect(text, name).toContain("marketplace.has_org_role(j.org_id, array['owner', 'manager', 'staff']::text[], true)")
      expect(text, name).toContain("marketplace.landing_scope_allows(j.org_id, j.landing_id)")
      expect(text, name).toContain("j.org_id = $1::text::uuid")
    }

    const edit = MARKETPLACE_QUERIES.own_job_edit.text
    expect(edit).not.toMatch(/\b(landing_id|status|last_confirmed_at|last_confirmed_by|published_at)\s*=(?!=)/)
    expect(edit).toContain("j.status <> 'draft'")
    expect(MARKETPLACE_QUERIES.own_job_lock.text).toMatch(/for update\)/)
  })
})
