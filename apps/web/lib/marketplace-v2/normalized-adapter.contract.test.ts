import { randomBytes, randomUUID } from "node:crypto"

import postgres, { type Sql } from "postgres"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
// v2-session.ts reads the request's session through ../session; these tests hand the store the subject directly.
vi.mock("../session", () => ({}))

import {
  landingInterestQueueFor,
  marketplaceCapabilities,
  marketplaceInquiryUnread,
  validateMarketplaceJobDraft,
  type MarketplaceMemberRole
} from "@logloads/contracts"

import { createNormalizedMarketplaceV2 } from "./normalized-adapter"
import {
  createPostgresIdentitySync,
  createPostgresMarketplaceDb,
  MARKETPLACE_FUNCTIONS,
  type MarketplaceDb,
  type MarketplacePrincipal
} from "./normalized-db"
import { viewerAccessRow } from "./normalized-mapping"
import { createNormalizedSessionStore, type NormalizedSessionStore } from "./normalized-session"
import { MarketplaceAdapterConfigurationError, MarketplaceRefusalError, type MarketplaceV2Port, type MarketplaceV2Viewer } from "./port"
import { selectV2Membership, v2MembershipFromNormalized } from "./v2-session"

/**
 * Contract tests of the normalized adapter against the REAL schema: architecture/normalized-v2 stages 01, 02, 03, 06,
 * 11, 12, 16 and 18 applied to a disposable PostgreSQL 17 + PostGIS database by `.github/workflows/normalized-adapter-ci.yml`,
 * behind the same fail-closed guard as the normalized-v2 workflow (`tools/normalized-v2-ci/guard.sh`).
 *
 * They run only on GitHub Actions against that guarded database, and skip anywhere else (there is no local PostgreSQL;
 * a local skip is not a pass). With `LOGLOADS_ADAPTER_CONTRACT=required` (the CI job) a missing database FAILS.
 *
 * Fixtures are created through the database's own functions as the migration role (`postgres`), the way
 * `14_supabase_api_tests.sh` does. The adapter under test connects as a separate NOINHERIT login role that can only
 * switch to `anon` and `authenticated`, as a deployment would.
 */

const DB_URL = process.env.LOGLOADS_DISPOSABLE_DB_URL ?? ""
const REQUIRED = process.env.LOGLOADS_ADAPTER_CONTRACT === "required"
const DISPOSABLE =
  process.env.GITHUB_ACTIONS === "true" &&
  process.env.LOGLOADS_DB_ENV === "ci-disposable" &&
  /^postgresql:\/\/postgres:[A-Za-z0-9_-]+@127\.0\.0\.1:5432\/logloads_test$/.test(DB_URL)

const ISSUER = "https://clerk.adapter-contract.test"
const AUDIENCE = "logloads-adapter-contract"
const ADAPTER_ROLE = "logloads_adapter_ci"
const UNSAFE_ROLE = "logloads_adapter_ci_unsafe"
/** HF-22: login roles that hold no attribute themselves but belong to a privileged role, directly or indirectly. */
const INDIRECT_ROLE = "logloads_adapter_ci_indirect"
const ROLE_ADMIN_MEMBER = "logloads_adapter_ci_roleadmin"
/** HF-22: a member of a role that holds no attribute (pg_write_all_data), and an owner of an object in the schema. */
const WRITER_ROLE = "logloads_adapter_ci_writer"
const OWNER_ROLE = "logloads_adapter_ci_owner"
/** #213: the identity-sync login role. NOINHERIT, and able to become service_role and nothing else. */
const SYNC_ROLE = "logloads_identity_sync_ci"

/** Public and private strings of the fixture landing. The private ones must never appear in any V2 view. */
const EXACT_POINT = "POINT(-122.48765 44.15432)"
const PRIVATE_STRINGS = ["Green gate 4417", "Spur 12 past the scale", "-122.48765", "44.15432"]

if (REQUIRED && !DISPOSABLE) {
  describe("normalized adapter contract", () => {
    it("runs only against the guarded disposable PostgreSQL 17 database", () => {
      throw new Error("LOGLOADS_ADAPTER_CONTRACT=required, but the guarded disposable CI database is not configured")
    })
  })
}

function roleUrl(role: string, password: string): string {
  return DB_URL.replace(/^postgresql:\/\/postgres:[A-Za-z0-9_-]+@/, `postgresql://${role}:${password}@`)
}

function client(url: string): Sql {
  return postgres(url, { max: 1, onnotice: () => undefined, prepare: false })
}

function isoDay(offsetDays: number): string {
  const day = new Date()
  day.setUTCDate(day.getUTCDate() + offsetDays)
  return day.toISOString().slice(0, 10)
}

function attestation(action: "publish" | "reconfirm") {
  return { action, confirmedAt: new Date().toISOString() }
}

function fixtureSql(): string {
  const claims = (sub: string) =>
    `jsonb_build_object('role','authenticated','iss','${ISSUER}','sub','${sub}','aud','${AUDIENCE}','exp',extract(epoch from now())::bigint + 600)::text`

  return `
insert into marketplace.trusted_identity_issuers (issuer, label, expected_audience, enabled)
values ('${ISSUER}', 'Clerk (adapter contract CI)', '${AUDIENCE}', true);

do $$
declare v_land uuid; v_rival uuid; v_haul uuid; v_dual uuid;
  worker constant text := '{"role":"service_role"}';
begin
  perform set_config('request.jwt.claims', worker, true); set local role service_role;
  perform marketplace.sync_verified_identity('${ISSUER}', 'adapter_land', 'Land Owner', 'land@adapter-contract.test', true);
  perform marketplace.sync_verified_identity('${ISSUER}', 'adapter_rival', 'Rival Owner', 'rival@adapter-contract.test', true);
  perform marketplace.sync_verified_identity('${ISSUER}', 'adapter_haul', 'Haul Owner', 'haul@adapter-contract.test', true);
  perform marketplace.sync_verified_identity('${ISSUER}', 'adapter_stranger', 'Stranger', 'stranger@adapter-contract.test', true);
  reset role;

  perform set_config('request.jwt.claims', ${claims("adapter_land")}, true); set local role authenticated;
  v_land := marketplace.create_organization('Adapter Timber', 'adapter-timber', 'OR', false);
  v_dual := marketplace.create_organization('Adapter Timber Hauling', 'adapter-timber-hauling', 'OR', true);
  perform set_config('request.jwt.claims', ${claims("adapter_rival")}, true);
  v_rival := marketplace.create_organization('Adapter Rival Timber', 'adapter-rival', 'OR', false);
  perform set_config('request.jwt.claims', ${claims("adapter_haul")}, true);
  v_haul := marketplace.create_organization('Adapter Hauling', 'adapter-hauling', 'OR', true);
  insert into marketplace.equipment_units (org_id, equipment_code, unit_label, unit_count) values (v_haul, 'log_truck', 'Adapter trucks', 2);
  reset role;

  perform set_config('request.jwt.claims', worker, true); set local role service_role;
  perform marketplace.open_subscription_cycle(v_land, 'basic', 'active', now() - interval '1 hour', now() + interval '29 days', 'cus_adapter_l', 'sub_adapter_l', false, 7, false);
  perform marketplace.open_subscription_cycle(v_rival, 'basic', 'active', now() - interval '1 hour', now() + interval '29 days', 'cus_adapter_r', 'sub_adapter_r', false, 7, false);
  reset role;

  perform set_config('request.jwt.claims', ${claims("adapter_land")}, true); set local role authenticated;
  insert into marketplace.landings (org_id, name, status, public_area_label, public_point, state_code)
  values (v_land, 'Upper Spur Landing', 'active', 'Near Vida, OR', extensions.st_GeogFromText('SRID=4326;${EXACT_POINT}'), 'OR');
  insert into marketplace.landing_private_details (landing_id, org_id, exact_point, directions, gate_instructions)
  select l.id, v_land, extensions.st_GeogFromText('SRID=4326;${EXACT_POINT}'), '${PRIVATE_STRINGS[1]}', '${PRIVATE_STRINGS[0]}'
  from marketplace.landings l where l.org_id = v_land;
  perform set_config('request.jwt.claims', ${claims("adapter_rival")}, true);
  insert into marketplace.landings (org_id, name, status, public_area_label, public_point, state_code)
  values (v_rival, 'Rival Landing', 'active', 'Near Sweet Home, OR', extensions.st_GeogFromText('SRID=4326;POINT(-122.73 44.40)'), 'OR');
  reset role;
end
$$;`
}

