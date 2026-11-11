import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import {
  attestAvailability,
  MARKETPLACE_AVAILABILITY_ATTESTATION,
  marketplaceJobDraftSchema,
  type MarketplaceCapability,
  type MarketplaceInterestView,
  type MarketplaceJobDetailView,
  type MarketplaceJobDraft,
  type MarketplaceJobStatus
} from "@logloads/contracts"
import {
  JOB_ALREADY_LISTED_REFUSAL,
  JOB_EXPIRED_REFUSAL,
  JOB_FILLED_REFUSAL,
  JOB_HELD_REFUSAL,
  JOB_LANDING_CHANGE_REFUSAL,
  JOB_PAUSE_REFUSAL
} from "@logloads/services"

import type { NormalizedFeatureContext } from "../normalized-adapter"
import type { MarketplaceCalls } from "../normalized-db"
import { MarketplaceRefusalError, type MarketplaceJobsPort, type MarketplaceV2Viewer } from "../port"
import {
  CANNOT_MANAGE_JOBS,
  DUPLICATE_NEEDS_EDIT,
  FIX_JOB_FIELDS,
  JOB_NOT_FOUND,
  JOB_STATUS_CHOICE,
  normalizedJobsMethods,
  RESUME_ATTESTATION_REQUIRED
} from "./methods"
import type { NormalizedJobsStore, StoredOwnJob } from "./store"

/**
 * The jobs group (#247) over a fake normalized store holding two businesses. The fake answers as the schema would for
 * the person in the transaction: their own business's jobs on landings in their scope (`own_jobs`, RLS and 26-B), and
 * it records every read and write. The SQL itself (set_job_posting_status, reactivate_job_posting, the catalogued
 * statements) runs against PostgreSQL 17 in CI once it is wired.
 */

const NOW = new Date("2026-11-10T12:00:00.000Z")
const DAY = 86_400_000
const iso = (offsetMs: number) => new Date(NOW.getTime() + offsetMs).toISOString()

const MILL = "11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const RIVAL = "22222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const NORTH = "33333333-cccc-4ccc-8ccc-cccccccccccc"
const SOUTH = "44444444-cccc-4ccc-8ccc-cccccccccccc"
const RIVAL_LANDING = "55555555-cccc-4ccc-8ccc-cccccccccccc"

const id = (n: number) => `66666666-0000-4000-8000-${String(n).padStart(12, "0")}`
const ACTIVE = id(1)
const PAUSED = id(2)
const FILLED = id(3)
const CLOSED = id(4)
const LAPSED = id(5)
const HELD = id(6)
const LEGACY = id(7)
const SOUTH_ACTIVE = id(8)
const RIVAL_JOB = id(9)
const MISSING = id(99)

interface Person {
  userId: string
  /** Business → role; a member limited to some landings lists them (membership_landing_scopes). */
  memberships: Record<string, { role: "owner" | "manager" | "staff" | "driver"; landings?: string[] }>
}

const people: Record<string, Person> = {
  bob: { memberships: { [RIVAL]: { role: "owner" } }, userId: "user_bob" },
  dana: { memberships: { [MILL]: { role: "driver" } }, userId: "user_dana" },
  // Owner of the mill and, separately, a member of the rival business: switching business stays a deliberate act.
  owner: { memberships: { [MILL]: { role: "owner" }, [RIVAL]: { role: "staff" } }, userId: "user_owner" },
  sam: { memberships: { [MILL]: { landings: [NORTH], role: "staff" } }, userId: "user_sam" }
}

const viewerOf = (person: keyof typeof people, organizationId = MILL): MarketplaceV2Viewer => ({ organizationId, userId: people[person]!.userId })

const baseDraft: MarketplaceJobDraft = marketplaceJobDraftSchema.parse({
  endsOn: "2026-12-20",
  equipment: ["log_truck"],
  landingId: NORTH,
  payAmount: "525",
  payUnit: "per_load",
  product: "Saw logs",
  startsOn: "2026-11-16",
  title: "North unit saw logs",
  trucksRequested: "6"
})

