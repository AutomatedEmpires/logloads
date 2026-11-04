import { randomUUID } from "node:crypto"

import postgres, { type Sql } from "postgres"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { seedLandings, seedLoadPostings, seedOrganizationMemberships, seedOrganizations, seedProfiles } from "@logloads/db"

import type { SessionActor } from "../session-policy"
import { normalizedAdapterConfiguration, sessionPrincipalResolver, type NormalizedAdapterConfiguration } from "./adapter"
import { createNormalizedMarketplaceV2 } from "./normalized-adapter"
import { createPostgresMarketplaceDb, type MarketplaceDb } from "./normalized-db"
import { MarketplaceRefusalError, type MarketplaceV2Port, type MarketplaceV2Viewer } from "./port"

/**
 * The normalized adapter on a store deployed the way the owner deploys staging (#200): `tools/normalized-store.mjs
 * schema --apply` (the migration chain, the issuer row and the adapter's login role) and `seed --apply` (the
 * synthetic pilot demo seed, architecture/normalized-v2/seed/pilot_demo_seed.sql), on a disposable database in
 * `.github/workflows/normalized-adapter-ci.yml` (plain PostgreSQL 17, and the Supabase local stack).
 *
 * Unlike normalized-adapter.contract.test.ts, nothing here creates fixtures: every person, business, landing and job
 * comes from the seed, and the adapter connects as the login role the tool created, through the same configuration
 * and session-principal path the app uses (`adapter.ts`). It runs only there, and skips anywhere else; with
 * LOGLOADS_ADAPTER_CONTRACT=required a missing seeded store FAILS.
 */

const ADMIN_URL = process.env.LOGLOADS_DISPOSABLE_DB_URL ?? ""
const ADAPTER_URL = process.env.LOGLOADS_NORMALIZED_DATABASE_URL ?? ""
const REQUIRED = process.env.LOGLOADS_ADAPTER_CONTRACT === "required"
const DISPOSABLE_TARGETS: Record<string, RegExp> = {
  "ci-disposable": /^postgresql:\/\/postgres:[A-Za-z0-9_-]+@127\.0\.0\.1:5432\/logloads_test$/,
  "supabase-local-ci": /^postgresql:\/\/postgres:postgres@127\.0\.0\.1:54322\/postgres$/
}
const SEEDED =
  process.env.GITHUB_ACTIONS === "true" &&
  (DISPOSABLE_TARGETS[process.env.LOGLOADS_DB_ENV ?? ""]?.test(ADMIN_URL) ?? false) &&
  /^postgresql:\/\/logloads_[a-z0-9_]+:[^@\s]+@127\.0\.0\.1:(?:5432|54322)\/[A-Za-z0-9_]+$/.test(ADAPTER_URL)

if (REQUIRED && !SEEDED) {
  describe("normalized adapter on the seeded store", () => {
    it("runs only against the guarded disposable database the owner tool deployed and seeded", () => {
      throw new Error("LOGLOADS_ADAPTER_CONTRACT=required, but the seeded disposable store is not configured")
    })
  })
}

// The pilot seed (packages/db) is the source of truth for every id the normalized seed must carry.
function profile(email: string) {
  const found = seedProfiles.find((candidate) => candidate.email === email)
  if (!found) throw new Error(`no seeded profile ${email}`)
  return found
}

function business(slug: string) {
  const found = seedOrganizations.find((candidate) => candidate.slug === slug)
  if (!found) throw new Error(`no seeded organization ${slug}`)
  return found
}

function job(title: string) {
  const found = seedLoadPostings.find((candidate) => candidate.title === title)
  if (!found) throw new Error(`no seeded load posting ${title}`)
  return found
}