interface Fixture {
  users: Record<"land" | "rival" | "haul" | "stranger", string>
  orgs: Record<"land" | "rival" | "haul" | "dual", string>
  landings: Record<"land" | "rival", string>
}

describe.skipIf(!DISPOSABLE)("normalized adapter contract (disposable PostgreSQL 17)", () => {
  let admin: Sql
  let adapterSql: Sql
  let unsafeSql: Sql
  let indirectSql: Sql
  let roleAdminMemberSql: Sql
  let writerSql: Sql
  let ownerSql: Sql
  let maskedSuperuserSql: Sql
  let syncSql: Sql
  let db: MarketplaceDb
  let port: MarketplaceV2Port
  /** #213: session memberships without identity linking, and with it. */
  let sessionStore: NormalizedSessionStore
  let linkingStore: NormalizedSessionStore
  let fixture: Fixture
  const subjects = new Map<string, string>()

  const principalFor = (issuer: string) => async (viewer: MarketplaceV2Viewer): Promise<MarketplacePrincipal> => {
    const subject = subjects.get(viewer.userId)
    if (!subject) throw new MarketplaceRefusalError("Sign in again to continue.")
    return { audience: AUDIENCE, issuer, subject }
  }

  const viewer = (user: keyof Fixture["users"], org: keyof Fixture["orgs"]): MarketplaceV2Viewer => ({
    organizationId: fixture.orgs[org],
    userId: fixture.users[user]
  })

  const one = async <T,>(query: string, values: Array<string | number | null> = []): Promise<T> => {
    const rows = await admin.unsafe(query, values)
    return rows[0] as T
  }

  let landJobId = ""
  let rivalJobId = ""
  let haulInterestId = ""
  let dualInterestId = ""

  beforeAll(async () => {
    admin = client(DB_URL)

    const marker = await one<{ marker: string }>(
      "select coalesce(shobj_description(oid, 'pg_database'), '') as marker from pg_database where datname = current_database()"
    )
    expect(marker.marker.startsWith("logloads-ci-disposable:")).toBe(true)
    expect((await one<{ v: string }>("select current_setting('server_version_num') as v")).v).toMatch(/^17\d{4}$/)

    const migrations = await one<{ versions: string }>("select string_agg(version, ',' order by applied_at, version) as versions from marketplace.schema_migrations")
    expect(migrations.versions).toBe("06,11,12,16,18,23")

    const password = randomBytes(18).toString("hex")
    const unsafePassword = randomBytes(18).toString("hex")
    await admin.unsafe(`create role ${ADAPTER_ROLE} login noinherit password '${password}'`)
    await admin.unsafe(`grant anon, authenticated to ${ADAPTER_ROLE}`)
    await admin.unsafe(`create role ${UNSAFE_ROLE} login noinherit password '${unsafePassword}'`)
    await admin.unsafe(`grant anon, authenticated, service_role to ${UNSAFE_ROLE}`)
    const indirectPassword = randomBytes(18).toString("hex")
    const roleAdminPassword = randomBytes(18).toString("hex")
    await admin.unsafe("create role logloads_ci_bypass nologin bypassrls")
    await admin.unsafe("create role logloads_ci_middle nologin")
    await admin.unsafe("grant logloads_ci_bypass to logloads_ci_middle")
    await admin.unsafe(`create role ${INDIRECT_ROLE} login noinherit password '${indirectPassword}'`)
    await admin.unsafe(`grant anon, authenticated, logloads_ci_middle to ${INDIRECT_ROLE}`)
    await admin.unsafe("create role logloads_ci_role_admin nologin createrole")
    await admin.unsafe(`create role ${ROLE_ADMIN_MEMBER} login noinherit password '${roleAdminPassword}'`)
    await admin.unsafe(`grant anon, authenticated, logloads_ci_role_admin to ${ROLE_ADMIN_MEMBER}`)
    const writerPassword = randomBytes(18).toString("hex")
    const ownerPassword = randomBytes(18).toString("hex")
    await admin.unsafe(`create role ${WRITER_ROLE} login noinherit password '${writerPassword}'`)
    await admin.unsafe(`grant anon, authenticated, pg_write_all_data to ${WRITER_ROLE}`)
    await admin.unsafe(`create role ${OWNER_ROLE} login noinherit password '${ownerPassword}'`)
    await admin.unsafe(`grant anon, authenticated to ${OWNER_ROLE}`)
    await admin.unsafe("create function marketplace.logloads_ci_owned_probe() returns integer language sql immutable as 'select 1'")
    await admin.unsafe(`alter function marketplace.logloads_ci_owned_probe() owner to ${OWNER_ROLE}`)
    const syncPassword = randomBytes(18).toString("hex")
    await admin.unsafe(`create role ${SYNC_ROLE} login noinherit password '${syncPassword}'`)
    await admin.unsafe(`grant service_role to ${SYNC_ROLE}`)

    await admin.unsafe(fixtureSql())

    const users = await admin.unsafe(
      "select subject, user_id::text as id from marketplace.identity_links where issuer = $1", [ISSUER]
    ) as unknown as Array<{ subject: string; id: string }>
    const byName = (name: string) => users.find((row) => row.subject === `adapter_${name}`)?.id ?? ""
    const org = async (slug: string) => (await one<{ id: string }>("select id::text as id from marketplace.organizations where slug = $1", [slug])).id
    const landing = async (orgId: string) => (await one<{ id: string }>("select id::text as id from marketplace.landings where org_id = $1::uuid", [orgId])).id

    const orgs = {
      dual: await org("adapter-timber-hauling"),
      haul: await org("adapter-hauling"),
      land: await org("adapter-timber"),
      rival: await org("adapter-rival")
    }
    fixture = {
      landings: { land: await landing(orgs.land), rival: await landing(orgs.rival) },
      orgs,
      users: { haul: byName("haul"), land: byName("land"), rival: byName("rival"), stranger: byName("stranger") }
    }

    for (const name of ["land", "rival", "haul", "stranger"] as const) {
      subjects.set(fixture.users[name], `adapter_${name}`)
    }

    adapterSql = client(roleUrl(ADAPTER_ROLE, password))
    unsafeSql = client(roleUrl(UNSAFE_ROLE, unsafePassword))
    indirectSql = client(roleUrl(INDIRECT_ROLE, indirectPassword))
    roleAdminMemberSql = client(roleUrl(ROLE_ADMIN_MEMBER, roleAdminPassword))
    writerSql = client(roleUrl(WRITER_ROLE, writerPassword))
    ownerSql = client(roleUrl(OWNER_ROLE, ownerPassword))
    // The superuser's credential with the adapter role set at connection time: current_user looks inert, the login is not.
    maskedSuperuserSql = postgres(DB_URL, { connection: { options: `-c role=${ADAPTER_ROLE}` }, max: 1, onnotice: () => undefined, prepare: false })
    syncSql = client(roleUrl(SYNC_ROLE, syncPassword))
    db = createPostgresMarketplaceDb({ sql: adapterSql })
    port = createNormalizedMarketplaceV2({ db, principal: principalFor(ISSUER) })
    sessionStore = createNormalizedSessionStore({ db, identity: { audience: AUDIENCE, issuer: ISSUER } })
    linkingStore = createNormalizedSessionStore({
      db,
      identity: { audience: AUDIENCE, issuer: ISSUER },
      sync: createPostgresIdentitySync({ sql: syncSql })
    })
  }, 120_000)

  afterAll(async () => {
    await Promise.allSettled([
      adapterSql?.end({ timeout: 5 }),
      unsafeSql?.end({ timeout: 5 }),
      indirectSql?.end({ timeout: 5 }),
      roleAdminMemberSql?.end({ timeout: 5 }),
      writerSql?.end({ timeout: 5 }),
      ownerSql?.end({ timeout: 5 }),
      maskedSuperuserSql?.end({ timeout: 5 }),
      syncSql?.end({ timeout: 5 }),
      admin?.end({ timeout: 5 })
    ])
  })

  function publishDraft(landingId: string, title: string, overrides: Record<string, string | string[]> = {}) {
    const result = validateMarketplaceJobDraft({
      destinationLabel: "Mill near Albany, OR",
      durationDays: "10",
      equipment: ["log_truck"],
      estOneWayMiles: "42",
      estTonsPerLoad: "28.5",
      landingId,
      payAmount: "91",
      payUnit: "per_ton",
      product: "Saw logs",
      publicRoadNotes: "Gravel haul road; chains may be required.",
      startsOn: isoDay(7),
      title,
      trucksPerDay: "2",
      trucksRequested: "3",
      ...overrides
    })

    if (!result.ok) throw new Error(JSON.stringify(result.issues))
    return result.draft
  }

  // -------------------------------------------------------------------------------------------------------------
  describe("the connection", () => {
    it("uses a login role that can do nothing until it switches to anon or authenticated", async () => {
      await expect(adapterSql.unsafe("select count(*) from marketplace.job_postings")).rejects.toMatchObject({ code: "42501" })
      await expect(adapterSql.unsafe("select * from marketplace.list_marketplace_jobs()")).rejects.toMatchObject({ code: "42501" })
      await expect(adapterSql.begin((tx) => tx.unsafe("set local role service_role"))).rejects.toMatchObject({ code: "42501" })
    })

    it("refuses a superuser or a service_role member as its login role", async () => {
      const superuser = createPostgresMarketplaceDb({ sql: admin })
      const serviceMember = createPostgresMarketplaceDb({ sql: unsafeSql })

      await expect(superuser.asAnon(async () => "ran")).rejects.toThrow(MarketplaceAdapterConfigurationError)
      await expect(superuser.asAnon(async () => "ran")).rejects.toThrow(/superuser/)
      await expect(serviceMember.asAnon(async () => "ran")).rejects.toThrow(/service_role/)
    })

    it("refuses a login role that belongs to a privileged role, even through another role (HF-22)", async () => {
      await expect(createPostgresMarketplaceDb({ sql: indirectSql }).asAnon(async () => "ran"))
        .rejects.toThrow(/privileged role \(logloads_ci_bypass\)/)
      await expect(createPostgresMarketplaceDb({ sql: roleAdminMemberSql }).asAnon(async () => "ran"))
        .rejects.toThrow(/privileged role \(logloads_ci_role_admin\)/)
      // The adapter's own role passes the same check.
      await expect(createPostgresMarketplaceDb({ sql: adapterSql }).asAnon(async () => "ran")).resolves.toBe("ran")
    })

    it("refuses a login role that reaches any role beyond anon and authenticated, or owns anything in the schema (HF-22)", async () => {
      await expect(createPostgresMarketplaceDb({ sql: writerSql }).asAnon(async () => "ran"))
        .rejects.toThrow(/roles other than anon and authenticated \(pg_write_all_data\)/)
      await expect(createPostgresMarketplaceDb({ sql: ownerSql }).asAnon(async () => "ran"))
        .rejects.toThrow(/owns objects in the marketplace schema/)
    })

    it("checks the login role itself, not a role set at connection time", async () => {
      const [masked] = await maskedSuperuserSql.unsafe("select current_user::text as current, session_user::text as login")
      expect(masked).toEqual({ current: ADAPTER_ROLE, login: "postgres" })

      await expect(createPostgresMarketplaceDb({ sql: maskedSuperuserSql }).asAnon(async () => "ran")).rejects.toThrow(/superuser/)
    })

    it("calls only functions that exist with the catalogued argument names and grants", async () => {
      for (const [name, spec] of Object.entries(MARKETPLACE_FUNCTIONS)) {
        const row = await one<{ found: boolean; authenticated: boolean; anon: boolean; service: boolean }>(
          `select count(*) > 0 as found,
                  bool_or(has_function_privilege('authenticated', p.oid, 'EXECUTE')) as authenticated,
                  bool_or(has_function_privilege('anon', p.oid, 'EXECUTE')) as anon,
                  bool_or(has_function_privilege('service_role', p.oid, 'EXECUTE')) as service
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'marketplace' and p.proname = $1 and $2::text[] <@ p.proargnames`,
          [name, `{${Object.keys(spec.args).join(",")}}`]
        )

        expect({ name, ...row }).toEqual({ anon: spec.anonymous, authenticated: true, found: true, name, service: false })
      }
    })
  })

  // -------------------------------------------------------------------------------------------------------------
  describe("identity", () => {
    it("resolves capabilities from the person's membership, matching the TypeScript capability rules", async () => {
      for (const [user, org] of [["land", "land"], ["haul", "haul"], ["land", "dual"]] as const) {
        const [raw] = await db.asUser(await principalFor(ISSUER)(viewer(user, org)), (calls) =>
          calls.call("get_viewer_marketplace_access", { p_org_id: fixture.orgs[org] }))
        const row = viewerAccessRow(raw)
        const expected = marketplaceCapabilities({
          haulerProfile: row.hauler_profile,
          landingWorkspaceSeat: row.landing_workspace_seat,
          role: row.role as MarketplaceMemberRole
        })

        expect([...row.capabilities].sort()).toEqual([...expected].sort())
      }

      expect((await port.viewerAccess(viewer("land", "land"))).capabilities).toEqual(expect.arrayContaining(["job.publish", "landing.manage", "inquiry.respond"]))
      expect((await port.viewerAccess(viewer("haul", "haul"))).capabilities).toEqual(expect.arrayContaining(["interest.express", "interest.withdraw", "interest.reply"]))
      expect((await port.viewerAccess(viewer("land", "land"))).organizationName).toBe("Adapter Timber")
    })

    it("refuses a person in a business they do not belong to", async () => {
      await expect(port.viewerAccess(viewer("stranger", "land"))).rejects.toBeInstanceOf(MarketplaceRefusalError)
      await expect(port.viewerAccess(viewer("land", "rival"))).rejects.toBeInstanceOf(MarketplaceRefusalError)
      await expect(port.authoringLandings(viewer("haul", "land"))).rejects.toBeInstanceOf(MarketplaceRefusalError)
    })

    it("resolves no one for an untrusted issuer: the database still checks every claim", async () => {
      const untrusted = createNormalizedMarketplaceV2({ db, principal: principalFor("https://clerk.untrusted.test") })

      await expect(untrusted.viewerAccess(viewer("land", "land"))).rejects.toBeInstanceOf(MarketplaceRefusalError)
    })
  })

  // -------------------------------------------------------------------------------------------------------------
  describe("publish → discover", () => {
    it("lists only the active business's own active landings, by public label", async () => {
      const landings = await port.authoringLandings(viewer("land", "land"))

      expect(landings).toEqual([{ areaLabel: "Near Vida, OR", id: fixture.landings.land, name: "Upper Spur Landing", stateCode: "OR" }])
    })

    it("publishes an attested, priced job that anonymous discovery shows on the public grid only", async () => {
      const before = Date.now()
      const published = await port.publishJob(viewer("land", "land"), publishDraft(fixture.landings.land, "Adapter Sawlog Run"), attestation("publish"))
      landJobId = published.jobId

      const job = await port.getJob(landJobId)
      expect(job).toMatchObject({
        acceptingInterest: true,
        destinationLabel: "Mill near Albany, OR",
        equipment: ["log_truck"],
        estimatedTonsPerLoad: 28.5,
        haulDistance: { basis: "poster_route_estimate", miles: 42 },
        origin: { approximatePoint: { lat: 44.2, lng: -122.5 }, label: "Near Vida, OR", stateCode: "OR" },
        pay: { amountCents: 9100, note: null, unit: "per_ton" },
        posterName: "Adapter Timber",
        posterOrganizationId: fixture.orgs.land,
        product: "Saw logs",
        startsOn: isoDay(7),
        status: "active",
        title: "Adapter Sawlog Run",
        trucks: { perDay: 2, total: 3 }
      })
      expect(Date.parse(job?.lastConfirmedAt ?? "")).toBeGreaterThanOrEqual(before - 5_000)
      expect(job?.endsOn).toBe(isoDay(16))

      const listed = await port.listJobs({ acceptingOnly: true })
      expect(listed.map((candidate) => candidate.id)).toContain(landJobId)
      expect((await port.listJobs({ query: "sawlog run" })).map((candidate) => candidate.id)).toContain(landJobId)
      expect(await port.listJobs({ payUnit: "per_hour" })).toEqual([])

      const everything = JSON.stringify([job, listed])
      for (const secret of PRIVATE_STRINGS) expect(everything).not.toContain(secret)

      const recorded = await one<{ by_publisher: boolean; ledger: number }>(
        `select j.last_confirmed_by = $2::uuid and j.published_at is not null as by_publisher,
                (select count(*)::int from marketplace.job_publication_attestations a where a.job_id = j.id) as ledger
         from marketplace.job_postings j where j.id = $1::uuid`,
        [landJobId, fixture.users.land]
      )
      expect(recorded).toEqual({ by_publisher: true, ledger: 1 })
    })

    it("refuses to publish at another business's landing, and records nothing", async () => {
      const count = async () => (await one<{ n: number }>("select count(*)::int as n from marketplace.job_postings")).n
      const before = await count()

      await expect(port.publishJob(viewer("land", "land"), publishDraft(fixture.landings.rival, "Hijack Run"), attestation("publish")))
        .rejects.toThrow("Choose one of your organization's landings")
      await expect(port.publishJob(viewer("stranger", "land"), publishDraft(fixture.landings.land, "Stranger Run"), attestation("publish")))
        .rejects.toBeInstanceOf(MarketplaceRefusalError)
      expect(await count()).toBe(before)
    })

    it("lets the rival publish at its own landing", async () => {
      const draft = publishDraft(fixture.landings.rival, "Rival Pulp Run", { payAmount: "525", payUnit: "per_load", product: "Pulpwood", startsOn: isoDay(30) })
      rivalJobId = (await port.publishJob(viewer("rival", "rival"), draft, attestation("publish"))).jobId
      expect((await port.getJob(rivalJobId))?.posterOrganizationId).toBe(fixture.orgs.rival)
    })

    it("applies the #185 discovery filters and orders to the stored jobs (contract pure rules after the query)", async () => {
      const ids = async (filters: Parameters<MarketplaceV2Port["listJobs"]>[0]) => (await port.listJobs(filters)).map((job) => job.id)
      const nearLand = { lat: 44.16, lng: -122.48 }
      const nearRival = { lat: 44.41, lng: -122.72 }

      expect(await ids({ product: "Pulpwood" })).toEqual([rivalJobId])
      expect(await ids({ product: "Saw logs" })).toEqual([landJobId])
      expect(await ids({ startsBy: isoDay(10) })).toEqual([landJobId])
      expect(await ids({ near: nearLand, radiusMiles: 5 })).toEqual([landJobId])
      expect((await ids({ near: nearLand, radiusMiles: null })).sort()).toEqual([landJobId, rivalJobId].sort())
      expect(await ids({ near: nearRival, sort: "nearest" })).toEqual([rivalJobId, landJobId])
      expect(await ids({ near: nearLand, sort: "nearest" })).toEqual([landJobId, rivalJobId])
      expect(await ids({ sort: "pay" })).toEqual([rivalJobId, landJobId])
      expect(await ids({ equipmentSetups: [["self_loader"]] })).toEqual([])
      expect((await ids({ equipmentSetups: [["log_truck"]] })).sort()).toEqual([landJobId, rivalJobId].sort())
    })
  })

  // -------------------------------------------------------------------------------------------------------------
  describe("interest → respond → reply", () => {
    it("offers the hauler's own listed equipment", async () => {
      expect(await port.haulerEquipment(viewer("haul", "haul"))).toEqual([{ configurationKey: "log_truck", equipmentCodes: ["log_truck"], label: "Log truck", unitsListed: 2 }])
    })

    it("records the hauler's inquiry and shows it to that landing only", async () => {
      const interest = await port.expressInterest(viewer("haul", "haul"), {
        equipment: [{ configurationKey: "log_truck", count: "2" }],
        loadPostingId: landJobId,
        message: "Two trucks from Sweet Home"
      })
      haulInterestId = interest.id

      expect(interest).toMatchObject({
        equipment: [{ configurationKey: "log_truck", count: 2, label: "Log truck" }],
        haulerOrganization: { id: fixture.orgs.haul, name: "Adapter Hauling" },
        job: { id: landJobId, status: "active" },
        landingOrganization: { id: fixture.orgs.land },
        status: "submitted",
        submittedBy: { userId: fixture.users.haul },
        trucksOffered: 2
      })
      expect((await port.interestForJob(viewer("haul", "haul"), landJobId))?.id).toBe(haulInterestId)
      expect((await port.listHaulerInterests(viewer("haul", "haul"))).map((row) => row.id)).toContain(haulInterestId)
      expect((await port.listLandingInterests(viewer("land", "land"))).map((row) => row.id)).toContain(haulInterestId)
      expect((await port.listLandingInterests(viewer("rival", "rival"))).map((row) => row.id)).not.toContain(haulInterestId)
    })

    it("turns a database business rule into a readable refusal", async () => {
      await expect(port.expressInterest(viewer("land", "land"), { loadPostingId: rivalJobId, trucksOffered: "1" }))
        .rejects.toThrow("Switch to a hauling business to express interest")
    })

    it("refuses responses from a rival or from the wrong business of the same person", async () => {
      dualInterestId = (await port.expressInterest(viewer("land", "dual"), { loadPostingId: rivalJobId, trucksOffered: "1" })).id

      await expect(port.respondToInterest(viewer("rival", "rival"), { decision: "viewed", interestId: haulInterestId })).rejects.toThrow("Inquiry not found")
      await expect(port.respondToInterest(viewer("land", "dual"), { decision: "viewed", interestId: haulInterestId })).rejects.toThrow("Inquiry not found")
      await expect(port.postHaulerReply(viewer("land", "land"), { body: "Hello", interestId: dualInterestId, replyId: randomUUID() }))
        .rejects.toThrow("Inquiry not found")
    })

    it("records one landing reply per reply id and the hauler's follow-up, without sharing private details", async () => {
      const replyId = randomUUID()
      const reply = { body: "Call the office to arrange a start date", decision: "replied", interestId: haulInterestId, replyId }

      await port.respondToInterest(viewer("land", "land"), reply)
      await port.respondToInterest(viewer("land", "land"), reply)
      await port.postHaulerReply(viewer("haul", "haul"), { body: "Will do, thanks", interestId: haulInterestId, replyId: randomUUID() })

      const seen = (await port.listLandingInterests(viewer("land", "land"))).find((row) => row.id === haulInterestId)
      expect(seen?.status).toBe("replied")
      expect(seen?.replies.map((entry) => [entry.authorSide, entry.body])).toEqual([
        ["landing", "Call the office to arrange a start date"],
        ["hauler", "Will do, thanks"]
      ])
      expect(seen?.replies[0]?.authorUserId).toBe(fixture.users.land)

      const shared = await one<{ shared: boolean }>(
        "select private_details_shared_at is not null as shared from marketplace.expressions_of_interest where id = $1::uuid", [haulInterestId]
      )
      expect(shared.shared).toBe(false)
      expect(JSON.stringify(seen)).not.toContain(PRIVATE_STRINGS[0])
    })
  })

  // -------------------------------------------------------------------------------------------------------------
  describe("reconfirm and withdraw", () => {
    it("advances the confirmation for the owner only", async () => {
      const before = (await port.getJob(landJobId))?.lastConfirmedAt ?? ""

      await expect(port.reconfirmJob(viewer("rival", "rival"), landJobId, attestation("reconfirm"))).rejects.toThrow("own job postings")
      await port.reconfirmJob(viewer("land", "land"), landJobId, attestation("reconfirm"))

      const after = (await port.getJob(landJobId))?.lastConfirmedAt ?? ""
      expect(Date.parse(after)).toBeGreaterThanOrEqual(Date.parse(before))
      expect((await one<{ seq: number }>("select confirmation_seq::int as seq from marketplace.job_publication_attestations where job_id = $1::uuid", [landJobId])).seq).toBe(2)
    })

    it("withdraws only from the business that sent the inquiry", async () => {
      await expect(port.withdrawInterest(viewer("land", "land"), dualInterestId)).rejects.toThrow("Inquiry not found")
      await port.withdrawInterest(viewer("land", "dual"), dualInterestId)
      await port.withdrawInterest(viewer("haul", "haul"), haulInterestId)

      expect((await port.interestForJob(viewer("haul", "haul"), landJobId))?.status).toBe("withdrawn")
      expect((await port.listLandingInterests(viewer("rival", "rival"))).find((row) => row.id === dualInterestId)?.status).toBe("withdrawn")
    })

    it("audits each step under the person who acted", async () => {
      const actions = (await admin.unsafe(
        "select action from marketplace.audit_events where entity_id = $1::uuid or entity_id = $2::uuid order by id", [landJobId, haulInterestId]
      ) as unknown as Array<{ action: string }>).map((row) => row.action)

      expect(actions).toEqual(expect.arrayContaining(["job_posting.published", "job_posting.reconfirmed", "interest.submitted", "interest.replied", "interest.withdrawn"]))
    })
  })

  // -------------------------------------------------------------------------------------------------------------
  describe("inquiry conversations (UX-09, #132)", () => {
    let poleJobId = ""
    /** Adapter Hauling → the pole job: marked reviewed, then declined with a reason. */
    let poleInterestId = ""
    /** Adapter Timber Hauling (the dual business) → the pole job: withdrawn with a reason. */
    let dualPoleInterestId = ""

    const messageCount = async (interestId: string) =>
      (await one<{ n: number }>("select count(*)::int as n from marketplace.interest_messages where interest_id = $1::uuid", [interestId])).n

    it("lists the landing's own inquiry jobs with their landing and equipment, and refuses everyone else", async () => {
      poleJobId = (await port.publishJob(
        viewer("land", "land"),
        publishDraft(fixture.landings.land, "Adapter Pole Run", { equipment: ["pole_trailer", "log_truck"] }),
        attestation("publish")
      )).jobId
      poleInterestId = (await port.expressInterest(viewer("haul", "haul"), {
        equipment: [{ configurationKey: "log_truck", count: "1" }],
        loadPostingId: poleJobId,
        message: "One truck from Sweet Home"
      })).id
      dualPoleInterestId = (await port.expressInterest(viewer("land", "dual"), { loadPostingId: poleJobId, trucksOffered: "1" })).id

      const landing = { id: fixture.landings.land, name: "Upper Spur Landing" }
      const jobs = await port.landingInquiryJobs(viewer("land", "land"))

      expect(jobs).toEqual(expect.arrayContaining([
        { equipmentCodes: ["log_truck"], jobId: landJobId, landing },
        { equipmentCodes: ["log_truck", "pole_trailer"], jobId: poleJobId, landing }
      ]))
      expect(jobs.map((job) => job.jobId)).not.toContain(rivalJobId)
      for (const secret of PRIVATE_STRINGS) expect(JSON.stringify(jobs)).not.toContain(secret)

      expect((await port.landingInquiryJobs(viewer("rival", "rival"))).map((job) => job.jobId)).toEqual([rivalJobId])
      await expect(port.landingInquiryJobs(viewer("haul", "haul"))).rejects.toBeInstanceOf(MarketplaceRefusalError)
      await expect(port.landingInquiryJobs(viewer("stranger", "land"))).rejects.toBeInstanceOf(MarketplaceRefusalError)
    })

    it("refuses a cross-organization read of an inbox or of a hauling business's inquiries", async () => {
      await expect(port.listLandingInterests(viewer("haul", "land"))).rejects.toBeInstanceOf(MarketplaceRefusalError)
      await expect(port.listHaulerInterests(viewer("land", "haul"))).rejects.toBeInstanceOf(MarketplaceRefusalError)
      await expect(port.listLandingInterests(viewer("stranger", "rival"))).rejects.toBeInstanceOf(MarketplaceRefusalError)

      expect((await port.listLandingInterests(viewer("rival", "rival"))).map((row) => row.id)).not.toContain(poleInterestId)
      expect((await port.listHaulerInterests(viewer("land", "dual"))).map((row) => row.id)).not.toContain(poleInterestId)
    })

    it("marks an inquiry reviewed: it stays in New, seen and no longer unread", async () => {
      await port.respondToInterest(viewer("land", "land"), { decision: "viewed", interestId: poleInterestId })

      const seen = (await port.listLandingInterests(viewer("land", "land"))).find((row) => row.id === poleInterestId)
      expect(seen?.status).toBe("viewed")
      expect(seen && landingInterestQueueFor(seen)).toBe("new")
      expect(seen && marketplaceInquiryUnread(seen, "landing")).toBe(false)
      expect(await messageCount(poleInterestId)).toBe(0)
    })

    it("declines with a reason the hauler sees, and a declined inquiry cannot be withdrawn (#194 HF-03)", async () => {
      await port.respondToInterest(viewer("land", "land"), {
        body: "We've filled this job",
        decision: "declined",
        interestId: poleInterestId,
        replyId: randomUUID()
      })

      const declined = (await port.listHaulerInterests(viewer("haul", "haul"))).find((row) => row.id === poleInterestId)
      expect(declined?.status).toBe("declined")
      expect(declined?.replies.map((entry) => [entry.authorSide, entry.body])).toEqual([["landing", "We've filled this job"]])

      await expect(port.withdrawInterestWithReason(viewer("haul", "haul"), { interestId: poleInterestId, reason: "Never mind", replyId: randomUUID() }))
        .rejects.toThrow("The landing has closed this inquiry")
      await expect(port.withdrawInterest(viewer("haul", "haul"), poleInterestId)).rejects.toThrow("The landing has closed this inquiry")

      expect(await messageCount(poleInterestId)).toBe(1)
      expect((await one<{ status: string }>("select status from marketplace.expressions_of_interest where id = $1::uuid", [poleInterestId])).status)
        .toBe("declined")
    })

    it("withdraws with a reason the landing sees, once, in one change, and only from the business that sent it", async () => {
      const input = { interestId: dualPoleInterestId, reason: "Booked on another job this week", replyId: randomUUID() }

      await expect(port.withdrawInterestWithReason(viewer("haul", "haul"), input)).rejects.toThrow("Inquiry not found")
      expect(await messageCount(dualPoleInterestId)).toBe(0)

      await port.withdrawInterestWithReason(viewer("land", "dual"), input)
      await port.withdrawInterestWithReason(viewer("land", "dual"), input)

      const withdrawn = (await port.listLandingInterests(viewer("land", "land"))).find((row) => row.id === dualPoleInterestId)
      expect(withdrawn?.status).toBe("withdrawn")
      expect(withdrawn?.replies.map((entry) => [entry.authorSide, entry.body])).toEqual([["hauler", "Booked on another job this week"]])
      expect(withdrawn && landingInterestQueueFor(withdrawn)).toBe("closed")
    })
  })

  // -------------------------------------------------------------------------------------------------------------
  describe("the job page: reports and a job that stopped (#130)", () => {
    const reportsOf = async (jobId: string) =>
      (await admin.unsafe(
        "select reporter_user_id::text as reporter, target_kind, reason, details, status from marketplace.abuse_reports where target_id = $1::uuid order by created_at",
        [jobId]
      )) as unknown as Array<{ reporter: string; target_kind: string; reason: string; details: string | null; status: string }>

    it("files one report per person and listing, as that person, with the reason the person chose", async () => {
      const first = await port.reportListing(viewer("haul", "haul"), { details: "Filled last week", jobId: landJobId, reason: "stale" })
      const again = await port.reportListing(viewer("haul", "haul"), { details: "Still up", jobId: landJobId, reason: "inaccurate_pay" })

      expect(first.alreadyReported).toBe(false)
      expect(again).toEqual({ ...first, alreadyReported: true })
      expect(await reportsOf(landJobId)).toEqual([
        { details: "Reason: No longer available.\nFilled last week", reason: "other", reporter: fixture.users.haul, status: "open", target_kind: "job_posting" }
      ])
    })

    it("keeps each person's report apart, and a schema reason as itself", async () => {
      const rival = await port.reportListing(viewer("rival", "rival"), { jobId: landJobId, reason: "inaccurate_pay" })

      expect(rival.alreadyReported).toBe(false)
      expect((await reportsOf(landJobId)).map((row) => [row.reporter, row.reason])).toEqual([
        [fixture.users.haul, "other"],
        [fixture.users.rival, "inaccurate_pay"]
      ])
    })

    it("refuses a listing the person cannot see, and files nothing", async () => {
      const missing = randomUUID()

      await expect(port.reportListing(viewer("haul", "haul"), { jobId: missing, reason: "fake_work" })).rejects.toThrow("Listing not found")
      expect(await reportsOf(missing)).toEqual([])
    })

    it("shows a paused job to its own business and to a business that sent interest, never to the public", async () => {
      await admin.unsafe(`do $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('role','authenticated','iss','${ISSUER}','sub','adapter_rival','aud','${AUDIENCE}','exp',extract(epoch from now())::bigint + 600)::text, true);
  set local role authenticated;
  perform marketplace.set_job_posting_status('${rivalJobId}'::uuid, 'paused');
  reset role;
end
$$;`)

      expect(await port.getJob(rivalJobId)).toBeNull()
      expect(await port.getJob(rivalJobId, viewer("rival", "rival"))).toMatchObject({ acceptingInterest: false, id: rivalJobId, status: "paused" })
      // Adapter Timber Hauling's inquiry on it was withdrawn, but it was sent: the job can still say why it stopped.
      expect((await port.getJob(rivalJobId, viewer("land", "dual")))?.status).toBe("paused")
      expect(await port.getJob(rivalJobId, viewer("stranger", "land"))).toBeNull()

      const seen = JSON.stringify(await port.getJob(rivalJobId, viewer("rival", "rival")))
      for (const secret of PRIVATE_STRINGS) expect(seen).not.toContain(secret)
    })
  })

  // -------------------------------------------------------------------------------------------------------------
  describe("session memberships (#213)", () => {
    const NEWCOMER = "adapter_newcomer"
    const newcomerHints = vi.fn(async () => ({ fullName: "New Comer", verifiedEmail: "newcomer@adapter-contract.test" as string | null }))
    const noHints = async () => ({ fullName: "", verifiedEmail: null })

    /** One statement as a person, through the migration role with that person's claims (as the fixture does). */
    async function asPerson(subject: string, query: string, values: Array<string | null> = []) {
      const claims = JSON.stringify({ aud: AUDIENCE, exp: Math.floor(Date.now() / 1000) + 600, iss: ISSUER, role: "authenticated", sub: subject })

      return admin.begin(async (tx) => {
        await tx.unsafe("select set_config('request.jwt.claims', $1::text, true), set_config('role', 'authenticated', true)", [claims])
        return tx.unsafe(query, values)
      }) as Promise<Array<Record<string, unknown>>>
    }

    const linksFor = async (subject: string) =>
      (await one<{ n: number }>("select count(*)::int as n from marketplace.identity_links where issuer = $1 and subject = $2", [ISSUER, subject])).n

    it("lists each person's active memberships of active businesses, as the schema's access function reports them", async () => {
      const land = await sessionStore.resolve({ hints: noHints, subject: "adapter_land" })

      expect(land?.person).toEqual({ displayName: "Land Owner", email: "land@adapter-contract.test", id: fixture.users.land })
      // Both were created in one fixture transaction (equal created_at), so compare them by name.
      const byName = (left: unknown[], right: unknown[]) => String(left[0]).localeCompare(String(right[0]))
      expect(land?.memberships.map((entry) => [entry.organizationName, entry.role, entry.haulerProfile]).sort(byName)).toEqual([
        ["Adapter Timber", "owner", false],
        ["Adapter Timber Hauling", "owner", true]
      ])
      expect(land?.memberships.find((entry) => entry.organizationId === fixture.orgs.land)?.capabilities)
        .toEqual(expect.arrayContaining(["job.publish", "landing.manage", "inquiry.respond"]))
      expect(land?.memberships.map(v2MembershipFromNormalized).map((entry) => [entry.organization.displayName, entry.kindLabel, entry.roleLabel]).sort(byName))
        .toEqual([["Adapter Timber", "Landing business", "Owner"], ["Adapter Timber Hauling", "Hauling business", "Owner"]])

      expect((await sessionStore.resolve({ hints: noHints, subject: "adapter_haul" }))?.memberships.map((entry) => entry.organizationId))
        .toEqual([fixture.orgs.haul])

      const stranger = await sessionStore.resolve({ hints: noHints, subject: "adapter_stranger" })
      expect(stranger).toEqual({ memberships: [], person: { displayName: "Stranger", email: "stranger@adapter-contract.test", id: fixture.users.stranger } })
    })

    it("resolves no one for a subject that is not linked, and writes nothing without the identity-sync connection", async () => {
      await expect(sessionStore.resolve({ hints: newcomerHints, subject: NEWCOMER })).resolves.toBeNull()
      expect(newcomerHints).not.toHaveBeenCalled()
      expect(await linksFor(NEWCOMER)).toBe(0)
    })

    it("links a first sign-in through sync_verified_identity, once, keyed to the session's Clerk user id", async () => {
      const users = async () => (await one<{ n: number }>("select count(*)::int as n from marketplace.app_users")).n
      const before = await users()

      const first = await linkingStore.resolve({ hints: newcomerHints, subject: NEWCOMER })
      expect(first).toMatchObject({ memberships: [], person: { displayName: "New Comer", email: "newcomer@adapter-contract.test" } })
      expect(await linksFor(NEWCOMER)).toBe(1)
      expect(await users()).toBe(before + 1)

      const again = await linkingStore.resolve({ hints: newcomerHints, subject: NEWCOMER })
      expect(again?.person.id).toBe(first?.person.id)
      expect(newcomerHints).toHaveBeenCalledOnce()
      expect(await users()).toBe(before + 1)

      // An address the provider has not verified is never stored (16 B-5).
      await linkingStore.resolve({ hints: async () => ({ fullName: "Unverified", verifiedEmail: null }), subject: "adapter_unverified" })
      const contact = await one<{ n: number }>(
        "select count(*)::int as n from marketplace.user_contacts c join marketplace.identity_links l on l.user_id = c.user_id where l.subject = $1",
        ["adapter_unverified"]
      )
      expect(contact.n).toBe(0)
    })

    it("links only over a login role that can become service_role and nothing else", async () => {
      const attempt = { displayName: "Never Linked", email: null, emailVerified: false, issuer: ISSUER, subject: "adapter_never" }

      await expect(createPostgresIdentitySync({ sql: adapterSql }).link(attempt)).rejects.toThrow(/cannot switch to the service_role role/)
      await expect(createPostgresIdentitySync({ sql: unsafeSql }).link(attempt)).rejects.toThrow(/roles other than service_role \(anon, authenticated\)/)
      await expect(createPostgresIdentitySync({ sql: admin }).link(attempt)).rejects.toThrow(/superuser/)
      expect(await linksFor("adapter_never")).toBe(0)

      // By itself the sync role reads nothing and cannot act as a person; the marketplace connection refuses it.
      await expect(syncSql.unsafe("select count(*) from marketplace.app_users")).rejects.toMatchObject({ code: "42501" })
      await expect(syncSql.begin((tx) => tx.unsafe("set local role authenticated"))).rejects.toMatchObject({ code: "42501" })
      await expect(createPostgresMarketplaceDb({ sql: syncSql }).asAnon(async () => "ran")).rejects.toThrow(MarketplaceAdapterConfigurationError)
    })

    it("makes a business created through create_organization selectable at once", async () => {
      const [created] = await asPerson(NEWCOMER, "select marketplace.create_organization('Adapter Newcomer Logging', 'adapter-newcomer-logging', 'OR', false)::text as id")
      const organizationId = String(created?.id)

      const session = await linkingStore.resolve({ hints: newcomerHints, subject: NEWCOMER })
      const memberships = (session?.memberships ?? []).map(v2MembershipFromNormalized)

      expect(memberships).toEqual([{ kindLabel: "Landing business", organization: { displayName: "Adapter Newcomer Logging", id: organizationId }, roleLabel: "Owner" }])
      expect(selectV2Membership(memberships, organizationId)).toEqual({ active: memberships[0], invalid: false })
      expect(selectV2Membership(memberships, null).active?.organization.id).toBe(organizationId)

      // The adapter acts for it as the same person.
      subjects.set(session?.person.id ?? "", NEWCOMER)
      await expect(port.viewerAccess({ organizationId, userId: session?.person.id ?? "" }))
        .resolves.toMatchObject({ organizationName: "Adapter Newcomer Logging" })
    })

    it("drops a removed membership on the next read, so a stale switch to it is refused and access ends", async () => {
      // The landing's owner invites the stranger as a driver (no landing seat), and the stranger accepts.
      await asPerson("adapter_land",
        "insert into marketplace.organization_memberships (org_id, user_id, role, landing_workspace_seat, status) values ($1::uuid, $2::uuid, 'driver', false, 'invited')",
        [fixture.orgs.land, fixture.users.stranger])
      const invited = await sessionStore.resolve({ hints: noHints, subject: "adapter_stranger" })
      expect(invited?.memberships).toEqual([]) // an invitation alone lists nothing

      await asPerson("adapter_stranger",
        "update marketplace.organization_memberships set status = 'active' where org_id = $1::uuid and user_id = marketplace.current_user_id()",
        [fixture.orgs.land])

      const joined = ((await sessionStore.resolve({ hints: noHints, subject: "adapter_stranger" }))?.memberships ?? []).map(v2MembershipFromNormalized)
      expect(joined.map((entry) => [entry.organization.id, entry.roleLabel])).toEqual([[fixture.orgs.land, "Driver"]])
      expect(selectV2Membership(joined, fixture.orgs.land)).toEqual({ active: joined[0], invalid: false })
      await expect(port.viewerAccess(viewer("stranger", "land"))).resolves.toMatchObject({ organizationName: "Adapter Timber" })

      // The owner removes the stranger. The page the stranger already has still shows the business.
      await asPerson("adapter_land",
        "update marketplace.organization_memberships set status = 'removed' where org_id = $1::uuid and user_id = $2::uuid",
        [fixture.orgs.land, fixture.users.stranger])

      const after = ((await sessionStore.resolve({ hints: noHints, subject: "adapter_stranger" }))?.memberships ?? []).map(v2MembershipFromNormalized)
      expect(after).toEqual([])
      // The switch action's check (switch-actions.ts) and the session's selection rule both refuse it.
      expect(after.some((entry) => entry.organization.id === fixture.orgs.land)).toBe(false)
      expect(selectV2Membership(after, fixture.orgs.land)).toEqual({ active: null, invalid: true })
      await expect(port.viewerAccess(viewer("stranger", "land"))).rejects.toBeInstanceOf(MarketplaceRefusalError)
    })

    it("drops a business that is suspended from every member's list", async () => {
      await admin.unsafe("update marketplace.organizations set status = 'suspended' where id = $1::uuid", [fixture.orgs.dual])

      try {
        const land = await sessionStore.resolve({ hints: noHints, subject: "adapter_land" })
        expect(land?.memberships.map((entry) => entry.organizationId)).toEqual([fixture.orgs.land])
      } finally {
        await admin.unsafe("update marketplace.organizations set status = 'active' where id = $1::uuid", [fixture.orgs.dual])
      }
    })

    it("sets up a hauling business for a first sign-in (/v2/start/hauler), selectable at once as a hauling business", async () => {
      const subject = "adapter_new_hauler"
      const linked = await linkingStore.resolve({ hints: async () => ({ fullName: "New Hauler", verifiedEmail: null }), subject })
      const userId = linked?.person.id ?? ""
      expect(linked?.memberships).toEqual([])
      subjects.set(userId, subject)

      const { organizationId } = await port.createHaulingBusiness({ userId }, {
        about: "",
        acceptsInvitations: false,
        businessName: "Adapter New Hauling",
        homeBase: "Sweet Home, OR",
        homeBasePoint: { lat: 44.4, lng: -122.7 },
        legalName: "",
        listed: false,
        serviceRadiusMiles: null
      })

      const memberships = (await sessionStore.resolve({ hints: noHints, subject }))?.memberships ?? []
      expect(memberships.map((entry) => [entry.organizationId, entry.role, entry.haulerProfile])).toEqual([[organizationId, "owner", true]])
      expect(memberships[0]?.capabilities).toEqual(expect.arrayContaining(["interest.express", "interest.withdraw", "interest.reply"]))
      expect(memberships[0]?.capabilities).not.toContain("job.publish")

      const choices = memberships.map(v2MembershipFromNormalized)
      expect(choices).toEqual([{ kindLabel: "Hauling business", organization: { displayName: "Adapter New Hauling", id: organizationId }, roleLabel: "Owner" }])
      expect(selectV2Membership(choices, organizationId)).toEqual({ active: choices[0], invalid: false })
      await expect(port.haulerProfile({ organizationId, userId })).resolves.toMatchObject({
        businessName: "Adapter New Hauling",
        homeBase: "Sweet Home, OR",
        listed: false,
        organizationId
      })
    })

    it("creates no business for someone the session does not resolve, and leaves nothing half-made", async () => {
      const organizations = async () => (await one<{ n: number }>("select count(*)::int as n from marketplace.organizations")).n
      const before = await organizations()
      const input = { about: "", acceptsInvitations: false, businessName: "Never Made", homeBase: "", legalName: "", listed: false, serviceRadiusMiles: null }

      await expect(port.createHaulingBusiness({ userId: randomUUID() }, input)).rejects.toBeInstanceOf(MarketplaceRefusalError)
      // A principal whose claims resolve to no one (an untrusted issuer) is refused by create_organization itself.
      const untrusted = createNormalizedMarketplaceV2({ db, principal: principalFor("https://clerk.untrusted.test") })
      await expect(untrusted.createHaulingBusiness({ userId: fixture.users.haul }, input)).rejects.toBeInstanceOf(MarketplaceRefusalError)
      expect(await organizations()).toBe(before)
    })
  })

  // -------------------------------------------------------------------------------------------------------------
  it("never leaves an identity on the pooled connection", async () => {
    await port.viewerAccess(viewer("land", "land"))

    const [session] = await adapterSql.unsafe(
      "select current_user::text as role, coalesce(current_setting('request.jwt.claims', true), '') as claims, current_setting('role') as set_role"
    )
    expect(session).toEqual({ claims: "", role: ADAPTER_ROLE, set_role: "none" })
  })
})