function publicJob(jobId: string, organizationId: string, status: MarketplaceJobStatus, overrides: Partial<MarketplaceJobDetailView> = {}): MarketplaceJobDetailView {
  return {
    acceptingInterest: status === "active",
    destinationLabel: null,
    endsOn: "2026-12-20",
    equipment: ["log_truck"],
    estimatedDailyLoads: null,
    estimatedLoadsPerTruckPerDay: null,
    estimatedTonsPerLoad: null,
    expiresAt: null,
    haulDistance: null,
    id: jobId,
    lastConfirmedAt: iso(-DAY),
    lastModifiedAt: iso(-DAY),
    origin: { approximatePoint: null, label: "Oakridge, OR", stateCode: "OR" },
    pay: { amountCents: 52_500, note: null, unit: "per_load" },
    posterName: organizationId === MILL ? "Mill Creek Timber" : "Rival Logging",
    posterOrganizationId: organizationId,
    posterVerification: null,
    product: "Saw logs",
    publicAccessRequirements: [],
    publicRoadNotes: null,
    scheduleNote: null,
    slug: jobId,
    sponsored: false,
    startsOn: "2026-11-16",
    status,
    title: "North unit saw logs",
    trucks: { perDay: null, total: 6 },
    ...overrides
  }
}

interface StoredJob {
  organizationId: string
  record: StoredOwnJob
}

let jobs: Map<string, StoredJob>
let interests: MarketplaceInterestView[]
let log: Array<{ op: string; args: unknown[]; userId: string }>
let transactions: Array<{ organizationId: string; readOnly: boolean; userId: string }>

function addJob(jobId: string, organizationId: string, landingId: string, status: MarketplaceJobStatus, options: {
  createdDaysAgo: number
  job?: Partial<MarketplaceJobDetailView>
  draft?: MarketplaceJobDraft | null
  hold?: boolean | null
}) {
  jobs.set(jobId, {
    organizationId,
    record: {
      boost: null,
      createdAt: iso(-options.createdDaysAgo * DAY),
      draft: options.draft === undefined ? { ...baseDraft, landingId } : options.draft,
      invitationsDelivered: 0,
      job: publicJob(jobId, organizationId, status, options.job),
      landing: { id: landingId, name: landingId === SOUTH ? "South landing" : landingId === NORTH ? "North landing" : "Rival landing" },
      moderationHold: options.hold === undefined ? false : options.hold
    }
  })
}

function interest(jobId: string, status: MarketplaceInterestView["status"], organizationId = MILL): MarketplaceInterestView {
  return {
    availableFrom: null,
    availableUntil: null,
    contactPreference: "in_app",
    createdAt: iso(-DAY),
    equipment: [],
    haulerOrganization: { id: "77777777-0000-4000-8000-000000000001", name: "Ridge Hauling", type: "hauler" },
    id: `88888888-0000-4000-8000-${String(interests.length + 1).padStart(12, "0")}`,
    job: { acceptingInterest: true, id: jobId, slug: jobId, status: "active", title: "North unit saw logs" },
    landingOrganization: { id: organizationId, name: "Mill Creek Timber" },
    message: null,
    replies: [],
    status,
    submittedBy: { name: "Ridge", userId: "99999999-0000-4000-8000-000000000001" },
    trucksOffered: 2,
    updatedAt: iso(-DAY)
  }
}

function personOf(userId: string): Person {
  const person = Object.values(people).find((candidate) => candidate.userId === userId)
  if (!person) throw new Error(`unknown person ${userId}`)
  return person
}

