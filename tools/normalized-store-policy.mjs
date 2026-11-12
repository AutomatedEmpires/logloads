/**
 * The pure half of tools/normalized-store.mjs: which database a run may touch, what it would change there, and
 * whether an existing adapter login role is safe. No database, network or psql is needed to test any of it
 * (tools/normalized-store.test.mjs).
 *
 * The migration chain below is the one CI applies (`.github/workflows/normalized-v2-ci.yml`,
 * `normalized-adapter-ci.yml`); a test fails when the two disagree.
 */
import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto"

import { LOCAL_PROJECT_REF } from "./operating-state-backup-policy.mjs"

export { LOCAL_PROJECT_REF }

export const MIGRATION_DIR = "architecture/normalized-v2"
export const SEED_FILE = "architecture/normalized-v2/seed/pilot_demo_seed.sql"
export const SEED_MARKER_ACTION = "seed.pilot_demo_loaded"
export const EXPECTED_PROJECT_REF_FLAG = "--expected-project-ref"

/**
 * Every migration file, in the order CI applies it. 01-03 predate the ledger (each is still one transaction, and is
 * detected by an object only it creates); 06 creates `marketplace.schema_migrations`, and every later file records
 * itself there and refuses to run twice or out of order.
 */
export const MIGRATION_CHAIN = Object.freeze([
  { file: "01_schema.sql", ledger: null, marker: "b01", stage: 1 },
  { file: "02_access.sql", ledger: null, marker: "b02", stage: 2 },
  { file: "03_entitlements.sql", ledger: null, marker: "b03", stage: 3 },
  { file: "06_v2_contract_alignment.sql", ledger: "06", stage: 6 },
  { file: "11_v2_phase3_policy.sql", ledger: "11", stage: 11 },
  { file: "12_v2_billing_events.sql", ledger: "12", stage: 12 },
  { file: "16_v2_identity_membership_hardening.sql", ledger: "16", stage: 16 },
  { file: "18_v2_review_106_hardening.sql", ledger: "18", stage: 18 },
  { file: "23_v2_round2_hardening.sql", ledger: "23", stage: 23 },
  { file: "26_v2_team_seats_saved_jobs_outbox.sql", ledger: "26", stage: 26 },
  { file: "29_v2_landing_scope_hardening.sql", ledger: "29", stage: 29 },
  { file: "31_v2_reply_gate_reconfirmation_unsubscribe.sql", ledger: "31", stage: 31 }
].map((entry) => Object.freeze(entry)))

export const LEDGER_CHAIN = Object.freeze(MIGRATION_CHAIN.filter((entry) => entry.ledger).map((entry) => entry.ledger))

/** The adapter's login role: our own namespace, so no platform role (postgres, authenticator, supabase_*) can match. */
export const ADAPTER_ROLE_PATTERN = /^logloads_[a-z0-9_]{1,54}$/
/** Role-level limits the tool sets on the adapter login it creates (#200, connection hardening). */
export const ADAPTER_ROLE_SETTINGS = Object.freeze({ idle_in_transaction_session_timeout: "60s", statement_timeout: "15s" })
export const ADAPTER_PASSWORD_MIN_LENGTH = 24

const PROJECT_REF_SHAPE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"])
const SSL_MODES = new Set(["disable", "allow", "prefer", "require", "verify-ca", "verify-full"])
const WEAK_SSL_MODES = new Set(["disable", "allow", "prefer"])
/** The production app origin (ops/production-env-contract.json `canonical_app_url`) and its www alias. */
const PRODUCTION_ORIGINS = new Set(["https://logloads.com", "https://www.logloads.com"])
const LIVE_KEYS = [
  ["STRIPE_SECRET_KEY", /^(?:sk|rk)_live_/],
  ["NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", /^pk_live_/],
  ["CLERK_SECRET_KEY", /^sk_live_/],
  ["NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", /^pk_live_/]
]

function trimmed(value) {
  const text = typeof value === "string" ? value.trim() : ""

  return text === "" ? null : text
}

function refuse(reason) {
  return { ok: false, reason }
}

// ---------------------------------------------------------------------------------------------
// Production signals
// ---------------------------------------------------------------------------------------------

/**
 * Everything in the environment that says "this is production". Any one of them refuses the run before a connection
 * is opened. A database URL cannot tell staging from production, so the environment around it is read instead:
 * the Doppler config `doppler run` injects, the Vercel environment, the production origin, and live provider keys.
 * Only names are reported, never values.
 */
