#!/usr/bin/env node
// LogLoads integration readiness: which provider connections are ready for a target.
//
//   pnpm integrations:check --target staging                  # report, exit 0
//   doppler run --project logloads --config stg -- pnpm integrations:check --target staging --strict
//   pnpm integrations:check --target local --env-file apps/web/.env.local
//   pnpm integrations:check --target staging --health-url https://<deployment>   # also compare /api/health
//   pnpm integrations:check --list                            # every variable, by integration and Doppler config
//
// The variable lists come from ops/production-env-contract.json (`targets`, `integrations`, and each
// variable's `integration`, `doppler_configs`, `must_be_unset_in`, `allowed_values`, `expected_by_target`).
// The consistency checks below never print a value: every message is built from variable names and
// fixed text only, and tools/integration-readiness.test.mjs asserts that with sentinel values.
import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
export const TARGETS = ["local", "preview", "staging", "production"]
export const STATUS = Object.freeze({
  invalid: "INVALID",
  notReady: "NOT READY",
  off: "OFF",
  ready: "READY"
})

const PROVIDER_PREFIXES = [
  "LOGLOADS_",
  "NEXT_PUBLIC_",
  "STRIPE_",
  "SUPABASE_",
  "CLERK_",
  "RESEND_",
  "SENTRY_",
  "POSTHOG_",
  "CARTO_",
  "MAPBOX_",
  "CRON_"
]
const MEDIA_BUCKET_PATTERN = /^[a-z0-9][a-z0-9_-]{2,62}$/
const CLERK_USER_ID_PATTERN = /^user_[A-Za-z0-9]+$/
const SHA256_PATTERN = /^[0-9a-f]{64}$/
const PLATFORM_ADMIN_SCOPE_VERSION = "logloads-platform-admin-scope-v1"
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"])

// ---------------------------------------------------------------------------------------------
// Contract and environment sources
// ---------------------------------------------------------------------------------------------

export function loadContract(root = REPO_ROOT) {
  return JSON.parse(readFileSync(join(root, "ops", "production-env-contract.json"), "utf8"))
}

/** Parses dotenv text (KEY=value, optional `export`, quotes, trailing # comments on unquoted values). */
export function parseEnvText(text) {
  const values = {}

  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(line)

    if (!match) {
      continue
    }

    let raw = match[2].trim()
    const quote = raw[0]

    if ((quote === '"' || quote === "'") && raw.indexOf(quote, 1) > 0) {
      raw = raw.slice(1, raw.indexOf(quote, 1))
    } else {
      raw = raw.replace(/\s+#.*$/, "").trim()
    }

    values[match[1]] = raw
  }

  return values
}

/** Reads a dotenv file, or a JSON object of strings (e.g. `doppler secrets download --format json`). */
export function readEnvFile(path, readFile = (file) => readFileSync(file, "utf8")) {
  // Windows PowerShell writes a byte-order mark when it redirects `doppler secrets download` to a file.
  const text = readFile(path).replace(/^﻿/, "")

  if (/\.json$/i.test(path)) {
    let parsed

    try {
      parsed = JSON.parse(text)
    } catch {
      // The parser's own message quotes the text around the error, which can be a secret value.
      throw new Error("the JSON env file is not valid JSON (the parser's message is withheld because it can quote values)")
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("the JSON env file must be an object of NAME: value strings")
    }

    return Object.fromEntries(
      Object.entries(parsed).filter(([, value]) => typeof value === "string")
    )
  }

  return parseEnvText(text)
}

// ---------------------------------------------------------------------------------------------
// Value classification (results are fixed labels, never the value)
// ---------------------------------------------------------------------------------------------

function present(env, name) {
  const raw = env[name]

  return typeof raw === "string" && raw.trim() !== "" ? raw.trim() : null
}

function isSet(env, name) {
  return present(env, name) !== null
}

function isBlankButPresent(env, name) {
  return typeof env[name] === "string" && env[name].trim() === ""
}

function parseUrl(raw) {
  try {
    return new URL(raw)
  } catch {
    return null
  }
}

function isLoopbackUrl(raw) {
  const url = parseUrl(raw)

  return Boolean(url && LOOPBACK_HOSTS.has(url.hostname.replace(/^\[|\]$/g, "")))
}

/** Returns the project ref of an https://<ref>.supabase.co URL, or null. */
export function supabaseRefFromUrl(raw) {
  const url = parseUrl(raw)

  if (!url || url.protocol !== "https:" || !url.hostname.endsWith(".supabase.co")) {
    return null
  }

  const ref = url.hostname.slice(0, -".supabase.co".length)

  return /^[a-z0-9]+$/.test(ref) ? ref : null
}

/** Decodes the payload of a JWT-shaped string without verifying it. Returns null if not a JWT. */
export function jwtPayload(raw) {
  const parts = raw.split(".")

  if (parts.length !== 3 || !parts[0].startsWith("eyJ")) {
    return null
  }

  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"))

    return payload && typeof payload === "object" ? payload : null
  } catch {
    return null
  }
}

/** Classifies a Supabase API key: service_role | anon | secret | publishable | unknown. */
export function supabaseKeyKind(raw) {
  if (raw.startsWith("sb_secret_")) return { kind: "secret", ref: null }
  if (raw.startsWith("sb_publishable_")) return { kind: "publishable", ref: null }

  const payload = jwtPayload(raw)

  if (payload?.role === "service_role") return { kind: "service_role", ref: payload.ref ?? null }
  if (payload?.role === "anon") return { kind: "anon", ref: payload.ref ?? null }

  return { kind: "unknown", ref: payload?.ref ?? null }
}

function prefixMode(raw, prefix) {
  if (raw.startsWith(`${prefix}test_`)) return "test"
  if (raw.startsWith(`${prefix}live_`)) return "live"

  return null
}

function expectedClerkMode(target) {
  return target === "production" ? "live" : "test"
}

