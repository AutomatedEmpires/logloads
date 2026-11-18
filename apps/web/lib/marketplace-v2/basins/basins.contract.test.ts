import { randomBytes } from "node:crypto"

import postgres, { type Sql } from "postgres"
import { afterAll, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { NOT_IN_YOUR_AREA_YET } from "@logloads/contracts"

import { createPostgresMarketplaceDb, type MarketplaceDb, type MarketplacePrincipal } from "../normalized-db"
import { MarketplaceRefusalError } from "../port"
import { normalizedBasins } from "./normalized"
import { pilotBasins } from "./pilot"

/**
 * Basin adapter against the real schema (#324), after stage 38 on the disposable database. A local skip is not a
 * pass. The file is last in the adapter-contract job and that job runs files one at a time, so the basin this test
 * commits cannot hide another file's jobs. It deletes the basin before it returns.
 */

const DB_URL = process.env.LOGLOADS_DISPOSABLE_DB_URL ?? ""
const REQUIRED = process.env.LOGLOADS_ADAPTER_CONTRACT === "required"
const DISPOSABLE =
  process.env.GITHUB_ACTIONS === "true" &&
  process.env.LOGLOADS_DB_ENV === "ci-disposable" &&
  /^postgresql:\/\/postgres:[A-Za-z0-9_-]+@127\.0\.0\.1:5432\/logloads_test$/.test(DB_URL)

const ISSUER = "https://clerk.basin-contract.test"
const AUDIENCE = "logloads-basin-contract"
const ROLE = "logloads_basin_ci"

if (REQUIRED && !DISPOSABLE) {
  describe("basin adapter contract", () => {
    it("runs only against the guarded disposable PostgreSQL 17 database", () => {
      throw new Error("LOGLOADS_ADAPTER_CONTRACT=required, but the guarded disposable CI database is not configured")
    })
  })
}

function roleUrl(password: string): string {
  return DB_URL.replace(/^postgresql:\/\/postgres:[A-Za-z0-9_-]+@/, `postgresql://${ROLE}:${password}@`)
}

describe.skipIf(!DISPOSABLE)("basin adapter contract (disposable PostgreSQL 17)", () => {
  let admin: Sql
  let adapterSql: Sql
  let db: MarketplaceDb
  const staff: MarketplacePrincipal = { audience: AUDIENCE, issuer: ISSUER, subject: "basin_staff" }
  const person: MarketplacePrincipal = { audience: AUDIENCE, issuer: ISSUER, subject: "basin_person" }

  afterAll(async () => {
    await db?.close().catch(() => undefined)
    await adapterSql?.end({ timeout: 5 }).catch(() => undefined)
    await admin?.unsafe("delete from marketplace.basins where name = 'Contract Sisters'").catch(() => undefined)
    await admin?.unsafe(`drop role if exists ${ROLE}`).catch(() => undefined)
    await admin?.end({ timeout: 5 }).catch(() => undefined)
  })

  it("lets staff open a basin, tells anon when none is open, and refuses everyone else", async () => {
    admin = postgres(DB_URL, { max: 1, onnotice: () => undefined, prepare: false })
    const password = randomBytes(18).toString("hex")

    await admin.unsafe(
      "insert into marketplace.trusted_identity_issuers (issuer, label, expected_audience, enabled) values ($1, 'Basin contract', $2, true) on conflict (issuer) do nothing",
      [ISSUER, AUDIENCE]
    )
    const [staffUser] = await admin.unsafe(
      "select marketplace.sync_verified_identity($1, 'basin_staff', 'Basin Staff', 'staff@basin-contract.test', true)::text as id",
      [ISSUER]
    )
    await admin.unsafe(
      "select marketplace.sync_verified_identity($1, 'basin_person', 'Basin Person', 'person@basin-contract.test', true)",
      [ISSUER]
    )
    await admin.unsafe(
      "insert into marketplace.platform_admins (user_id, admin_role, note) values ($1::uuid, 'billing', 'basin contract') on conflict (user_id) do nothing",
      [staffUser?.id]
    )
    await admin.unsafe("delete from marketplace.basins where name = 'Contract Sisters'")
    await admin.unsafe(`drop role if exists ${ROLE}`)
    await admin.unsafe(`create role ${ROLE} login noinherit password '${password}'`)
    await admin.unsafe(`grant anon, authenticated to ${ROLE}`)

    adapterSql = postgres(roleUrl(password), { max: 1, onnotice: () => undefined, prepare: false })
    db = createPostgresMarketplaceDb({ sql: adapterSql })
    const basins = normalizedBasins(db)
    let basinId = ""

    try {
      const ledger = await admin.unsafe("select string_agg(version, ',' order by applied_at, version) as versions from marketplace.schema_migrations")
      expect(ledger[0]?.versions).toBe("06,11,12,16,18,23,26,29,31,33,35,38,40")

      await expect(pilotBasins().createBasin()).rejects.toThrow(/not available until the normalized marketplace store is connected/)
      await expect(basins.createBasin(person, { counties: ["Deschutes"], name: "Contract Sisters", reason: "A person is not staff", stateCode: "OR" }))
        .rejects.toMatchObject({ code: "42501", name: "MarketplaceRefusalError" })

      basinId = await basins.createBasin(staff, {
        counties: ["Deschutes"],
        name: "Contract Sisters",
        reason: "Recording the contract basin",
        stateCode: "OR"
      })
      expect(await basins.areaNotice()).toBe(NOT_IN_YOUR_AREA_YET)
      expect(await basins.listBasins(staff)).toEqual(expect.arrayContaining([expect.objectContaining({ id: basinId, status: "closed" })]))
      expect(await basins.readiness(staff, basinId)).toMatchObject({ activeJobs: 0, haulersAvailable: 0, status: "closed", verifiedLandings: 0 })

      await basins.setBasinStatus(staff, { basinId, reason: "Enough to pilot this test", status: "pilot" })
      expect(await basins.areaNotice()).toBeNull()
      await expect(basins.setBasinStatus(person, { basinId, reason: "A person cannot launch it", status: "open" }))
        .rejects.toBeInstanceOf(MarketplaceRefusalError)
    } finally {
      if (basinId) await admin.unsafe("delete from marketplace.basins where id = $1::uuid", [basinId])
    }
  }, 60_000)
})