/** What the schema lets this person see and do: their own business's jobs on landings in their scope. */
function fakeStore(viewer: MarketplaceV2Viewer, leak = false): NormalizedJobsStore {
  const person = personOf(viewer.userId)
  const record = (op: string, ...args: unknown[]) => log.push({ args, op, userId: viewer.userId })
  const visible = (organizationId: string, job: StoredJob) => {
    const membership = person.memberships[organizationId]
    return (leak || job.organizationId === organizationId) && Boolean(membership) && membership!.role !== "driver" &&
      (!membership!.landings || membership!.landings.includes(job.record.landing.id))
  }

  return {
    async capabilities(organizationId) {
      record("capabilities", organizationId)
      const role = person.memberships[organizationId]?.role
      return (role && role !== "driver" ? ["job.publish", "inquiry.respond"] : []) as MarketplaceCapability[]
    },
    async editTerms(organizationId, jobId, draft) {
      record("editTerms", organizationId, jobId, draft)
      return jobs.has(jobId) ? { lastModifiedAt: NOW.toISOString() } : null
    },
    async landingInquiries(organizationId, jobId) {
      record("landingInquiries", organizationId, jobId)
      return interests.filter((item) => item.landingOrganization.id === organizationId && (jobId === null || item.job.id === jobId))
    },
    async ownJobs(organizationId, options) {
      record("ownJobs", organizationId, options)
      return [...jobs.values()]
        .filter((job) => visible(organizationId, job) && (options.jobId === null || job.record.job.id === options.jobId))
        .map((job) => structuredClone(job.record))
    },
    async reactivate(jobId) {
      record("reactivate", jobId)
    },
    async setStatus(jobId, status) {
      record("setStatus", jobId, status)
    }
  }
}

function methods(options: { leak?: boolean } = {}): MarketplaceJobsPort {
  const context: NormalizedFeatureContext = {
    asAccount: async () => {
      throw new Error("the jobs group never acts for no business")
    },
    asViewer: async (viewer, work, { readOnly }) => {
      transactions.push({ organizationId: viewer.organizationId, readOnly, userId: viewer.userId })
      return work({ viewer } as unknown as MarketplaceCalls)
    },
    now: () => NOW
  }

  return normalizedJobsMethods(context, (calls) => fakeStore((calls as unknown as { viewer: MarketplaceV2Viewer }).viewer, options.leak))
}

const writes = () => log.filter((entry) => ["editTerms", "reactivate", "setStatus"].includes(entry.op))
const reconfirmed = () => attestAvailability(MARKETPLACE_AVAILABILITY_ATTESTATION.value, "reconfirm", NOW)!

async function refusal(promise: Promise<unknown>): Promise<{ message: string; code: string | null }> {
  const error = await promise.then(() => null, (caught: unknown) => caught)
  expect(error).toBeInstanceOf(MarketplaceRefusalError)
  return { code: (error as MarketplaceRefusalError).code, message: (error as Error).message }
}

beforeEach(() => {
  jobs = new Map()
  interests = []
  log = []
  transactions = []

  addJob(ACTIVE, MILL, NORTH, "active", { createdDaysAgo: 1 })
  addJob(PAUSED, MILL, NORTH, "paused", { createdDaysAgo: 2 })
  addJob(FILLED, MILL, NORTH, "filled", { createdDaysAgo: 3 })
  addJob(CLOSED, MILL, NORTH, "closed", { createdDaysAgo: 4 })
  addJob(LAPSED, MILL, NORTH, "active", { createdDaysAgo: 40, job: { expiresAt: iso(-DAY) } })
  addJob(HELD, MILL, NORTH, "paused", { createdDaysAgo: 5, hold: true })
  addJob(LEGACY, MILL, NORTH, "paused", { createdDaysAgo: 400, draft: null, hold: null })
  addJob(SOUTH_ACTIVE, MILL, SOUTH, "active", { createdDaysAgo: 6, job: { title: "South unit pulpwood" } })
  addJob(RIVAL_JOB, RIVAL, RIVAL_LANDING, "active", { createdDaysAgo: 1 })
})

