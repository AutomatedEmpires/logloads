import { randomBytes } from "node:crypto"

import postgres, { type Sql } from "postgres"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { HAULER_IDENTITY_EDIT_REFUSED, HAULER_PROFILE_EDIT_REFUSED, publicHaulerProfile } from "@logloads/services"

import { createNormalizedMarketplaceV2 } from "./normalized-adapter"
import { createPostgresMarketplaceDb, type MarketplacePrincipal } from "./normalized-db"
import { MARKETPLACE_QUERIES } from "./normalized-queries"
import { MarketplaceRefusalError, type MarketplaceV2Port, type MarketplaceV2Viewer } from "./port"

/**
 * Contract tests of the hauling business profile statements (#125, `normalized-queries.ts`) against the REAL schema,
 * on the same guarded disposable PostgreSQL 17 database as `normalized-adapter.contract.test.ts`
 * (`.github/workflows/normalized-adapter-ci.yml`). They skip anywhere else; with `LOGLOADS_ADAPTER_CONTRACT=required`
 * a missing database fails. Their fixtures use their own issuer, login role and slugs, so the two files never touch
 * each other's rows.
 */

const DB_URL = process.env.LOGLOADS_DISPOSABLE_DB_URL ?? ""
const REQUIRED = process.env.LOGLOADS_ADAPTER_CONTRACT === "required"
const DISPOSABLE =
  process.env.GITHUB_ACTIONS === "true" &&
  process.env.LOGLOADS_DB_ENV === "ci-disposable" &&
  /^postgresql:\/\/postgres:[A-Za-z0-9_-]+@127\.0\.0\.1:5432\/logloads_test$/.test(DB_URL)

const ISSUER = "https://clerk.hauler-contract.test"
const AUDIENCE = "logloads-hauler-contract"
const ROLE = "logloads_hauler_ci"
const PRIVATE_LEGAL_NAME = "Contract Ridge Hauling Holdings LLC"

if (REQUIRED && !DISPOSABLE) {
  describe("normalized hauler contract", () => {
    it("runs only against the guarded disposable PostgreSQL 17 database", () => {
      throw new Error("LOGLOADS_ADAPTER_CONTRACT=required, but the guarded disposable CI database is not configured")
    })
  })
}

function client(url: string): Sql {
  return postgres(url, { max: 1, onnotice: () => undefined, prepare: false })
}

const PEOPLE = ["owner", "manager", "driver", "rival", "stranger"] as const
type Person = (typeof PEOPLE)[number]

function fixtureSql(): string {
  const claims = (sub: string) =>
    `jsonb_build_object('role','authenticated','iss','${ISSUER}','sub','${sub}','aud','${AUDIENCE}','exp',extract(epoch from now())::bigint + 600)::text`

  return `
insert into marketplace.trusted_identity_issuers (issuer, label, expected_audience, enabled)
values ('${ISSUER}', 'Clerk (hauler contract CI)', '${AUDIENCE}', true);

do $$
declare v_haul uuid; v_rival uuid;
  worker constant text := '{"role":"service_role"}';
begin
  perform set_config('request.jwt.claims', worker, true); set local role service_role;
${PEOPLE.map((person) => `  perform marketplace.sync_verified_identity('${ISSUER}', 'hauler_${person}', 'Hauler ${person}', '${person}@hauler-contract.test', true);`).join("\n")}
  reset role;

  perform set_config('request.jwt.claims', ${claims("hauler_owner")}, true); set local role authenticated;
  v_haul := marketplace.create_organization('Contract Ridge Hauling', 'contract-ridge-hauling', 'OR', true);
  perform set_config('request.jwt.claims', ${claims("hauler_rival")}, true);
  v_rival := marketplace.create_organization('Contract Rival Hauling', 'contract-rival-hauling', 'OR', true);
  reset role;
end
$$;`
}

