import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { test } from "node:test"

import {
  STATUS,
  TARGETS,
  evaluate,
  formatList,
  formatReport,
  jwtPayload,
  loadContract,
  parseArgs,
  parseEnvText,
  probeDeployment,
  readEnvFile,
  runCli,
  supabaseKeyKind,
  supabaseRefFromUrl
} from "./integration-readiness.mjs"

const contract = loadContract()
const SENTINEL = /zzsentinel/i
const REF = "zzsentinelref"
const OTHER_REF = "zzsentinelother"
const NOW = new Date("2026-11-03T12:00:00.000Z")
const VERCEL_JSON = JSON.stringify({ crons: [{ path: "/api/billing/cron", schedule: "15 5 * * *" }] })
const repoWithCron = (path) => {
  if (path === "apps/web/vercel.json") return VERCEL_JSON
  throw new Error(`unexpected repo read ${path}`)
}
const repoWithoutCron = () => {
  throw new Error("ENOENT")
}

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url")
const jwt = (payload) => `${b64({ alg: "HS256", typ: "JWT" })}.${b64(payload)}.zzsentinelsignature`
const digestFor = (id) => createHash("sha256").update(`logloads-platform-admin-scope-v1\n${id}`).digest("hex")

/** A complete, consistent Preview/Staging environment. Every secret carries the sentinel. */
function readyStaging(overrides = {}) {
  return {
    CRON_SECRET: "zzsentinel-cron-secret-0000000000000000",
    LOGLOADS_DISPATCH_SELF_SERVE: "disabled",
    LOGLOADS_FEE_COLLECTION: "disabled",
    LOGLOADS_INTERNAL_BILLING_SMOKE: "disabled",
    LOGLOADS_MEDIA_BUCKET: "logloads-private-media",
    LOGLOADS_MEDIA_STORAGE: "supabase",
    LOGLOADS_PERCENTAGE_ENROLLMENT: "disabled",
    LOGLOADS_PLATFORM_ADMIN_BOOTSTRAP: "disabled",
    LOGLOADS_RATE_LIMIT_HMAC_SECRET: "zzsentinel-hmac-secret-000000000000000000000",
    LOGLOADS_RATE_LIMIT_KEY_PREFIX: "logloads:staging",
    LOGLOADS_SESSION_SECRET: "zzsentinel-session-secret-0000000000000000000",
    LOGLOADS_STRIPE_EXPECTED_LIVEMODE: "test",
    LOGLOADS_SUBSCRIPTION_COLLECTION: "disabled",
    LOGLOADS_SUPABASE_EXPECTED_PROJECT_REF: REF,
    CLERK_SECRET_KEY: "sk_test_zzsentinel03",
    NEXT_PUBLIC_APP_URL: "https://staging.zzsentinel.example",
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_zzsentinel02",
    NEXT_PUBLIC_CLERK_SIGN_IN_URL: "/sign-in",
    NEXT_PUBLIC_CLERK_SIGN_UP_URL: "/sign-up",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_zzsentinel01",
    SUPABASE_SERVICE_ROLE_KEY: jwt({ ref: REF, role: "service_role" }),
    SUPABASE_URL: `https://${REF}.supabase.co`,
    ...overrides
  }
}

function readyProduction(overrides = {}) {
  const id = "user_zzsentinel04"

  return readyStaging({
    CLERK_SECRET_KEY: "sk_live_zzsentinel05",
    LOGLOADS_PLATFORM_ADMIN_CLERK_IDS: id,
    LOGLOADS_PLATFORM_ADMIN_EXPECTED_SCOPE_SHA256: digestFor(id),
    LOGLOADS_RATE_LIMIT_KEY_PREFIX: "logloads:production",
    LOGLOADS_STRIPE_EXPECTED_LIVEMODE: "live",
    NEXT_PUBLIC_APP_URL: "https://logloads.com",
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_live_zzsentinel06",
    ...overrides
  })
}

function run(env, target = "staging", readRepoFile = repoWithCron) {
  return evaluate({ contract, env, now: NOW, readRepoFile, target })
}

function result(report, id) {
  const entry = report.results.find((candidate) => candidate.id === id)
  assert.ok(entry, `no result for ${id}`)
  return entry
}

function assertStatus(report, id, status) {
  const entry = result(report, id)
  assert.equal(entry.status, status, `${id}: ${JSON.stringify({ missing: entry.missing, problems: entry.problems, warnings: entry.warnings })}`)
  return entry
}

function assertNoSentinel(text) {
  assert.doesNotMatch(text, SENTINEL, "a value leaked into the output")
}

function hasMessage(entry, pattern) {
  return [...entry.problems, ...entry.warnings, ...entry.notes, ...entry.missing].some((message) => pattern.test(message))
}

// --- sources ----------------------------------------------------------------------------

test("parseEnvText reads export, quotes, and trailing comments without touching quoted hashes", () => {
  const env = parseEnvText([
    "# comment",
    "export A=one",
    'B="two # not a comment"',
    "C='three'",
    "D=four # trailing comment",
    "E=",
    "not a line"
  ].join("\n"))

  assert.deepEqual(env, { A: "one", B: "two # not a comment", C: "three", D: "four", E: "" })
})

test("readEnvFile accepts a JSON object of strings and refuses other JSON", () => {
  assert.deepEqual(readEnvFile("x.json", () => '{"A":"1","B":2}'), { A: "1" })
  assert.throws(() => readEnvFile("x.json", () => "[1]"), /object/)
  assert.deepEqual(readEnvFile("x.env", () => "A=1\n"), { A: "1" })
})

