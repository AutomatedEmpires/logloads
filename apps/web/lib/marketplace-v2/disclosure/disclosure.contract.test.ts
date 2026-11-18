import { randomBytes, randomUUID } from "node:crypto"

import postgres, { type Sql } from "postgres"
import { afterAll, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { createPostgresMarketplaceDb, type MarketplaceDb, type MarketplacePrincipal } from "../normalized-db"
import { MarketplaceRefusalError } from "../port"
import { normalizedDisclosure } from "./normalized"
import { pilotDisclosure } from "./pilot"

/**
 * Disclosure adapter against the real schema (#325), after stage 40 on the disposable database. A local skip is not a
 * pass. The file runs last in the adapter-contract job, one file at a time. It does not release a phone number.
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
const LEDGER = "06,11,12,16,18,23,26,29,31,33,35,38,40,42"

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

describe.skipIf(!DISPOSABLE)("disclosure adapter contract (disposable PostgreSQL 17)", () => {
  let admin: Sql
  let adapterSql: Sql
  let db: MarketplaceDb
  const staff: MarketplacePrincipal = { audience: AUDIENCE, issuer: ISSUER, subject: "reveal_staff" }
  const person: MarketplacePrincipal = { audience: AUDIENCE, issuer: ISSUER, subject: "reveal_person" }

  afterAll(async () => {
    await db?.close().catch(() => undefined)
    await adapterSql?.end({ timeout: 5 }).catch(() => undefined)
    await admin?.unsafe(`drop role if exists ${ROLE}`).catch(() => undefined)
    await admin?.end({ timeout: 5 }).catch(() => undefined)
  })

  it("lets a moderator clear only a real pause, and refuses everyone else", async () => {
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
    await admin.unsafe(`drop role if exists ${ROLE}`)
    await admin.unsafe(`create role ${ROLE} login noinherit password '${password}'`)
    await admin.unsafe(`grant anon, authenticated to ${ROLE}`)

    adapterSql = postgres(roleUrl(password), { max: 1, onnotice: () => undefined, prepare: false })
    db = createPostgresMarketplaceDb({ sql: adapterSql })
    const disclosure = normalizedDisclosure(db)
    const missing = randomUUID()

    const ledger = await admin.unsafe("select string_agg(version, ',' order by applied_at, version) as versions from marketplace.schema_migrations")
    expect(ledger[0]?.versions).toBe(LEDGER)

    await expect(pilotDisclosure().clearHaulerRevealPause()).rejects.toThrow(/not available until the normalized marketplace store is connected/)
    await expect(disclosure.clearHaulerRevealPause(person, {
      haulerOrgId: missing,
      reason: "A person cannot clear a reveal pause"
    })).rejects.toMatchObject({ code: "42501", name: "MarketplaceRefusalError" })
    await expect(disclosure.clearHaulerRevealPause(staff, {
      haulerOrgId: missing,
      reason: "no"
    })).rejects.toBeInstanceOf(MarketplaceRefusalError)
    await expect(disclosure.clearHaulerRevealPause(staff, {
      haulerOrgId: missing,
      reason: "Staff reviewed a pause that is not open"
    })).rejects.toMatchObject({ code: "P0002", name: "MarketplaceRefusalError" })
  }, 60_000)
})