/** Kinds of secret a NEXT_PUBLIC_ value must never hold. Each entry is [label, predicate]. */
const SECRET_VALUE_SHAPES = [
  ["Stripe or Clerk secret key", (raw) => /^(?:sk|rk)_(?:test|live)_/.test(raw)],
  ["Stripe webhook signing secret", (raw) => raw.startsWith("whsec_")],
  ["Supabase secret key", (raw) => raw.startsWith("sb_secret_")],
  ["Supabase service_role key", (raw) => jwtPayload(raw)?.role === "service_role"],
  ["Resend API key", (raw) => /^re_[A-Za-z0-9]/.test(raw)],
  ["PostHog personal API key", (raw) => raw.startsWith("phx_")],
  ["Mapbox secret token", (raw) => raw.startsWith("sk.")],
  ["Anthropic API key", (raw) => raw.startsWith("sk-ant-")],
  ["database URL with a password", (raw) => /^postgres(?:ql)?:\/\/[^:/@]+:[^@]+@/.test(raw)]
]
const SECRET_NAME_PATTERN = /SECRET|PRIVATE|PASSWORD|SERVICE_ROLE|ACCESS_TOKEN|AUTH_TOKEN|WEBHOOK/

// ---------------------------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------------------------

function flattenNeeds(needs = []) {
  return needs.flatMap((entry) => (Array.isArray(entry) ? entry : [entry]))
}

function missingNeeds(env, needs = []) {
  const missing = []

  for (const entry of needs) {
    if (Array.isArray(entry)) {
      if (!entry.some((name) => isSet(env, name))) {
        missing.push(entry.join(" or "))
      }
    } else if (!isSet(env, entry)) {
      missing.push(entry)
    }
  }

  return missing
}

function createResult(integration, target) {
  return {
    id: integration.id,
    label: integration.label,
    docs: integration.docs ?? null,
    required: (integration.required_in ?? []).includes(target),
    active: false,
    status: STATUS.ready,
    missing: [],
    problems: [],
    warnings: [],
    notes: []
  }
}

function applyVariableRules(result, variables, env, target) {
  for (const variable of variables) {
    const raw = present(env, variable.name)

    if (raw === null) {
      continue
    }

    if (variable.must_be_unset_in?.includes(target)) {
      result.problems.push(`${variable.name} must be unset for target ${target}`)
      continue
    }

    if (variable.allowed_values && !variable.allowed_values.includes(raw)) {
      result.problems.push(`${variable.name} must be one of: ${variable.allowed_values.join(", ")}`)
      continue
    }

    const expected = variable.expected_by_target?.[target]

    if (expected && raw.toLowerCase() !== expected) {
      result.problems.push(`${variable.name} must be ${expected} for target ${target}`)
    }
  }
}

function finish(result) {
  if (result.problems.length > 0) {
    result.status = STATUS.invalid
  } else if (result.active && result.missing.length > 0) {
    result.status = STATUS.notReady
  } else if (!result.active) {
    result.status = STATUS.off
  } else {
    result.status = STATUS.ready
  }

  return result
}

function secretLengthWarning(result, env, name, minimum) {
  const raw = present(env, name)

  if (raw !== null && raw.length < minimum) {
    result.warnings.push(`${name} is shorter than ${minimum} characters; generate a longer random value`)
  }
}