test("Supabase helpers classify refs and keys without verifying signatures", () => {
  assert.equal(supabaseRefFromUrl(`https://${REF}.supabase.co`), REF)
  assert.equal(supabaseRefFromUrl("http://127.0.0.1:55321"), null)
  assert.equal(supabaseRefFromUrl(`http://${REF}.supabase.co`), null)
  assert.deepEqual(supabaseKeyKind(jwt({ ref: REF, role: "service_role" })), { kind: "service_role", ref: REF })
  assert.equal(supabaseKeyKind(jwt({ role: "anon" })).kind, "anon")
  assert.equal(supabaseKeyKind("sb_secret_zzsentinel").kind, "secret")
  assert.equal(supabaseKeyKind("sb_publishable_zzsentinel").kind, "publishable")
  assert.equal(supabaseKeyKind("nonsense").kind, "unknown")
  assert.equal(jwtPayload("a.b"), null)
})

// --- overall verdicts ---------------------------------------------------------------------

test("a complete staging environment is ready, and Stripe, Resend, PostHog, Sentry and Anthropic are deliberately off", () => {
  const report = run(readyStaging())

  assert.equal(report.ready, true, formatReport(report, "test"))
  for (const id of ["environment", "app", "session", "supabase-api", "supabase-storage", "rate-limit", "clerk", "billing-gates", "cron", "maps"]) {
    assertStatus(report, id, STATUS.ready)
  }
  for (const id of ["stripe", "resend", "posthog", "sentry", "anthropic", "platform-admin", "supabase-db"]) {
    assertStatus(report, id, STATUS.off)
  }
})

test("a complete production environment is ready", () => {
  const report = run(readyProduction(), "production")

  assert.equal(report.ready, true, formatReport(report, "test"))
  assertStatus(report, "platform-admin", STATUS.ready)
})