describe("listOwnJobs", () => {
  it("lists the business's own jobs in every status, newest first, with their inquiries", async () => {
    interests.push(interest(ACTIVE, "submitted"), interest(ACTIVE, "replied"), interest(PAUSED, "viewed"), interest(RIVAL_JOB, "submitted", RIVAL))

    const list = await methods().listOwnJobs(viewerOf("owner"))

    expect(list.map((view) => view.job.id)).toEqual([ACTIVE, PAUSED, FILLED, CLOSED, HELD, SOUTH_ACTIVE, LAPSED, LEGACY])
    expect(list.find((view) => view.job.id === ACTIVE)?.inquiries).toEqual({ awaitingReply: 1, total: 2 })
    expect(list.find((view) => view.job.id === PAUSED)?.inquiries).toEqual({ awaitingReply: 1, total: 1 })
    expect(list.find((view) => view.job.id === HELD)).toMatchObject({ landing: { id: NORTH, name: "North landing" }, moderationHold: true })
    expect(transactions).toEqual([{ organizationId: MILL, readOnly: true, userId: "user_owner" }])
    expect(writes()).toEqual([])
  })

  it("filters by status (expired by date too), landing and title", async () => {
    const port = methods()

    expect((await port.listOwnJobs(viewerOf("owner"), { status: "expired" })).map((view) => view.job.id)).toEqual([LAPSED])
    expect((await port.listOwnJobs(viewerOf("owner"), { landingId: SOUTH })).map((view) => view.job.id)).toEqual([SOUTH_ACTIVE])
    expect((await port.listOwnJobs(viewerOf("owner"), { query: "pulpwood" })).map((view) => view.job.id)).toEqual([SOUTH_ACTIVE])
    expect(await port.listOwnJobs(viewerOf("owner"), { landingId: RIVAL_LANDING })).toEqual([])
  })

  it("refuses malformed filters before reaching the store", async () => {
    expect((await refusal(methods().listOwnJobs(viewerOf("owner"), { status: "draft" } as never))).code).toBe("22023")
    expect((await refusal(methods().listOwnJobs(viewerOf("owner"), { sort: "oldest" } as never))).code).toBe("22023")
    expect(transactions).toEqual([])
  })

  it("shows a member limited to some landings only those landings' jobs", async () => {
    const ids = (await methods().listOwnJobs(viewerOf("sam"))).map((view) => view.job.id)

    expect(ids).not.toContain(SOUTH_ACTIVE)
    expect(ids).toContain(ACTIVE)
  })

  it("refuses a role without job.publish, and a person outside the business", async () => {
    expect(await refusal(methods().listOwnJobs(viewerOf("dana")))).toEqual({ code: "42501", message: CANNOT_MANAGE_JOBS })
    expect(await refusal(methods().listOwnJobs(viewerOf("bob", MILL)))).toEqual({ code: "42501", message: CANNOT_MANAGE_JOBS })
    expect(log.filter((entry) => entry.op === "ownJobs")).toEqual([])
  })
})

describe("getOwnJob", () => {
  it("returns one own job with its editable draft and inquiries", async () => {
    interests.push(interest(ACTIVE, "submitted"))

    const detail = await methods().getOwnJob(viewerOf("owner"), ACTIVE)

    expect(detail).toMatchObject({ draft: { landingId: NORTH, title: "North unit saw logs" }, inquiries: { awaitingReply: 1, total: 1 }, job: { id: ACTIVE } })
    expect(log.find((entry) => entry.op === "ownJobs")?.args).toEqual([MILL, { jobId: ACTIVE, lock: false }])
  })

  it("gives a legacy posting no draft rather than a guessed one", async () => {
    expect((await methods().getOwnJob(viewerOf("owner"), LEGACY))?.draft).toBeNull()
  })

  it("is null for a malformed id (no store call), another business's job, a missing job and a job outside the person's scope", async () => {
    const port = methods()

    expect(await port.getOwnJob(viewerOf("owner"), "not-a-uuid")).toBeNull()
    expect(transactions).toEqual([])
    expect(await port.getOwnJob(viewerOf("owner"), RIVAL_JOB)).toBeNull()
    expect(await port.getOwnJob(viewerOf("owner"), MISSING)).toBeNull()
    expect(await port.getOwnJob(viewerOf("sam"), SOUTH_ACTIVE)).toBeNull()
  })
})