export function productionSignals(env) {
  const signals = []

  for (const name of ["DOPPLER_CONFIG", "DOPPLER_ENVIRONMENT"]) {
    const value = trimmed(env[name])

    if (value && (value === "prd" || value.startsWith("prd_"))) signals.push(`${name} names the production config`)
  }

  if (trimmed(env.VERCEL_ENV) === "production") signals.push("VERCEL_ENV is production")
  if (trimmed(env.LOGLOADS_STRIPE_EXPECTED_LIVEMODE) === "live") signals.push("LOGLOADS_STRIPE_EXPECTED_LIVEMODE is live")

  const appUrl = trimmed(env.NEXT_PUBLIC_APP_URL)

  if (appUrl) {
    try {
      if (PRODUCTION_ORIGINS.has(new URL(appUrl).origin)) signals.push("NEXT_PUBLIC_APP_URL is the production origin")
    } catch {
      // not a URL: not a production signal
    }
  }

  for (const [name, pattern] of LIVE_KEYS) {
    if (pattern.test(trimmed(env[name]) ?? "")) signals.push(`${name} is a live key`)
  }

  return signals
}

// ---------------------------------------------------------------------------------------------
// Connection strings
// ---------------------------------------------------------------------------------------------

/**
 * What a PostgreSQL URL addresses, derived from the URL alone. Accepted: a loopback address (project `local`), a
 * Supabase direct host `db.<ref>.supabase.co`, or a Supabase pooler host with the user `<role>.<ref>`. Anything else
 * is refused, because a custom host can front any database and names no project to check. Reasons never echo the
 * URL; the result carries the password for the connection only.
 */
