import assert from "node:assert/strict"
import { createHash, createHmac } from "node:crypto"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import { ADAPTER_LOGIN_SQL, createRoleSql, REPO_ROOT, runNormalizedStore, STATE_SQL } from "./normalized-store.mjs"
import {
  assessRole,
  checkTargets,
  computeIssuerPlan,
  computeSchemaPlan,
  computeSeedPlan,
  createRedactor,
  describeDatabaseUrl,
  identityFromEnvironment,
  LEDGER_CHAIN,
  MIGRATION_CHAIN,
  parseStateLines,
  productionSignals,
  scramSha256Verifier,
  SEED_FILE
} from "./normalized-store-policy.mjs"

const root = fileURLToPath(new URL("..", import.meta.url))
const read = (path) => readFileSync(join(root, path), "utf8")

// Obviously fake: a made-up project reference and throwaway passwords.
const REF = "stagingfakeref"
const ADAPTER_PASSWORD = "adapter-test-password-0123456789"
const MIGRATION_PASSWORD = "migration-test-password-0123456789"
const LOCAL_ENV = {
  DATABASE_URL: `postgresql://postgres:${MIGRATION_PASSWORD}@127.0.0.1:5432/logloads_test`,
  LOGLOADS_NORMALIZED_DATABASE_URL: `postgresql://logloads_marketplace_adapter:${ADAPTER_PASSWORD}@127.0.0.1:5432/logloads_test`,
  LOGLOADS_NORMALIZED_IDENTITY_AUDIENCE: "logloads-test-audience",
  LOGLOADS_NORMALIZED_IDENTITY_ISSUER: "https://clerk.normalized-store.test"
}
const HOSTED_ENV = {
  DATABASE_URL: `postgresql://postgres.${REF}:${MIGRATION_PASSWORD}@aws-0-us-east-1.pooler.supabase.com:5432/postgres`,
  LOGLOADS_NORMALIZED_DATABASE_URL: `postgresql://logloads_marketplace_adapter.${REF}:${ADAPTER_PASSWORD}@aws-0-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require`,
  LOGLOADS_NORMALIZED_IDENTITY_AUDIENCE: "logloads-test-audience",
  LOGLOADS_NORMALIZED_IDENTITY_ISSUER: "https://clerk.normalized-store.test",
  LOGLOADS_SUPABASE_EXPECTED_PROJECT_REF: REF,
  SUPABASE_PROJECT_REF: REF
}

// ---------------------------------------------------------------------------------------------
// The chain is CI's chain
// ---------------------------------------------------------------------------------------------

/** Stage number -> migration file, for the stages run-stage.sh applies with run_migration. */
function migrationStages() {
  const source = read("tools/normalized-v2-ci/run-stage.sh")
  const stages = new Map()

  for (const block of source.split(/^ {2}(?=\d+\)$)/m).slice(1)) {
    const stage = Number(/^(\d+)\)/.exec(block)[1])
    const file = /run_migration "\$DIR\/([^"]+)"/.exec(block.split(/^ {4};;$/m)[0])

    if (file) stages.set(stage, file[1])
  }

  return stages
}

/** For each job of a workflow: the run-stage.sh stage numbers its steps run, in order. */
function stagesByJob(workflow) {
  const jobs = read(`.github/workflows/${workflow}`).split(/^jobs:$/m)[1]
  const result = new Map()

  for (const block of jobs.split(/^ {2}(?=[a-z0-9-]+:$)/m).slice(1)) {
    const name = /^([a-z0-9-]+):/.exec(block)[1]
    result.set(name, [...block.matchAll(/run: bash tools\/normalized-v2-ci\/run-stage\.sh (\d+)/g)].map((match) => Number(match[1])))
  }

  return result
}