describe("setJobStatus: pause, mark filled, close", () => {
  const changes: Array<[string, string, "paused" | "filled" | "closed"]> = [
    ["active → paused", ACTIVE, "paused"],
    ["active → filled", ACTIVE, "filled"],
    ["active → closed", ACTIVE, "closed"],
    ["paused → filled", PAUSED, "filled"],
    ["paused → closed", PAUSED, "closed"],
    ["filled → closed", FILLED, "closed"],
    ["expired → closed", LAPSED, "closed"],
    ["held and paused → closed", HELD, "closed"]
  ]

  it.each(changes)("%s writes set_job_posting_status once, in a write transaction, on the locked row", async (_label, jobId, status) => {
    await methods().setJobStatus(viewerOf("owner"), jobId, status)

    expect(writes()).toEqual([{ args: [jobId, status], op: "setStatus", userId: "user_owner" }])
    expect(log.find((entry) => entry.op === "ownJobs")?.args).toEqual([MILL, { jobId, lock: true }])
    expect(transactions).toEqual([{ organizationId: MILL, readOnly: false, userId: "user_owner" }])
  })

  it.each([
    [PAUSED, "paused"],
    [FILLED, "filled"],
    [CLOSED, "closed"]
  ] as const)("asking for the status a job already has writes nothing (a retried request is safe): %s", async (jobId, status) => {
    await methods().setJobStatus(viewerOf("owner"), jobId, status)
    expect(writes()).toEqual([])
  })

  it.each([
    [FILLED, "paused", JOB_PAUSE_REFUSAL],
    [CLOSED, "paused", JOB_PAUSE_REFUSAL],
    [CLOSED, "filled", JOB_FILLED_REFUSAL],
    [LAPSED, "paused", JOB_EXPIRED_REFUSAL],
    [LAPSED, "filled", JOB_EXPIRED_REFUSAL]
  ] as const)("refuses an invalid change before the store: %s → %s", async (jobId, status, message) => {
    expect(await refusal(methods().setJobStatus(viewerOf("owner"), jobId, status))).toEqual({ code: "23514", message })
    expect(writes()).toEqual([])
  })

  it("refuses a status that is not a stop status before reaching the store", async () => {
    for (const status of ["active", "expired", "draft", "archived"]) {
      expect(await refusal(methods().setJobStatus(viewerOf("owner"), ACTIVE, status as never))).toEqual({ code: "22023", message: JOB_STATUS_CHOICE })
    }

    expect(transactions).toEqual([])
  })
})

describe("resumeJob: back on the marketplace with a fresh attestation", () => {
  it.each([PAUSED, FILLED, CLOSED])("puts a stopped job back through reactivate_job_posting (%s)", async (jobId) => {
    await methods().resumeJob(viewerOf("owner"), jobId, reconfirmed())

    expect(writes()).toEqual([{ args: [jobId], op: "reactivate", userId: "user_owner" }])
    expect(log.find((entry) => entry.op === "ownJobs")?.args).toEqual([MILL, { jobId, lock: true }])
  })

  it("refuses without a fresh reconfirm attestation, before reaching the store", async () => {
    const stale = attestAvailability(MARKETPLACE_AVAILABILITY_ATTESTATION.value, "reconfirm", new Date(NOW.getTime() - 10 * 60_000))!
    const publish = attestAvailability(MARKETPLACE_AVAILABILITY_ATTESTATION.value, "publish", NOW)!

    for (const attestation of [null, stale, publish]) {
      expect(await refusal(methods().resumeJob(viewerOf("owner"), PAUSED, attestation as never))).toEqual({ code: "23514", message: RESUME_ATTESTATION_REQUIRED })
    }

    expect(transactions).toEqual([])
  })

  it.each([
    [ACTIVE, JOB_ALREADY_LISTED_REFUSAL],
    [LAPSED, JOB_EXPIRED_REFUSAL],
    [HELD, JOB_HELD_REFUSAL]
  ])("refuses %s without writing", async (jobId, message) => {
    expect(await refusal(methods().resumeJob(viewerOf("owner"), jobId, reconfirmed()))).toEqual({ code: "23514", message })
    expect(writes()).toEqual([])
  })

  it("leaves a hold the business cannot read to the store, which refuses a held job itself", async () => {
    await methods().resumeJob(viewerOf("owner"), LEGACY, reconfirmed())
    expect(writes().map((entry) => entry.op)).toEqual(["reactivate"])
  })
})

