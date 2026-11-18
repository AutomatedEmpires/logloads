import { randomBytes, randomUUID } from "node:crypto"

import postgres, { type Sql } from "postgres"
import { afterAll, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
// v2-session.ts reads the request's session through lib/session; this test hands the store the subject directly.
vi.mock("@/lib/session", () => ({}))

import { NOT_IN_YOUR_AREA_YET, validateMarketplaceJobDraft } from "@logloads/contracts"

import { normalizedBasins } from "@/lib/marketplace-v2/basins/normalized"
import { createNormalizedMarketplaceV2 } from "@/lib/marketplace-v2/normalized-adapter"
import { createPostgresMarketplaceDb, type MarketplaceDb, type MarketplacePrincipal } from "@/lib/marketplace-v2/normalized-db"
import { MarketplaceRefusalError, type MarketplaceV2Port } from "@/lib/marketplace-v2/port"

import { resolveShareWith, type ShareReads } from "./resolve"

/**
 * The share link against the real schema (#287, #324, #404), on the disposable PostgreSQL 17 database of
 * `.github/workflows/normalized-adapter-ci.yml`, after stage 38. `page.test.tsx` replaces both store reads, so it
 * cannot show the closed branch's precondition: that an anonymous `get_marketplace_job` returns nothing for a job in
 * a closed basin while `public_area_notice` names it. This file reads both from the store, as anon, through the same
 * adapter functions the page uses.
 *
 * It runs only on GitHub Actions against that guarded database, and skips anywhere else. A local skip is not a pass.
 * With `LOGLOADS_ADAPTER_CONTRACT=required` a missing database fails. The job runs its files one at a time. While
 * this file's basin exists every other job in the database is hidden, so it deletes the basin before it returns.
 */

const DB_URL = process.env.LOGLOADS_DISPOSABLE_DB_URL ?? ""
const REQUIRED = process.env.LOGLOADS_ADAPTER_CONTRACT === "required"
const DISPOSABLE =
  process.env.GITHUB_ACTIONS === "true" &&
  process.env.LOGLOADS_DB_ENV === "ci-disposable" &&
  /^postgresql:\/\/postgres:[A-Za-z0-9_-]+@127\.0\.0\.1:5432\/logloads_test$/.test(DB_URL)

const ISSUER = "https://clerk.share-contract.test"
const AUDIENCE = "logloads-share-contract"
const ROLE = "logloads_share_ci"
const BASIN = "Share Contract Sisters"
const TITLE = "Share Contract Sawlog Run"

if (REQUIRED && !DISPOSABLE) {
  describe("share link store contract", () => {
    it("runs only against the guarded disposable PostgreSQL 17 database", () => {
      throw new Error("LOGLOADS_ADAPTER_CONTRACT=required, but the guarded disposable CI database is not configured")
    })
  })
}

function roleUrl(password: string): string {
  return DB_URL.replace(/^postgresql:\/\/postgres:[A-Za-z0-9_-]+@/, `postgresql://${ROLE}:${password}@`)
}

function isoDay(offsetDays: number): string {
  const day = new Date()
  day.setUTCDate(day.getUTCDate() + offsetDays)
  return day.toISOString().slice(0, 10)
}

/** A landing business with a plan and one active landing in Deschutes County, OR, made the way the adapter contract makes its own. */
function fixtureSql(): string {
  const claims = (sub: string) =>
    `jsonb_build_object('role','authenticated','iss','${ISSUER}','sub','${sub}','aud','${AUDIENCE}','exp',extract(epoch from now())::bigint + 600)::text`

  return `
insert into marketplace.trusted_identity_issuers (issuer, label, expected_audience, enabled)
values ('${ISSUER}', 'Clerk (share contract CI)', '${AUDIENCE}', true) on conflict (issuer) do nothing;

do $$
declare v_land uuid; v_staff uuid;
  worker constant text := '{"role":"service_role"}';
begin
  perform set_config('request.jwt.claims', worker, true); set local role service_role;
  perform marketplace.sync_verified_identity('${ISSUER}', 'share_land', 'Share Land Owner', 'land@share-contract.test', true);
  v_staff := marketplace.sync_verified_identity('${ISSUER}', 'share_staff', 'Share Staff', 'staff@share-contract.test', true);
  reset role;

  insert into marketplace.platform_admins (user_id, admin_role, note) values (v_staff, 'billing', 'share contract')
  on conflict (user_id) do nothing;

  perform set_config('request.jwt.claims', ${claims("share_land")}, true); set local role authenticated;
  v_land := marketplace.create_organization('Share Contract Timber', 'share-contract-timber', 'OR', false);
  reset role;

  perform set_config('request.jwt.claims', worker, true); set local role service_role;
  perform marketplace.open_subscription_cycle(v_land, 'basic', 'active', now() - interval '1 hour', now() + interval '29 days', 'cus_share_l', 'sub_share_l', false, 7, false);
  reset role;

  perform set_config('request.jwt.claims', ${claims("share_land")}, true); set local role authenticated;
  insert into marketplace.landings (org_id, name, status, public_area_label, public_point, state_code, county)
  values (v_land, 'Share Contract Landing', 'active', 'Near Sisters, OR', extensions.st_GeogFromText('SRID=4326;POINT(-121.5 44.3)'), 'OR', 'Deschutes');
  reset role;
end
$$;`
}

describe.skipIf(!DISPOSABLE)("share link store contract (disposable PostgreSQL 17)", () => {
  let admin: Sql
  let adapterSql: Sql
  let db: MarketplaceDb
  const staff: MarketplacePrincipal = { audience: AUDIENCE, issuer: ISSUER, subject: "share_staff" }

  afterAll(async () => {
    await db?.close().catch(() => undefined)
    await adapterSql?.end({ timeout: 5 }).catch(() => undefined)
    await admin?.unsafe("delete from marketplace.basins where name = $1", [BASIN]).catch(() => undefined)
    await admin?.unsafe(`drop role if exists ${ROLE}`).catch(() => undefined)
    await admin?.end({ timeout: 5 }).catch(() => undefined)
  })

  it("resolves a job to its listing, to the closed notice while its basin is closed, and an unknown id to nothing", async () => {
    admin = postgres(DB_URL, { max: 1, onnotice: () => undefined, prepare: false })
    const password = randomBytes(18).toString("hex")

    await admin.unsafe(fixtureSql())
    await admin.unsafe("delete from marketplace.basins where name = $1", [BASIN])
    await admin.unsafe(`drop role if exists ${ROLE}`)
    await admin.unsafe(`create role ${ROLE} login noinherit password '${password}'`)
    await admin.unsafe(`grant anon, authenticated to ${ROLE}`)

    const [owner] = await admin.unsafe(
      "select user_id::text as id from marketplace.identity_links where issuer = $1 and subject = 'share_land'", [ISSUER]
    )
    const [org] = await admin.unsafe("select id::text as id from marketplace.organizations where slug = 'share-contract-timber'")
    const [landing] = await admin.unsafe("select id::text as id from marketplace.landings where org_id = $1::uuid", [org?.id])

    adapterSql = postgres(roleUrl(password), { max: 1, onnotice: () => undefined, prepare: false })
    db = createPostgresMarketplaceDb({ sql: adapterSql })

    const port: MarketplaceV2Port = createNormalizedMarketplaceV2({
      db,
      principal: async (viewer) => {
        if (viewer.userId !== owner?.id) throw new MarketplaceRefusalError("Sign in again to continue.")
        return { audience: AUDIENCE, issuer: ISSUER, subject: "share_land" }
      }
    })
    const basins = normalizedBasins(db)
    // The page's two reads: the job with no viewer, and the notice by job id. Both run as anon.
    const reads: ShareReads = {
      areaNotice: async (jobId) => ((await basins.areaNotice({ jobId })) === NOT_IN_YOUR_AREA_YET ? NOT_IN_YOUR_AREA_YET : null),
      getJob: (jobId) => port.getJob(jobId)
    }

    const draft = validateMarketplaceJobDraft({
      destinationLabel: "Mill near Bend, OR",
      durationDays: "10",
      equipment: ["log_truck"],
      estOneWayMiles: "28",
      estTonsPerLoad: "28.5",
      landingId: landing?.id,
      payAmount: "91",
      payUnit: "per_ton",
      product: "Saw logs",
      startsOn: isoDay(7),
      title: TITLE,
      trucksPerDay: "2",
      trucksRequested: "3"
    })

    if (!draft.ok) throw new Error(JSON.stringify(draft.issues))

    const { jobId } = await port.publishJob(
      { organizationId: String(org?.id), userId: String(owner?.id) },
      draft.draft,
      { action: "publish", confirmedAt: new Date().toISOString() }
    )
    const unknown = randomUUID()
    let basinId = ""

    try {
      // No basin is recorded: the gate is off and the link is the listing.
      expect(await resolveShareWith(reads, jobId)).toMatchObject({ job: { id: jobId, title: TITLE }, kind: "job" })
      expect(await resolveShareWith(reads, unknown)).toEqual({ kind: "missing" })

      basinId = await basins.createBasin(staff, {
        counties: ["Deschutes"],
        name: BASIN,
        reason: "Recording the share contract basin",
        stateCode: "OR"
      })

      // Closed: anon gets no job row, and the store names the job as real and not open. The link shows the notice only.
      expect(await port.getJob(jobId)).toBeNull()
      expect(await basins.areaNotice({ jobId })).toBe(NOT_IN_YOUR_AREA_YET)
      expect(await resolveShareWith(reads, jobId)).toEqual({ kind: "closed" })
      // An id that is no job stays missing while the gate is on: the notice does not name it.
      expect(await basins.areaNotice({ jobId: unknown })).toBeNull()
      expect(await resolveShareWith(reads, unknown)).toEqual({ kind: "missing" })

      await basins.setBasinStatus(staff, { basinId, reason: "Enough to pilot this test", status: "pilot" })
      expect(await basins.areaNotice({ jobId })).toBeNull()
      expect(await resolveShareWith(reads, jobId)).toMatchObject({ job: { id: jobId, title: TITLE }, kind: "job" })

      await basins.setBasinStatus(staff, { basinId, reason: "Closing it again for this test", status: "closed" })
      expect(await resolveShareWith(reads, jobId)).toEqual({ kind: "closed" })
    } finally {
      if (basinId) await admin.unsafe("delete from marketplace.basins where id = $1::uuid", [basinId])
    }

    // With the basin gone the listing is public again, so nothing this file did hides a later file's jobs.
    expect(await resolveShareWith(reads, jobId)).toMatchObject({ kind: "job" })
  }, 120_000)

  // Review finding 3 on PR 390 (#404). `public_area_notice(p_job_id)` in 38_v2_basins.sql answers for any
  // `job_postings` row at a landing whose basin is not launched, whatever the job's status. Anon has no other read
  // that tells a draft or a removed job from a public one, so the fix is in that function: answer only when the job
  // would be publicly visible but for the basin gate. Write these two cases with that change.
  it.todo("resolves a draft job in a closed basin to missing, not to the closed notice")
  it.todo("resolves a staff-removed job in a closed basin to missing, not to the closed notice")
})
