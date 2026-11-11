import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { alertsCatalogueReady, normalizedAlerts } from "./index"
import { savedJobFromRow, savedJobSearchFromRow } from "./mapping"
import { alertMethods, createAlertUnsubscribeToken, unsubscribeAlert } from "./methods"
import { ALERT_STATEMENTS, ALERT_STATEMENT_NAMES, alertStatement, type AlertStatementName } from "./statements"
import { createNormalizedMarketplaceV2, type NormalizedFeatureContext } from "../normalized-adapter"
import type { MarketplaceCalls, MarketplaceDb, MarketplacePrincipal } from "../normalized-db"
import {
  MarketplaceFeatureUnavailableError,
  MarketplaceRefusalError,
  MarketplaceStoreError,
  type MarketplaceV2Viewer
} from "../port"

const EMAIL = "hauler@example.com"
const SECRET = "test-unsubscribe-secret"
const CLERK = "user_clerk_hauler"
const OTHER_CLERK = "user_clerk_other"
const STORE_USER = "55555555-dddd-4ddd-8ddd-dddddddddddd"
const ORG = "33333333-bbbb-4bbb-8bbb-333333333333"
const OTHER_ORG = "44444444-cccc-4ccc-8ccc-cccccccccccc"
const JOB = "11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const SEARCH = "22222222-bbbb-4bbb-8bbb-222222222222"
const NOW = new Date("2026-11-10T12:00:00.000Z")
const PRINCIPAL: MarketplacePrincipal = { audience: "logloads-test-audience", issuer: "https://clerk.logloads.test", subject: CLERK }

const viewer: MarketplaceV2Viewer = { organizationId: ORG, userId: CLERK }
const other: MarketplaceV2Viewer = { organizationId: OTHER_ORG, userId: OTHER_CLERK }

interface Recorded { kind: "call" | "query"; name: string; args: unknown; readOnly?: boolean }

let recorded: Recorded[]
let calls: Record<string, unknown[]>
let queries: Record<string, unknown[]>
let failure: { name: string; error: Error } | null
let principal: ReturnType<typeof vi.fn>
let context: NormalizedFeatureContext

function postgresError(message: string, code: string): Error {
  return Object.assign(new Error(message), { code, severity: "ERROR" })
}

function fakeDb(): MarketplaceDb {
  const api = (readOnly?: boolean): MarketplaceCalls => ({
    async call(fn, args) {
      recorded.push({ args, kind: "call", name: fn, readOnly })
      if (failure?.name === fn) throw failure.error
      return calls[fn] ?? []
    },
    fileListingReport: async () => { throw new Error("not used") },
    inquiryJobs: async () => [],
    inquiryParties: async () => null,
    landingStatement: async () => [],
    async query(name, values) {
      recorded.push({ args: values, kind: "query", name, readOnly })
      if (failure?.name === name) throw failure.error
      return queries[name] ?? []
    },
    standingListingReport: async () => null,
    viewerSession: async () => ({ memberships: [], person: null })
  })

  return {
    asAnon: async (work) => work(api()),
    asUser: async (_principal, work, options) => work(api(options?.readOnly)),
    close: async () => undefined
  }
}

function useAdapter(): ReturnType<typeof createNormalizedMarketplaceV2> {
  return createNormalizedMarketplaceV2({
    db: fakeDb(),
    features: {
      alerts: {
        methods: (given) => {
          context = given
          return alertMethods(given)
        },
        supported: false
      }
    },
    now: () => NOW,
    principal: principal as never
  })
}

function openJob(overrides: Record<string, unknown> = {}) {
  return {
    availability: "open",
    ends_on: "2026-11-20",
    job_id: JOB,
    last_confirmed_at: "2026-11-01T15:00:00+00:00",
    last_modified_at: "2026-11-02T15:00:00+00:00",
    origin_label: "Sweet Home",
    origin_state_code: "OR ",
    pay_amount_cents: 52500,
    pay_note: null,
    pay_unit: "per_load",
    poster_name: "Cedar Landing",
    saved_at: "2026-11-03T15:00:00+00:00",
    starts_on: "2026-11-12",
    title: "Fir haul",
    trucks_total: 2,
    ...overrides
  }
}