test("the migration chain is exactly the files and order CI applies", () => {
  const migrations = migrationStages()

  assert.deepEqual(
    MIGRATION_CHAIN.map((entry) => [entry.stage, entry.file]),
    [...migrations.entries()].sort((a, b) => a[0] - b[0]).map(([stage, file]) => [stage, file]),
    "MIGRATION_CHAIN must list every run_migration stage of tools/normalized-v2-ci/run-stage.sh"
  )

  const chain = MIGRATION_CHAIN.map((entry) => entry.stage)
  const full = []

  for (const workflow of ["normalized-v2-ci.yml", "normalized-adapter-ci.yml"]) {
    for (const [job, stages] of stagesByJob(workflow)) {
      const applied = stages.filter((stage) => migrations.has(stage))

      // Every job applies a prefix of the chain (the baseline job stops after 03); most apply all of it.
      assert.deepEqual(applied, chain.slice(0, applied.length), `${workflow} ${job} applies migrations in another order`)
      if (applied.length === chain.length) full.push(`${workflow}:${job}`)
    }
  }

  for (const job of ["normalized-adapter-ci.yml:adapter-contract", "normalized-v2-ci.yml:postgres17-contract-alignment", "normalized-v2-ci.yml:supabase-local-stack"]) {
    assert.ok(full.includes(job), `${job} applies the whole chain`)
  }
  assert.deepEqual(LEDGER_CHAIN, ["06", "11", "12", "16", "18", "23"])
  // The seed and the adapter contract test expect the same ledger.
  assert.match(read(SEED_FILE), /'06,11,12,16,18,23'/)
  assert.match(read("apps/web/lib/marketplace-v2/normalized-adapter.contract.test.ts"), /toBe\("06,11,12,16,18,23"\)/)
})

test("the seeded-store CI jobs deploy through this tool, not a second copy of the chain", () => {
  const workflow = read(".github/workflows/normalized-adapter-ci.yml")
  const jobs = stagesByJob("normalized-adapter-ci.yml")

  for (const job of ["seeded-store", "seeded-store-supabase"]) {
    assert.deepEqual(jobs.get(job), [], `${job} must not apply stages itself`)
  }

  assert.match(workflow, /node tools\/normalized-store\.mjs schema --expected-project-ref local --apply/)
  assert.match(workflow, /node tools\/normalized-store\.mjs seed --expected-project-ref local --apply/)
  assert.match(workflow, /normalized-seed\.contract\.test\.ts/)
})

// ---------------------------------------------------------------------------------------------
// Targets
// ---------------------------------------------------------------------------------------------