describe("editJob", () => {
  const changed = (changes: Record<string, unknown>) => marketplaceJobDraftSchema.parse({ ...baseDraft, ...changes })

  it("saves changed terms and names the material changes, for haulers to be told", async () => {
    const receipt = await methods().editJob(viewerOf("owner"), ACTIVE, changed({ description: "Fir only.", payAmount: "550", trucksRequested: "8" }))

    expect(receipt).toEqual({ jobId: ACTIVE, lastModifiedAt: NOW.toISOString(), materialChanges: ["pay", "trucks"] })
    expect(writes()).toMatchObject([{ args: [MILL, ACTIVE, { payAmount: 550, trucksRequested: 8 }], op: "editTerms" }])
  })

  it("writes nothing for the terms the job already has (a repeated save moves no timestamp)", async () => {
    const receipt = await methods().editJob(viewerOf("owner"), ACTIVE, changed({}))

    expect(receipt).toEqual({ jobId: ACTIVE, lastModifiedAt: iso(-DAY), materialChanges: [] })
    expect(writes()).toEqual([])
  })

  it("saves a legacy posting's first complete draft", async () => {
    await methods().editJob(viewerOf("owner"), LEGACY, changed({}))
    expect(writes().map((entry) => entry.op)).toEqual(["editTerms"])
  })

  it("keeps the job at its landing, and refuses an expired listing", async () => {
    expect(await refusal(methods().editJob(viewerOf("owner"), ACTIVE, changed({ landingId: SOUTH })))).toEqual({ code: "23514", message: JOB_LANDING_CHANGE_REFUSAL })
    expect(await refusal(methods().editJob(viewerOf("owner"), LAPSED, changed({})))).toEqual({ code: "23514", message: JOB_EXPIRED_REFUSAL })
    expect(writes()).toEqual([])
  })

  it("refuses a draft that would not publish, before reaching the store", async () => {
    const incomplete = { ...baseDraft, startsOn: undefined } as MarketplaceJobDraft
    const invalid = { ...baseDraft, title: "Call 541-555-0100" } as MarketplaceJobDraft

    for (const draft of [incomplete, invalid]) {
      expect(await refusal(methods().editJob(viewerOf("owner"), ACTIVE, draft))).toEqual({ code: "23514", message: FIX_JOB_FIELDS })
    }

    expect(transactions).toEqual([])
  })

  it("reports an edit statement that changed no row as not found", async () => {
    const store = fakeStore(viewerOf("owner"))
    store.editTerms = async () => null
    const port = normalizedJobsMethods(
      {
        asAccount: async () => {
          throw new Error("the jobs group never acts for no business")
        },
        asViewer: async (_viewer, work) => work({} as MarketplaceCalls),
        now: () => NOW
      },
      () => store
    )

    expect(await refusal(port.editJob(viewerOf("owner"), ACTIVE, changed({ payAmount: "600" })))).toEqual({ code: "P0002", message: JOB_NOT_FOUND })
  })
})