beforeEach(() => {
  recorded = []
  calls = {}
  queries = {}
  failure = null
  principal = vi.fn(async (candidate: MarketplaceV2Viewer) => {
    if (candidate.userId !== CLERK && candidate.userId !== OTHER_CLERK) {
      throw new MarketplaceRefusalError("This business is not available to your account.", "42501")
    }
    return PRINCIPAL
  })
  useAdapter()
})

describe("alert statements", () => {
  it("binds every value and never selects an email address", () => {
    const texts = ALERT_STATEMENT_NAMES.map((name) => ALERT_STATEMENTS[name].text).join("\n")

    expect(texts).not.toMatch(/user_contacts|delivery_address|email/i)

    for (const name of ALERT_STATEMENT_NAMES) {
      const bound = alertStatement(name, Array.from({ length: ALERT_STATEMENTS[name].params }, () => ORG))

      expect(bound.text).not.toContain(ORG)
      expect(bound.values).toEqual(Array.from({ length: ALERT_STATEMENTS[name].params }, () => ORG))
    }

    expect(() => alertStatement("alert_save_job", [ORG])).toThrow(TypeError)
  })

  it("scopes signed-in writes to the session and leaves unsubscribe independent of a session", () => {
    const save = ALERT_STATEMENTS.alert_save_job.text
    const insert = ALERT_STATEMENTS.alert_insert_job_search.text
    const update = ALERT_STATEMENTS.alert_update_job_search.text
    const setClause = update.slice(update.indexOf("set"), update.indexOf("where"))

    expect(save).toMatch(/insert into marketplace\.saved_jobs \(org_id, job_id\)/)
    expect(save).toContain("on conflict (user_id, org_id, job_id) do nothing")
    expect(save).not.toContain("current_user_id()")
    expect(insert).toMatch(/insert into marketplace\.saved_searches \(org_id, kind, name, criteria, alerts_enabled\)/)
    expect(insert).toContain("'jobs'")
    expect(insert).not.toContain("owner_user_id")
    expect(setClause).toContain("name")
    expect(setClause).toContain("criteria")
    expect(setClause).toContain("alerts_enabled")
    expect(setClause).not.toContain("owner_user_id")
    expect(setClause).not.toContain("updated_at")
    expect(update).toContain("owner_user_id = marketplace.current_user_id()")
    expect(update).toContain("kind = 'jobs'")

    const sessionScoped: AlertStatementName[] = [
      "alert_unsave_job",
      "alert_list_job_searches",
      "alert_delete_job_search",
      "alert_list_notification_preferences",
      "alert_set_notification_preference",
      "alert_viewer_user"
    ]

    for (const name of sessionScoped) {
      expect(ALERT_STATEMENTS[name].text, name).toContain("marketplace.current_user_id()")
    }

    expect(ALERT_STATEMENTS.alert_unsubscribe_notification.text).not.toContain("current_user_id()")
    expect(ALERT_STATEMENTS.alert_unsubscribe_notification.text).toContain("set enabled = false")
    expect(ALERT_STATEMENTS.alert_viewer_user.text).not.toContain("display_name")
  })
})

