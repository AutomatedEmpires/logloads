import { randomBytes } from "node:crypto"

import postgres, { type Sql } from "postgres"
import { afterAll, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { normalizedBasins } from "../basins/normalized"
import { createPostgresMarketplaceDb, type MarketplaceDb, type MarketplacePrincipal } from "../normalized-db"
import { liquidityBoard } from "./board"
import { normalizedLiquidity } from "./normalized"

/**
 * The liquidity board's read against the real schema (#326), after stage 42 on the disposable database, through the
 * restricted adapter role and an identity-bound transaction: the path the page uses. A local skip is not a pass.
 * The counts themselves are proved in SQL (43_v2_basin_liquidity_tests.sql); this proves the adapter's call, its
 * mapping and the permission boundary. The file runs last in the adapter-contract job, one file at a time, and it
 * deletes the basin it commits.
 */

const DB_URL = process.env.LOGLOADS_DISPOSABLE_DB_URL ?? ""
const REQUIRED = process.env.LOGLOADS_ADAPTER_CONTRACT === "required"
const DISPOSABLE =
  process.env.GITHUB_ACTIONS === "true" &&
  process.env.LOGLOADS_DB_ENV === "ci-disposable" &&
  /^postgresql:\/\/postgres:[A-Za-z0-9_-]+@127\.0\.0\.1:5432\/logloads_test$/.test(DB_URL)

const ISSUER = "https://clerk.liquidity-contract.test"
const AUDIENCE = "logloads-liquidity-contract"
const ROLE = "logloads_liquidity_ci"
const BASIN = "Contract Wallowa"

if (REQUIRED && !DISPOSABLE) {
  describe("liquidity board adapter contract", () => {
    it("runs only against the guarded disposable PostgreSQL 17 database", () => {
      throw new Error("LOGLOADS_ADAPTER_CONTRACT=required, but the guarded disposable CI database is not configured")
    })
  })
}

function roleUrl(password: string): string {
  return DB_URL.replace(/^postgresql:\/\/postgres:[A-Za-z0-9_-]+@/, `postgresql://${ROLE}:${password}@`)
}

describe.skipIf(!DISPOSABLE)("liquidity board adapter contract (disposable PostgreSQL 17)", () => {
  let admin: Sql
  let adapterSql: Sql
  let db: MarketplaceDb
  const staff: MarketplacePrincipal = { audience: AUDIENCE, issuer: ISSUER, subject: "liquidity_staff" }
  const person: MarketplacePrincipal = { audience: AUDIENCE, issuer: ISSUER, subject: "liquidity_person" }

  afterAll(async () => {
    await db?.close().catch(() => undefined)
    await adapterSql?.end({ timeout: 5 }).catch(() => undefined)
    await admin?.unsafe("delete from marketplace.basins where name = $1", [BASIN]).catch(() => undefined)
    await admin?.unsafe(`drop role if exists ${ROLE}`).catch(() => undefined)
    await admin?.end({ timeout: 5 }).catch(() => undefined)
  })

  it("gives staff one row of counts per basin and refuses a person who is not staff", async () => {
    admin = postgres(DB_URL, { max: 1, onnotice: () => undefined, prepare: false })
    const password = randomBytes(18).toString("hex")

    await admin.unsafe(
      "insert into marketplace.trusted_identity_issuers (issuer, label, expected_audience, enabled) values ($1, 'Liquidity contract', $2, true) on conflict (issuer) do nothing",
      [ISSUER, AUDIENCE]
    )
    const [staffUser] = await admin.unsafe(
      "select marketplace.sync_verified_identity($1, 'liquidity_staff', 'Liquidity Staff', 'staff@liquidity-contract.test', true)::text as id",
      [ISSUER]
    )
    await admin.unsafe(
      "select marketplace.sync_verified_identity($1, 'liquidity_person', 'Liquidity Person', 'person@liquidity-contract.test', true)",
      [ISSUER]
    )
    await admin.unsafe(
      "insert into marketplace.platform_admins (user_id, admin_role, note) values ($1::uuid, 'support', 'liquidity contract') on conflict (user_id) do nothing",
      [staffUser?.id]
    )
    await admin.unsafe("delete from marketplace.basins where name = $1", [BASIN])
    await admin.unsafe(`drop role if exists ${ROLE}`)
    await admin.unsafe(`create role ${ROLE} login noinherit password '${password}'`)
    await admin.unsafe(`grant anon, authenticated to ${ROLE}`)

    adapterSql = postgres(roleUrl(password), { max: 1, onnotice: () => undefined, prepare: false })
    db = createPostgresMarketplaceDb({ sql: adapterSql })
    const liquidity = normalizedLiquidity(db)
    let basinId = ""

    try {
      const ledger = await admin.unsafe("select string_agg(version, ',' order by applied_at, version) as versions from marketplace.schema_migrations")
      expect(ledger[0]?.versions).toBe("06,11,12,16,18,23,26,29,31,33,35,38,40,42")

      // A signed-in person who is not staff gets the refusal, with or without a basin on record.
      await expect(liquidity.board(person)).rejects.toMatchObject({ code: "42501", name: "MarketplaceRefusalError" })

      const before = await liquidity.board(staff)
      expect(before.some((row) => row.name === BASIN)).toBe(false)

      basinId = await normalizedBasins(db).createBasin(staff, {
        counties: ["Wallowa"],
        name: BASIN,
        reason: "Recording the liquidity contract basin",
        stateCode: "OR"
      })

      const board = await liquidity.board(staff)
      expect(board).toHaveLength(before.length + 1)
      // Nothing is posted in Wallowa County on this database: every count is zero and there is no median.
      expect(board.find((row) => row.id === basinId)).toEqual({
        activeJobs: 0,
        haulersAvailable: 0,
        id: basinId,
        inquiries: { answered: 0, medianFirstReplyMinutes: null, received: 0 },
        jobsConfirmed: 0,
        name: BASIN,
        stateCode: "OR",
        status: "closed",
        verifiedLandings: 0
      })
      expect(liquidityBoard(board).rows.find((row) => row.id === basinId)).toMatchObject({
        answeredShare: { state: "none", text: "No inquiries" },
        staleShare: { state: "none", text: "No active jobs" },
        statusLabel: "Closed"
      })

      await expect(liquidity.board(person)).rejects.toMatchObject({ code: "42501", name: "MarketplaceRefusalError" })
    } finally {
      if (basinId) await admin.unsafe("delete from marketplace.basins where id = $1::uuid", [basinId])
    }
  }, 60_000)
})