const CHECKS = {
  app(result, { env, target, contract, hosted }) {
    const raw = present(env, "NEXT_PUBLIC_APP_URL")

    if (raw === null) {
      result.notes.push(
        hosted
          ? "NEXT_PUBLIC_APP_URL is unset: absolute URLs use VERCEL_URL, which changes per deployment"
          : "NEXT_PUBLIC_APP_URL is unset: the app uses http://localhost:3002"
      )
    } else {
      const url = parseUrl(raw)

      if (!url || !["http:", "https:"].includes(url.protocol)) {
        result.problems.push("NEXT_PUBLIC_APP_URL is not an http(s) URL")
      } else if (hosted && url.protocol !== "https:") {
        result.problems.push(`NEXT_PUBLIC_APP_URL must use https for target ${target}`)
      } else if (!hosted && !isLoopbackUrl(raw)) {
        result.warnings.push("NEXT_PUBLIC_APP_URL is not a loopback origin, so seeded sign-in stays off locally")
      } else if (target === "production" && url.origin !== contract.canonical_app_url) {
        result.warnings.push(`NEXT_PUBLIC_APP_URL differs from the canonical ${contract.canonical_app_url}`)
      }
    }

    if (hosted && target !== "production" && isSet(env, "LOGLOADS_MARKETPLACE_V2")) {
      result.warnings.push(
        "LOGLOADS_MARKETPLACE_V2 is enabled on a hosted target: it needs an isolated Supabase project and the docs/DEPLOYMENT.md §4 gates"
      )
    }
  },

  session(result, { env, hosted }) {
    secretLengthWarning(result, env, "LOGLOADS_SESSION_SECRET", 32)

    if (!hosted && !isSet(env, "LOGLOADS_SESSION_SECRET")) {
      result.notes.push("LOGLOADS_SESSION_SECRET is unset: local development uses its built-in fallback (run pnpm setup:local)")
    }
  },

  "supabase-api"(result, { env, hosted }) {
    const url = present(env, "SUPABASE_URL")
    const key = present(env, "SUPABASE_SERVICE_ROLE_KEY")
    const urlRef = url ? supabaseRefFromUrl(url) : null

    if (url !== null) {
      if (hosted && !urlRef) {
        result.problems.push("SUPABASE_URL must be https://<project-ref>.supabase.co")
      } else if (!hosted && !urlRef && !isLoopbackUrl(url)) {
        result.problems.push("SUPABASE_URL is neither a local stack nor https://<project-ref>.supabase.co")
      } else if (!hosted && urlRef) {
        result.warnings.push(
          "SUPABASE_URL points local development at a hosted project; local work should use the JSON store or a local stack (docs/ENVIRONMENT.md §2)"
        )
      }
    }

    if (key !== null) {
      const { kind, ref } = supabaseKeyKind(key)

      if (kind === "anon" || kind === "publishable") {
        result.problems.push(`SUPABASE_SERVICE_ROLE_KEY holds a ${kind} key, not a server key`)
      } else if (kind === "secret") {
        result.warnings.push(
          "SUPABASE_SERVICE_ROLE_KEY is a new-style sb_secret_ key; the app sends it as Authorization: Bearer (packages/db/src/snapshot.ts, apps/web/lib/rate-limit-supabase.ts), which Supabase documents for JWT keys. Use the legacy service_role JWT until that path is verified"
        )
      } else if (kind === "unknown") {
        result.warnings.push("SUPABASE_SERVICE_ROLE_KEY is not a recognizable Supabase key")
      }

      if (ref && urlRef && ref !== urlRef) {
        result.problems.push("SUPABASE_SERVICE_ROLE_KEY belongs to a different Supabase project than SUPABASE_URL")
      }
    }

    if (isSet(env, "LOGLOADS_ALLOW_STATE_BOOTSTRAP") && hosted) {
      result.warnings.push(
        "LOGLOADS_ALLOW_STATE_BOOTSTRAP is set: keep it only for one controlled bootstrap of an empty operating_state, then delete it and redeploy"
      )
    }

    if (!hosted && url === null && key === null) {
      result.notes.push("no Supabase API configured: local development uses the JSON store")
    }
  },

  "supabase-storage"(result, { env, contract }) {
    const forbidden = contract.private_media_storage?.forbidden_environment_prefixes ?? []
    const forbiddenNames = Object.keys(env)
      .filter((name) => forbidden.some((prefix) => name.startsWith(prefix)) && isSet(env, name))
      .sort()

    if (forbiddenNames.length > 0) {
      result.problems.push(
        `${forbiddenNames.join(", ")} ${forbiddenNames.length === 1 ? "is" : "are"} set; any retired Cloudinary variable disables private media`
      )
    }

    const bucket = present(env, "LOGLOADS_MEDIA_BUCKET")

    if (bucket !== null && !MEDIA_BUCKET_PATTERN.test(bucket)) {
      result.problems.push("LOGLOADS_MEDIA_BUCKET is not a valid bucket name")
    } else if (bucket !== null && bucket !== "logloads-private-media") {
      result.warnings.push("LOGLOADS_MEDIA_BUCKET is not logloads-private-media, the bucket the runbook creates")
    }

    const url = present(env, "SUPABASE_URL")
    const urlRef = url ? supabaseRefFromUrl(url) : null
    const expectedRef = present(env, "LOGLOADS_SUPABASE_EXPECTED_PROJECT_REF")

    if (expectedRef !== null && url !== null && expectedRef !== urlRef) {
      result.problems.push("LOGLOADS_SUPABASE_EXPECTED_PROJECT_REF does not match the project ref in SUPABASE_URL")
    }

    const publishable = present(env, "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY")
    const alias = present(env, "NEXT_PUBLIC_SUPABASE_ANON_KEY")
    const browserName = publishable !== null ? "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY" : "NEXT_PUBLIC_SUPABASE_ANON_KEY"
    const browserKey = publishable ?? alias

    if (browserKey !== null) {
      const { kind, ref } = supabaseKeyKind(browserKey)

      if (kind === "service_role" || kind === "secret") {
        result.problems.push(`${browserName} holds a server key; only a publishable or anon key may reach the browser`)
      } else if (kind === "unknown") {
        result.warnings.push(`${browserName} is not a recognizable Supabase publishable or anon key`)
      }

      if (ref && urlRef && ref !== urlRef) {
        result.problems.push(`${browserName} belongs to a different Supabase project than SUPABASE_URL`)
      }
    }

    if (publishable !== null && alias !== null) {
      result.notes.push("both browser key names are set; NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY wins")
    }
  },

  "supabase-db"(result, { env, hosted }) {
    result.notes.push("tooling only: the running app never reads these")

    const raw = present(env, "DATABASE_URL")
    const knownRef =
      present(env, "LOGLOADS_SUPABASE_EXPECTED_PROJECT_REF") ??
      supabaseRefFromUrl(present(env, "SUPABASE_URL") ?? "")
    const projectRef = present(env, "SUPABASE_PROJECT_REF")

    if (projectRef !== null && knownRef && projectRef !== knownRef) {
      result.problems.push("SUPABASE_PROJECT_REF does not match the project ref in SUPABASE_URL")
    }

    if (raw === null) {
      return
    }

    const url = parseUrl(raw)

    if (!url || !["postgres:", "postgresql:"].includes(url.protocol)) {
      result.problems.push("DATABASE_URL is not a postgres:// connection string")
      return
    }

    const host = url.hostname
    const user = decodeURIComponent(url.username)
    const dbRef =
      /^db\.([a-z0-9]+)\.supabase\.co$/.exec(host)?.[1] ??
      (host.endsWith(".pooler.supabase.com") ? /^postgres\.([a-z0-9]+)$/.exec(user)?.[1] : null) ??
      null

    if (dbRef && knownRef && dbRef !== knownRef) {
      result.problems.push("DATABASE_URL points at a different Supabase project than SUPABASE_URL")
    }

    if (url.port === "6543") {
      result.warnings.push("DATABASE_URL uses the transaction pooler (6543); supabase db push needs the session pooler on 5432")
    }

    if (hosted && LOOPBACK_HOSTS.has(host)) {
      result.warnings.push("DATABASE_URL points at localhost on a hosted target")
    }
  },

  "rate-limit"(result, { env, hosted }) {
    secretLengthWarning(result, env, "LOGLOADS_RATE_LIMIT_HMAC_SECRET", 32)

    if (isSet(env, "SUPABASE_URL") !== isSet(env, "SUPABASE_SERVICE_ROLE_KEY")) {
      result.problems.push(
        "only one of SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY is set; a partial shared-store configuration makes every rate-limited route unavailable"
      )
    }

    if (hosted && !isSet(env, "LOGLOADS_RATE_LIMIT_KEY_PREFIX")) {
      result.notes.push("LOGLOADS_RATE_LIMIT_KEY_PREFIX is unset: the code default prefix is used")
    }
  },

  clerk(result, { env, target }) {
    const publishable = present(env, "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY")
    const secret = present(env, "CLERK_SECRET_KEY")
    const expected = expectedClerkMode(target)
    const publishableMode = publishable ? prefixMode(publishable, "pk_") : null
    const secretMode = secret ? prefixMode(secret, "sk_") : null

    if (publishable !== null && !publishableMode) {
      result.problems.push("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY is not a Clerk publishable key (pk_test_ or pk_live_)")
    } else if (publishableMode && publishableMode !== expected) {
      result.problems.push(
        `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY is a ${publishableMode} key (pk_${publishableMode}_) but target ${target} needs the ${expected === "live" ? "production instance (pk_live_)" : "development instance (pk_test_)"}`
      )
    }

    if (secret !== null && !secretMode) {
      result.problems.push("CLERK_SECRET_KEY is not a Clerk secret key (sk_test_ or sk_live_)")
    } else if (secretMode && publishableMode && secretMode !== publishableMode) {
      result.problems.push("CLERK_SECRET_KEY and NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY come from different Clerk instances (test vs live)")
    }

    for (const name of [
      "NEXT_PUBLIC_CLERK_SIGN_IN_URL",
      "NEXT_PUBLIC_CLERK_SIGN_UP_URL",
      "NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL",
      "NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL"
    ]) {
      const raw = present(env, name)

      if (raw !== null && !raw.startsWith("/")) {
        result.warnings.push(`${name} should be an app path such as /sign-in`)
      }
    }

    if (result.active && !isSet(env, "NEXT_PUBLIC_CLERK_SIGN_IN_URL")) {
      result.notes.push("NEXT_PUBLIC_CLERK_SIGN_IN_URL and NEXT_PUBLIC_CLERK_SIGN_UP_URL are unset: Clerk-rendered links follow the Clerk dashboard Paths")
    }

    if (!result.active) {
      result.notes.push("no Clerk keys: seeded development sign-in (loopback, non-production only)")
    }
  },

  "platform-admin"(result, { env, now }) {
    const rawIds = env.LOGLOADS_PLATFORM_ADMIN_CLERK_IDS ?? ""
    const digest = env.LOGLOADS_PLATFORM_ADMIN_EXPECTED_SCOPE_SHA256 ?? ""
    let id = null

    if (rawIds !== "") {
      const entries = rawIds.split(",")

      if (entries.length !== 1 || entries[0] !== entries[0].trim() || !CLERK_USER_ID_PATTERN.test(entries[0])) {
        result.problems.push("LOGLOADS_PLATFORM_ADMIN_CLERK_IDS must be exactly one Clerk user_ id with no spaces or commas")
      } else {
        id = entries[0]
      }
    }

    if (digest !== "") {
      if (!SHA256_PATTERN.test(digest)) {
        result.problems.push("LOGLOADS_PLATFORM_ADMIN_EXPECTED_SCOPE_SHA256 is not a lowercase 64-character SHA-256")
      } else if (id) {
        const expected = createHash("sha256").update(`${PLATFORM_ADMIN_SCOPE_VERSION}\n${id}`).digest("hex")

        if (expected !== digest) {
          result.problems.push("LOGLOADS_PLATFORM_ADMIN_EXPECTED_SCOPE_SHA256 does not match LOGLOADS_PLATFORM_ADMIN_CLERK_IDS")
        }
      }
    }

    if (rawIds !== "" && !isSet(env, "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY")) {
      result.warnings.push("the platform-admin scope is set but Clerk is not configured")
    }

    const bootstrap = (env.LOGLOADS_PLATFORM_ADMIN_BOOTSTRAP ?? "").trim().toLowerCase()

    if (bootstrap === "enabled") {
      const expiresAt = env.LOGLOADS_PLATFORM_ADMIN_BOOTSTRAP_EXPIRES_AT ?? ""
      const parsed = new Date(expiresAt)

      if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString() !== expiresAt) {
        result.problems.push("LOGLOADS_PLATFORM_ADMIN_BOOTSTRAP is enabled without a canonical ISO LOGLOADS_PLATFORM_ADMIN_BOOTSTRAP_EXPIRES_AT")
      } else if (parsed.valueOf() <= now.valueOf()) {
        result.problems.push("LOGLOADS_PLATFORM_ADMIN_BOOTSTRAP_EXPIRES_AT is in the past; disable the bootstrap gate")
      } else {
        result.warnings.push("the platform-admin claim window is open: claim once at /admin/bootstrap, then disable the gate and remove the expiry")
      }
    } else if (isSet(env, "LOGLOADS_PLATFORM_ADMIN_BOOTSTRAP_EXPIRES_AT")) {
      result.warnings.push("LOGLOADS_PLATFORM_ADMIN_BOOTSTRAP_EXPIRES_AT is set while the gate is disabled; remove it")
    }

    if (!result.active) {
      result.notes.push("no founder admin scope yet: claim it after Clerk works (docs/ACTIVATION_CLERK.md §3)")
    }
  },

  stripe(result, { env, target, contract }) {
    const expectedMode = contract.variables
      .find((variable) => variable.name === "LOGLOADS_STRIPE_EXPECTED_LIVEMODE")
      ?.expected_by_target?.[target]
    const livemode = present(env, "LOGLOADS_STRIPE_EXPECTED_LIVEMODE")?.toLowerCase() ?? null
    const historical = contract.variables
      .filter((variable) => /^STRIPE_PRICE_|^STRIPE_PORTAL_/.test(variable.name) && isSet(env, variable.name))
      .map((variable) => variable.name)

    if (historical.length > 0) {
      result.warnings.push(
        `${historical.join(", ")}: historical subscription_v1 catalog ids; never provision them for new activity`
      )
    }

    if (!result.active) {
      result.notes.push("no Stripe credential is set: billing stays dark and /api/health reports billing=misconfigured")

      if (livemode === null && expectedMode) {
        result.warnings.push(`LOGLOADS_STRIPE_EXPECTED_LIVEMODE is unset; set it to ${expectedMode} now so every Stripe boundary knows the mode`)
      }

      return
    }

    const secret = present(env, "STRIPE_SECRET_KEY")
    const secretMode = secret ? prefixMode(secret, "sk_") : null

    if (secret !== null && !secretMode) {
      result.problems.push(
        secret.startsWith("rk_")
          ? "STRIPE_SECRET_KEY is a restricted key (rk_); the runtime mode check accepts only sk_test_ or sk_live_"
          : "STRIPE_SECRET_KEY is not a Stripe secret key (sk_test_ or sk_live_)"
      )
    }

    if (secretMode && livemode && secretMode !== livemode) {
      result.problems.push(`STRIPE_SECRET_KEY is a ${secretMode}-mode key but LOGLOADS_STRIPE_EXPECTED_LIVEMODE says ${livemode}`)
    }

    const publishableModes = new Set()

    for (const name of ["STRIPE_PUBLISHABLE_KEY", "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY"]) {
      const raw = present(env, name)

      if (raw === null) {
        continue
      }

      const mode = prefixMode(raw, "pk_")

      if (!mode) {
        result.problems.push(`${name} is not a Stripe publishable key (pk_test_ or pk_live_)`)
        continue
      }

      publishableModes.add(mode)

      if (livemode && mode !== livemode) {
        result.problems.push(`${name} is a ${mode}-mode key but LOGLOADS_STRIPE_EXPECTED_LIVEMODE says ${livemode}`)
      }
    }

    if (publishableModes.size > 1) {
      result.problems.push("STRIPE_PUBLISHABLE_KEY and NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY disagree on test vs live mode")
    }

    const webhook = present(env, "STRIPE_WEBHOOK_SECRET")

    if (webhook !== null && !webhook.startsWith("whsec_")) {
      result.problems.push("STRIPE_WEBHOOK_SECRET is not a webhook signing secret (whsec_)")
    }

    const account = present(env, "LOGLOADS_STRIPE_EXPECTED_ACCOUNT_ID")

    if (account !== null && !/^acct_[A-Za-z0-9]+$/.test(account)) {
      result.problems.push("LOGLOADS_STRIPE_EXPECTED_ACCOUNT_ID is not a Stripe account id (acct_)")
    }

    if (secretMode === "live") {
      result.warnings.push("live Stripe keys: only with explicit founder billing authorization (docs/ACTIVATION_STRIPE.md §5)")
    }
  },

  "billing-gates"(result, { env }) {
    if (present(env, "LOGLOADS_INTERNAL_BILLING_SMOKE")?.toLowerCase() === "enabled") {
      result.warnings.push("LOGLOADS_INTERNAL_BILLING_SMOKE is enabled: only for one explicitly approved manual run")

      for (const name of ["LOGLOADS_INTERNAL_BILLING_SMOKE_ALLOWED_USER_IDS", "LOGLOADS_INTERNAL_BILLING_SMOKE_ALLOWED_ORGANIZATION_IDS"]) {
        if (!isSet(env, name)) {
          result.problems.push(`LOGLOADS_INTERNAL_BILLING_SMOKE is enabled without ${name}`)
        }
      }
    } else {
      const stray = ["LOGLOADS_INTERNAL_BILLING_SMOKE_ALLOWED_USER_IDS", "LOGLOADS_INTERNAL_BILLING_SMOKE_ALLOWED_ORGANIZATION_IDS"].filter(
        (name) => isSet(env, name)
      )

      if (stray.length > 0) {
        result.warnings.push(`${stray.join(", ")} set while the smoke gate is disabled; clear them`)
      }
    }

    result.notes.push("absent gates behave as disabled")
  },

  cron(result, { env, hosted, target, readRepoFile }) {
    secretLengthWarning(result, env, "CRON_SECRET", 16)

    if (hosted) {
      let declared = false

      try {
        const config = JSON.parse(readRepoFile("apps/web/vercel.json"))
        declared = (config.crons ?? []).some((cron) => cron.path === "/api/billing/cron")
      } catch {
        declared = false
      }

      if (!declared) {
        ;(target === "production" ? result.problems : result.warnings).push(
          "apps/web/vercel.json does not declare /api/billing/cron; Vercel reads vercel.json from the project Root Directory (apps/web)"
        )
      }

      if (target !== "production") {
        result.notes.push("Vercel runs cron jobs on Production deployments only")
      }
    }
  },

  resend(result, { env, target }) {
    if (!result.active) {
      result.notes.push("no RESEND_API_KEY: email delivery is skipped and in-app records stay the source of truth")
      return
    }

    const key = present(env, "RESEND_API_KEY")

    if (key !== null && !key.startsWith("re_")) {
      result.problems.push("RESEND_API_KEY is not a Resend API key (re_)")
    }

    const from = present(env, "RESEND_FROM") ?? present(env, "LOGLOADS_EMAIL_FROM")
    const fromName = isSet(env, "RESEND_FROM") ? "RESEND_FROM" : "LOGLOADS_EMAIL_FROM"
    const fromAddress = from ? (/<([^>]+)>/.exec(from)?.[1] ?? from).trim() : null

    if (fromAddress && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(fromAddress)) {
      result.problems.push(`${fromName} is not an email address or "Name <address>"`)
    } else if (fromAddress && !fromAddress.toLowerCase().endsWith("@logloads.com")) {
      result.warnings.push(`${fromName} is not an @logloads.com sender; it must be on a domain verified in Resend`)
    }

    if (target === "production") {
      result.warnings.push("a production RESEND_API_KEY needs explicit founder authorization (docs/ACTIVATION_RESEND.md §3)")
    }
  },

  posthog(result, { env, hosted, target }) {
    if (result.active && isBlankButPresent(env, "NEXT_PUBLIC_POSTHOG_HOST")) {
      result.problems.push(
        "NEXT_PUBLIC_POSTHOG_HOST is blank; a blank value replaces the US default with an empty host. Delete it instead"
      )
    }

    const host = present(env, "NEXT_PUBLIC_POSTHOG_HOST")

    if (host !== null) {
      const url = parseUrl(host)

      if (!url || url.protocol !== "https:") {
        result.problems.push("NEXT_PUBLIC_POSTHOG_HOST must be an https URL")
      } else if (!url.hostname.endsWith(".posthog.com")) {
        result.warnings.push("NEXT_PUBLIC_POSTHOG_HOST is not a posthog.com host (fine only for a deliberate reverse proxy)")
      }
    }

    if (!result.active) {
      result.notes.push("no NEXT_PUBLIC_POSTHOG_KEY: analytics is inert (no init, no network)")
      return
    }

    const key = present(env, "NEXT_PUBLIC_POSTHOG_KEY")

    if (key.startsWith("phx_")) {
      result.problems.push("NEXT_PUBLIC_POSTHOG_KEY is a personal API key (phx_) and would ship to every browser; use the project key (phc_) and revoke this one")
    } else if (!key.startsWith("phc_")) {
      result.warnings.push("NEXT_PUBLIC_POSTHOG_KEY is not a PostHog project key (phc_)")
    }

    if (hosted && target !== "production") {
      result.notes.push("analytics is on for a non-production target; keep its events out of the production project")
    }
  },

  sentry(result, { env, target }) {
    if (!result.active) {
      result.notes.push("no SENTRY_DSN: Sentry is never imported; the app is healthy without it")
      return
    }

    const url = parseUrl(present(env, "SENTRY_DSN"))

    if (!url || url.protocol !== "https:" || !url.username || !/^\/\d+$/.test(url.pathname)) {
      result.problems.push("SENTRY_DSN is not a Sentry DSN (https://<key>@<host>/<project-id>)")
    } else if (!/(^|\.)sentry\.io$/.test(url.hostname)) {
      result.warnings.push("SENTRY_DSN is not on sentry.io (fine only for a self-hosted Sentry)")
    }

    if (target !== "production") {
      result.notes.push("Sentry tags events with NODE_ENV (production on every Vercel deployment); use a separate Sentry project outside prd")
    }
  },

  maps(result, { env }) {
    const mapbox = present(env, "NEXT_PUBLIC_MAPBOX_TOKEN")

    if (mapbox !== null && !mapbox.startsWith("pk.")) {
      result.problems.push("NEXT_PUBLIC_MAPBOX_TOKEN is not a public Mapbox token (pk.); a secret token must never reach the browser")
    }

    if (isSet(env, "NEXT_PUBLIC_CARTO_BASEMAP_KEY")) {
      result.notes.push("provider: CARTO Basemaps on MapLibre (keyed); restrict the key by origin in CARTO")
    } else if (mapbox !== null) {
      result.notes.push("provider: legacy Mapbox (no CARTO key)")
    } else {
      result.notes.push("provider: keyless CARTO fallback on MapLibre")
    }
  },

  anthropic(result, { env }) {
    if (result.active && isBlankButPresent(env, "ASSISTANT_MODEL")) {
      result.warnings.push("ASSISTANT_MODEL is blank; a blank value is sent as an empty model name. Delete it instead")
    }

    if (!result.active) {
      result.notes.push("no ANTHROPIC_API_KEY: legacy credential review stays pending, so pilot drivers cannot accept work; V2 does not need it")
      return
    }

    if (!present(env, "ANTHROPIC_API_KEY").startsWith("sk-ant-")) {
      result.warnings.push("ANTHROPIC_API_KEY is not an Anthropic API key (sk-ant-)")
    }

    if (isSet(env, "CREDENTIAL_REVIEW_MODEL")) {
      result.notes.push("CREDENTIAL_REVIEW_MODEL overrides the pinned model; changing it needs a controlled re-verification")
    }
  }
}