describe("saved job and search rows", () => {
  it("maps an open job's public fields and drops them once the job is unavailable", () => {
    expect(savedJobFromRow(openJob())).toEqual({
      availability: "open",
      endsOn: "2026-11-20",
      jobId: JOB,
      lastConfirmedAt: "2026-11-01T15:00:00.000Z",
      lastModifiedAt: "2026-11-02T15:00:00.000Z",
      origin: { label: "Sweet Home", stateCode: "OR" },
      pay: { amountCents: 52500, note: null, unit: "per_load" },
      posterName: "Cedar Landing",
      savedAt: "2026-11-03T15:00:00.000Z",
      startsOn: "2026-11-12",
      title: "Fir haul",
      trucksTotal: 2
    })

    const hidden = savedJobFromRow(openJob({
      availability: "unavailable",
      origin_label: "Secret ridge",
      poster_name: "Hidden",
      title: `Private haul for ${EMAIL}`
    }))

    expect(hidden.title).toBeNull()
    expect(hidden.posterName).toBeNull()
    expect(hidden.pay).toBeNull()
    expect(hidden.origin).toBeNull()
    expect(JSON.stringify(hidden)).not.toContain(EMAIL)
    expect(() => savedJobFromRow(openJob({ availability: "open", extra: true }))).toThrow(MarketplaceStoreError)
  })

  it("refuses a saved search whose criteria carry an email address", () => {
    expect(savedJobSearchFromRow({
      alerts_enabled: true,
      criteria: { equipment: [], place: "Sweet Home", radiusMiles: 50, stateCode: "OR" },
      id: SEARCH,
      kind: "jobs",
      last_alerted_at: null,
      name: "Fir",
      updated_at: "2026-11-03T15:00:00+00:00"
    })).toMatchObject({ alertsEnabled: true, id: SEARCH, kind: "jobs", name: "Fir" })

    expect(() => savedJobSearchFromRow({
      alerts_enabled: false,
      criteria: { email: EMAIL, equipment: [], place: null, radiusMiles: null, stateCode: null },
      id: SEARCH,
      kind: "jobs",
      last_alerted_at: null,
      name: "Fir",
      updated_at: "2026-11-03T15:00:00+00:00"
    })).toThrow(MarketplaceStoreError)
  })
})