const DANA = "dispatch@northpine.example" // North Pine Logging's landing desk (staff), and Summit Ridge Timber staff
const MAYA = "maya@northpine.example" // North Pine Logging driver
const COLE = "cole@summit.example" // Summit Ridge Timber owner
const MORGAN = "emptyfleet@logloads.example" // New River Hauling owner, no trucks listed
const AVERY = "avery@granitecreek.example" // Granite Creek Hauling owner, trucks listed
const NORTH_PINE = "north-pine-logging"
const SUMMIT = "summit-ridge-timber"
const NEW_RIVER = "new-river-hauling"
const GRANITE_CREEK = "granite-creek-hauling"
const SEEDED_SLUGS = [GRANITE_CREEK, NEW_RIVER, NORTH_PINE, SUMMIT]
const OPEN_JOBS = ["Oak saw-log morning run", "Oak chip shuttle", "Blue River high-grade campaign"]

describe.skipIf(!SEEDED)("normalized adapter on the seeded store", () => {
  let admin: Sql
  let configuration: NormalizedAdapterConfiguration
  let db: MarketplaceDb
  let privateStrings: string[] = []
  let newRiverInterestId = ""

  /** The port as the app builds it for a signed-in person: the session's own profile is the principal. */
  const portFor = (email: string): MarketplaceV2Port => {
    const actor = { profile: profile(email) } as unknown as SessionActor
    return createNormalizedMarketplaceV2({ db, principal: sessionPrincipalResolver(configuration.identity, async () => actor) })
  }
  const viewer = (email: string, slug: string): MarketplaceV2Viewer => ({ organizationId: business(slug).id, userId: profile(email).id })
  const anonymous = () => portFor(DANA)

  beforeAll(async () => {
    admin = postgres(ADMIN_URL, { max: 1, onnotice: () => undefined, prepare: false })
    configuration = normalizedAdapterConfiguration({
      LOGLOADS_MARKETPLACE_V2_ADAPTER: "normalized",
      LOGLOADS_NORMALIZED_DATABASE_URL: ADAPTER_URL,
      LOGLOADS_NORMALIZED_IDENTITY_AUDIENCE: process.env.LOGLOADS_NORMALIZED_IDENTITY_AUDIENCE,
      LOGLOADS_NORMALIZED_IDENTITY_ISSUER: process.env.LOGLOADS_NORMALIZED_IDENTITY_ISSUER
    })
    db = createPostgresMarketplaceDb({ url: configuration.databaseUrl })

    const [marker] = await admin.unsafe("select coalesce(shobj_description(oid, 'pg_database'), '') as marker from pg_database where datname = current_database()")
    expect(String(marker?.marker)).toMatch(/^logloads-ci-disposable:/)

    const rows = await admin.unsafe(`
      select directions, gate_instructions, site_contact_phone,
             extensions.st_x(exact_point::extensions.geometry)::text as lng, extensions.st_y(exact_point::extensions.geometry)::text as lat
      from marketplace.landing_private_details`) as unknown as Array<Record<string, string>>
    privateStrings = rows.flatMap((row) => [row.directions, row.gate_instructions, row.site_contact_phone, row.lng, row.lat].map(String))
    expect(privateStrings).toHaveLength(10)
  }, 60_000)

  afterAll(async () => {
    await Promise.allSettled([db?.close(), admin?.end({ timeout: 5 })])
  })

  // -------------------------------------------------------------------------------------------------------------
  it("was deployed and seeded by the owner tool: the full ledger, and the seed marker", async () => {
    const [ledger] = await admin.unsafe("select string_agg(version, ',' order by applied_at, version) as versions from marketplace.schema_migrations")
    expect(ledger?.versions).toBe("06,11,12,16,18,23")

    const [seed] = await admin.unsafe("select count(*)::int as n from marketplace.audit_events where action = 'seed.pilot_demo_loaded'")
    expect(seed?.n).toBe(1)
  })

  it("connects as the tool's login role: NOINHERIT, with timeouts, and unable to read a table until it switches", async () => {
    const role = decodeURIComponent(new URL(ADAPTER_URL).username)
    const [facts] = await admin.unsafe(
      `select r.rolinherit, r.rolsuper, r.rolbypassrls, r.rolcreaterole,
              (select array_agg(g.rolname::text order by g.rolname) from pg_auth_members m join pg_roles g on g.oid = m.roleid where m.member = r.oid) as member_of,
              (select array_agg(s order by s) from pg_db_role_setting d, unnest(d.setconfig) s where d.setrole = r.oid) as settings
       from pg_roles r where r.rolname = $1`,
      [role]
    )
    expect(facts).toMatchObject({ member_of: ["anon", "authenticated"], rolbypassrls: false, rolcreaterole: false, rolinherit: false, rolsuper: false })
    expect(facts?.settings).toEqual(expect.arrayContaining(["idle_in_transaction_session_timeout=60s", "statement_timeout=15s"]))

    const direct = postgres(ADAPTER_URL, { max: 1, onnotice: () => undefined, prepare: false })
    try {
      await expect(direct.unsafe("select count(*) from marketplace.job_postings")).rejects.toMatchObject({ code: "42501" })
    } finally {
      await direct.end({ timeout: 5 })
    }
  })

  it("carries the pilot seed's ids for businesses, people, memberships, landings and jobs", async () => {
    const organizations = await admin.unsafe("select id::text as id, slug, display_name from marketplace.organizations order by slug") as unknown as Array<Record<string, string>>
    expect(organizations).toEqual(SEEDED_SLUGS.map((slug) => ({ display_name: business(slug).displayName, id: business(slug).id, slug })))

    const links = await admin.unsafe(
      "select subject, user_id::text as user_id from marketplace.identity_links where issuer = $1 order by subject",
      [configuration.identity.issuer]
    ) as unknown as Array<Record<string, string>>
    expect(links).toHaveLength(9)
    for (const link of links) {
      expect(seedProfiles.find((candidate) => candidate.clerkUserId === link.subject)?.id, link.subject).toBe(link.user_id)
    }

    const memberships = await admin.unsafe("select id::text as id, org_id::text as org, user_id::text as user from marketplace.organization_memberships order by id") as unknown as Array<Record<string, string>>
    expect(memberships).toEqual(
      seedOrganizationMemberships
        .filter((membership) => SEEDED_SLUGS.some((slug) => business(slug).id === membership.organizationId))
        .map((membership) => ({ id: membership.id, org: membership.organizationId, user: membership.userId }))
        .sort((a, b) => a.id.localeCompare(b.id))
    )

    const landings = await admin.unsafe("select id::text as id, org_id::text as org, name from marketplace.landings order by id") as unknown as Array<Record<string, string>>
    expect(landings).toEqual(seedLandings.map((landing) => ({ id: landing.id, name: landing.name, org: landing.companyId })))

    const jobs = await admin.unsafe("select id::text as id, org_id::text as org, landing_id::text as landing, title, status from marketplace.job_postings order by id") as unknown as Array<Record<string, string>>
    expect(jobs).toHaveLength(5)
    for (const row of jobs) {
      const pilot = job(row.title as string)
      expect({ id: row.id, landing: row.landing, org: row.org }, row.title).toEqual({ id: pilot.id, landing: pilot.pickupLandingId, org: pilot.companyId })
    }
    expect(Object.fromEntries(jobs.map((row) => [row.title, row.status]))).toMatchObject({ "Blue River pulp contingency": "filled", "Oak recovery load": "closed" })
  })

  // -------------------------------------------------------------------------------------------------------------
  it("shows anonymous discovery the three open seeded jobs, newest first, and nothing private", async () => {
    const listed = await anonymous().listJobs({ acceptingOnly: true })

    expect(listed.map((candidate) => candidate.title)).toEqual(OPEN_JOBS)
    expect(listed.map((candidate) => candidate.id)).toEqual(OPEN_JOBS.map((title) => job(title).id))
    expect(listed[0]).toMatchObject({
      acceptingInterest: true,
      destinationLabel: "Cascade Mill · Springfield, OR",
      equipment: ["log_truck", "pole_trailer"],
      haulDistance: { basis: "poster_route_estimate", miles: 54 },
      origin: { approximatePoint: { lat: 43.7, lng: -122.5 }, label: "Oakridge, OR", stateCode: "OR" },
      pay: { amountCents: 52500, note: null, unit: "per_load" },
      posterName: "North Pine Logging",
      posterOrganizationId: business(NORTH_PINE).id,
      posterVerification: { scope: "business_identity" },
      status: "active",
      trucks: { perDay: 3, total: 3 }
    })
    expect(listed[2]?.posterOrganizationId).toBe(business(SUMMIT).id)

    // Filled and closed jobs are not public, in the list or by id.
    expect((await anonymous().listJobs({ acceptingOnly: false })).map((candidate) => candidate.title)).toEqual(OPEN_JOBS)
    expect(await anonymous().getJob(job("Blue River pulp contingency").id)).toBeNull()
    expect(await anonymous().getJob(job("Oak recovery load").id)).toBeNull()

    const detail = await anonymous().getJob(job("Oak saw-log morning run").id)
    expect(detail?.publicAccessRequirements).toEqual(["Radio on the landing channel"])

    const everything = JSON.stringify([listed, detail])
    for (const secret of privateStrings) expect(everything).not.toContain(secret)
  })

  it("resolves each seeded person to their pilot business, with the capabilities the V2 pages rely on", async () => {
    const access = async (email: string, slug: string) => portFor(email).viewerAccess(viewer(email, slug))

    expect(await access(DANA, NORTH_PINE)).toMatchObject({ organizationName: "North Pine Logging" })
    expect((await access(DANA, NORTH_PINE)).capabilities).toEqual(expect.arrayContaining(["job.publish", "inquiry.respond", "interest.express"]))
    expect((await access(DANA, SUMMIT)).capabilities).toEqual(expect.arrayContaining(["job.publish", "inquiry.respond"]))
    expect((await access(COLE, SUMMIT)).capabilities).toEqual(expect.arrayContaining(["job.publish", "landing.manage", "inquiry.respond"]))
    expect((await access(MORGAN, NEW_RIVER)).capabilities).toEqual(expect.arrayContaining(["interest.express", "interest.reply"]))
    expect((await access(AVERY, GRANITE_CREEK)).capabilities).toEqual(expect.arrayContaining(["interest.express", "equipment.manage"]))

    // A driver holds no landing seat; a person outside a business is refused.
    expect((await access(MAYA, NORTH_PINE)).capabilities).not.toContain("job.publish")
    await expect(portFor(MAYA).authoringLandings(viewer(MAYA, NORTH_PINE))).rejects.toBeInstanceOf(MarketplaceRefusalError)
    await expect(access(COLE, NORTH_PINE)).rejects.toBeInstanceOf(MarketplaceRefusalError)

    const oak = seedLandings.find((landing) => landing.companyId === business(NORTH_PINE).id)
    expect(await portFor(DANA).authoringLandings(viewer(DANA, NORTH_PINE))).toEqual([{ areaLabel: "Oakridge, OR", id: oak?.id, name: "Oak Landing", stateCode: "OR" }])
  })

  it("offers each hauler its own listed equipment and profile (DS-05's Granite Creek setups; none for New River)", async () => {
    const options = await portFor(AVERY).haulerEquipment(viewer(AVERY, GRANITE_CREEK))

    expect(options.map(({ configurationKey, label, unitsListed }) => ({ configurationKey, label, unitsListed }))).toEqual([
      { configurationKey: "log_truck|bunk_trailer", label: "Log truck + Bunk / short-log", unitsListed: 2 },
      { configurationKey: "log_truck|pole_trailer", label: "Log truck + Pole trailer", unitsListed: 1 }
    ])
    expect(await portFor(MORGAN).haulerEquipment(viewer(MORGAN, NEW_RIVER))).toEqual([])

    // The hauling profiles: Granite Creek Hauling consented to public discovery; New River Hauling did not.
    expect(await portFor(AVERY).haulerProfile(viewer(AVERY, GRANITE_CREEK))).toMatchObject({
      businessName: "Granite Creek Hauling",
      canEditProfile: true,
      homeBase: "Springfield, OR",
      listed: true,
      organizationId: business(GRANITE_CREEK).id,
      serviceRadiusMiles: 75
    })
    expect(await portFor(MORGAN).haulerProfile(viewer(MORGAN, NEW_RIVER))).toMatchObject({ businessName: "New River Hauling", listed: false })
  })

  // -------------------------------------------------------------------------------------------------------------
  it("lets New River Hauling express interest in North Pine Logging's job, and the landing desk reply", async () => {
    const jobId = job("Oak saw-log morning run").id
    const interest = await portFor(MORGAN).expressInterest(viewer(MORGAN, NEW_RIVER), {
      loadPostingId: jobId,
      message: "One truck from Oakridge, mornings",
      trucksOffered: "1"
    })
    newRiverInterestId = interest.id

    expect(interest).toMatchObject({
      haulerOrganization: { id: business(NEW_RIVER).id, name: "New River Hauling" },
      job: { id: jobId, status: "active" },
      landingOrganization: { id: business(NORTH_PINE).id },
      status: "submitted",
      submittedBy: { userId: profile(MORGAN).id },
      trucksOffered: 1
    })
    expect((await portFor(DANA).listLandingInterests(viewer(DANA, NORTH_PINE))).map((row) => row.id)).toEqual([newRiverInterestId])
    // Summit Ridge Timber's inbox stays empty (DS-05 LANDING_WITHOUT_INQUIRIES).
    expect(await portFor(COLE).listLandingInterests(viewer(COLE, SUMMIT))).toEqual([])

    await portFor(DANA).respondToInterest(viewer(DANA, NORTH_PINE), {
      body: "Call the office to set a start date",
      decision: "replied",
      interestId: newRiverInterestId,
      replyId: randomUUID()
    })

    const seen = (await portFor(MORGAN).listHaulerInterests(viewer(MORGAN, NEW_RIVER))).find((row) => row.id === newRiverInterestId)
    expect(seen?.status).toBe("replied")
    expect(seen?.replies.map((entry) => [entry.authorSide, entry.body])).toEqual([["landing", "Call the office to set a start date"]])
    expect(seen?.replies[0]?.authorUserId).toBe(profile(DANA).id)

    const [shared] = await admin.unsafe("select private_details_shared_at is not null as shared from marketplace.expressions_of_interest where id = $1::uuid", [newRiverInterestId])
    expect(shared?.shared).toBe(false)
    for (const secret of privateStrings) expect(JSON.stringify(seen)).not.toContain(secret)
  })

  it("refuses what the product refuses on the seeded data, and writes nothing", async () => {
    const count = async () => Number((await admin.unsafe("select count(*)::int as n from marketplace.expressions_of_interest"))[0]?.n)
    const before = await count()

    // DS-05's refused offer: more bunk setups than Granite Creek Hauling lists.
    await expect(portFor(AVERY).expressInterest(viewer(AVERY, GRANITE_CREEK), {
      equipment: [{ configurationKey: "log_truck|bunk_trailer", count: "3" }],
      loadPostingId: job("Oak saw-log morning run").id
    })).rejects.toThrow(/Your profile lists 2 x Log truck \+ Bunk \/ short-log/)

    // A closed job refuses new interest.
    await expect(portFor(MORGAN).expressInterest(viewer(MORGAN, NEW_RIVER), { loadPostingId: job("Oak recovery load").id, trucksOffered: "1" }))
      .rejects.toThrow(/no longer accepting interest/)

    // A stranger cannot respond to someone else's inquiry.
    await expect(portFor(COLE).respondToInterest(viewer(COLE, SUMMIT), { decision: "viewed", interestId: newRiverInterestId }))
      .rejects.toThrow("Inquiry not found")

    expect(await count()).toBe(before)
  })
})