function checkEnvironmentWide(contract, env, target) {
  const result = {
    id: "environment",
    label: "Names and browser exposure",
    docs: "docs/INTEGRATIONS.md#12-verify",
    required: true,
    active: true,
    status: STATUS.ready,
    missing: [],
    problems: [],
    warnings: [],
    notes: []
  }
  const known = new Map(contract.variables.map((variable) => [variable.name, variable]))
  const ciOnly = new Set(contract.ci_only_variables?.names ?? [])
  const removed = new Set(contract.removed_placeholders?.names ?? [])
  const forbiddenPrefixes = contract.private_media_storage?.forbidden_environment_prefixes ?? []
  const names = Object.keys(env).filter((name) => isSet(env, name)).sort()
  const unknown = []
  const removedPresent = []
  const ciPresent = []

  for (const name of names) {
    const raw = present(env, name)

    if (name.startsWith("NEXT_PUBLIC_")) {
      const variable = known.get(name)

      if (variable?.secret) {
        result.problems.push(`${name} is marked secret in the contract but NEXT_PUBLIC_ values ship to every browser`)
      } else if (!variable && SECRET_NAME_PATTERN.test(name.slice("NEXT_PUBLIC_".length))) {
        result.problems.push(`${name} looks like a secret name; NEXT_PUBLIC_ values ship to every browser`)
      }

      const shape = SECRET_VALUE_SHAPES.find(([, matches]) => matches(raw))

      if (shape) {
        result.problems.push(`${name} holds a value shaped like a ${shape[0]}; NEXT_PUBLIC_ values ship to every browser`)
      }
    }

    if (removed.has(name)) {
      removedPresent.push(name)
    } else if (ciOnly.has(name)) {
      ciPresent.push(name)
    } else if (
      !known.has(name) &&
      PROVIDER_PREFIXES.some((prefix) => name.startsWith(prefix)) &&
      !forbiddenPrefixes.some((prefix) => name.startsWith(prefix))
    ) {
      unknown.push(name)
    }
  }

  if (unknown.length > 0) {
    result.warnings.push(`not in ops/production-env-contract.json, so nothing reads them: ${unknown.join(", ")}`)
  }

  if (removedPresent.length > 0) {
    result.warnings.push(`removed placeholders (#111), nothing reads them: ${removedPresent.join(", ")}`)
  }

  if (ciPresent.length > 0) {
    result.warnings.push(`GitHub Actions secrets do not belong in an app environment: ${ciPresent.join(", ")}`)
  }

  const injectedConfig = present(env, "DOPPLER_CONFIG")
  const expectedConfig = contract.targets?.[target]?.doppler_config

  if (injectedConfig !== null && expectedConfig && injectedConfig !== expectedConfig && !injectedConfig.startsWith(`${expectedConfig}_`)) {
    result.warnings.push(`the injected Doppler config is not ${expectedConfig}, the config for target ${target}`)
  }

  return finish(result)
}

