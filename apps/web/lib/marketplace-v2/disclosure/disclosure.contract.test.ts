import { randomBytes, randomUUID } from "node:crypto"

import postgres, { type Sql } from "postgres"
import { afterAll, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { createPostgresMarketplaceDb, type MarketplaceDb, type MarketplacePrincipal } from "../normalized-db"
import { jobViewFromRow } from "../normalized-mapping"
import { MarketplaceRefusalError, MarketplaceStoreError } from "../port"
import { normalizedDisclosure } from "./normalized"
import { pilotDisclosure } from "./pilot"

/**
 * The phone reveal through the adapter against the real schema (#325, #403), after stage 44 on the disposable
 * database. A local skip is not a pass. The file runs in the adapter-contract job, one file at a time, over the
 * restricted NOINHERIT login role a deployment uses.
 *
 * It proves at the API layer what stage 45 proves in SQL: the landing shows and hides its number through
 * respond_to_interest; the hauler's job view carries the access notes, gate details and phone only while that release
 * is live; anonymous, other-business and revoked responses carry none of them; a paused hauler's share is withheld
 * without an error; and a moderator clears a real pause. Its jobs are paused and its pauses removed before it returns.
 */

const DB_URL = process.env.LOGLOADS_DISPOSABLE_DB_URL ?? ""
const REQUIRED = process.env.LOGLOADS_ADAPTER_CONTRACT === "required"
const DISPOSABLE =
  process.env.GITHUB_ACTIONS === "true" &&
  process.env.LOGLOADS_DB_ENV === "ci-disposable" &&
  /^postgresql:\/\/postgres:[A-Za-z0-9_-]+@127\.0\.0\.1:5432\/logloads_test$/.test(DB_URL)

const ISSUER = "https://clerk.reveal-contract.test"
const AUDIENCE = "logloads-reveal-contract"
const ROLE = "logloads_reveal_ci"
const LEDGER = "06,11,12,16,18,23,26,29,31,33,35,38,40,42,44"
/** The fixture's phones: +1208555014 then 1 to 6. Only these copies may exist. */
const PHONE_DIGITS = "208555014"

if (REQUIRED && !DISPOSABLE) {
  describe("disclosure adapter contract", () => {
    it("runs only against the guarded disposable PostgreSQL 17 database", () => {
      throw new Error("LOGLOADS_ADAPTER_CONTRACT=required, but the guarded disposable CI database is not configured")
    })
  })
}

function roleUrl(password: string): string {
  return DB_URL.replace(/^postgresql:\/\/postgres:[A-Za-z0-9_-]+@/, `postgresql://${ROLE}:${password}@`)
}

const as = (sub: string) => `perform set_config('request.jwt.claims', jsonb_build_object(
    'role', 'authenticated', 'iss', '${ISSUER}', 'sub', '${sub}', 'aud', '${AUDIENCE}',
    'exp', extract(epoch from now())::bigint + 3600)::text, true);
  set local role authenticated;`

/** Six landings of one landing business, a job at each, three hauling businesses, and replies without a share. */
const FIXTURE = `
do $$
declare
  o_land uuid; o_haul uuid; o_rival uuid; o_burst uuid; l uuid; j uuid; e uuid; i integer;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  set local role service_role;
  perform marketplace.sync_verified_identity('${ISSUER}', 'reveal_land', 'Reveal Landing Owner', 'land@reveal-contract.test', true);
  perform marketplace.sync_verified_identity('${ISSUER}', 'reveal_haul', 'Reveal Hauler Owner', 'haul@reveal-contract.test', true);
  perform marketplace.sync_verified_identity('${ISSUER}', 'reveal_rival', 'Reveal Rival Owner', 'rival@reveal-contract.test', true);
  perform marketplace.sync_verified_identity('${ISSUER}', 'reveal_burst', 'Reveal Burst Owner', 'burst@reveal-contract.test', true);
  reset role;
  ${as("reveal_land")}
  o_land := marketplace.create_organization('Reveal Landing Co', 'dc403-landing', 'ID', false);
  reset role;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  set local role service_role;
  perform marketplace.open_subscription_cycle(o_land, 'regional', 'active', now() - interval '1 hour', now() + interval '29 days', 'cus_dc403', 'sub_dc403', false, 7, false);
  reset role;
  ${as("reveal_land")}
  for i in 1..6 loop
    insert into marketplace.landings (org_id, name, status, public_area_label, public_point, state_code)
    values (o_land, 'Reveal Landing ' || i, 'active', 'Near Elk City, ID', marketplace.make_public_point(-115.40 - (i * 0.01), 45.80), 'ID')
    returning id into l;
    insert into marketplace.landing_private_details (landing_id, org_id, exact_point, directions, gate_instructions, site_contact_name, site_contact_phone)
    values (l, o_land, extensions.st_setsrid(extensions.st_makepoint(-115.40 - (i * 0.01), 45.80), 4326)::extensions.geography,
            'Forest road ' || i, 'Gate code ' || i, 'Reveal Foreman ' || i, '+1${PHONE_DIGITS}' || i::text);
    j := marketplace.publish_job_posting(l, 'DC403 Haul ' || i, array['log_truck'], 1, 'Fir sawlogs', 'Contract haul.', 'per_ton', 500, null,
      1, current_date + 10, 8, 3.0, 6, 30.0, 'Grangeville Mill, ID', 28, null, null, array['ppe'], true);
  end loop;
  reset role;
  ${as("reveal_haul")}
  o_haul := marketplace.create_organization('Reveal Hauling', 'dc403-haul', 'ID', true);
  perform marketplace.submit_expression_of_interest(o_haul, (select id from marketplace.job_postings where title = 'DC403 Haul 1'), 1);
  reset role;
  ${as("reveal_rival")}
  o_rival := marketplace.create_organization('Reveal Rival Hauling', 'dc403-rival', 'ID', true);
  perform marketplace.submit_expression_of_interest(o_rival, (select id from marketplace.job_postings where title = 'DC403 Haul 1'), 1);
  reset role;
  ${as("reveal_burst")}
  o_burst := marketplace.create_organization('Reveal Burst Hauling', 'dc403-burst', 'ID', true);
  for i in 1..6 loop
    perform marketplace.submit_expression_of_interest(o_burst, (select id from marketplace.job_postings where title = 'DC403 Haul ' || i), 1);
  end loop;
  reset role;
  ${as("reveal_land")}
  for e in
    select x.id from marketplace.expressions_of_interest x
    join marketplace.organizations o on o.id = x.hauler_org_id
    where o.slug in ('dc403-haul', 'dc403-burst')
  loop
    perform marketplace.respond_to_interest(e, 'replied', null, gen_random_uuid(), 'Yes, we can use you. Call me.');
  end loop;
  reset role;
  ${as("reveal_staff")}
  perform marketplace.admin_set_org_verification(o_land, 'verified', 'Business documents reviewed for the contract test');
end
$$;`

const CLEANUP = `
do $$
declare j uuid;
begin
  ${as("reveal_land")}
  for j in select id from marketplace.job_postings where title like 'DC403 %' and status = 'active' loop
    perform marketplace.set_job_posting_status(j, 'paused');
  end loop;
  reset role;
  delete from marketplace.hauler_reveal_pauses p using marketplace.abuse_reports r
  where p.report_id = r.id and r.reason = 'unsafe_disclosure'
    and (r.target_id in (select id from marketplace.organizations where slug like 'dc403-%')
         or r.target_id in (select id from marketplace.app_users where display_name like 'Reveal %'));
  delete from marketplace.abuse_reports r
  where r.reason = 'unsafe_disclosure'
    and (r.target_id in (select id from marketplace.organizations where slug like 'dc403-%')
         or r.target_id in (select id from marketplace.app_users where display_name like 'Reveal %'));
end
$$;`

describe.skipIf(!DISPOSABLE)("disclosure adapter contract (disposable PostgreSQL 17)", () => {
  let admin: Sql
  let adapterSql: Sql
  let db: MarketplaceDb
  const principal = (subject: string): MarketplacePrincipal => ({ audience: AUDIENCE, issuer: ISSUER, subject })
  const staff = principal("reveal_staff")
  const person = principal("reveal_person")
  const land = principal("reveal_land")
  const haul = principal("reveal_haul")
  const rival = principal("reveal_rival")

  afterAll(async () => {
    await db?.close().catch(() => undefined)
    await adapterSql?.end({ timeout: 5 }).catch(() => undefined)
    await admin?.unsafe(CLEANUP).catch(() => undefined)
    await admin?.unsafe(`drop role if exists ${ROLE}`).catch(() => undefined)
    await admin?.end({ timeout: 5 }).catch(() => undefined)
  })

  const id = async (query: string, values: string[] = []): Promise<string> => {
    const [row] = await admin.unsafe(query, values)
    const value = (row as { id?: unknown } | undefined)?.id

    if (typeof value !== "string") throw new Error(`fixture lookup returned nothing: ${query}`)

    return value
  }
  const org = (slug: string) => id("select id::text as id from marketplace.organizations where slug = $1", [slug])
  const job = (n: number) => id("select id::text as id from marketplace.job_postings where title = $1", [`DC403 Haul ${n}`])
  const interest = (slug: string, n: number) => id(
    "select e.id::text as id from marketplace.expressions_of_interest e join marketplace.organizations o on o.id = e.hauler_org_id join marketplace.job_postings j on j.id = e.job_id where o.slug = $1 and j.title = $2",
    [slug, `DC403 Haul ${n}`]
  )

  it("sets up the reveal fixture over the restricted adapter role", async () => {
    admin = postgres(DB_URL, { max: 1, onnotice: () => undefined, prepare: false })
    const password = randomBytes(18).toString("hex")

    await admin.unsafe(
      "insert into marketplace.trusted_identity_issuers (issuer, label, expected_audience, enabled) values ($1, 'Reveal contract', $2, true) on conflict (issuer) do nothing",
      [ISSUER, AUDIENCE]
    )
    const [staffUser] = await admin.unsafe(
      "select marketplace.sync_verified_identity($1, 'reveal_staff', 'Reveal Staff', 'staff@reveal-contract.test', true)::text as id",
      [ISSUER]
    )
    await admin.unsafe(
      "select marketplace.sync_verified_identity($1, 'reveal_person', 'Reveal Person', 'person@reveal-contract.test', true)",
      [ISSUER]
    )
    await admin.unsafe(
      "insert into marketplace.platform_admins (user_id, admin_role, note) values ($1::uuid, 'moderator', 'reveal contract') on conflict (user_id) do nothing",
      [staffUser?.id]
    )
    await admin.unsafe(FIXTURE)
    await admin.unsafe(`drop role if exists ${ROLE}`)
    await admin.unsafe(`create role ${ROLE} login noinherit password '${password}'`)
    await admin.unsafe(`grant anon, authenticated to ${ROLE}`)

    adapterSql = postgres(roleUrl(password), { max: 1, onnotice: () => undefined, prepare: false })
    db = createPostgresMarketplaceDb({ sql: adapterSql })

    const ledger = await admin.unsafe("select string_agg(version, ',' order by applied_at, version) as versions from marketplace.schema_migrations")
    expect(ledger[0]?.versions).toBe(LEDGER)
  }, 60_000)

  it("refuses everything on the pilot store", async () => {
    const pilot = pilotDisclosure()
    const missing = randomUUID()

    await expect(pilot.clearHaulerRevealPause(staff, { haulerOrgId: missing, reason: "Staff reviewed it" })).rejects.toThrow(/not available until the normalized marketplace store is connected/)
    await expect(pilot.sharePhone(land, missing, { interestId: missing }, true)).rejects.toThrow(/not available until the normalized marketplace store is connected/)
    await expect(pilot.haulerJobAccess(haul, missing, missing)).rejects.toThrow(/not available until the normalized marketplace store is connected/)
  })

  it("releases the access notes, gate details and phone to that one hauling business only while the release is live", async () => {
    const disclosure = normalizedDisclosure(db)
    const [landOrg, haulOrg, rivalOrg, job1, e1, rivalInterest] = await Promise.all([
      org("dc403-landing"), org("dc403-haul"), org("dc403-rival"), job(1), interest("dc403-haul", 1), interest("dc403-rival", 1)
    ])

    // Before any opt-in the landing sees its own number to offer, and the hauler sees nothing.
    expect(await disclosure.inquiryDisclosure(land, landOrg, e1)).toMatchObject({ phone: `+1${PHONE_DIGITS}1`, shared: false, status: "replied" })
    expect(await disclosure.haulerJobAccess(haul, haulOrg, job1)).toBeNull()

    // Show my number.
    expect(await disclosure.sharePhone(land, landOrg, { interestId: e1 }, true)).toEqual({ shared: true })
    expect(await disclosure.haulerJobAccess(haul, haulOrg, job1)).toMatchObject({
      directions: "Forest road 1",
      gateInstructions: "Gate code 1",
      siteContactName: "Reveal Foreman 1",
      siteContactPhone: `+1${PHONE_DIGITS}1`
    })

    // Another business: neither as itself nor by naming the released business.
    expect(await disclosure.haulerJobAccess(rival, rivalOrg, job1)).toBeNull()
    expect(await disclosure.haulerJobAccess(rival, haulOrg, job1)).toBeNull()
    // The landing's view of the inquiry is not the rival's to read, and the rival cannot hide the number.
    expect(await disclosure.inquiryDisclosure(rival, landOrg, e1)).toBeNull()
    await expect(disclosure.sharePhone(rival, landOrg, { interestId: e1 }, false)).rejects.toMatchObject({ code: "42501", name: "MarketplaceRefusalError" })
    // An inquiry the landing has not replied to cannot be shared.
    await expect(disclosure.sharePhone(land, landOrg, { interestId: rivalInterest }, true)).rejects.toMatchObject({ code: "23514", name: "MarketplaceRefusalError" })

    // Anonymous: the adapter will not make the call, and the database refuses the role outright.
    const anonymous = await db.asAnon((calls) => calls.call("hauler_job_access" as never, { p_job_id: job1, p_org_id: haulOrg } as never))
      .catch((error: unknown) => error)
    expect(anonymous).toBeInstanceOf(MarketplaceStoreError)
    expect(String(((anonymous as Error).cause as Error | undefined)?.message)).toMatch(/needs a signed-in person/)
    await expect(adapterSql.begin(async (tx) => {
      await tx.unsafe("select set_config('role', 'anon', true), set_config('request.jwt.claims', '{\"role\":\"anon\"}', true)")
      return tx.unsafe("select * from marketplace.hauler_job_access($1::uuid, $2::uuid)", [haulOrg, job1])
    })).rejects.toMatchObject({ code: "42501" })

    // Hide my number: the next read carries nothing.
    expect(await disclosure.sharePhone(land, landOrg, { interestId: e1 }, false)).toEqual({ shared: false })
    expect(await disclosure.haulerJobAccess(haul, haulOrg, job1)).toBeNull()
    expect(await disclosure.inquiryDisclosure(land, landOrg, e1)).toMatchObject({ shared: false })
  }, 60_000)

  it("withholds a paused hauler's share without an error, and lets a moderator clear the real pause", async () => {
    const disclosure = normalizedDisclosure(db)
    const landOrg = await org("dc403-landing")
    const burst = await Promise.all([1, 2, 3, 4, 5, 6].map((n) => interest("dc403-burst", n)))

    for (const interestId of burst.slice(0, 5)) {
      expect(await disclosure.sharePhone(land, landOrg, { interestId }, true)).toEqual({ shared: true })
    }
    // The fifth distinct landing opened the pause; the sixth reply's share is withheld, and the call still succeeds.
    expect(await disclosure.sharePhone(land, landOrg, { interestId: burst[5]! }, true)).toEqual({ shared: false })

    await expect(disclosure.revealPauses(person)).rejects.toMatchObject({ code: "42501", name: "MarketplaceRefusalError" })
    const pauses = (await disclosure.revealPauses(staff)).filter((pause) => pause.subjectName.startsWith("Reveal Burst"))
    expect(pauses.map((pause) => pause.subjectKind).sort()).toEqual(["organization", "person"])
    expect(pauses.every((pause) => pause.reportStatus === "open" && pause.landingsInWindow === 5)).toBe(true)

    const business = pauses.find((pause) => pause.subjectKind === "organization")!
    await expect(disclosure.clearRevealPause(staff, { pauseId: business.id, reason: "no" })).rejects.toBeInstanceOf(MarketplaceRefusalError)
    await expect(disclosure.clearRevealPause(person, { pauseId: business.id, reason: "A person cannot clear a pause" })).rejects.toMatchObject({ code: "42501" })
    await disclosure.clearRevealPause(staff, { pauseId: business.id, reason: "Staff reviewed the hauler for the contract" })
    // The clear dismissed the report, which closed the person pause filed under it too.
    expect((await disclosure.revealPauses(staff)).filter((pause) => pause.subjectName.startsWith("Reveal Burst"))).toEqual([])
    await expect(disclosure.clearRevealPause(staff, { pauseId: business.id, reason: "Staff reviewed it already" })).rejects.toMatchObject({ code: "P0002" })
    await expect(disclosure.clearHaulerRevealPause(person, { haulerOrgId: randomUUID(), reason: "A person cannot clear a reveal pause" }))
      .rejects.toMatchObject({ code: "42501", name: "MarketplaceRefusalError" })

    expect(await disclosure.sharePhone(land, landOrg, { interestId: burst[5]! }, true)).toEqual({ shared: true })

    const [report] = await admin.unsafe(
      "select r.reporter_user_id, r.status, r.resolution_note from marketplace.abuse_reports r where r.id = $1::uuid",
      [business.reportId]
    )
    expect(report).toMatchObject({ reporter_user_id: null, status: "dismissed" })
    expect(String(report?.resolution_note)).not.toContain("contract")
  }, 60_000)

  it("never copies the phone into the audit log, the outbox, reports or messages", async () => {
    const [leak] = await admin.unsafe(
      `select (select count(*) from marketplace.audit_events where coalesce(reason, '') like $1 or metadata::text like $1)
            + (select count(*) from marketplace.notification_outbox where payload::text like $1)
            + (select count(*) from marketplace.interest_messages where body like $1)
            + (select count(*) from marketplace.abuse_reports where coalesce(details, '') like $1 or coalesce(resolution_note, '') like $1) as n`,
      [`%${PHONE_DIGITS}%`]
    )
    expect(Number(leak?.n)).toBe(0)
  })

  it("carries the poster's review date through the normalized job read (#337)", async () => {
    const job1 = await job(1)
    const [row] = await db.asAnon((calls) => calls.call("get_marketplace_job", { p_job_id: job1 }))
    const [verified] = await admin.unsafe(
      "select to_char(o.verified_at at time zone 'UTC', 'YYYY-MM-DD') as day from marketplace.organizations o where o.slug = 'dc403-landing'"
    )

    expect(typeof verified?.day).toBe("string")
    expect(jobViewFromRow(row).posterVerification).toEqual({ reviewedOn: verified?.day, scope: "business_identity" })
  })
})
