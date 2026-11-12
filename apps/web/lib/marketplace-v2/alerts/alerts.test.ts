import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { MARKETPLACE_V2_FEATURES } from "@logloads/contracts"

import { normalizedAlerts } from "./index"
import { changedFromRow, savedJobFromRow, savedJobSearchFromRow } from "./mapping"
import { createAlertUnsubscribeToken, unsubscribeAlert } from "./methods"
import { ALERT_QUERY_NAMES, ALERT_UNSUBSCRIBE_STATEMENT, alertUnsubscribeStatement } from "./statements"
import { createNormalizedMarketplaceV2, type NormalizedFeatureContext } from "../normalized-adapter"
import { MARKETPLACE_FUNCTIONS, type MarketplaceCalls, type MarketplaceDb, type MarketplacePrincipal } from "../normalized-db"
import { MARKETPLACE_QUERIES, marketplaceQueryStatement, type MarketplaceQueryName } from "../normalized-queries"
import {
  MarketplaceRefusalError,
  MarketplaceStoreError,
  marketplaceV2FeatureMethods,
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
const NOT_AVAILABLE = "This is not available to your account."
/** The roles every alerts table's row-level security admits (`my_org_ids` in 02 and 26): any active member. */
const MEMBER_CHECK = "marketplace.has_org_role($1::text::uuid, array['owner', 'manager', 'staff', 'driver']::text[])"

const viewer: MarketplaceV2Viewer = { organizationId: ORG, userId: CLERK }
const other: MarketplaceV2Viewer = { organizationId: OTHER_ORG, userId: OTHER_CLERK }

/** What the store answers a member of the active business for each write: one row, saying whether anything changed. */
const MEMBER_WRITES: Partial<Record<MarketplaceQueryName, unknown[]>> = {
  alert_delete_job_search: [{ changed: true }],
  alert_save_job: [{ changed: true }],
  alert_set_notification_preference: [{ changed: true }],
  alert_unsave_job: [{ changed: true }]
}

interface Recorded { kind: "call" | "query"; name: string; args: unknown; readOnly?: boolean }

let recorded: Recorded[]
let calls: Record<string, unknown[]>
let queries: Partial<Record<MarketplaceQueryName, unknown[]>>
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
      // The real store binds through the same function, so a value of the wrong type or count never reaches SQL.
      const bound = marketplaceQueryStatement(name, values)
      recorded.push({ args: bound.values, kind: "query", name, readOnly })
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

/** The live adapter, with the alerts group as it ships. `context` is the one it hands the group. */
function useAdapter(): ReturnType<typeof createNormalizedMarketplaceV2> {
  return createNormalizedMarketplaceV2({
    db: fakeDb(),
    features: {
      alerts: {
        methods: (given) => {
          context = given
          return normalizedAlerts.methods(given)
        },
        supported: normalizedAlerts.supported
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
  queries = { ...MEMBER_WRITES }
  failure = null
  principal = vi.fn(async (candidate: MarketplaceV2Viewer) => {
    if (candidate.userId !== CLERK && candidate.userId !== OTHER_CLERK) {
      throw new MarketplaceRefusalError("This business is not available to your account.", "42501")
    }
    return PRINCIPAL
  })
  useAdapter()
})

describe("alert statements are catalogued (#316)", () => {
  const text = (name: MarketplaceQueryName): string => MARKETPLACE_QUERIES[name].text

  it("names every signed-in alerts statement in MARKETPLACE_QUERIES, and list_saved_jobs in MARKETPLACE_FUNCTIONS", () => {
    expect([...ALERT_QUERY_NAMES].sort()).toEqual([
      "alert_delete_job_search",
      "alert_insert_job_search",
      "alert_list_job_searches",
      "alert_list_notification_preferences",
      "alert_save_job",
      "alert_set_notification_preference",
      "alert_unsave_job",
      "alert_update_job_search",
      "alert_viewer_user"
    ])

    for (const name of ALERT_QUERY_NAMES) {
      expect(Object.prototype.hasOwnProperty.call(MARKETPLACE_QUERIES, name), name).toBe(true)
    }

    expect(MARKETPLACE_FUNCTIONS.list_saved_jobs).toEqual({ anonymous: false, args: { p_org_id: "uuid" }, returns: "rows" })
  })

  it("binds the active business as $1 to every statement, and checks the person is an active member of it", () => {
    for (const name of ALERT_QUERY_NAMES) {
      expect(MARKETPLACE_QUERIES[name].args[0], name).toBe("uuid")
      expect(text(name), name).toContain("$1::text::uuid")
      expect(text(name), name).toContain(MEMBER_CHECK)
    }
  })

  it("binds every value, refuses a value of the wrong type or count, and never selects an email address", () => {
    const texts = ALERT_QUERY_NAMES.map(text).join("\n")

    expect(texts).not.toMatch(/user_contacts|delivery_address|email/i)
    expect(marketplaceQueryStatement("alert_save_job", [ORG, JOB])).toEqual({ text: text("alert_save_job"), values: [ORG, JOB] })
    expect(marketplaceQueryStatement("alert_insert_job_search", [ORG, "Fir", "{}", true]).values).toEqual([ORG, "Fir", "{}", "true"])
    expect(marketplaceQueryStatement("alert_update_job_search", [ORG, SEARCH, "Fir", "{}", false]).values).toEqual([ORG, SEARCH, "Fir", "{}", "false"])
    expect(marketplaceQueryStatement("alert_set_notification_preference", [ORG, "job_alert", "email", false]).values)
      .toEqual([ORG, "job_alert", "email", "false"])
    expect(marketplaceQueryStatement("alert_viewer_user", [ORG]).values).toEqual([ORG])

    for (const name of ALERT_QUERY_NAMES) {
      const values = MARKETPLACE_QUERIES[name].args.map((type) => (type === "boolean" ? true : type === "uuid" ? ORG : "x"))

      expect(marketplaceQueryStatement(name, values).text, name).not.toContain(ORG)
    }

    expect(() => marketplaceQueryStatement("alert_save_job", [ORG])).toThrow(TypeError)
    expect(() => marketplaceQueryStatement("alert_save_job", [ORG, "x'; delete from marketplace.saved_jobs; --"])).toThrow(TypeError)
    expect(() => marketplaceQueryStatement("alert_insert_job_search", [ORG, "Fir", "{}", "true"])).toThrow(TypeError)
  })

  it("keeps the person to current_user_id() and writes only the granted columns", () => {
    const save = text("alert_save_job")
    const insert = text("alert_insert_job_search")
    const update = text("alert_update_job_search")
    const setClause = update.slice(update.indexOf("set"), update.indexOf("where"))

    // saved_jobs and saved_searches take the person from the column default (`current_user_id()`).
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

    const personScoped: MarketplaceQueryName[] = [
      "alert_unsave_job",
      "alert_list_job_searches",
      "alert_update_job_search",
      "alert_delete_job_search",
      "alert_list_notification_preferences",
      "alert_set_notification_preference",
      "alert_viewer_user"
    ]

    for (const name of personScoped) {
      expect(text(name), name).toContain("marketplace.current_user_id()")
    }

    for (const name of ["alert_list_job_searches", "alert_update_job_search", "alert_delete_job_search"] as const) {
      expect(text(name), name).toContain("kind = 'jobs'")
    }

    expect(text("alert_viewer_user")).not.toMatch(/display_name|avatar_path|bio/)
  })

  it("answers a write with one row only for a member, so a non-member is refused instead of told it saved", () => {
    // Each write's own row (or the INSERT's SELECT) is gated by the membership check, never only by the table policy.
    for (const name of ["alert_save_job", "alert_unsave_job", "alert_delete_job_search"] as const) {
      expect(text(name), name).toMatch(/select jsonb_build_object\('changed', exists \(select 1 from \w+\)\) as row\s+where marketplace\.has_org_role\(\$1::text::uuid/)
    }

    expect(text("alert_insert_job_search")).toMatch(/select \$1::text::uuid, 'jobs'[^]*where marketplace\.has_org_role\(\$1::text::uuid/)
    expect(text("alert_set_notification_preference")).toMatch(/select marketplace\.current_user_id\(\), \$1::text::uuid[^]*where marketplace\.has_org_role\(\$1::text::uuid/)
  })

  it("keeps the signed-out unsubscribe out of the catalogue, so no adapter transaction can run it before #294", () => {
    expect(ALERT_QUERY_NAMES).not.toContain("alert_unsubscribe_notification")
    expect(Object.keys(MARKETPLACE_QUERIES).filter((name) => /unsubscribe/i.test(name))).toEqual([])
    expect(() => marketplaceQueryStatement("alert_unsubscribe_notification" as never, [STORE_USER, ORG, "job_alert", "email"])).toThrow(TypeError)
    expect(marketplaceV2FeatureMethods("alerts").filter((method) => /unsubscribe/i.test(method))).toEqual([])

    expect(ALERT_UNSUBSCRIBE_STATEMENT).not.toContain("current_user_id()")
    expect(ALERT_UNSUBSCRIBE_STATEMENT).toContain("set enabled = false")
    expect(ALERT_UNSUBSCRIBE_STATEMENT).not.toMatch(/email/i)
    expect(alertUnsubscribeStatement({ category: "job_alert", channel: "email", organizationId: ORG, userId: STORE_USER }))
      .toEqual({ text: ALERT_UNSUBSCRIBE_STATEMENT, values: [STORE_USER, ORG, "job_alert", "email"] })
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

  it("reads a write's row as whether it changed anything, no row as not a member, and fails closed on drift", () => {
    expect(changedFromRow({ changed: true })).toBe(true)
    expect(changedFromRow({ changed: false })).toBe(false)
    expect(changedFromRow(undefined)).toBeNull()
    expect(() => changedFromRow({ changed: "yes" })).toThrow(MarketplaceStoreError)
    expect(() => changedFromRow({ changed: true, user_id: STORE_USER })).toThrow(MarketplaceStoreError)
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
    queries.alert_save_job = [{ changed: false }]
    await port.saveJob(viewer, JOB)
    await port.unsaveJob(viewer, JOB)
    queries.alert_unsave_job = [{ changed: false }]
    await port.unsaveJob(viewer, JOB)

    expect(recorded.map((entry) => [entry.name, entry.args, entry.readOnly])).toEqual([
      ["alert_save_job", [ORG, JOB], false],
      ["alert_save_job", [ORG, JOB], false],
      ["alert_unsave_job", [ORG, JOB], false],
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
    await expect(denied).rejects.toMatchObject({ message: NOT_AVAILABLE })
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

    expect(recorded[0]).toMatchObject({ args: [ORG], name: "alert_list_job_searches", readOnly: true })
    expect(recorded[1]).toMatchObject({ args: [ORG, "Fir", expect.stringContaining("log_truck"), "true"], name: "alert_insert_job_search", readOnly: false })
    expect(recorded[2]).toMatchObject({ args: [ORG, SEARCH, "Fir", expect.any(String), "false"], name: "alert_update_job_search", readOnly: false })
    expect(recorded[3]).toMatchObject({ args: [ORG, SEARCH], name: "alert_delete_job_search", readOnly: false })
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
    expect(recorded[0]).toMatchObject({ args: [ORG], name: "alert_list_notification_preferences", readOnly: true })

    await port.setNotificationPreference(viewer, { category: "inquiry_reply", channel: "in_app", enabled: true })
    await expect(port.setNotificationPreference(viewer, { category: "job_alert", channel: "email", email: EMAIL, enabled: false })).rejects.toBeInstanceOf(MarketplaceRefusalError)

    expect(recorded.at(-1)).toMatchObject({
      args: [ORG, "inquiry_reply", "in_app", "true"],
      name: "alert_set_notification_preference",
      readOnly: false
    })
    expect(recorded.some((entry) => JSON.stringify(entry.args).includes(EMAIL))).toBe(false)
  })

  it("refuses every write for a person who is not an active member of the active business, and never claims it saved", async () => {
    queries = {}
    const port = useAdapter()
    const writes: Array<[string, () => Promise<unknown>]> = [
      ["saveJob", () => port.saveJob(other, JOB)],
      ["unsaveJob", () => port.unsaveJob(other, JOB)],
      ["saveJobSearch", () => port.saveJobSearch(other, { alertsEnabled: true, criteria: {}, name: "Fir" })],
      ["deleteJobSearch", () => port.deleteJobSearch(other, SEARCH)],
      ["setNotificationPreference", () => port.setNotificationPreference(other, { category: "job_alert", channel: "email", enabled: true })]
    ]

    for (const [method, write] of writes) {
      const outcome = await write().then(() => null, (error: unknown) => error)

      expect(outcome, method).toBeInstanceOf(MarketplaceRefusalError)
      expect(outcome, method).toMatchObject({ code: "42501", message: NOT_AVAILABLE })
    }

    expect(recorded.map((entry) => entry.name)).toEqual([
      "alert_save_job",
      "alert_unsave_job",
      "alert_insert_job_search",
      "alert_delete_job_search",
      "alert_set_notification_preference"
    ])
    expect(recorded.every((entry) => JSON.stringify(entry.args).includes(OTHER_ORG) && !JSON.stringify(entry.args).includes(ORG))).toBe(true)
  })

  it("fails closed when a write's row drifted from the SQL", async () => {
    queries.alert_save_job = [{ changed: true, job_id: JOB }]

    await expect(useAdapter().saveJob(viewer, JOB)).rejects.toBeInstanceOf(MarketplaceStoreError)
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
    expect(recorded).toEqual([{ args: [ORG], kind: "query", name: "alert_viewer_user", readOnly: true }])
    expect(JSON.stringify(recorded)).not.toContain(CLERK)
  })

  it("refuses to mint for a person who is not a member of the active business", async () => {
    const refused = createAlertUnsubscribeToken(context, other, { category: "job_alert", channel: "email", enabled: false }, SECRET, NOW)

    await expect(refused).rejects.toBeInstanceOf(MarketplaceRefusalError)
    await expect(refused).rejects.toMatchObject({ code: "42501", message: NOT_AVAILABLE })
    expect(recorded).toEqual([{ args: [OTHER_ORG], kind: "query", name: "alert_viewer_user", readOnly: true }])
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
    expect(ran[0]?.text).toBe(ALERT_UNSUBSCRIBE_STATEMENT)
    expect(ran[0]?.text).not.toContain("current_user_id()")
    expect(ran[0]?.text).not.toMatch(/email/i)
    expect(ran[0]?.values).toEqual([STORE_USER, ORG, "targeted_invitation", "email"])
    expect(recorded).toEqual([])
  })

  it("answers a store failure with the fixed sentence only", async () => {
    queries.alert_viewer_user = [{ id: STORE_USER }]
    const { token } = await createAlertUnsubscribeToken(context, viewer, { category: "job_alert", channel: "email", enabled: true }, SECRET, NOW)
    const failed = unsubscribeAlert(token, SECRET, NOW, async () => {
      throw postgresError(`permission denied for table notification_preferences (${EMAIL})`, "42501")
    })

    await expect(failed).rejects.toThrow()
    await expect(failed).rejects.not.toThrow(EMAIL)
    await expect(failed).rejects.not.toThrow("notification_preferences")
  })
})

describe("the alerts group is on (#316)", () => {
  it("is supported, and the live adapter runs its methods through the catalogues", async () => {
    expect(normalizedAlerts.supported).toBe(true)

    const port = createNormalizedMarketplaceV2({ db: fakeDb(), now: () => NOW, principal: principal as never })
    calls.list_saved_jobs = [openJob()]
    recorded = []

    expect(port.supports.alerts).toBe(true)
    await expect(port.listSavedJobs(viewer)).resolves.toMatchObject([{ jobId: JOB }])
    await port.saveJob(viewer, JOB)

    expect(recorded.map((entry) => [entry.kind, entry.name])).toEqual([["call", "list_saved_jobs"], ["query", "alert_save_job"]])
    expect(MARKETPLACE_V2_FEATURES).toContain("alerts")
  })
})