/**
 * Pure evaluation. `readRepoFile(relativePath)` reads repository files for repo-level checks.
 * Returns { target, dopplerConfig, results, ready, counts }.
 */
export function evaluate({
  contract,
  env,
  target,
  now = new Date(),
  readRepoFile = (relative) => readFileSync(join(REPO_ROOT, relative), "utf8")
}) {
  if (!TARGETS.includes(target)) {
    throw new Error(`unknown target ${target}; use one of ${TARGETS.join(", ")}`)
  }

  const hosted = Boolean(contract.targets?.[target]?.hosted)
  const results = [checkEnvironmentWide(contract, env, target)]

  for (const integration of contract.integrations) {
    if (integration.checked === false) {
      continue
    }

    const result = createResult(integration, target)
    const needs = [...(integration.needs ?? []), ...(hosted ? integration.needs_hosted ?? [] : [])]
    const activatedBy = integration.activated_by ?? flattenNeeds(integration.needs)

    result.active = needs.length === 0 || result.required || activatedBy.some((name) => isSet(env, name))
    result.missing = result.active ? missingNeeds(env, needs) : []

    applyVariableRules(
      result,
      contract.variables.filter((variable) => variable.integration === integration.id),
      env,
      target
    )
    CHECKS[integration.id]?.(result, { contract, env, hosted, now, readRepoFile, target })
    results.push(finish(result))
  }

  return summarize(contract, target, results)
}