test("connection strings: loopback, Supabase direct and pooler hosts; nothing else", () => {
  assert.deepEqual(
    pick(describeDatabaseUrl(LOCAL_ENV.DATABASE_URL, "DATABASE_URL"), ["hosted", "kind", "ref", "role", "port", "database"]),
    { database: "logloads_test", hosted: false, kind: "loopback", port: 5432, ref: "local", role: "postgres" }
  )
  assert.deepEqual(
    pick(describeDatabaseUrl(HOSTED_ENV.DATABASE_URL, "DATABASE_URL"), ["hosted", "kind", "ref", "role", "user"]),
    { hosted: true, kind: "session-pooler", ref: REF, role: "postgres", user: `postgres.${REF}` }
  )
  assert.equal(describeDatabaseUrl(HOSTED_ENV.LOGLOADS_NORMALIZED_DATABASE_URL, "X").kind, "transaction-pooler")
  assert.equal(describeDatabaseUrl(`postgresql://postgres:pw@db.${REF}.supabase.co:5432/postgres`, "X").kind, "direct")
  assert.equal(describeDatabaseUrl("postgresql://u:p@[::1]:54322/postgres", "X").ref, "local")
  assert.equal(describeDatabaseUrl("postgresql://u:p%40ss@127.0.0.1/db", "X").password, "p@ss")

  for (const [url, reason] of [
    ["postgresql://u:p@db.example.com:5432/postgres", /names no Supabase project/],
    ["https://127.0.0.1/db", /postgresql:\/\//],
    ["postgresql://u:p@127.0.0.1/db?options=-c%20role%3Dpostgres", /only sslmode/],
    [`postgresql://postgres:pw@db.${REF}.supabase.co/postgres?sslmode=disable`, /must use TLS/],
    [`postgresql://postgres@aws-0-us-east-1.pooler.supabase.com:5432/postgres`, /<role>\.<project-ref>/],
    [`postgresql://postgres.${REF}:pw@aws-0-us-east-1.pooler.supabase.com:7000/postgres`, /5432 \(session\) or 6543/],
    ["postgresql://u:p@127.0.0.1/two;dbs", /one plain database/],
    ["", /is not set/]
  ]) {
    const result = describeDatabaseUrl(url, "DATABASE_URL")
    assert.equal(result.ok, false, url)
    assert.match(result.reason, reason)
    assert.ok(!result.reason.includes("pw@") && !result.reason.includes(MIGRATION_PASSWORD))
  }
})

test("targets: the project is named on the command line and every source agrees", () => {
  assert.equal(checkTargets({ env: LOCAL_ENV, expectedRef: "local" }).ok, true)
  assert.equal(checkTargets({ env: HOSTED_ENV, expectedRef: REF }).ok, true)

  const refused = (env, expectedRef, reason) => {
    const result = checkTargets({ env, expectedRef })
    assert.equal(result.ok, false)
    assert.match(result.reason, reason)
    assert.ok(!result.reason.includes(MIGRATION_PASSWORD) && !result.reason.includes(ADAPTER_PASSWORD))
  }

  refused(LOCAL_ENV, undefined, /--expected-project-ref <ref> is required/)
  refused(LOCAL_ENV, REF, /points at project "local", not the expected project/)
  refused(HOSTED_ENV, "local", /points at project "stagingfakeref"/)
  refused({ ...HOSTED_ENV, LOGLOADS_SUPABASE_EXPECTED_PROJECT_REF: "" }, REF, /needs LOGLOADS_SUPABASE_EXPECTED_PROJECT_REF/)
  refused({ ...HOSTED_ENV, LOGLOADS_SUPABASE_EXPECTED_PROJECT_REF: "otherfakeref" }, REF, /LOGLOADS_SUPABASE_EXPECTED_PROJECT_REF names project "otherfakeref"/)
  refused({ ...HOSTED_ENV, SUPABASE_PROJECT_REF: "otherfakeref" }, REF, /SUPABASE_PROJECT_REF names project/)
  refused({ ...LOCAL_ENV, LOGLOADS_SUPABASE_EXPECTED_PROJECT_REF: REF }, "local", /names project "stagingfakeref", not the expected project "local"/)
  refused(
    { ...HOSTED_ENV, LOGLOADS_NORMALIZED_DATABASE_URL: HOSTED_ENV.LOGLOADS_NORMALIZED_DATABASE_URL.replace(`.${REF}:`, ".otherfakeref:") },
    REF,
    /LOGLOADS_NORMALIZED_DATABASE_URL points at project "otherfakeref"/
  )
  refused({ ...HOSTED_ENV, DATABASE_URL: HOSTED_ENV.DATABASE_URL.replace(":5432/", ":6543/") }, REF, /transaction pooler/)
  refused({ ...HOSTED_ENV, LOGLOADS_NORMALIZED_DATABASE_URL: HOSTED_ENV.LOGLOADS_NORMALIZED_DATABASE_URL.replace("?sslmode=require", "") }, REF, /sslmode=require/)
  refused({ ...LOCAL_ENV, LOGLOADS_NORMALIZED_DATABASE_URL: LOCAL_ENV.LOGLOADS_NORMALIZED_DATABASE_URL.replace("logloads_marketplace_adapter", "authenticator") }, "local", /logloads_<name>/)
  refused({ ...LOCAL_ENV, LOGLOADS_NORMALIZED_DATABASE_URL: LOCAL_ENV.LOGLOADS_NORMALIZED_DATABASE_URL.replace(ADAPTER_PASSWORD, "short") }, "local", /at least 24/)
  refused({ ...LOCAL_ENV, LOGLOADS_NORMALIZED_DATABASE_URL: LOCAL_ENV.LOGLOADS_NORMALIZED_DATABASE_URL.replace("/logloads_test", "/postgres") }, "local", /different databases/)
  refused({ ...LOCAL_ENV, LOGLOADS_NORMALIZED_DATABASE_URL: LOCAL_ENV.LOGLOADS_NORMALIZED_DATABASE_URL.replace(":5432", ":54322") }, "local", /different local servers/)
  refused({ ...LOCAL_ENV, DOPPLER_CONFIG: "prd" }, "local", /looks like production/)
})

test("production signals: the config, the platform, the origin and live keys; names only", () => {
  assert.deepEqual(productionSignals({ DOPPLER_CONFIG: "stg", DOPPLER_ENVIRONMENT: "stg", VERCEL_ENV: "preview" }), [])
  assert.deepEqual(productionSignals({ DOPPLER_CONFIG: "stg_tooling" }), [])

  const signals = productionSignals({
    CLERK_SECRET_KEY: "sk_live_fake",
    DOPPLER_CONFIG: "prd_tooling",
    DOPPLER_ENVIRONMENT: "prd",
    LOGLOADS_STRIPE_EXPECTED_LIVEMODE: "live",
    NEXT_PUBLIC_APP_URL: "https://logloads.com/",
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_live_fake",
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_live_fake",
    STRIPE_SECRET_KEY: "rk_live_fake",
    VERCEL_ENV: "production"
  })

  assert.equal(signals.length, 9)
  assert.ok(signals.every((signal) => !signal.includes("_fake")))
  assert.deepEqual(productionSignals({ NEXT_PUBLIC_APP_URL: "https://staging.logloads.example", STRIPE_SECRET_KEY: "sk_test_fake" }), [])
})

test("identity settings use the adapter's bounds", () => {
  assert.equal(identityFromEnvironment(LOCAL_ENV).ok, true)
  assert.match(identityFromEnvironment({}).reason, /LOGLOADS_NORMALIZED_IDENTITY_ISSUER and LOGLOADS_NORMALIZED_IDENTITY_AUDIENCE/)
  assert.match(identityFromEnvironment({ ...LOCAL_ENV, LOGLOADS_NORMALIZED_IDENTITY_ISSUER: "short" }).reason, /ISSUER/)
})

// ---------------------------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------------------------

test("schema plan: fresh, part of the way, current, or refused", () => {
  const files = (plan) => plan.pending.map((entry) => entry.file.slice(0, 2))

  assert.deepEqual(files(computeSchemaPlan({ schema: false })), ["01", "02", "03", "06", "11", "12", "16", "18", "23"])
  // PostGIS: absent or already in `extensions` is fine; elsewhere only a stamped disposable database lets 01 move it.
  assert.equal(computeSchemaPlan({ postgis: "extensions", schema: false, stamped: false }).status, "absent")
  assert.equal(computeSchemaPlan({ postgis: "public", schema: false, stamped: true }).status, "absent")
  const pilotFirst = computeSchemaPlan({ postgis: "public", schema: false, stamped: false })
  assert.equal(pilotFirst.status, "conflict")
  assert.match(pilotFirst.reason, /PostGIS is installed in schema "public".*before the pilot migrations/)
  // Supabase exposes an empty schema before it exists; nothing in it yet.
  assert.equal(computeSchemaPlan({ objects: 0, schema: true }).status, "absent")
  assert.deepEqual(files(computeSchemaPlan({ b01: true, b02: false, b03: false, objects: 40, schema: true })), ["02", "03", "06", "11", "12", "16", "18", "23"])
  assert.deepEqual(files(computeSchemaPlan({ b01: true, b02: true, b03: true, objects: 90, schema: true })), ["06", "11", "12", "16", "18", "23"])
  assert.deepEqual(files(computeSchemaPlan({ b01: true, b02: true, b03: true, ledger: ["06", "11", "12"], objects: 90, schema: true })), ["16", "18", "23"])

  const current = computeSchemaPlan({ b01: true, b02: true, b03: true, ledger: [...LEDGER_CHAIN], objects: 300, schema: true })
  assert.equal(current.status, "current")
  assert.deepEqual(current.pending, [])

  for (const [state, reason] of [
    [{ b01: false, b02: false, b03: false, objects: 3, schema: true }, /not the normalized baseline/],
    [{ b01: true, b02: false, b03: true, objects: 40, schema: true }, /out of order/],
    [{ b01: true, b02: true, b03: true, ledger: [], objects: 90, schema: true }, /ledger is empty/],
    [{ b01: true, b02: true, b03: true, ledger: ["06", "12"], objects: 90, schema: true }, /ledger records 06,12/],
    [{ b01: true, b02: true, b03: true, ledger: [...LEDGER_CHAIN, "25"], objects: 90, schema: true }, /Update the checkout/],
    [{ b01: true, b02: true, b03: false, ledger: ["06"], objects: 90, schema: true }, /baseline is incomplete/]
  ]) {
    const plan = computeSchemaPlan(state)
    assert.equal(plan.status, "conflict")
    assert.match(plan.reason, reason)
  }
})

test("an existing login role is kept only when it meets docs/SECURITY.md §4.1", () => {
  const safe = {
    bypassrls: false, createdb: false, createrole: false, inherit: false, login: true,
    member_of: ["anon", "authenticated"], owns: 0, privileged: [], reaches: [], replication: false, superuser: false
  }

  assert.deepEqual(assessRole(safe), { problems: [], status: "compliant" })
  assert.equal(assessRole("absent").status, "absent")

  for (const [change, problem] of [
    [{ inherit: true }, /NOINHERIT/],
    [{ superuser: true }, /superuser/],
    [{ bypassrls: true }, /row-level security/],
    [{ createrole: true }, /create roles/],
    [{ owns: 1 }, /owns objects/],
    [{ member_of: ["anon"] }, /not a member of authenticated/],
    [{ reaches: ["pg_write_all_data"] }, /pg_write_all_data/],
    [{ privileged: ["postgres"] }, /privileged role \(postgres\)/]
  ]) {
    const result = assessRole({ ...safe, ...change })
    assert.equal(result.status, "unsafe")
    assert.match(result.problems.join("; "), problem)
  }
})

test("issuer and seed plans", () => {
  const identity = { audience: "logloads-test-audience", issuer: "https://clerk.normalized-store.test" }
  const current = { status: "current" }

  assert.equal(computeIssuerPlan(undefined, identity).action, "register")
  assert.equal(computeIssuerPlan({ audience: identity.audience, enabled: true }, identity).action, "present")
  assert.match(computeIssuerPlan({ audience: "other", enabled: true }, identity).reason, /another audience/)
  assert.match(computeIssuerPlan({ audience: identity.audience, enabled: false }, identity).reason, /disabled/)

  assert.equal(computeSeedPlan({ organizations: 0, seed: 0 }, current, { action: "present" }).action, "load")
  assert.equal(computeSeedPlan({ organizations: 4, seed: 1 }, current, { action: "present" }).action, "present")
  assert.match(computeSeedPlan({ organizations: 2, seed: 0 }, current, { action: "present" }).reason, /empty marketplace store/)
  assert.match(computeSeedPlan({}, { status: "partial" }, { action: "register" }).reason, /schema is not current/)
})

test("state lines parse into facts; the ledger stays a list of strings", () => {
  const state = parseStateLines([
    "server|170006",
    "schema|true",
    "objects|0",
    'ledger|["06","11"]',
    'issuer|{"enabled":true,"audience":"a"}',
    "role|absent",
    "noise without a separator",
    "BAD KEY|x"
  ].join("\n"))

  assert.deepEqual(state, { issuer: { audience: "a", enabled: true }, ledger: ["06", "11"], objects: 0, role: "absent", schema: true, server: 170006 })
})

// ---------------------------------------------------------------------------------------------
// Secrets
// ---------------------------------------------------------------------------------------------

test("the SCRAM-SHA-256 verifier authenticates RFC 7677's example exchange", () => {
  // RFC 7677 §3: user "user", password "pencil", salt and iteration count from the server-first message.
  const verifier = scramSha256Verifier("pencil", { iterations: 4096, salt: Buffer.from("W22ZaJ0SNY7soEsUEjb6gQ==", "base64") })
  const [, iterations, salt, storedKey, serverKey] = /^SCRAM-SHA-256\$(\d+):([^$]+)\$([^:]+):(.+)$/.exec(verifier)

  assert.equal(iterations, "4096")
  assert.equal(salt, "W22ZaJ0SNY7soEsUEjb6gQ==")

  const nonce = "rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0"
  const authMessage = `n=user,r=rOprNGfwEbeRWgbNEkqO,r=${nonce},s=W22ZaJ0SNY7soEsUEjb6gQ==,i=4096,c=biws,r=${nonce}`
  const clientProof = Buffer.from("dHzbZapWIk4jUhN+Ute9ytag9zjfMHgsqmmiz7AndVQ=", "base64")
  // The server's check: ClientKey = ClientProof XOR HMAC(StoredKey, AuthMessage), and SHA-256(ClientKey) = StoredKey.
  const signature = createHmac("sha256", Buffer.from(storedKey, "base64")).update(authMessage).digest()
  const clientKey = Buffer.from(clientProof.map((byte, index) => byte ^ signature[index]))

  assert.equal(createHash("sha256").update(clientKey).digest("base64"), storedKey)
  assert.equal(
    createHmac("sha256", Buffer.from(serverKey, "base64")).update(authMessage).digest("base64"),
    "6rriTRBi23WpRR/wtup+mMhUZUn/dB5nLTJRsjl95G4="
  )
  // A fresh salt every time.
  assert.notEqual(scramSha256Verifier("pencil"), scramSha256Verifier("pencil"))
})

test("redaction covers raw and URL-encoded secrets", () => {
  const redact = createRedactor(["p@ss word", null, "abc"])

  assert.equal(redact("x p@ss word y p%40ss%20word z abc"), "x <redacted> y <redacted> z abc")
})

test("the role statements create a NOINHERIT login in anon and authenticated only", () => {
  const sql = createRoleSql("logloads_marketplace_adapter", "SCRAM-SHA-256$4096:c2FsdA==$c3RvcmVk:c2VydmVy")

  assert.match(sql, /create role logloads_marketplace_adapter with login noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls password 'SCRAM-SHA-256\$4096:/)
  assert.match(sql, /grant anon, authenticated to logloads_marketplace_adapter;/)
  assert.match(sql, /set statement_timeout = '15s'/)
  assert.match(sql, /already exists; nothing was changed/)
})

// ---------------------------------------------------------------------------------------------
// The command, with a scripted psql
// ---------------------------------------------------------------------------------------------

const SAFE_ROLE = JSON.stringify({
  bypassrls: false, createdb: false, createrole: false, inherit: false, login: true,
  member_of: ["anon", "authenticated"], owns: 0, privileged: [], reaches: [], replication: false, superuser: false
})

function stateLines(database) {
  const lines = ["server|170006", `login|postgres`]

  lines.push(`schema|${database.applied.length > 0}`, `objects|${database.applied.length * 10}`)
  lines.push(`b01|${database.applied.includes("01_schema.sql")}`, `b02|${database.applied.includes("02_access.sql")}`, `b03|${database.applied.includes("03_entitlements.sql")}`)
  lines.push("inv_rls|true", "inv_public_execute|true", "inv_search_path|true")

  const ledger = MIGRATION_CHAIN.filter((entry) => entry.ledger && database.applied.includes(entry.file)).map((entry) => entry.ledger)

  if (ledger.length > 0) {
    lines.push(`ledger|${JSON.stringify(ledger)}`)
    lines.push(`issuer|${database.issuer ? JSON.stringify({ audience: LOCAL_ENV.LOGLOADS_NORMALIZED_IDENTITY_AUDIENCE, enabled: true }) : "absent"}`)
    lines.push(`organizations|${database.organizations}`, `seed|${database.seed}`)
  }

  lines.push(`role|${database.role ?? "absent"}`)
  return `${lines.join("\n")}\n`
}

/** A fake spawnSync that plays psql against an in-memory database and records every call. */
function scriptedPsql(database) {
  const calls = []

  const spawnSync = (command, args, options = {}) => {
    calls.push({ args, command, env: options.env ?? {}, input: options.input ?? "" })

    if (args[0] === "--version") return { status: 0, stderr: "", stdout: "psql (PostgreSQL) 17.6\n" }

    const file = args[args.indexOf("-f") + 1]
    const input = options.input ?? ""

    if (file === "-" && input === STATE_SQL) return { status: 0, stderr: "", stdout: stateLines(database) }
    if (file === "-" && input === ADAPTER_LOGIN_SQL) {
      if (options.env.PGPASSWORD !== database.adapterPassword) return { status: 2, stderr: "psql: error: FATAL:  password authentication failed\n", stdout: "" }
      return { status: 0, stderr: "", stdout: 'adapter_login|{"user":"logloads_marketplace_adapter","superuser":false,"bypassrls":false,"inherit":false}\nadapter_discovery|3\n' }
    }
    if (file === "-" && input.includes("insert into marketplace.trusted_identity_issuers")) {
      database.issuer = true
      return { status: 0, stderr: "", stdout: "" }
    }
    if (file === "-" && input.startsWith("alter role")) {
      database.adapterPassword = ADAPTER_PASSWORD
      return { status: 0, stderr: "", stdout: "" }
    }
    if (file === "-" && input.includes("create role")) {
      database.role = SAFE_ROLE
      database.adapterPassword = ADAPTER_PASSWORD
      return { status: 0, stderr: "", stdout: "" }
    }
    if (file.endsWith("pilot_demo_seed.sql")) {
      database.seed = 1
      database.organizations = 4
      return { status: 0, stderr: "", stdout: "seed|loaded: 4 businesses\n" }
    }

    const migration = MIGRATION_CHAIN.find((entry) => file.endsWith(entry.file))

    if (migration) {
      if (database.failOn === migration.file) return { status: 3, stderr: `psql:${file}:12: ERROR:  55000: refused for the test\n`, stdout: "" }
      database.applied.push(migration.file)
      return { status: 0, stderr: "", stdout: "" }
    }

    throw new Error(`unexpected psql call: ${args.join(" ")}`)
  }

  return { calls, spawnSync }
}

async function run(argv, { database = { applied: [], organizations: 0, seed: 0 }, env = LOCAL_ENV } = {}) {
  const psql = scriptedPsql(database)
  const out = []
  const err = []
  const code = await runNormalizedStore({ argv, env, root: REPO_ROOT, spawnSync: psql.spawnSync, stderr: (line) => err.push(line), stdout: (line) => out.push(line) })
  const text = [...out, ...err].join("\n")

  // Never a value: no password, no URL, nothing secret on any psql command line.
  for (const secret of [ADAPTER_PASSWORD, MIGRATION_PASSWORD, LOCAL_ENV.DATABASE_URL, "postgresql://"]) {
    assert.ok(!text.includes(secret), `output contains ${secret}`)
    for (const call of psql.calls) assert.ok(!call.args.join(" ").includes(secret), `psql argv contains ${secret}`)
  }

  return { calls: psql.calls, code, database, err: err.join("\n"), out: out.join("\n") }
}

const writes = (calls) => calls.filter((call) => call.args.includes("--single-transaction"))
const fullDatabase = () => ({ adapterPassword: ADAPTER_PASSWORD, applied: MIGRATION_CHAIN.map((entry) => entry.file), issuer: true, organizations: 0, role: SAFE_ROLE, seed: 0 })

test("schema without --apply plans the whole chain and changes nothing", async () => {
  const { calls, code, out } = await run(["schema", "--expected-project-ref", "local"])

  assert.equal(code, 0)
  assert.deepEqual(writes(calls), [])
  assert.match(out, /pending: 01_schema\.sql, 02_access\.sql, 03_entitlements\.sql, 06_v2_contract_alignment\.sql, .*23_v2_round2_hardening\.sql/)
  assert.match(out, /18 revokes EXECUTE from PUBLIC/)
  assert.match(out, /create logloads_marketplace_adapter: LOGIN NOINHERIT/)
  assert.match(out, /dry run only/)
})

test("schema --apply applies each file in one transaction, in order, then the issuer, the role, and verifies as the adapter", async () => {
  const { calls, code, database, out } = await run(["schema", "--expected-project-ref", "local", "--apply"])

  assert.equal(code, 0, out)
  assert.deepEqual(database.applied, MIGRATION_CHAIN.map((entry) => entry.file))

  const written = writes(calls)
  assert.deepEqual(
    written.slice(0, MIGRATION_CHAIN.length).map((call) => call.args[call.args.indexOf("-f") + 1].split(/[\\/]/).pop()),
    MIGRATION_CHAIN.map((entry) => entry.file)
  )

  const role = written.find((call) => call.input.includes("create role"))
  assert.ok(role, "the role is created")
  assert.match(role.input, /password 'SCRAM-SHA-256\$4096:/)
  assert.ok(!role.input.includes(ADAPTER_PASSWORD), "the plaintext password is never sent")
  assert.equal(role.env.PGUSER, "postgres")
  assert.equal(role.env.PGPASSWORD, MIGRATION_PASSWORD, "connection values travel in the environment")

  const login = calls.find((call) => call.input === ADAPTER_LOGIN_SQL)
  assert.equal(login.env.PGUSER, "logloads_marketplace_adapter")
  assert.match(out, /as anon, public discovery returned 3 job\(s\)/)
  assert.match(out, /Result: the normalized store is deployed to project local/)
})

test("schema --apply on a current store is a no-op", async () => {
  const { calls, code, out } = await run(["schema", "--expected-project-ref", "local", "--apply"], { database: fullDatabase() })

  assert.equal(code, 0, out)
  assert.deepEqual(writes(calls), [])
  assert.match(out, /up to date \(ledger 06,11,12,16,18,23\)/)
  assert.match(out, /keep logloads_marketplace_adapter and its password/)
})

test("schema --apply resumes after the last applied file and stops at a failure", async () => {
  const database = { applied: ["01_schema.sql", "02_access.sql", "03_entitlements.sql", "06_v2_contract_alignment.sql"], failOn: "12_v2_billing_events.sql", organizations: 0, seed: 0 }
  const { calls, code, err } = await run(["schema", "--expected-project-ref", "local", "--apply"], { database })

  assert.equal(code, 1)
  assert.deepEqual(writes(calls).map((call) => call.args[call.args.indexOf("-f") + 1].split(/[\\/]/).pop()), ["11_v2_phase3_policy.sql", "12_v2_billing_events.sql"])
  assert.match(err, /12_v2_billing_events\.sql failed and was rolled back/)
})

test("an unsafe existing role, production or the wrong project stop the run before any change", async () => {
  const unsafe = await run(["schema", "--expected-project-ref", "local", "--apply"], { database: { ...fullDatabase(), role: JSON.stringify({ ...JSON.parse(SAFE_ROLE), inherit: true }) } })
  assert.equal(unsafe.code, 1)
  assert.deepEqual(writes(unsafe.calls), [])
  assert.match(unsafe.out, /REFUSED: logloads_marketplace_adapter inherits privileges/)

  const production = await run(["schema", "--expected-project-ref", "local", "--apply"], { env: { ...LOCAL_ENV, VERCEL_ENV: "production" } })
  assert.equal(production.code, 2)
  assert.deepEqual(production.calls, [])
  assert.match(production.err, /looks like production/)

  const misnamed = await run(["schema", "--expected-project-ref", REF, "--apply"])
  assert.equal(misnamed.code, 2)
  assert.deepEqual(misnamed.calls, [])
})

test("a wrong adapter password is reported, and --reset-adapter-password resets it", async () => {
  const stale = await run(["status", "--expected-project-ref", "local"], { database: { ...fullDatabase(), adapterPassword: "another-password-for-the-test-only" } })
  assert.equal(stale.code, 1)
  assert.match(stale.out, /login {8}FAILED as the adapter role/)

  const reset = await run(["schema", "--expected-project-ref", "local", "--apply", "--reset-adapter-password"], {
    database: { ...fullDatabase(), adapterPassword: "another-password-for-the-test-only" }
  })
  assert.equal(reset.code, 0, reset.out)
  const statement = writes(reset.calls)
  assert.equal(statement.length, 1)
  assert.match(statement[0].input, /^alter role logloads_marketplace_adapter password 'SCRAM-SHA-256\$/)
  assert.match(reset.out, /password reset \(sent as a SCRAM-SHA-256 verifier\)/)
})

test("seed loads once into a current, empty store, never into one with other data", async () => {
  const dry = await run(["seed", "--expected-project-ref", "local"], { database: fullDatabase() })
  assert.equal(dry.code, 0)
  assert.deepEqual(writes(dry.calls), [])

  const loaded = await run(["seed", "--expected-project-ref", "local", "--apply"], { database: fullDatabase() })
  assert.equal(loaded.code, 0, loaded.out)
  const seed = writes(loaded.calls)
  assert.equal(seed.length, 1)
  assert.ok(seed[0].args.includes(`issuer=${LOCAL_ENV.LOGLOADS_NORMALIZED_IDENTITY_ISSUER}`))
  assert.ok(seed[0].args.join(" ").includes("pilot_demo_seed.sql"))

  const again = await run(["seed", "--expected-project-ref", "local", "--apply"], { database: { ...fullDatabase(), organizations: 4, seed: 1 } })
  assert.equal(again.code, 0)
  assert.deepEqual(writes(again.calls), [])
  assert.match(again.out, /already loaded/)

  const occupied = await run(["seed", "--expected-project-ref", "local", "--apply"], { database: { ...fullDatabase(), organizations: 7 } })
  assert.equal(occupied.code, 1)
  assert.deepEqual(writes(occupied.calls), [])
  assert.match(occupied.out, /empty marketplace store; this one holds 7/)

  const early = await run(["seed", "--expected-project-ref", "local", "--apply"])
  assert.equal(early.code, 1)
  assert.match(early.out, /schema is not current/)
})

test("status is read-only and reports readiness", async () => {
  const ready = await run(["status", "--expected-project-ref", "local"], { database: fullDatabase() })
  assert.equal(ready.code, 0, ready.out)
  assert.deepEqual(writes(ready.calls), [])
  assert.match(ready.out, /ready for the adapter/)

  const fresh = await run(["status", "--expected-project-ref", "local"])
  assert.equal(fresh.code, 1)
  assert.match(fresh.out, /not ready/)

  assert.equal((await run(["status", "--expected-project-ref", "local", "--apply"])).code, 2)
  assert.equal((await run(["status"])).code, 2)
  assert.equal((await run(["drop", "--expected-project-ref", "local"])).code, 2)
})

function pick(object, keys) {
  return Object.fromEntries(keys.map((key) => [key, object[key]]))
}