describe("duplicateJob", () => {
  it("returns a new draft with the dates cleared and saves nothing", async () => {
    const draft = await methods().duplicateJob(viewerOf("owner"), CLOSED)

    expect(draft).toMatchObject({ equipment: ["log_truck"], landingId: NORTH, payAmount: 525, title: "North unit saw logs" })
    expect(draft.startsOn).toBeUndefined()
    expect(draft.endsOn).toBeUndefined()
    expect(transactions).toEqual([{ organizationId: MILL, readOnly: true, userId: "user_owner" }])
    expect(writes()).toEqual([])
  })

  it("copies an expired listing, which is how its work is posted again", async () => {
    await expect(methods().duplicateJob(viewerOf("owner"), LAPSED)).resolves.toMatchObject({ title: "North unit saw logs" })
  })

  it("asks for an edit first when the stored terms cannot be read back", async () => {
    expect(await refusal(methods().duplicateJob(viewerOf("owner"), LEGACY))).toEqual({ code: "23514", message: DUPLICATE_NEEDS_EDIT })
  })
})

describe("one business can never touch another's jobs", () => {
  const attempts: Array<[string, (port: MarketplaceJobsPort, viewer: MarketplaceV2Viewer, jobId: string) => Promise<unknown>]> = [
    ["setJobStatus", (port, viewer, jobId) => port.setJobStatus(viewer, jobId, "closed")],
    ["resumeJob", (port, viewer, jobId) => port.resumeJob(viewer, jobId, reconfirmed())],
    ["editJob", (port, viewer, jobId) => port.editJob(viewer, jobId, { ...baseDraft, landingId: RIVAL_LANDING })],
    ["duplicateJob", (port, viewer, jobId) => port.duplicateJob(viewer, jobId)]
  ]

  it.each(attempts)("%s on another business's job is 'not found', exactly like a missing job, and writes nothing", async (_name, attempt) => {
    const foreign = await refusal(attempt(methods(), viewerOf("owner"), RIVAL_JOB))
    const missing = await refusal(attempt(methods(), viewerOf("owner"), MISSING))

    expect(foreign).toEqual({ code: "P0002", message: JOB_NOT_FOUND })
    expect(missing).toEqual(foreign)
    expect(writes()).toEqual([])
  })

  it.each(attempts)("%s reaches a job only through the ACTIVE business, even for a member of both", async (_name, attempt) => {
    // The owner of the mill is also staff at the rival business; acting for the mill never reaches the rival's job.
    expect((await refusal(attempt(methods(), viewerOf("owner", MILL), RIVAL_JOB))).code).toBe("P0002")
    expect(log.filter((entry) => entry.op === "ownJobs").every((entry) => entry.args[0] === MILL)).toBe(true)
    expect(writes()).toEqual([])
  })

  it.each(attempts)("%s ignores another business's row even if the store returned one", async (_name, attempt) => {
    expect((await refusal(attempt(methods({ leak: true }), viewerOf("owner"), RIVAL_JOB))).code).toBe("P0002")
    expect(writes()).toEqual([])
  })

  it("never lists another business's jobs, even if the store returned them", async () => {
    const ids = (await methods({ leak: true }).listOwnJobs(viewerOf("owner"))).map((view) => view.job.id)

    expect(ids).not.toContain(RIVAL_JOB)
    expect(ids).toContain(ACTIVE)
  })

  it.each(attempts)("%s refuses a member outside the job's landing scope as 'not found'", async (_name, attempt) => {
    expect((await refusal(attempt(methods(), viewerOf("sam"), SOUTH_ACTIVE))).code).toBe("P0002")
    expect(writes()).toEqual([])
  })

  it("refuses the rival's owner on the mill's job at the capability check", async () => {
    expect(await refusal(methods().setJobStatus(viewerOf("bob", MILL), ACTIVE, "closed"))).toEqual({ code: "42501", message: CANNOT_MANAGE_JOBS })
    expect(await refusal(methods().setJobStatus(viewerOf("bob", RIVAL), ACTIVE, "closed"))).toEqual({ code: "P0002", message: JOB_NOT_FOUND })
    expect(writes()).toEqual([])
  })
})