function summarize(contract, target, results) {
  const counts = { invalid: 0, notReady: 0, off: 0, ready: 0 }

  for (const result of results) {
    if (result.status === STATUS.invalid) counts.invalid += 1
    else if (result.status === STATUS.notReady) counts.notReady += 1
    else if (result.status === STATUS.off) counts.off += 1
    else counts.ready += 1
  }

  return {
    counts,
    dopplerConfig: contract.targets?.[target]?.doppler_config ?? null,
    ready: counts.invalid === 0 && counts.notReady === 0,
    results,
    target
  }
}

// ---------------------------------------------------------------------------------------------
// Deployment probe (/api/health and the cron route), compared with the environment verdicts
// ---------------------------------------------------------------------------------------------

async function fetchJson(fetchImpl, url, headers) {
  const response = await fetchImpl(url, { headers, redirect: "manual", signal: AbortSignal.timeout(15_000) })
  let body = null

  try {
    body = await response.json()
  } catch {
    body = null
  }

  return { body, status: response.status }
}

export async function probeDeployment({ origin, env, report, fetchImpl = fetch }) {
  const result = {
    id: "deployment",
    label: "Deployed /api/health agrees with this environment",
    docs: "docs/INTEGRATIONS.md#12-verify",
    required: true,
    active: true,
    status: STATUS.ready,
    missing: [],
    problems: [],
    warnings: [],
    notes: []
  }
  const base = parseUrl(origin)

  if (!base || !["http:", "https:"].includes(base.protocol)) {
    result.problems.push("--health-url must be an http(s) origin")
    return finish(result)
  }

  const headers = { Accept: "application/json" }
  const bypass = present(env, "VERCEL_AUTOMATION_BYPASS_SECRET")

  if (bypass) {
    headers["x-vercel-protection-bypass"] = bypass
  }

  let health

  try {
    health = await fetchJson(fetchImpl, new URL("/api/health", base.origin).toString(), headers)
  } catch {
    result.problems.push("GET /api/health did not answer (network error or timeout)")
    return finish(result)
  }

  if (!health.body || health.body.app !== "logloads") {
    result.problems.push(
      health.status === 401 || health.status === 403
        ? "the deployment is protected (Vercel Authentication); set VERCEL_AUTOMATION_BYPASS_SECRET for the probe"
        : `GET /api/health answered ${health.status} without the LogLoads health document`
    )
    return finish(result)
  }

  const body = health.body
  const integrations = body.integrations ?? {}

  if (health.status !== 200 || body.status !== "ok") {
    result.problems.push(
      "health is degraded: canonical state did not load (apply migrations, then the one-time bootstrap; docs/INTEGRATIONS.md §2)"
    )
  }

  if (typeof body.gitCommit === "string" && /^[0-9a-f]{7,40}$/.test(body.gitCommit)) {
    result.notes.push(`deployment commit ${body.gitCommit.slice(0, 12)}`)
  }

  const byId = Object.fromEntries(report.results.map((entry) => [entry.id, entry]))
  const ready = (id) => byId[id]?.status === STATUS.ready && byId[id]?.active
  const expectations = [
    ["auth", ready("clerk") ? "clerk" : "dev-session", "clerk"],
    ["canonicalState", isSet(env, "SUPABASE_URL") && isSet(env, "SUPABASE_SERVICE_ROLE_KEY"), "supabase-api"],
    ["media", ready("supabase-storage"), "supabase-storage"],
    ["email", isSet(env, "RESEND_API_KEY"), "resend"],
    ["analytics", isSet(env, "NEXT_PUBLIC_POSTHOG_KEY"), "posthog"],
    ["errorTracking", isSet(env, "SENTRY_DSN"), "sentry"],
    ["credentialReview", isSet(env, "ANTHROPIC_API_KEY"), "anthropic"]
  ]

  for (const [field, expected, id] of expectations) {
    if (integrations[field] !== expected) {
      result.problems.push(
        `deployment reports integrations.${field}=${JSON.stringify(integrations[field] ?? null)} but this environment expects ${JSON.stringify(expected)} (${id}): sync Doppler to Vercel and redeploy`
      )
    }
  }

  const expectedBilling = ready("stripe") ? "dark_configured" : "misconfigured"

  if (integrations.billing !== expectedBilling) {
    result.problems.push(
      `deployment reports integrations.billing=${JSON.stringify(integrations.billing ?? null)} but this environment expects ${JSON.stringify(expectedBilling)}`
    )
  }

  let cron

  try {
    cron = await fetchJson(fetchImpl, new URL("/api/billing/cron", base.origin).toString(), headers)
  } catch {
    result.warnings.push("GET /api/billing/cron did not answer")
    return finish(result)
  }

  if (cron.status === 401 && cron.body?.error === "Unauthorized") {
    result.notes.push("cron route: CRON_SECRET is configured on the deployment (unauthenticated probe refused)")
  } else if (cron.status === 503) {
    ;(report.target === "production" ? result.problems : result.notes).push("cron route: CRON_SECRET is not configured on the deployment")
  } else {
    result.warnings.push(`cron route answered ${cron.status} to an unauthenticated probe`)
  }

  return finish(result)
}