describe("alert methods are scoped to the signed-in person and the active business", () => {
  it("reads saved jobs for the active business only, as the session, without the session subject", async () => {
    calls.list_saved_jobs = [openJob()]
    const port = useAdapter()

    await expect(port.listSavedJobs(viewer)).resolves.toMatchObject([{ jobId: JOB, title: "Fir haul" }])
    await port.listSavedJobs(other)

    expect(recorded.map((entry) => entry.args)).toEqual([{ p_org_id: ORG }, { p_org_id: OTHER_ORG }])
    expect(recorded.every((entry) => entry.kind === "call" && entry.name === "list_saved_jobs" && entry.readOnly === true)).toBe(true)
    expect(JSON.stringify(recorded)).not.toContain(CLERK)
    expect(principal).toHaveBeenCalledWith(viewer)
  })

  it("saves and removes a job with one idempotent statement for the active business", async () => {
    const port = useAdapter()

    await port.saveJob(viewer, JOB)
    await port.saveJob(viewer, JOB)
    await port.unsaveJob(viewer, JOB)

    expect(recorded.map((entry) => [entry.name, entry.args, entry.readOnly])).toEqual([
      ["alert_save_job", [ORG, JOB], false],
      ["alert_save_job", [ORG, JOB], false],
      ["alert_unsave_job", [ORG, JOB], false]
    ])
    expect(JSON.stringify(recorded)).not.toContain(CLERK)
  })

  it("refuses a bad job id before the store, and surfaces the store's own refusal without a table name", async () => {
    const port = useAdapter()

    await expect(port.saveJob(viewer, "not-a-job")).rejects.toMatchObject({ code: "22023", message: "That job was not found." })
    expect(recorded).toEqual([])
    expect(principal).not.toHaveBeenCalled()

    failure = { error: postgresError("You cannot save your own organization's job", "23514"), name: "alert_save_job" }
    await expect(port.saveJob(viewer, JOB)).rejects.toMatchObject({ code: "23514", message: "You cannot save your own organization's job" })

    failure = { error: postgresError("permission denied for table saved_jobs", "42501"), name: "alert_save_job" }
    const denied = port.saveJob(viewer, JOB)
    await expect(denied).rejects.toBeInstanceOf(MarketplaceRefusalError)
    await expect(denied).rejects.toMatchObject({ message: "This is not available to your account." })
    await expect(denied).rejects.not.toThrow("saved_jobs")
  })

  it("does not reach the store when the session rejects the viewer", async () => {
    const port = useAdapter()

    await expect(port.listSavedJobs({ organizationId: ORG, userId: "user_someone_else" })).rejects.toBeInstanceOf(MarketplaceRefusalError)
    expect(recorded).toEqual([])
  })

  it("lists, saves and deletes only the caller's job searches", async () => {
    queries.alert_list_job_searches = [{
      alerts_enabled: false,
      criteria: { equipment: ["log_truck"], place: null, radiusMiles: null, stateCode: null },
      id: SEARCH,
      kind: "jobs",
      last_alerted_at: null,
      name: "Fir",
      updated_at: "2026-11-03T15:00:00+00:00"
    }]
    queries.alert_insert_job_search = [{ id: SEARCH }]
    queries.alert_update_job_search = [{ id: SEARCH }]
    const port = useAdapter()

    await expect(port.listJobSearches(viewer)).resolves.toMatchObject([{ id: SEARCH, kind: "jobs" }])
    await expect(port.saveJobSearch(viewer, {
      alertsEnabled: true,
      criteria: { equipment: ["log_truck"] },
      name: "Fir"
    })).resolves.toEqual({ searchId: SEARCH })
    await expect(port.saveJobSearch(viewer, {
      alertsEnabled: false,
      criteria: {},
      name: "Fir",
      searchId: SEARCH
    })).resolves.toEqual({ searchId: SEARCH })
    await port.deleteJobSearch(viewer, SEARCH)

    expect(recorded[0]).toMatchObject({ name: "alert_list_job_searches", readOnly: true })
    expect(recorded[1]).toMatchObject({ args: [ORG, "Fir", expect.stringContaining("log_truck"), "true"], name: "alert_insert_job_search", readOnly: false })
    expect(recorded[2]).toMatchObject({ args: [SEARCH, ORG, "Fir", expect.any(String), "false"], name: "alert_update_job_search" })
    expect(recorded[3]).toMatchObject({ args: [SEARCH, ORG], name: "alert_delete_job_search" })
    expect(JSON.stringify(recorded[1]?.args)).not.toContain("trucks")
    expect(JSON.stringify(recorded)).not.toContain(CLERK)
  })

  it("reports a missing search as not found and does not say whose it was", async () => {
    const port = useAdapter()
    const missing = port.saveJobSearch(other, { alertsEnabled: false, criteria: {}, name: "Gone", searchId: SEARCH })

    await expect(missing).rejects.toMatchObject({ code: "P0002", message: "That saved search was not found." })
    expect(JSON.stringify(recorded)).toContain(OTHER_ORG)
    expect(JSON.stringify(recorded)).not.toContain(OTHER_CLERK)
    expect(JSON.stringify(recorded)).not.toContain(EMAIL)
  })

  it("lists every preference, unset ones off, and writes only the active business", async () => {
    queries.alert_list_notification_preferences = [{
      category: "job_alert",
      channel: "email",
      enabled: true,
      updated_at: "2026-11-02T00:00:00+00:00"
    }]
    const port = useAdapter()
    const listed = await port.notificationPreferences(viewer)

    expect(listed).toHaveLength(6)
    expect(listed.find((row) => row.category === "job_alert" && row.channel === "email")).toMatchObject({ enabled: true })
    expect(listed.filter((row) => row.updatedAt === null)).toHaveLength(5)

    await port.setNotificationPreference(viewer, { category: "inquiry_reply", channel: "in_app", enabled: true })
    await expect(port.setNotificationPreference(viewer, { category: "job_alert", channel: "email", email: EMAIL, enabled: false })).rejects.toBeInstanceOf(MarketplaceRefusalError)

    expect(recorded.at(-1)).toMatchObject({
      args: [ORG, "inquiry_reply", "in_app", "true"],
      name: "alert_set_notification_preference",
      readOnly: false
    })
    expect(recorded.some((entry) => JSON.stringify(entry.args).includes(EMAIL))).toBe(false)
  })
})