export function describeDatabaseUrl(raw, name) {
  const value = trimmed(raw)

  if (!value) return refuse(`${name} is not set`)

  let url

  try {
    url = new URL(value)
  } catch {
    return refuse(`${name} is not a valid postgresql:// URL`)
  }

  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") return refuse(`${name} must be a postgresql:// URL`)
  if (url.hash) return refuse(`${name} must not carry a fragment`)

  for (const key of url.searchParams.keys()) {
    if (key !== "sslmode") return refuse(`${name} carries the query parameter "${key}"; only sslmode is accepted`)
  }

  const sslmode = url.searchParams.get("sslmode")

  if (sslmode !== null && !SSL_MODES.has(sslmode)) return refuse(`${name} has an unknown sslmode`)

  let user
  let password
  let database

  try {
    user = decodeURIComponent(url.username)
    password = decodeURIComponent(url.password)
    database = decodeURIComponent(url.pathname.replace(/^\//, ""))
  } catch {
    return refuse(`${name} has a malformed user, password or database`)
  }

  if (!user) return refuse(`${name} names no user`)
  if (!/^[A-Za-z0-9_]{1,63}$/.test(database)) return refuse(`${name} must name one plain database (letters, digits, underscore)`)

  const host = url.hostname.toLowerCase().replace(/^\[(.*)\]$/, "$1")
  const port = url.port ? Number(url.port) : 5432

  if (LOOPBACK_HOSTS.has(host)) {
    return { database, host, hosted: false, kind: "loopback", ok: true, password, port, ref: LOCAL_PROJECT_REF, role: user, sslmode, user }
  }

  let ref
  let role
  let kind
  const direct = /^db\.([a-z0-9-]{1,63})\.supabase\.co$/.exec(host)

  if (direct) {
    ;[, ref] = direct
    role = user
    kind = "direct"
  } else if (/^[a-z0-9-]+\.pooler\.supabase\.com$/.test(host)) {
    const pooled = /^([a-z_][a-z0-9_]{0,62})\.([a-z0-9-]{1,63})$/.exec(user)

    if (!pooled) return refuse(`${name}: a Supabase pooler user is <role>.<project-ref>`)
    ;[, role, ref] = pooled

    if (port === 5432) kind = "session-pooler"
    else if (port === 6543) kind = "transaction-pooler"
    else return refuse(`${name}: a Supabase pooler listens on 5432 (session) or 6543 (transaction)`)
  } else {
    return refuse(
      `${name} names no Supabase project: use db.<ref>.supabase.co, the project's pooler host, or a loopback address for a local stack`
    )
  }

  if (!PROJECT_REF_SHAPE.test(ref) || ref === LOCAL_PROJECT_REF) return refuse(`${name} does not name a valid project reference`)
  if (sslmode && WEAK_SSL_MODES.has(sslmode)) return refuse(`${name}: a hosted connection must use TLS (sslmode=require or stronger)`)

  return { database, host, hosted: true, kind, ok: true, password, port, ref, role, sslmode, user }
}

/** The adapter's identity settings, with the same bounds `apps/web/lib/marketplace-v2/adapter.ts` applies. */
export function identityFromEnvironment(env) {
  const issuer = trimmed(env.LOGLOADS_NORMALIZED_IDENTITY_ISSUER) ?? ""
  const audience = trimmed(env.LOGLOADS_NORMALIZED_IDENTITY_AUDIENCE) ?? ""
  const missing = [
    (issuer.length < 8 || issuer.length > 300) && "LOGLOADS_NORMALIZED_IDENTITY_ISSUER",
    (audience.length < 1 || audience.length > 200) && "LOGLOADS_NORMALIZED_IDENTITY_AUDIENCE"
  ].filter(Boolean)

  if (missing.length > 0) return refuse(`set ${missing.join(" and ")} (the values the app will use)`)
  if (/[\u0000-\u001f]/.test(issuer + audience)) return refuse("the identity issuer and audience must be single-line text")

  return { audience, issuer, ok: true }
}

/**
 * Whether this run may touch the database the environment names, and which one it is. Nothing is connected to
 * until this passes. The project must be named on the command line; DATABASE_URL (the migration role) and
 * LOGLOADS_NORMALIZED_DATABASE_URL (the adapter's login role) must both address it; and a hosted project must
 * also be the one the environment's own config expects (LOGLOADS_SUPABASE_EXPECTED_PROJECT_REF), so a URL pasted
 * from another project, or another config's file, is refused.
 */
export function checkTargets({ env, expectedRef }) {
  const signals = productionSignals(env)

  if (signals.length > 0) {
    return refuse(`this looks like production (${signals.join("; ")}). The normalized store and its seed are for staging and disposable databases only`)
  }

  const ref = trimmed(expectedRef)

  if (!ref) {
    return refuse(`${EXPECTED_PROJECT_REF_FLAG} <ref> is required on the command line ("${LOCAL_PROJECT_REF}" for a database on this machine)`)
  }

  if (!PROJECT_REF_SHAPE.test(ref)) return refuse(`${EXPECTED_PROJECT_REF_FLAG} is not a valid project reference`)

  const migration = describeDatabaseUrl(env.DATABASE_URL, "DATABASE_URL")

  if (!migration.ok) return migration

  const adapter = describeDatabaseUrl(env.LOGLOADS_NORMALIZED_DATABASE_URL, "LOGLOADS_NORMALIZED_DATABASE_URL")

  if (!adapter.ok) return adapter

  if (migration.ref !== ref) {
    return refuse(`DATABASE_URL points at project "${migration.ref}", not the expected project "${ref}". Nothing was read or written`)
  }

  if (adapter.ref !== ref) {
    return refuse(`LOGLOADS_NORMALIZED_DATABASE_URL points at project "${adapter.ref}", not the expected project "${ref}". Nothing was read or written`)
  }

  const configured = trimmed(env.LOGLOADS_SUPABASE_EXPECTED_PROJECT_REF)
  const tooling = trimmed(env.SUPABASE_PROJECT_REF)

  if (migration.hosted && !configured) {
    return refuse(
      "a hosted project needs LOGLOADS_SUPABASE_EXPECTED_PROJECT_REF from that environment's own config: run under " +
        "doppler run --project logloads --config stg (or its tooling branch)"
    )
  }

  for (const [label, value] of [["LOGLOADS_SUPABASE_EXPECTED_PROJECT_REF", configured], ["SUPABASE_PROJECT_REF", tooling]]) {
    if (value !== null && value !== ref) {
      return refuse(`${label} names project "${value}", not the expected project "${ref}". Nothing was read or written`)
    }
  }

  if (adapter.database !== migration.database) {
    return refuse("DATABASE_URL and LOGLOADS_NORMALIZED_DATABASE_URL name different databases")
  }

  if (!migration.hosted && (adapter.host !== migration.host || adapter.port !== migration.port)) {
    return refuse("DATABASE_URL and LOGLOADS_NORMALIZED_DATABASE_URL name different local servers")
  }

  if (migration.kind === "transaction-pooler") {
    return refuse("DATABASE_URL uses the transaction pooler (port 6543); apply migrations through the session pooler (5432) or the direct connection")
  }

  if (!ADAPTER_ROLE_PATTERN.test(adapter.role)) {
    return refuse("the adapter's login role (the user in LOGLOADS_NORMALIZED_DATABASE_URL) must be named logloads_<name>: lowercase letters, digits, underscore")
  }

  if (adapter.role === migration.role) return refuse("the adapter's login role must not be the migration role")

  if (adapter.password.length < ADAPTER_PASSWORD_MIN_LENGTH || !/^[\x21-\x7e]+$/.test(adapter.password)) {
    return refuse(
      `the password in LOGLOADS_NORMALIZED_DATABASE_URL must be at least ${ADAPTER_PASSWORD_MIN_LENGTH} printable ASCII characters ` +
        "(for example the output of openssl rand -hex 24)"
    )
  }

  if (adapter.hosted && adapter.sslmode === null) {
    return refuse("LOGLOADS_NORMALIZED_DATABASE_URL must end with ?sslmode=require for a hosted project, so the app connects over TLS")
  }

  return { adapter, hosted: migration.hosted, migration, ok: true, ref }
}

// ---------------------------------------------------------------------------------------------
// Plans from the database's state
// ---------------------------------------------------------------------------------------------

/**
 * The state script's `key|value` lines as an object. Booleans arrive as "true"/"false", numbers as digits; the
 * `role` and `issuer` lines are JSON or the word "absent".
 */
export function parseStateLines(text) {
  const state = {}

  for (const line of String(text).split(/\r?\n/)) {
    const separator = line.indexOf("|")

    if (separator <= 0) continue

    const key = line.slice(0, separator)
    const value = line.slice(separator + 1)

    if (!/^[a-z_0-9]+$/.test(key)) continue

    if (value === "true" || value === "false") state[key] = value === "true"
    else if (/^\d+$/.test(value)) state[key] = Number(value)
    else if (value.startsWith("{") || value.startsWith("[")) {
      try {
        state[key] = JSON.parse(value)
      } catch {
        state[key] = value
      }
    } else state[key] = value
  }

  return state
}

/**
 * Which migration files a database still needs. Each file is atomic, so a database is either fresh, part of the way
 * along the chain, or current; anything else (objects that are not the baseline, a ledger this checkout does not
 * know) is refused rather than guessed at.
 */
export function computeSchemaPlan(state) {
  if (!state.schema || !state.objects) {
    // 01 installs PostGIS in `extensions`, and drops a copy installed elsewhere only in a stamped disposable
    // database. Anywhere else it refuses; say why before anything runs.
    if (typeof state.postgis === "string" && state.postgis !== "absent" && state.postgis !== "extensions" && state.stamped !== true) {
      return {
        reason:
          `PostGIS is installed in schema "${state.postgis}", and 01 needs it in "extensions" and never moves it outside a ` +
          "disposable database. On the staging project, deploy the normalized store before the pilot migrations " +
          "(docs/INTEGRATIONS.md §15.1); on a project where they already ran, moving PostGIS is an owner decision",
        status: "conflict"
      }
    }

    return { pending: [...MIGRATION_CHAIN], status: "absent" }
  }

  const baseline = [state.b01 === true, state.b02 === true, state.b03 === true]
  const applied = baseline.indexOf(false) === -1 ? 3 : baseline.indexOf(false)

  if (baseline.slice(applied).some(Boolean)) {
    return { reason: "the normalized baseline (01, 02, 03) is only partly present, out of order; inspect the database by hand", status: "conflict" }
  }

  if (state.ledger === undefined || state.ledger === null) {
    if (applied === 0) {
      return { reason: "the marketplace schema holds objects that are not the normalized baseline; nothing will be applied over them", status: "conflict" }
    }

    return { pending: MIGRATION_CHAIN.slice(applied), status: "partial" }
  }

  if (applied < 3) {
    return { reason: "the migration ledger exists but the 01-03 baseline is incomplete; inspect the database by hand", status: "conflict" }
  }

  // The state script reports the ledger as a JSON array of version strings ("06" must not become a number).
  const versions = Array.isArray(state.ledger) ? state.ledger.map(String) : String(state.ledger).split(",").filter(Boolean)

  if (versions.length === 0) {
    return { reason: "the migration ledger is empty although it exists; inspect the database by hand", status: "conflict" }
  }

  if (versions.length > LEDGER_CHAIN.length || versions.some((version, index) => version !== LEDGER_CHAIN[index])) {
    return {
      reason: `the migration ledger records ${versions.join(",")}; this checkout's chain is ${LEDGER_CHAIN.join(",")}. Update the checkout or inspect the database`,
      status: "conflict"
    }
  }

  const pending = MIGRATION_CHAIN.filter((entry) => entry.ledger && !versions.includes(entry.ledger))

  return { pending, status: pending.length === 0 ? "current" : "partial", versions }
}

/** Whether an existing login role meets docs/SECURITY.md §4.1. Never altered silently: an unsafe role is refused. */
export function assessRole(role) {
  if (role === undefined || role === null || role === "absent") return { problems: [], status: "absent" }

  const problems = []

  if (role.login !== true) problems.push("cannot log in")
  if (role.inherit !== false) problems.push("inherits privileges (must be NOINHERIT)")
  if (role.superuser) problems.push("is a superuser")
  if (role.bypassrls) problems.push("bypasses row-level security")
  if (role.createrole) problems.push("can create roles")
  if (role.createdb) problems.push("can create databases")
  if (role.replication) problems.push("has replication")
  if (Number(role.owns) > 0) problems.push("owns objects in the marketplace schema")

  const memberOf = new Set(Array.isArray(role.member_of) ? role.member_of : [])

  for (const needed of ["anon", "authenticated"]) {
    if (!memberOf.has(needed)) problems.push(`is not a member of ${needed}`)
  }

  if (Array.isArray(role.reaches) && role.reaches.length > 0) problems.push(`reaches roles beyond anon and authenticated (${role.reaches.join(", ")})`)
  if (Array.isArray(role.privileged) && role.privileged.length > 0) problems.push(`belongs to a privileged role (${role.privileged.join(", ")})`)

  return { problems, status: problems.length === 0 ? "compliant" : "unsafe" }
}

/** Whether the adapter's issuer row needs registering, is already right, or conflicts. */
export function computeIssuerPlan(issuer, identity) {
  if (issuer === undefined || issuer === null || issuer === "absent") return { action: "register" }
  if (issuer.enabled !== true) return { action: "conflict", reason: "the trusted issuer row for LOGLOADS_NORMALIZED_IDENTITY_ISSUER is disabled; it is never re-enabled silently" }
  if (issuer.audience !== identity.audience) {
    return { action: "conflict", reason: "the trusted issuer row for LOGLOADS_NORMALIZED_IDENTITY_ISSUER pins another audience than LOGLOADS_NORMALIZED_IDENTITY_AUDIENCE" }
  }

  return { action: "present" }
}

/** Whether the synthetic seed can be loaded: only into a current, empty store, and only once. */
export function computeSeedPlan(state, schemaPlan, issuerPlan) {
  if (schemaPlan.status !== "current") return { action: "conflict", reason: "the schema is not current; run the schema command with --apply first" }
  if (issuerPlan.action === "conflict") return { action: "conflict", reason: issuerPlan.reason }
  if (Number(state.seed) > 0) return { action: "present" }
  if (Number(state.organizations) > 0) {
    return {
      action: "conflict",
      reason: `the seed loads only into an empty marketplace store; this one holds ${Number(state.organizations)} organization(s)`
    }
  }

  return { action: "load" }
}

// ---------------------------------------------------------------------------------------------
// Secrets
// ---------------------------------------------------------------------------------------------

/**
 * A SCRAM-SHA-256 verifier (RFC 5802 / RFC 7677, the format PostgreSQL stores in pg_authid). The tool sends this,
 * never the password, so the plaintext reaches neither the server nor its logs. Passwords are printable ASCII
 * (checkTargets), which SASLprep leaves unchanged.
 */
export function scramSha256Verifier(password, { iterations = 4096, salt = randomBytes(16) } = {}) {
  const salted = pbkdf2Sync(Buffer.from(password, "utf8"), salt, iterations, 32, "sha256")
  const clientKey = createHmac("sha256", salted).update("Client Key").digest()
  const storedKey = createHash("sha256").update(clientKey).digest()
  const serverKey = createHmac("sha256", salted).update("Server Key").digest()

  return `SCRAM-SHA-256$${iterations}:${salt.toString("base64")}$${storedKey.toString("base64")}:${serverKey.toString("base64")}`
}

/** Replaces every known secret (and its URL-encoded form) in text that is about to be printed. */
export function createRedactor(values) {
  const secrets = new Set()

  for (const value of values) {
    if (typeof value === "string" && value.length >= 4) {
      secrets.add(value)
      secrets.add(encodeURIComponent(value))
    }
  }

  const ordered = [...secrets].sort((a, b) => b.length - a.length)

  return (text) => {
    let output = String(text)

    for (const secret of ordered) output = output.split(secret).join("<redacted>")

    return output
  }
}