// ---------------------------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------------------------

export function formatReport(report, source) {
  const lines = [
    "LogLoads integration readiness",
    `Target: ${report.target}${report.dopplerConfig ? ` (Doppler config ${report.dopplerConfig})` : ""} · Source: ${source} · Values are never printed.`,
    ""
  ]

  for (const result of report.results) {
    lines.push(`  ${result.status.padEnd(10)} ${result.id.padEnd(17)} ${result.label}${result.required ? "" : " (optional here)"}`)

    if (result.missing.length > 0) lines.push(`${" ".repeat(13)}missing: ${result.missing.join(", ")}`)
    for (const problem of result.problems) lines.push(`${" ".repeat(13)}problem: ${problem}`)
    for (const warning of result.warnings) lines.push(`${" ".repeat(13)}warning: ${warning}`)
    for (const note of result.notes) lines.push(`${" ".repeat(13)}note: ${note}`)
  }

  const { counts } = report
  lines.push(
    "",
    `Result: ${report.ready ? "READY" : "NOT READY"} for ${report.target} — ${counts.ready} ready, ${counts.notReady} not ready, ${counts.invalid} invalid, ${counts.off} off.`,
    "Runbook: docs/INTEGRATIONS.md"
  )

  return `${lines.join("\n")}\n`
}