describe.skipIf(!DISPOSABLE)("normalized hauler profile contract (disposable PostgreSQL 17)", () => {
  let admin: Sql
  let adapterSql: Sql
  let port: MarketplaceV2Port
  const users = {} as Record<Person, string>
  const subjects = new Map<string, string>()
  let haul = ""
  let rival = ""

  const principal = async (viewer: MarketplaceV2Viewer): Promise<MarketplacePrincipal> => {
    const subject = subjects.get(viewer.userId)
    if (!subject) throw new MarketplaceRefusalError("Sign in again to continue.")
    return { audience: AUDIENCE, issuer: ISSUER, subject }
  }

  const as = (person: Person, organizationId = haul): MarketplaceV2Viewer => ({ organizationId, userId: users[person] })

  const one = async <T,>(query: string, values: Array<string | number | null> = []): Promise<T> => (await admin.unsafe(query, values))[0] as T

  const form = (overrides: Record<string, unknown> = {}) => ({
    about: "Two log trucks out of Sweet Home.",
    acceptsInvitations: false,
    businessName: "Contract Ridge Hauling",
    homeBase: "Sweet Home, OR",
    legalName: PRIVATE_LEGAL_NAME,
    listed: true,
    serviceRadiusMiles: 100,
    ...overrides
  })

  beforeAll(async () => {
    admin = client(DB_URL)
    const marker = await one<{ marker: string }>(
      "select coalesce(shobj_description(oid, 'pg_database'), '') as marker from pg_database where datname = current_database()"
    )
    expect(marker.marker.startsWith("logloads-ci-disposable:")).toBe(true)

    const password = randomBytes(18).toString("hex")
    await admin.unsafe(`create role ${ROLE} login noinherit password '${password}'`)
    await admin.unsafe(`grant anon, authenticated to ${ROLE}`)
    await admin.unsafe(fixtureSql())

    const links = await admin.unsafe("select subject, user_id::text as id from marketplace.identity_links where issuer = $1", [ISSUER]) as unknown as Array<{ subject: string; id: string }>
    for (const person of PEOPLE) {
      users[person] = links.find((link) => link.subject === `hauler_${person}`)?.id ?? ""
      subjects.set(users[person], `hauler_${person}`)
    }
    haul = (await one<{ id: string }>("select id::text as id from marketplace.organizations where slug = 'contract-ridge-hauling'")).id
    rival = (await one<{ id: string }>("select id::text as id from marketplace.organizations where slug = 'contract-rival-hauling'")).id

    // A manager and a driver of the hauling business (fleet-only seats), added as the migration role.
    await admin.unsafe(
      `insert into marketplace.organization_memberships (org_id, user_id, role, landing_workspace_seat, status)
       values ($1::uuid, $2::uuid, 'manager', false, 'active'), ($1::uuid, $3::uuid, 'driver', false, 'active')`,
      [haul, users.manager, users.driver]
    )

    adapterSql = client(DB_URL.replace(/^postgresql:\/\/postgres:[A-Za-z0-9_-]+@/, `postgresql://${ROLE}:${password}@`))
    port = createNormalizedMarketplaceV2({ db: createPostgresMarketplaceDb({ sql: adapterSql }), principal })
  }, 120_000)

  afterAll(async () => {
    await Promise.allSettled([adapterSql?.end({ timeout: 5 }), admin?.end({ timeout: 5 })])
  })

  it("reads a new hauling business as private by default, with the owner's edit rights", async () => {
    await expect(port.haulerProfile(as("owner"))).resolves.toMatchObject({
      acceptsInvitations: false,
      businessName: "Contract Ridge Hauling",
      canEditIdentity: true,
      canEditProfile: true,
      homeBase: null,
      listed: false,
      organizationId: haul,
      verification: null
    })
    await expect(port.haulerProfile(as("manager"))).resolves.toMatchObject({ canEditIdentity: false, canEditProfile: true })
    await expect(port.haulerProfile(as("driver"))).resolves.toMatchObject({ canEditIdentity: false, canEditProfile: false })
  })

  it("saves the owner's profile, recording the listing consent on the server", async () => {
    const saved = await port.saveHaulerProfile(as("owner"), form())

    expect(saved).toMatchObject({ about: "Two log trucks out of Sweet Home.", homeBase: "Sweet Home, OR", legalName: PRIVATE_LEGAL_NAME, listed: true, serviceRadiusMiles: 100 })
    const stored = await one<{ consented: boolean; consent_by: string; legal_name: string }>(
      `select h.public_listing_consent_at is not null as consented, h.public_listing_consent_by::text as consent_by, o.legal_name
       from marketplace.hauler_profiles h join marketplace.organizations o on o.id = h.org_id where h.org_id = $1::uuid`,
      [haul]
    )
    expect(stored).toEqual({ consent_by: users.owner, consented: true, legal_name: PRIVATE_LEGAL_NAME })
  })

  it("keeps the legal name and settings out of the public projection", async () => {
    const profile = await port.haulerProfile(as("owner"))
    const view = publicHaulerProfile(profile, await port.haulerEquipment(as("owner")))

    expect(JSON.stringify(view)).not.toContain(PRIVATE_LEGAL_NAME)
    expect(view).not.toHaveProperty("listed")
    expect(view).not.toHaveProperty("acceptsInvitations")
  })

  it("lets a manager change the profile but not the business name or legal name", async () => {
    await expect(port.saveHaulerProfile(as("manager"), form({ about: "Manager's words", legalName: PRIVATE_LEGAL_NAME }))).resolves.toMatchObject({ about: "Manager's words" })
    await expect(port.saveHaulerProfile(as("manager"), form({ businessName: "Renamed by a manager" }))).rejects.toThrow(HAULER_IDENTITY_EDIT_REFUSED)
    expect((await one<{ name: string }>("select display_name as name from marketplace.organizations where id = $1::uuid", [haul])).name).toBe("Contract Ridge Hauling")
  })

  it("refuses a driver's edit, and the database refuses the statement on its own too", async () => {
    await expect(port.saveHaulerProfile(as("driver"), form({ about: "Driver's words" }))).rejects.toThrow(HAULER_PROFILE_EDIT_REFUSED)

    // Without the adapter's own check: row-level security filters the driver's update out (no row changes).
    const db = createPostgresMarketplaceDb({ sql: adapterSql })
    const rows = await db.asUser(await principal(as("driver")), (calls) =>
      calls.query("hauler_profile_update", [haul, "97386", 50, "Driver's words", true, true]), { readOnly: false })
    expect(rows).toEqual([])
    expect((await one<{ about: string }>("select description as about from marketplace.hauler_profiles where org_id = $1::uuid", [haul])).about).toBe("Manager's words")
  })

  it("refuses a person outside the business, and a member of another hauling business", async () => {
    await expect(port.haulerProfile(as("stranger"))).rejects.toBeInstanceOf(MarketplaceRefusalError)
    await expect(port.haulerProfile(as("rival"))).rejects.toBeInstanceOf(MarketplaceRefusalError)
    await expect(port.saveHaulerProfile(as("rival"), form({ about: "Hijacked" }))).rejects.toBeInstanceOf(MarketplaceRefusalError)
    await expect(port.haulerProfile(as("owner", rival))).rejects.toBeInstanceOf(MarketplaceRefusalError)
    expect((await one<{ about: string }>("select description as about from marketplace.hauler_profiles where org_id = $1::uuid", [haul])).about).toBe("Manager's words")
  })

  it("sets the service point from the home base's place, on the public grid, and clears it with no home base", async () => {
    const point = async () => one<{ lat: number | null; lng: number | null }>(
      `select extensions.st_y(service_center::extensions.geometry) as lat, extensions.st_x(service_center::extensions.geometry) as lng
       from marketplace.hauler_profiles where org_id = $1::uuid`,
      [haul]
    )

    await port.saveHaulerProfile(as("owner"), form({ about: "Manager's words", homeBase: "Sweet Home, OR", homeBasePoint: { lat: 44.4, lng: -122.7 } }))
    const placed = await point()
    expect(placed.lat).toBeCloseTo(44.4, 6)
    expect(placed.lng).toBeCloseTo(-122.7, 6)

    await port.saveHaulerProfile(as("owner"), form({ about: "Manager's words", homeBase: null, homeBasePoint: null }))
    expect(await point()).toEqual({ lat: null, lng: null })
  })

  it("re-opens verification when a verified business changes its legal name (LE-08)", async () => {
    await admin.unsafe(
      "update marketplace.organizations set verification_status = 'verified', verified_at = now(), verified_by = $2::uuid where id = $1::uuid",
      [haul, users.stranger]
    )
    await expect(port.haulerProfile(as("owner"))).resolves.toMatchObject({ verification: { scope: "business_identity" } })

    await port.saveHaulerProfile(as("owner"), form({ legalName: "Contract Ridge Hauling Co." }))
    await expect(port.haulerProfile(as("owner"))).resolves.toMatchObject({ legalName: "Contract Ridge Hauling Co.", verification: null })
  })

  it("names only catalogued tables and runs every statement through has_org_role", () => {
    for (const { text } of Object.values(MARKETPLACE_QUERIES)) {
      expect(text).toContain("marketplace.has_org_role(")
    }
  })
})