describe("unsubscribe", () => {
  it("mints a link for the store's person in the active business, with no email in the token", async () => {
    queries.alert_viewer_user = [{ id: STORE_USER }]

    const { token } = await createAlertUnsubscribeToken(context, viewer, { category: "job_alert", channel: "email", enabled: false }, SECRET, NOW)
    const payload = JSON.parse(Buffer.from(token.split(".")[0] ?? "", "base64url").toString("utf8")) as Record<string, unknown>

    expect(Object.keys({ token })).toEqual(["token"])
    expect(token).not.toContain("@")
    expect(payload).toMatchObject({ c: "job_alert", h: "email", o: ORG, u: STORE_USER })
    expect(payload).not.toHaveProperty("email")
    expect(recorded).toEqual([{ args: [], kind: "query", name: "alert_viewer_user", readOnly: true }])
    expect(JSON.stringify(recorded)).not.toContain(CLERK)
  })

  it("refuses an email on the input, and a person row that carries one, before minting", async () => {
    await expect(createAlertUnsubscribeToken(context, viewer, {
      category: "job_alert",
      channel: "email",
      email: EMAIL,
      enabled: true
    }, SECRET, NOW)).rejects.toBeInstanceOf(MarketplaceRefusalError)
    expect(recorded).toEqual([])

    queries.alert_viewer_user = [{ email: EMAIL, id: STORE_USER }]
    const leaked = createAlertUnsubscribeToken(context, viewer, { category: "job_alert", channel: "email", enabled: true }, SECRET, NOW)

    await expect(leaked).rejects.toBeInstanceOf(MarketplaceStoreError)
    await expect(leaked).rejects.not.toThrow(EMAIL)
  })

  it("turns the preference off without a viewer, and does nothing when the token is tampered or expired", async () => {
    queries.alert_viewer_user = [{ id: STORE_USER }]
    const { token } = await createAlertUnsubscribeToken(context, viewer, { category: "targeted_invitation", channel: "email", enabled: true }, SECRET, NOW)
    const ran: Array<{ text: string; values: Array<string | null> }> = []
    recorded = []

    const result = await unsubscribeAlert(token, SECRET, NOW, async (bound) => { ran.push(bound) })
    const flipped = `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`
    const tampered = await unsubscribeAlert(flipped, SECRET, NOW, async (bound) => { ran.push(bound) })
    const expired = await unsubscribeAlert(token, SECRET, new Date(NOW.getTime() + 91 * 24 * 60 * 60 * 1000), async (bound) => { ran.push(bound) })

    expect(result).toEqual({ outcome: "unsubscribed" })
    expect(Object.keys(result)).toEqual(["outcome"])
    expect(JSON.stringify(result)).not.toContain(EMAIL)
    expect(JSON.stringify(result)).not.toContain(STORE_USER)
    expect(tampered).toEqual({ outcome: "invalid" })
    expect(expired).toEqual({ outcome: "expired" })
    expect(ran).toHaveLength(1)
    expect(ran[0]?.text).not.toContain("current_user_id()")
    expect(ran[0]?.text).not.toMatch(/email/i)
    expect(ran[0]?.values).toEqual([STORE_USER, ORG, "targeted_invitation", "email"])
    expect(recorded).toEqual([])
  })
})

describe("the port stays refused until the catalogues name these statements", () => {
  it("is not supported yet, and a port call reaches no store", async () => {
    expect(alertsCatalogueReady()).toBe(false)
    expect(normalizedAlerts.supported).toBe(false)

    const port = createNormalizedMarketplaceV2({ db: fakeDb(), now: () => NOW, principal: principal as never })
    recorded = []
    principal.mockClear()

    await expect(port.listSavedJobs(viewer)).rejects.toBeInstanceOf(MarketplaceFeatureUnavailableError)
    await expect(port.saveJob(viewer, JOB)).rejects.toThrow("Saving a job is not available yet")
    expect(recorded).toEqual([])
    expect(principal).not.toHaveBeenCalled()
  })
})