export function formatList(contract) {
  const lines = ["LogLoads environment variables by integration (from ops/production-env-contract.json)", ""]

  for (const integration of contract.integrations) {
    const required = integration.required_in?.length ? integration.required_in.join(", ") : "nowhere (optional)"
    lines.push(`${integration.id} — ${integration.label}`, `  required in: ${required}`)

    for (const variable of contract.variables.filter((entry) => entry.integration === integration.id)) {
      const configs = variable.doppler_configs?.length ? variable.doppler_configs.join(", ") : "not in Doppler"
      const flags = [variable.secret ? "secret" : "public", variable.must_be_unset_in ? `unset in ${variable.must_be_unset_in.join("/")}` : null]
        .filter(Boolean)
        .join("; ")
      lines.push(`  ${variable.name.padEnd(56)} ${configs.padEnd(16)} ${flags}`)
    }

    lines.push("")
  }

  return `${lines.join("\n")}`
}

// ---------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------

export function parseArgs(argv) {
  const options = { envFile: null, healthUrl: null, json: false, list: false, strict: false, target: null }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const next = () => {
      const value = argv[index + 1]

      if (value === undefined || value.startsWith("--")) {
        throw new Error(`${arg} needs a value`)
      }

      index += 1
      return value
    }

    if (arg === "--target") options.target = next()
    else if (arg.startsWith("--target=")) options.target = arg.slice("--target=".length)
    else if (arg === "--env-file") options.envFile = next()
    else if (arg.startsWith("--env-file=")) options.envFile = arg.slice("--env-file=".length)
    else if (arg === "--health-url") options.healthUrl = next()
    else if (arg.startsWith("--health-url=")) options.healthUrl = arg.slice("--health-url=".length)
    else if (arg === "--strict") options.strict = true
    else if (arg === "--json") options.json = true
    else if (arg === "--list") options.list = true
    else if (arg === "--help" || arg === "-h") options.help = true
    else throw new Error(`unknown argument ${arg}`)
  }

  return options
}

const USAGE = `Usage: node tools/integration-readiness.mjs --target local|preview|staging|production [--env-file <path>] [--strict] [--json] [--health-url <origin>]
       node tools/integration-readiness.mjs --list
Reads process.env unless --env-file is given (dotenv or JSON). Prints names and verdicts, never values.
--strict exits 1 when the target is not ready.`

export async function runCli(argv, io = {}) {
  const {
    contract = loadContract(),
    cwd = process.cwd(),
    env = process.env,
    fetchImpl = fetch,
    fileExists = existsSync,
    now = new Date(),
    readFile = (path) => readFileSync(path, "utf8"),
    readRepoFile,
    stderr = (text) => process.stderr.write(text),
    stdout = (text) => process.stdout.write(text)
  } = io
  let options

  try {
    options = parseArgs(argv)
  } catch (error) {
    stderr(`integrations:check: ${error.message}\n${USAGE}\n`)
    return 2
  }

  if (options.help) {
    stdout(`${USAGE}\n`)
    return 0
  }

  if (options.list) {
    stdout(`${formatList(contract)}\n`)
    return 0
  }

  const target = options.target ?? "local"

  if (!TARGETS.includes(target)) {
    stderr(`integrations:check: unknown target ${target}\n${USAGE}\n`)
    return 2
  }

  let source = "process.env"
  let sourceEnv = env

  if (options.envFile) {
    const path = resolve(cwd, options.envFile)

    if (!fileExists(path)) {
      stderr(`integrations:check: env file not found: ${options.envFile}\n`)
      return 2
    }

    try {
      sourceEnv = readEnvFile(path, readFile)
    } catch (error) {
      stderr(`integrations:check: could not parse ${options.envFile}: ${error.message}\n`)
      return 2
    }

    source = options.envFile
  }

  const report = evaluate({ contract, env: sourceEnv, now, readRepoFile, target })

  if (options.healthUrl) {
    report.results.push(await probeDeployment({ env: sourceEnv, fetchImpl, origin: options.healthUrl, report }))
    Object.assign(report, summarize(contract, target, report.results))
  }

  stdout(options.json ? `${JSON.stringify({ ...report, source }, null, 2)}\n` : formatReport(report, source))

  return options.strict && !report.ready ? 1 : 0
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code
    },
    (error) => {
      process.stderr.write(`integrations:check: ${error.message}\n`)
      process.exitCode = 2
    }
  )
}