test("an empty hosted environment lists the missing names for every required integration", () => {
  const report = run({}, "staging")
  const text = formatReport(report, "test")

  assert.equal(report.ready, false)
  assert.deepEqual(assertStatus(report, "supabase-api", STATUS.notReady).missing, ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"])
  assert.deepEqual(assertStatus(report, "clerk", STATUS.notReady).missing, ["NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "CLERK_SECRET_KEY"])
  assert.ok(assertStatus(report, "supabase-storage", STATUS.notReady).missing.includes("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY"))
  assert.deepEqual(assertStatus(report, "rate-limit", STATUS.notReady).missing, ["LOGLOADS_RATE_LIMIT_HMAC_SECRET", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"])
  assertStatus(report, "session", STATUS.notReady)
  assert.match(text, /Result: NOT READY for staging/)
})

test("an empty local environment needs only the rate-limit key; providers are off", () => {
  const report = run({}, "local")

  assert.deepEqual(assertStatus(report, "rate-limit", STATUS.notReady).missing, ["LOGLOADS_RATE_LIMIT_HMAC_SECRET"])
  for (const id of ["session", "supabase-api", "clerk"]) {
    assert.notEqual(result(report, id).status, STATUS.notReady)
  }
  assert.equal(run({ LOGLOADS_RATE_LIMIT_HMAC_SECRET: "zzsentinel-hmac-secret-000000000000000000000" }, "local").ready, true)
})

test("an optional integration with some of its variables set is not ready and names the rest", () => {
  const report = run(readyStaging({ STRIPE_SECRET_KEY: "sk_test_zzsentinel07" }))
  const stripe = assertStatus(report, "stripe", STATUS.notReady)

  assert.deepEqual(stripe.missing, ["STRIPE_PUBLISHABLE_KEY or NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "STRIPE_WEBHOOK_SECRET", "LOGLOADS_STRIPE_EXPECTED_ACCOUNT_ID"])
  assert.equal(report.ready, false)
})

test("unknown targets are refused", () => {
  assert.throws(() => run({}, "prod"), /unknown target/)
})

// --- app and session ----------------------------------------------------------------------

test("app: hosted targets need https, production should use the canonical origin, local should be loopback", () => {
  assertStatus(run(readyStaging({ NEXT_PUBLIC_APP_URL: "http://staging.zzsentinel.example" })), "app", STATUS.invalid)
  assert.ok(hasMessage(run(readyProduction({ NEXT_PUBLIC_APP_URL: "https://zzsentinel.example" }), "production").results.find((r) => r.id === "app"), /canonical/))
  assert.ok(hasMessage(result(run({ NEXT_PUBLIC_APP_URL: "https://zzsentinel.example" }, "local"), "app"), /loopback/))
  assertStatus(run(readyStaging({ NEXT_PUBLIC_APP_URL: "not a url" })), "app", STATUS.invalid)
  assert.ok(hasMessage(result(run(readyStaging({ NEXT_PUBLIC_APP_URL: undefined })), "app"), /VERCEL_URL/))
  assertStatus(run(readyProduction({ NEXT_PUBLIC_APP_URL: undefined }), "production"), "app", STATUS.notReady)
})

test("app: LOGLOADS_MARKETPLACE_V2 must be unset for production and is flagged on hosted previews", () => {
  const production = assertStatus(run(readyProduction({ LOGLOADS_MARKETPLACE_V2: "enabled" }), "production"), "app", STATUS.invalid)

  assert.ok(production.problems.some((problem) => /LOGLOADS_MARKETPLACE_V2 must be unset for target production/.test(problem)))
  assert.ok(hasMessage(assertStatus(run(readyStaging({ LOGLOADS_MARKETPLACE_V2: "enabled" })), "app", STATUS.ready), /isolated Supabase project/))
  assert.notEqual(result(run({ LOGLOADS_MARKETPLACE_V2: "enabled", LOGLOADS_RATE_LIMIT_HMAC_SECRET: "x".repeat(40) }, "local"), "app").status, STATUS.invalid)
})

test("session: development switches must be unset on hosted targets and short secrets are flagged", () => {
  for (const name of ["LOGLOADS_ENABLE_DEV_LOGIN", "LOGLOADS_DEMO_MODE"]) {
    assertStatus(run(readyStaging({ [name]: "true" })), "session", STATUS.invalid)
    assert.notEqual(result(run({ [name]: "true" }, "local"), "session").status, STATUS.invalid)
  }
  assertStatus(run(readyStaging({ LOGLOADS_STATE_FILE: "/tmp/zzsentinel.json" })), "supabase-api", STATUS.invalid)
  assert.ok(hasMessage(result(run(readyStaging({ LOGLOADS_SESSION_SECRET: "zzsentinel-short" })), "session"), /shorter than 32/))
})

// --- Supabase -----------------------------------------------------------------------------

test("supabase-api: URL shape, key role and key project are checked", () => {
  assertStatus(run(readyStaging({ SUPABASE_URL: "https://zzsentinel.example.com" })), "supabase-api", STATUS.invalid)
  assertStatus(run(readyStaging({ SUPABASE_SERVICE_ROLE_KEY: jwt({ ref: REF, role: "anon" }) })), "supabase-api", STATUS.invalid)
  assertStatus(run(readyStaging({ SUPABASE_SERVICE_ROLE_KEY: "sb_publishable_zzsentinel" })), "supabase-api", STATUS.invalid)
  assertStatus(run(readyStaging({ SUPABASE_SERVICE_ROLE_KEY: jwt({ ref: OTHER_REF, role: "service_role" }) })), "supabase-api", STATUS.invalid)
  assert.ok(hasMessage(assertStatus(run(readyStaging({ SUPABASE_SERVICE_ROLE_KEY: "sb_secret_zzsentinel" })), "supabase-api", STATUS.ready), /legacy service_role JWT/))
  assert.ok(hasMessage(result(run(readyStaging({ LOGLOADS_ALLOW_STATE_BOOTSTRAP: "true" })), "supabase-api"), /one controlled bootstrap/))
})

test("supabase-api: local development may use a local stack and is warned off hosted projects", () => {
  const local = { LOGLOADS_RATE_LIMIT_HMAC_SECRET: "x".repeat(40), SUPABASE_SERVICE_ROLE_KEY: jwt({ role: "service_role" }) }

  assertStatus(run({ ...local, SUPABASE_URL: "http://127.0.0.1:55321" }, "local"), "supabase-api", STATUS.ready)
  assert.ok(hasMessage(result(run({ ...local, SUPABASE_URL: `https://${REF}.supabase.co` }, "local"), "supabase-api"), /hosted project/))
  assertStatus(run({ ...local, SUPABASE_URL: "https://zzsentinel.example.com" }, "local"), "supabase-api", STATUS.invalid)
})

test("supabase-storage: project ref, bucket, browser key and retired Cloudinary names are enforced", () => {
  assert.ok(
    assertStatus(run(readyStaging({ LOGLOADS_SUPABASE_EXPECTED_PROJECT_REF: OTHER_REF })), "supabase-storage", STATUS.invalid)
      .problems.some((problem) => /does not match the project ref in SUPABASE_URL/.test(problem))
  )
  assertStatus(run(readyStaging({ LOGLOADS_MEDIA_BUCKET: "Bad Bucket" })), "supabase-storage", STATUS.invalid)
  assert.ok(hasMessage(result(run(readyStaging({ LOGLOADS_MEDIA_BUCKET: "other-bucket" })), "supabase-storage"), /logloads-private-media/))
  assertStatus(run(readyStaging({ LOGLOADS_MEDIA_STORAGE: "cloudinary" })), "supabase-storage", STATUS.invalid)
  assertStatus(run(readyStaging({ CLOUDINARY_URL: "zzsentinel" })), "supabase-storage", STATUS.invalid)
  assertStatus(run(readyStaging({ NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_secret_zzsentinel" })), "supabase-storage", STATUS.invalid)
  assertStatus(
    run(readyStaging({ NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: undefined, NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt({ ref: OTHER_REF, role: "anon" }) })),
    "supabase-storage",
    STATUS.invalid
  )
  assertStatus(
    run(readyStaging({ NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: undefined, NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt({ ref: REF, role: "anon" }) })),
    "supabase-storage",
    STATUS.ready
  )
})

test("supabase-db: tooling values must point at the same project and use the session pooler", () => {
  const pooler = (ref, port = 5432) => `postgresql://postgres.${ref}:zzsentinelpw@aws-0-us-east-1.pooler.supabase.com:${port}/postgres`

  assertStatus(run(readyStaging({ DATABASE_URL: pooler(REF), SUPABASE_PROJECT_REF: REF })), "supabase-db", STATUS.ready)
  assertStatus(run(readyStaging({ DATABASE_URL: pooler(OTHER_REF) })), "supabase-db", STATUS.invalid)
  assertStatus(run(readyStaging({ DATABASE_URL: `postgresql://postgres:zzsentinelpw@db.${OTHER_REF}.supabase.co:5432/postgres` })), "supabase-db", STATUS.invalid)
  assert.ok(hasMessage(result(run(readyStaging({ DATABASE_URL: pooler(REF, 6543) })), "supabase-db"), /session pooler/))
  assertStatus(run(readyStaging({ SUPABASE_PROJECT_REF: OTHER_REF })), "supabase-db", STATUS.invalid)
  assertStatus(run(readyStaging({ DATABASE_URL: "mysql://zzsentinel" })), "supabase-db", STATUS.invalid)
  assertStatus(run(readyStaging({ SUPABASE_DB_PASSWORD: "zzsentinelpw" })), "supabase-db", STATUS.notReady)
})

test("the Supabase management token must never sit in a hosted environment", () => {
  assertStatus(run(readyStaging({ SUPABASE_ACCESS_TOKEN: "sbp_zzsentinel" })), "supabase-db", STATUS.invalid)
  assert.notEqual(result(run({ SUPABASE_ACCESS_TOKEN: "sbp_zzsentinel" }, "local"), "supabase-db").status, STATUS.invalid)
})

// --- rate limiting ------------------------------------------------------------------------

test("rate-limit: partial shared-store configuration and test mode are refused", () => {
  assertStatus(
    run({ LOGLOADS_RATE_LIMIT_HMAC_SECRET: "x".repeat(40), SUPABASE_URL: "http://127.0.0.1:55321" }, "local"),
    "rate-limit",
    STATUS.invalid
  )
  assertStatus(run(readyStaging({ LOGLOADS_RATE_LIMIT_TEST_MODE: "true" })), "rate-limit", STATUS.invalid)
  assert.ok(hasMessage(result(run(readyStaging({ LOGLOADS_RATE_LIMIT_KEY_PREFIX: undefined })), "rate-limit"), /default prefix/))
})

// --- Clerk and platform admin -------------------------------------------------------------

test("clerk: key modes must match the target and each other", () => {
  assert.ok(
    assertStatus(run(readyStaging({ NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_live_zzsentinel", CLERK_SECRET_KEY: "sk_live_zzsentinel" })), "clerk", STATUS.invalid)
      .problems.some((problem) => /development instance \(pk_test_\)/.test(problem))
  )
  assert.ok(
    assertStatus(run(readyProduction({ NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_zzsentinel", CLERK_SECRET_KEY: "sk_test_zzsentinel" }), "production"), "clerk", STATUS.invalid)
      .problems.some((problem) => /production instance \(pk_live_\)/.test(problem))
  )
  assertStatus(run(readyStaging({ CLERK_SECRET_KEY: "sk_live_zzsentinel" })), "clerk", STATUS.invalid)
  assertStatus(run(readyStaging({ NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "zzsentinel" })), "clerk", STATUS.invalid)
  assertStatus(run(readyStaging({ CLERK_SECRET_KEY: "zzsentinel" })), "clerk", STATUS.invalid)
  assert.ok(hasMessage(result(run(readyStaging({ NEXT_PUBLIC_CLERK_SIGN_IN_URL: "https://zzsentinel.example/sign-in" })), "clerk"), /app path/))
  assert.ok(hasMessage(result(run(readyStaging({ NEXT_PUBLIC_CLERK_SIGN_IN_URL: undefined })), "clerk"), /Clerk dashboard Paths/))
})

test("platform-admin: exactly one Clerk id with a matching digest; the claim window needs a future expiry", () => {
  const id = "user_zzsentinel08"

  assertStatus(run(readyStaging({ LOGLOADS_PLATFORM_ADMIN_CLERK_IDS: id, LOGLOADS_PLATFORM_ADMIN_EXPECTED_SCOPE_SHA256: digestFor(id) })), "platform-admin", STATUS.ready)
  assertStatus(run(readyStaging({ LOGLOADS_PLATFORM_ADMIN_CLERK_IDS: `${id},user_zzsentinel09`, LOGLOADS_PLATFORM_ADMIN_EXPECTED_SCOPE_SHA256: digestFor(id) })), "platform-admin", STATUS.invalid)
  assertStatus(run(readyStaging({ LOGLOADS_PLATFORM_ADMIN_CLERK_IDS: "clerk-admin-1", LOGLOADS_PLATFORM_ADMIN_EXPECTED_SCOPE_SHA256: digestFor(id) })), "platform-admin", STATUS.invalid)
  assertStatus(run(readyStaging({ LOGLOADS_PLATFORM_ADMIN_CLERK_IDS: id, LOGLOADS_PLATFORM_ADMIN_EXPECTED_SCOPE_SHA256: digestFor("user_other") })), "platform-admin", STATUS.invalid)
  assertStatus(run(readyStaging({ LOGLOADS_PLATFORM_ADMIN_CLERK_IDS: id, LOGLOADS_PLATFORM_ADMIN_EXPECTED_SCOPE_SHA256: "ZZSENTINEL" })), "platform-admin", STATUS.invalid)
  assertStatus(run(readyProduction({ LOGLOADS_PLATFORM_ADMIN_CLERK_IDS: undefined, LOGLOADS_PLATFORM_ADMIN_EXPECTED_SCOPE_SHA256: undefined }), "production"), "platform-admin", STATUS.notReady)

  const scoped = { LOGLOADS_PLATFORM_ADMIN_CLERK_IDS: id, LOGLOADS_PLATFORM_ADMIN_EXPECTED_SCOPE_SHA256: digestFor(id), LOGLOADS_PLATFORM_ADMIN_BOOTSTRAP: "enabled" }
  assertStatus(run(readyStaging(scoped)), "platform-admin", STATUS.invalid)
  assertStatus(run(readyStaging({ ...scoped, LOGLOADS_PLATFORM_ADMIN_BOOTSTRAP_EXPIRES_AT: "2026-11-01T00:00:00.000Z" })), "platform-admin", STATUS.invalid)
  assertStatus(run(readyStaging({ ...scoped, LOGLOADS_PLATFORM_ADMIN_BOOTSTRAP_EXPIRES_AT: "2026-11-04" })), "platform-admin", STATUS.invalid)
  assert.ok(hasMessage(assertStatus(run(readyStaging({ ...scoped, LOGLOADS_PLATFORM_ADMIN_BOOTSTRAP_EXPIRES_AT: "2026-11-04T00:00:00.000Z" })), "platform-admin", STATUS.ready), /claim window is open/))
  assertStatus(run(readyStaging({ ...scoped, LOGLOADS_PLATFORM_ADMIN_BOOTSTRAP: "yes" })), "platform-admin", STATUS.invalid)
})

// --- Stripe and the historical gates ------------------------------------------------------

function stripeReady(mode, overrides = {}) {
  return {
    LOGLOADS_STRIPE_EXPECTED_ACCOUNT_ID: "acct_zzsentinel10",
    LOGLOADS_STRIPE_EXPECTED_LIVEMODE: mode,
    STRIPE_PUBLISHABLE_KEY: `pk_${mode}_zzsentinel11`,
    STRIPE_SECRET_KEY: `sk_${mode}_zzsentinel12`,
    STRIPE_WEBHOOK_SECRET: "whsec_zzsentinel13",
    ...overrides
  }
}

test("stripe: test keys on staging are ready; key, webhook and account shapes are checked", () => {
  assertStatus(run(readyStaging(stripeReady("test"))), "stripe", STATUS.ready)
  assertStatus(run(readyStaging(stripeReady("test", { STRIPE_SECRET_KEY: "sk_live_zzsentinel" }))), "stripe", STATUS.invalid)
  assertStatus(run(readyStaging(stripeReady("test", { STRIPE_PUBLISHABLE_KEY: "pk_live_zzsentinel" }))), "stripe", STATUS.invalid)
  assertStatus(run(readyStaging(stripeReady("test", { NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "zzsentinel" }))), "stripe", STATUS.invalid)
  assert.ok(hasMessage(assertStatus(run(readyStaging(stripeReady("test", { STRIPE_SECRET_KEY: "rk_test_zzsentinel" }))), "stripe", STATUS.invalid), /restricted key/))
  assertStatus(run(readyStaging(stripeReady("test", { STRIPE_WEBHOOK_SECRET: "zzsentinel" }))), "stripe", STATUS.invalid)
  assertStatus(run(readyStaging(stripeReady("test", { LOGLOADS_STRIPE_EXPECTED_ACCOUNT_ID: "zzsentinel" }))), "stripe", STATUS.invalid)
})

test("stripe: the expected mode follows the target even when billing is dark", () => {
  assertStatus(run(readyStaging({ LOGLOADS_STRIPE_EXPECTED_LIVEMODE: "live" })), "stripe", STATUS.invalid)
  assertStatus(run(readyProduction({ LOGLOADS_STRIPE_EXPECTED_LIVEMODE: "test" }), "production"), "stripe", STATUS.invalid)
  assert.ok(hasMessage(result(run(readyStaging({ LOGLOADS_STRIPE_EXPECTED_LIVEMODE: undefined })), "stripe"), /set it to test/))
  assert.ok(hasMessage(assertStatus(run(readyProduction(stripeReady("live")), "production"), "stripe", STATUS.ready), /founder billing authorization/))
  assert.ok(hasMessage(result(run(readyStaging({ STRIPE_PRICE_DISPATCH: "price_zzsentinel" })), "stripe"), /historical subscription_v1/))
})

test("billing-gates: historical commercial gates stay disabled and their allowlists blank", () => {
  for (const name of ["LOGLOADS_FEE_COLLECTION", "LOGLOADS_PERCENTAGE_ENROLLMENT", "LOGLOADS_SUBSCRIPTION_COLLECTION", "LOGLOADS_DISPATCH_SELF_SERVE"]) {
    assertStatus(run(readyStaging({ [name]: "enabled" })), "billing-gates", STATUS.invalid)
  }
  for (const name of ["LOGLOADS_PERCENTAGE_ALLOWED_ORGANIZATION_IDS", "LOGLOADS_PERCENTAGE_EXPECTED_ORGANIZATION_SCOPE_SHA256", "LOGLOADS_SUBSCRIPTION_ALLOWED_ORGANIZATION_IDS"]) {
    assertStatus(run(readyStaging({ [name]: "zzsentinel" })), "billing-gates", STATUS.invalid)
  }
  assertStatus(run(readyStaging({ LOGLOADS_INTERNAL_BILLING_SMOKE: "enabled" })), "billing-gates", STATUS.invalid)
  assert.ok(
    hasMessage(
      assertStatus(
        run(readyStaging({ LOGLOADS_INTERNAL_BILLING_SMOKE: "enabled", LOGLOADS_INTERNAL_BILLING_SMOKE_ALLOWED_ORGANIZATION_IDS: "zzsentinel", LOGLOADS_INTERNAL_BILLING_SMOKE_ALLOWED_USER_IDS: "zzsentinel" })),
        "billing-gates",
        STATUS.ready
      ),
      /one explicitly approved manual run/
    )
  )
  assert.ok(hasMessage(result(run(readyStaging({ LOGLOADS_INTERNAL_BILLING_SMOKE_ALLOWED_USER_IDS: "zzsentinel" })), "billing-gates"), /clear them/))
  assertStatus(run(readyStaging({ LOGLOADS_FEE_COLLECTION: undefined, LOGLOADS_PERCENTAGE_ENROLLMENT: undefined })), "billing-gates", STATUS.ready)
})

// --- cron ---------------------------------------------------------------------------------

test("cron: production needs CRON_SECRET and the cron declared in apps/web/vercel.json", () => {
  assertStatus(run(readyProduction(), "production", repoWithCron), "cron", STATUS.ready)
  assertStatus(run(readyProduction(), "production", repoWithoutCron), "cron", STATUS.invalid)
  assert.ok(hasMessage(assertStatus(run(readyStaging(), "staging", repoWithoutCron), "cron", STATUS.ready), /Root Directory/))
  assertStatus(run(readyProduction({ CRON_SECRET: undefined }), "production"), "cron", STATUS.notReady)
  assert.ok(hasMessage(result(run(readyProduction({ CRON_SECRET: "zzsentinel" }), "production"), "cron"), /shorter than 16/))
})

test("cron: the repository's apps/web/vercel.json really declares the billing cron", () => {
  const report = evaluate({ contract, env: readyProduction(), now: NOW, target: "production" })

  assertStatus(report, "cron", STATUS.ready)
})

// --- Resend, PostHog, Sentry, maps, Anthropic ---------------------------------------------

test("resend: needs a re_ key and a From identity on a verified domain", () => {
  const email = { RESEND_API_KEY: "re_zzsentinel14", RESEND_FROM: "LogLoads <notifications@logloads.com>" }

  assertStatus(run(readyStaging(email)), "resend", STATUS.ready)
  assertStatus(run(readyStaging({ ...email, RESEND_API_KEY: "zzsentinel" })), "resend", STATUS.invalid)
  assert.deepEqual(assertStatus(run(readyStaging({ RESEND_API_KEY: "re_zzsentinel14" })), "resend", STATUS.notReady).missing, ["RESEND_FROM or LOGLOADS_EMAIL_FROM"])
  assert.ok(hasMessage(result(run(readyStaging({ ...email, RESEND_FROM: "zzsentinel@example.com" })), "resend"), /@logloads\.com/))
  assertStatus(run(readyStaging({ ...email, RESEND_FROM: "zzsentinel" })), "resend", STATUS.invalid)
  assert.ok(hasMessage(result(run(readyProduction(email), "production"), "resend"), /founder authorization/))
})

test("posthog: only a project key, and a blank host is refused once analytics is on", () => {
  assertStatus(run(readyStaging({ NEXT_PUBLIC_POSTHOG_KEY: "phc_zzsentinel15" })), "posthog", STATUS.ready)
  assertStatus(run(readyStaging({ NEXT_PUBLIC_POSTHOG_KEY: "phx_zzsentinel16" })), "posthog", STATUS.invalid)
  assertStatus(run(readyStaging({ NEXT_PUBLIC_POSTHOG_HOST: "", NEXT_PUBLIC_POSTHOG_KEY: "phc_zzsentinel15" })), "posthog", STATUS.invalid)
  assertStatus(run(readyStaging({ NEXT_PUBLIC_POSTHOG_HOST: "http://zzsentinel.example", NEXT_PUBLIC_POSTHOG_KEY: "phc_zzsentinel15" })), "posthog", STATUS.invalid)
  assert.ok(hasMessage(result(run(readyStaging({ NEXT_PUBLIC_POSTHOG_HOST: "https://zzsentinel.example", NEXT_PUBLIC_POSTHOG_KEY: "phc_zzsentinel15" })), "posthog"), /reverse proxy/))
  assertStatus(run(readyStaging({ NEXT_PUBLIC_POSTHOG_HOST: "" })), "posthog", STATUS.off)
})

test("sentry: the DSN must be a Sentry DSN", () => {
  assertStatus(run(readyProduction({ SENTRY_DSN: "https://zzsentinel@o1.ingest.us.sentry.io/123" }), "production"), "sentry", STATUS.ready)
  assertStatus(run(readyProduction({ SENTRY_DSN: "zzsentinel" }), "production"), "sentry", STATUS.invalid)
  assert.ok(hasMessage(result(run(readyStaging({ SENTRY_DSN: "https://zzsentinel@o1.ingest.us.sentry.io/123" })), "sentry"), /separate Sentry project/))
})

test("maps: reports the provider and refuses a secret Mapbox token", () => {
  assert.ok(hasMessage(result(run(readyStaging()), "maps"), /keyless CARTO/))
  assert.ok(hasMessage(result(run(readyStaging({ NEXT_PUBLIC_CARTO_BASEMAP_KEY: "zzsentinel" })), "maps"), /CARTO Basemaps/))
  assert.ok(hasMessage(result(run(readyStaging({ NEXT_PUBLIC_MAPBOX_TOKEN: "pk.zzsentinel" })), "maps"), /legacy Mapbox/))
  assertStatus(run(readyStaging({ NEXT_PUBLIC_MAPBOX_TOKEN: "sk.zzsentinel" })), "maps", STATUS.invalid)
})

test("anthropic: optional; a blank assistant model is flagged once the key is set", () => {
  assertStatus(run(readyStaging()), "anthropic", STATUS.off)
  assert.ok(hasMessage(assertStatus(run(readyStaging({ ANTHROPIC_API_KEY: "sk-ant-zzsentinel", ASSISTANT_MODEL: "" })), "anthropic", STATUS.ready), /ASSISTANT_MODEL is blank/))
  assert.ok(hasMessage(result(run(readyStaging({ ANTHROPIC_API_KEY: "zzsentinel" })), "anthropic"), /sk-ant-/))
})

// --- environment-wide ---------------------------------------------------------------------

test("environment: secrets never sit under NEXT_PUBLIC_, by name or by value shape", () => {
  assertStatus(run(readyStaging({ NEXT_PUBLIC_SERVICE_ROLE_KEY: "zzsentinel" })), "environment", STATUS.invalid)
  assertStatus(run(readyStaging({ NEXT_PUBLIC_STRIPE_SECRET: "zzsentinel" })), "environment", STATUS.invalid)

  for (const value of [
    "sk_live_zzsentinel",
    "rk_test_zzsentinel",
    "whsec_zzsentinel",
    "sb_secret_zzsentinel",
    jwt({ role: "service_role" }),
    "re_zzsentinel",
    "phx_zzsentinel",
    "sk.zzsentinel",
    "sk-ant-zzsentinel",
    "postgresql://postgres:zzsentinel@db.example.supabase.co:5432/postgres"
  ]) {
    const entry = assertStatus(run(readyStaging({ NEXT_PUBLIC_CARTO_BASEMAP_KEY: value })), "environment", STATUS.invalid)

    assert.ok(entry.problems.some((problem) => /NEXT_PUBLIC_CARTO_BASEMAP_KEY holds a value shaped like/.test(problem)))
  }
})

test("environment: unknown, removed and CI-only names are reported by name", () => {
  const entry = assertStatus(
    run(readyStaging({ CODEX_AGENT_WEBHOOK_TOKEN: "zzsentinel", LOGLOADS_TYPO_FLAG: "zzsentinel", OPENAI_API_KEY: "zzsentinel", STRIPE_SECRET: "zzsentinel" })),
    "environment",
    STATUS.ready
  )

  assert.ok(entry.warnings.some((warning) => /LOGLOADS_TYPO_FLAG, STRIPE_SECRET/.test(warning)))
  assert.ok(entry.warnings.some((warning) => /removed placeholders.*OPENAI_API_KEY/.test(warning)))
  assert.ok(entry.warnings.some((warning) => /GitHub Actions secrets.*CODEX_AGENT_WEBHOOK_TOKEN/.test(warning)))
})

test("environment: a Doppler config that does not match the target is flagged", () => {
  assert.ok(hasMessage(result(run(readyStaging({ DOPPLER_CONFIG: "prd" })), "environment"), /not stg/))
  assert.equal(result(run(readyStaging({ DOPPLER_CONFIG: "stg" })), "environment").warnings.length, 0)
  assert.equal(result(run(readyStaging({ DOPPLER_CONFIG: "stg_owner" })), "environment").warnings.length, 0)
})

// --- deployment probe ---------------------------------------------------------------------

function healthFor(overrides = {}) {
  return {
    app: "logloads",
    engine: { ok: true },
    gitCommit: "0123456789abcdef0123",
    integrations: {
      analytics: false,
      auth: "clerk",
      billing: "misconfigured",
      canonicalState: true,
      credentialReview: false,
      email: false,
      errorTracking: false,
      media: true,
      ...overrides
    },
    status: "ok"
  }
}

function fakeFetch(routes, calls = []) {
  return async (url, init) => {
    calls.push({ headers: init.headers, url })
    const route = routes[new URL(url).pathname]

    if (!route) throw new Error("unexpected url")

    return {
      json: async () => {
        if (route.body === undefined) throw new Error("not json")
        return route.body
      },
      status: route.status
    }
  }
}

test("probe: a deployment that matches the environment passes, and the cron route proves CRON_SECRET", async () => {
  const env = readyStaging({ VERCEL_AUTOMATION_BYPASS_SECRET: "zzsentinel-bypass" })
  const calls = []
  const report = run(env)
  const probe = await probeDeployment({
    env,
    fetchImpl: fakeFetch({ "/api/billing/cron": { body: { error: "Unauthorized" }, status: 401 }, "/api/health": { body: healthFor(), status: 200 } }, calls),
    origin: "https://staging.example",
    report
  })

  assert.equal(probe.status, STATUS.ready, JSON.stringify(probe.problems))
  assert.ok(probe.notes.some((note) => /CRON_SECRET is configured/.test(note)))
  assert.ok(probe.notes.some((note) => /0123456789ab/.test(note)))
  assert.equal(calls[0].headers["x-vercel-protection-bypass"], "zzsentinel-bypass")
  assert.equal(calls[0].url, "https://staging.example/api/health")
})

test("probe: drift between Doppler and the deployment, degraded health and protection are reported", async () => {
  const env = readyStaging()
  const report = run(env)
  const probe = async (routes, target = report) => probeDeployment({ env, fetchImpl: fakeFetch(routes), origin: "https://staging.example", report: target })
  const cron = { body: { error: "Unauthorized" }, status: 401 }

  const drift = await probe({ "/api/billing/cron": cron, "/api/health": { body: healthFor({ media: false }), status: 200 } })
  assert.equal(drift.status, STATUS.invalid)
  assert.ok(drift.problems.some((problem) => /integrations\.media=false/.test(problem) && /redeploy/.test(problem)))

  const degraded = await probe({ "/api/billing/cron": cron, "/api/health": { body: { ...healthFor(), engine: { ok: false }, status: "degraded" }, status: 503 } })
  assert.ok(degraded.problems.some((problem) => /bootstrap/.test(problem)))

  const protectedPreview = await probe({ "/api/health": { status: 401 } })
  assert.ok(protectedPreview.problems.some((problem) => /VERCEL_AUTOMATION_BYPASS_SECRET/.test(problem)))

  const production = run(readyProduction(), "production")
  const cronMissing = await probe({ "/api/billing/cron": { body: { error: "x" }, status: 503 }, "/api/health": { body: healthFor(), status: 200 } }, production)
  assert.ok(cronMissing.problems.some((problem) => /CRON_SECRET is not configured/.test(problem)))

  const invalidOrigin = await probeDeployment({ env, fetchImpl: fakeFetch({}), origin: "ftp://x", report })
  assert.equal(invalidOrigin.status, STATUS.invalid)

  const unreachable = await probeDeployment({ env, fetchImpl: async () => { throw new Error("zzsentinel network") }, origin: "https://x.example", report })
  assert.ok(unreachable.problems.some((problem) => /did not answer/.test(problem)))
  assertNoSentinel(JSON.stringify(unreachable))
})

// --- CLI ----------------------------------------------------------------------------------

function capture() {
  const out = []
  const err = []

  return { err, io: { stderr: (text) => err.push(text), stdout: (text) => out.push(text) }, out }
}

test("cli: exits 0 with a report by default and 1 under --strict when not ready", async () => {
  const first = capture()
  assert.equal(await runCli(["--target", "staging"], { env: {}, readRepoFile: repoWithCron, ...first.io }), 0)
  assert.match(first.out.join(""), /NOT READY for staging/)

  const strict = capture()
  assert.equal(await runCli(["--target", "staging", "--strict"], { env: {}, readRepoFile: repoWithCron, ...strict.io }), 1)

  const ready = capture()
  assert.equal(await runCli(["--target=staging", "--strict"], { env: readyStaging(), now: NOW, readRepoFile: repoWithCron, ...ready.io }), 0)
  assert.match(ready.out.join(""), /READY for staging/)
})

test("cli: usage errors exit 2", async () => {
  for (const argv of [["--target"], ["--target", "prod"], ["--bogus"], ["--env-file"]]) {
    const io = capture()
    assert.equal(await runCli(argv, { env: {}, ...io.io }), 2, argv.join(" "))
  }

  const missing = capture()
  assert.equal(await runCli(["--env-file", "nope.env"], { env: {}, fileExists: () => false, ...missing.io }), 2)
  assert.throws(() => parseArgs(["--health-url", "--strict"]), /needs a value/)
})

test("cli: --env-file and --json read a file and print structured verdicts", async () => {
  const text = Object.entries(readyStaging()).map(([name, value]) => `${name}=${value}`).join("\n")
  const io = capture()
  const code = await runCli(["--target", "staging", "--env-file", "stg.env", "--json"], {
    cwd: "/repo",
    env: {},
    fileExists: () => true,
    now: NOW,
    readFile: () => text,
    readRepoFile: repoWithCron,
    ...io.io
  })
  const parsed = JSON.parse(io.out.join(""))

  assert.equal(code, 0)
  assert.equal(parsed.ready, true)
  assert.equal(parsed.source, "stg.env")
  assert.equal(parsed.target, "staging")
  assertNoSentinel(io.out.join(""))
})

test("cli: --list prints every contract variable with its Doppler configs", async () => {
  const io = capture()

  assert.equal(await runCli(["--list"], { ...io.io }), 0)
  for (const variable of contract.variables) {
    assert.ok(io.out.join("").includes(variable.name), variable.name)
  }
  assert.match(formatList(contract), /LOGLOADS_MARKETPLACE_V2\s+dev, stg/)
})

test("no value is ever printed: every target, every check, text and JSON, with the deployment probe", async () => {
  const id = "user_zzsentinel17"
  // Every name in the contract gets a sentinel value, then a second pass adds shapes that trigger each check.
  const everything = Object.fromEntries(contract.variables.map((variable) => [variable.name, `zzsentinel-${variable.name.toLowerCase()}`]))
  const kitchenSinks = [
    everything,
    readyStaging(),
    readyProduction(stripeReady("live", { RESEND_API_KEY: "re_zzsentinel", RESEND_FROM: "zzsentinel@example.com", NEXT_PUBLIC_POSTHOG_KEY: "phx_zzsentinel", SENTRY_DSN: "https://zzsentinel@o1.ingest.sentry.io/1" })),
    readyStaging({
      ANTHROPIC_API_KEY: "zzsentinel",
      ASSISTANT_MODEL: "",
      CLOUDINARY_API_SECRET: "zzsentinel",
      DATABASE_URL: `postgresql://postgres.${OTHER_REF}:zzsentinelpw@aws-0-us-east-1.pooler.supabase.com:6543/postgres`,
      DOPPLER_CONFIG: "zzsentinelconfig",
      LOGLOADS_PLATFORM_ADMIN_BOOTSTRAP: "enabled",
      LOGLOADS_PLATFORM_ADMIN_BOOTSTRAP_EXPIRES_AT: "zzsentinel",
      LOGLOADS_PLATFORM_ADMIN_CLERK_IDS: id,
      LOGLOADS_PLATFORM_ADMIN_EXPECTED_SCOPE_SHA256: digestFor("user_other"),
      LOGLOADS_SUPABASE_EXPECTED_PROJECT_REF: OTHER_REF,
      LOGLOADS_TYPO_NAME: "zzsentinel",
      NEXT_PUBLIC_APP_URL: "http://zzsentinel.example",
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_live_zzsentinel",
      NEXT_PUBLIC_MAPBOX_TOKEN: "sk.zzsentinel",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: jwt({ ref: OTHER_REF, role: "service_role" }),
      SUPABASE_ACCESS_TOKEN: "sbp_zzsentinel",
      SUPABASE_SERVICE_ROLE_KEY: "sb_secret_zzsentinel",
      ...stripeReady("test", { STRIPE_SECRET_KEY: "rk_live_zzsentinel", STRIPE_WEBHOOK_SECRET: "zzsentinel" })
    })
  ]
  const health = { "/api/billing/cron": { body: { error: "Unauthorized" }, status: 401 }, "/api/health": { body: healthFor({ media: false }), status: 200 } }

  for (const env of kitchenSinks) {
    for (const target of TARGETS) {
      for (const extra of [[], ["--json"], ["--health-url", "https://deployment.example"]]) {
        const io = capture()

        await runCli(["--target", target, ...extra], { env, fetchImpl: fakeFetch(health), now: NOW, readRepoFile: repoWithCron, ...io.io })
        assertNoSentinel(io.out.join("") + io.err.join(""))
      }
    }
  }
})
