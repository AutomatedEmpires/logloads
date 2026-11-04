#!/usr/bin/env node
/**
 * Verify Clerk tokens through Supabase third-party auth, end to end (#112). Development only.
 *
 * WHAT IT PROVES. The normalized-v2 SQL suites present simulated `request.jwt.claims`, which proves what the
 * database does with claims the gateway already accepted (layer 2, docs/SECURITY.md §4). This harness sends real
 * tokens through the Supabase API gateway and PostgREST (layer 1) and checks each #112 acceptance criterion:
 *   AC1  a valid token resolves its own app_users row and reads only its own tenant's rows;
 *   AC2  forged, expired, wrong-issuer, wrong-audience and missing-role tokens are rejected at the gateway or
 *        resolve to no user;
 *   AC3  a removed membership loses access on the next request, with the same still-valid token.
 * It prints a pass/fail table. It never prints a key, a token, a user ID or a row ID.
 *
 * TWO MODES
 *   live (default)   A development Clerk instance and a development Supabase project. Clerk session tokens for
 *                    two test users are minted through the Clerk Backend API (development instances only).
 *   --local-stack    The disposable Supabase CLI stack inside the normalized-v2 CI job (stage 22). Tokens are
 *                    signed locally with the stack's JWT secret, standing in for Clerk, so the same checks run
 *                    through the real gateway without any provider key.
 *
 * USAGE
 *   node tools/verify-clerk-supabase-auth.mjs [--require]
 *   node tools/verify-clerk-supabase-auth.mjs --local-stack [--require]
 *
 * With its environment missing it prints "skipped: …" and exits 0, or 1 with --require. --require also turns a
 * skipped check into a failure. Exit codes: 0 pass (or skipped), 1 fail, 2 refused (wrong target or bad
 * arguments).
 *
 * TARGET GUARDS (live). Nothing is sent anywhere until all of these hold:
 *   - CLERK_SECRET_KEY is a development key (sk_test_…), NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY (if set) is pk_test_…
 *     and names a *.clerk.accounts.dev frontend API;
 *   - SUPABASE_URL is https://<ref>.supabase.co and <ref> is listed in LOGLOADS_SUPABASE_DEV_PROJECT_REFS;
 *   - a Supabase key that is a JWT names the same project and the right role.
 * Then, before any Supabase request: Clerk reports a development instance (when it says) and the minted token's
 * issuer is that development frontend API. Requests never follow a redirect.
 *
 * WHAT IT CHANGES (live and local). It links the two test users through the sync_verified_identity worker RPC,
 * creates two fixture organizations (logloads-authcheck-a/-b) and one equipment row in each on first use, and
 * reuses them afterwards. For AC3 it invites test user B into organization A, B accepts, A removes B. Cleanup
 * always leaves B without a live membership in A (the state before the run) and revokes the Clerk sessions it
 * created. The runbook is docs/SECURITY.md §5.1.
 */

import { createHmac, generateKeyPairSync, randomBytes, sign as signBytes } from "node:crypto"
import { fileURLToPath } from "node:url"

import { describeTarget, parseArguments } from "./operating-state-backup-policy.mjs"

const TOOL = "verify-clerk-supabase-auth"

export const DEV_PROJECT_REFS_ENV = "LOGLOADS_SUPABASE_DEV_PROJECT_REFS"
export const TEST_USERS_ENV = "LOGLOADS_AUTH_HARNESS_CLERK_USER_IDS"
export const LOCAL_JWT_SECRET_ENV = "LOGLOADS_SUPABASE_JWT_SECRET"
export const WRONG_AUDIENCE_TEMPLATE = "logloads-authcheck-wrong-audience"
export const NO_ROLE_TEMPLATE = "logloads-authcheck-no-role"
export const FIXTURES = {
  a: { name: "LogLoads Authcheck A", slug: "logloads-authcheck-a" },
  b: { name: "LogLoads Authcheck B", slug: "logloads-authcheck-b" }
}
export const PROBE_UNIT_LABEL = "authcheck-probe"
// What the local stack trusts: the issuer row stage 22 inserts, as stage 14 does.
export const LOCAL_IDENTITY = {
  audience: "logloads-app",
  issuer: "https://clerk.logloads.test",
  subjects: { a: "user_authcheck_a", b: "user_authcheck_b" }
}
export const FOREIGN_ISSUER = "https://wrong-issuer.logloads.invalid"
export const FOREIGN_AUDIENCE = "logloads-authcheck-not-this-app"

const CLERK_API = "https://api.clerk.com/v1"
const CLERK_DEV_FRONTEND_SUFFIX = ".clerk.accounts.dev"
const EXIT = { fail: 1, pass: 0, refused: 2 }
const REQUEST_TIMEOUT_MS = 20_000
const VALID_TOKEN_LIFETIME_S = 300
const EXPIRY_PROBE_LIFETIME_S = 15
const MIN_REMAINING_MS = 45_000
// PostgREST tolerates a little clock skew on `exp`; wait past it before calling a token expired.
const EXPIRY_MARGIN_MS = 35_000
const MAX_EXPIRY_WAIT_MS = 180_000
const PROJECT_REF_SHAPE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
const CLERK_USER_ID_SHAPE = /^user_[A-Za-z0-9]+$/

export const CHECKS = [
  { id: "valid-identity", title: "AC1 valid token resolves its own app_users row" },
  { id: "own-tenant", title: "AC1 valid token reads only its own tenant's rows" },
  { id: "forged-tampered", title: "AC2 forged: payload edited after signing" },
  { id: "forged-foreign-key", title: "AC2 forged: signed with a key the gateway does not trust" },
  { id: "forged-alg-none", title: "AC2 forged: unsigned (alg none)" },
  { id: "expired", title: "AC2 expired token" },
  { id: "wrong-issuer", title: "AC2 wrong issuer" },
  { id: "wrong-audience", title: "AC2 wrong audience" },
  { id: "missing-role", title: "AC2 missing role claim" },
  { id: "removed-membership", title: "AC3 removed membership loses access on the next request" },
  { id: "cleanup", title: "Cleanup restores memberships and revokes sessions" }
]

const USAGE = `usage: node tools/${TOOL}.mjs [--local-stack] [--require]
  live (default): a development Clerk instance and a development Supabase project. Needs
    SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY),
    SUPABASE_SERVICE_ROLE_KEY, CLERK_SECRET_KEY (sk_test_), ${DEV_PROJECT_REFS_ENV}, ${TEST_USERS_ENV}.
  --local-stack: the disposable Supabase CLI stack in CI (LOGLOADS_DB_ENV=supabase-local-ci, a loopback
    SUPABASE_URL, the stack's keys and ${LOCAL_JWT_SECRET_ENV}).
  --require: missing configuration or a skipped check fails the run.
Runbook: docs/SECURITY.md section 5.1.`

class RefusedError extends Error {}
class PreflightError extends Error {}

// ---------------------------------------------------------------------------
// JWTs (encoding only; the harness never verifies, it asks the gateway to)
// ---------------------------------------------------------------------------

const b64url = (value) => Buffer.from(value).toString("base64url")

function encodeJwt(header, payload, signer) {
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`

  return `${signingInput}.${signer(signingInput)}`
}

export function decodeJwt(token) {
  const parts = typeof token === "string" ? token.split(".") : []

  if (parts.length !== 3) {
    return null
  }

  try {
    return {
      header: JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")),
      payload: JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"))
    }
  } catch {
    return null
  }
}

export function signHs256(payload, secret) {
  return encodeJwt({ alg: "HS256", typ: "JWT" }, payload, (input) =>
    createHmac("sha256", secret).update(input).digest("base64url")
  )
}

export function signRs256(payload, privateKey, kid) {
  return encodeJwt({ alg: "RS256", kid, typ: "JWT" }, payload, (input) =>
    signBytes("sha256", Buffer.from(input), privateKey).toString("base64url")
  )
}

/** The token with its payload changed and its original signature kept. */
export function tamperPayload(token, change) {
  const [header, , signature] = token.split(".")

  return `${header}.${b64url(JSON.stringify(change(decodeJwt(token).payload)))}.${signature}`
}

export function unsignedToken(payload) {
  return `${b64url(JSON.stringify({ alg: "none", typ: "JWT" }))}.${b64url(JSON.stringify(payload))}.`
}

const audiences = (claim) => (Array.isArray(claim) ? claim : claim === undefined || claim === null ? [] : [claim])

// ---------------------------------------------------------------------------
// Configuration and target guards (no network)
// ---------------------------------------------------------------------------

const trimmed = (value) => (typeof value === "string" && value.trim() ? value.trim() : null)
const looksLikeJwt = (value) => decodeJwt(value) !== null

function listOf(value) {
  return (trimmed(value) ?? "").split(/[\s,]+/).filter(Boolean)
}

function clerkFrontendHost(publishableKey) {
  const encoded = publishableKey.replace(/^pk_(?:test|live)_/, "")
  const decoded = Buffer.from(encoded, "base64").toString("utf8")

  return decoded.endsWith("$") ? decoded.slice(0, -1) : null
}

function checkSupabaseKey(name, key, { expectedRole, ref, wrongPrefix }) {
  if (key.startsWith(wrongPrefix)) {
    return `${name} holds the wrong kind of key (${wrongPrefix}…)`
  }

  if (!looksLikeJwt(key)) {
    return null
  }

  const { payload } = decodeJwt(key)

  if (payload.role !== expectedRole) {
    return `${name} is a key for the "${payload.role}" role, not "${expectedRole}"`
  }

  if (ref && payload.ref && payload.ref !== ref) {
    return `${name} belongs to project "${payload.ref}", not "${ref}"`
  }

  return null
}

/**
 * Read and guard the configuration. Returns { ok: true, config }, { ok: false, missing } (skip) or
 * { ok: false, refused } (exit 2). A present value is guarded even when others are missing, so a production key
 * in the environment is refused rather than merely skipped.
 */
export function resolveConfig(env, mode) {
  const anonName = trimmed(env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)
    ? "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"
    : "NEXT_PUBLIC_SUPABASE_ANON_KEY"
  const values = {
    anonKey: trimmed(env[anonName]),
    serviceKey: trimmed(env.SUPABASE_SERVICE_ROLE_KEY),
    url: trimmed(env.SUPABASE_URL)
  }
  const missing = []
  const refusals = []

  if (!values.url) missing.push("SUPABASE_URL")
  if (!values.anonKey) missing.push("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY)")
  if (!values.serviceKey) missing.push("SUPABASE_SERVICE_ROLE_KEY")

  let target = null

  if (values.url) {
    target = describeTarget(values.url)

    if (!target.ok) {
      refusals.push(target.reason)
    } else if (mode === "live" && !target.hosted) {
      refusals.push("SUPABASE_URL is a loopback stack; the live mode needs a hosted development project (use --local-stack in CI)")
    } else if (mode === "local-stack" && target.hosted) {
      refusals.push("--local-stack runs only against a loopback Supabase stack, never a hosted project")
    }
  }

  const ref = target?.ok ? target.ref : null

  if (values.anonKey) {
    const problem = checkSupabaseKey(anonName, values.anonKey, {
      expectedRole: "anon",
      ref: target?.hosted ? ref : null,
      wrongPrefix: "sb_secret_"
    })
    if (problem) refusals.push(problem)
  }

  if (values.serviceKey) {
    const problem = checkSupabaseKey("SUPABASE_SERVICE_ROLE_KEY", values.serviceKey, {
      expectedRole: "service_role",
      ref: target?.hosted ? ref : null,
      wrongPrefix: "sb_publishable_"
    })
    if (problem) refusals.push(problem)
  }

  const config = { mode, supabase: { ...values, origin: target?.ok ? target.origin : null, ref } }

  if (mode === "local-stack") {
    const secret = trimmed(env[LOCAL_JWT_SECRET_ENV])

    if (!trimmed(env.LOGLOADS_DB_ENV)) missing.push("LOGLOADS_DB_ENV=supabase-local-ci")
    else if (env.LOGLOADS_DB_ENV !== "supabase-local-ci") {
      refusals.push("--local-stack needs LOGLOADS_DB_ENV=supabase-local-ci (the disposable CI stack)")
    }
    if (!secret) missing.push(LOCAL_JWT_SECRET_ENV)
    else if (secret.length < 32) refusals.push(`${LOCAL_JWT_SECRET_ENV} is shorter than 32 characters`)
    config.jwtSecret = secret
  } else {
    const secretKey = trimmed(env.CLERK_SECRET_KEY)
    const publishableKey = trimmed(env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY)
    const devRefs = listOf(env[DEV_PROJECT_REFS_ENV])
    const users = listOf(env[TEST_USERS_ENV])

    if (!secretKey) missing.push("CLERK_SECRET_KEY")
    else if (!secretKey.startsWith("sk_test_")) {
      refusals.push("CLERK_SECRET_KEY is not a development-instance key (sk_test_…); this harness never runs against production Clerk")
    }

    let frontendHost = null

    if (publishableKey) {
      frontendHost = publishableKey.startsWith("pk_test_") ? clerkFrontendHost(publishableKey) : null

      if (!publishableKey.startsWith("pk_test_")) {
        refusals.push("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY is not a development-instance key (pk_test_…)")
      } else if (!frontendHost?.endsWith(CLERK_DEV_FRONTEND_SUFFIX)) {
        refusals.push(`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY does not name a *${CLERK_DEV_FRONTEND_SUFFIX} frontend API`)
      }
    }

    if (devRefs.length === 0) missing.push(DEV_PROJECT_REFS_ENV)
    else if (!devRefs.every((entry) => PROJECT_REF_SHAPE.test(entry))) {
      refusals.push(`${DEV_PROJECT_REFS_ENV} must list project references only (comma-separated)`)
    } else if (ref && target?.hosted && !devRefs.includes(ref)) {
      refusals.push(`SUPABASE_URL points at project "${ref}", which is not listed in ${DEV_PROJECT_REFS_ENV}`)
    }

    if (users.length === 0) missing.push(TEST_USERS_ENV)
    else if (users.length !== 2 || users[0] === users[1] || !users.every((id) => CLERK_USER_ID_SHAPE.test(id))) {
      refusals.push(`${TEST_USERS_ENV} must name exactly two different Clerk user IDs (user_…), comma-separated`)
    }

    config.clerk = { frontendHost, secretKey }
    config.users = { a: users[0], b: users[1] }
  }

  if (refusals.length > 0) {
    return { ok: false, refused: refusals }
  }

  if (missing.length > 0) {
    return { missing, ok: false }
  }

  return { config, ok: true }
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

async function request(fetchImpl, url, { body, headers = {}, method = "GET" } = {}) {
  const response = await fetchImpl(url, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers,
    method,
    redirect: "manual",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  })

  if (response.status >= 300 && response.status < 400) {
    throw new RefusedError(`${new URL(url).host} answered with a redirect; redirects are never followed`)
  }

  const text = await response.text()
  let json = null

  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = null
  }

  return { json, status: response.status }
}

const errorCode = (result) => (typeof result.json?.code === "string" ? result.json.code : "")
const httpDetail = (result) => `HTTP ${result.status}${errorCode(result) ? ` ${errorCode(result)}` : ""}`

/**
 * What a probe request says about the identity behind it:
 *   rows      2xx with rows (the identity resolved and RLS let it read)
 *   no-rows   2xx with nothing (resolved to no user, or no access)
 *   denied    the database refused (42501): no user, or a role without the privilege
 *   rejected  the gateway refused the token (PGRST3xx, or a 401/403 that is not a database refusal)
 *   error     anything else (inconclusive)
 */
export function classify(result) {
  const code = errorCode(result)

  if (result.status >= 200 && result.status < 300) {
    const rows = Array.isArray(result.json) ? result.json : result.json === null ? [] : [result.json]

    return rows.length > 0
      ? { detail: `HTTP ${result.status}, ${rows.length} row(s)`, outcome: "rows", rows }
      : { detail: `HTTP ${result.status}, 0 rows`, outcome: "no-rows", rows }
  }

  if (code === "42501") {
    return { detail: httpDetail(result), message: String(result.json?.message ?? ""), outcome: "denied", rows: [] }
  }

  if (/^PGRST3\d\d$/.test(code) || result.status === 401 || result.status === 403) {
    return { detail: httpDetail(result), outcome: "rejected", rows: [] }
  }

  return { detail: httpDetail(result), outcome: "error", rows: [] }
}

function describeRefusal(probe) {
  if (probe.outcome === "rejected") return `rejected at the gateway (${probe.detail})`
  if (probe.outcome === "denied") return `resolved to no user (${probe.detail})`
  return `resolved to no user (${probe.detail})`
}

function supabaseClient({ anonKey, fetch: fetchImpl, origin, serviceKey }) {
  const keyHeaders = (key) => (looksLikeJwt(key) ? { Authorization: `Bearer ${key}`, apikey: key } : { apikey: key })

  async function call(auth, method, path, body, extraHeaders = {}) {
    const headers = {
      Accept: "application/json",
      "Accept-Profile": "marketplace",
      "Content-Profile": "marketplace",
      "Content-Type": "application/json",
      ...extraHeaders,
      ...(auth === "anon"
        ? keyHeaders(anonKey)
        : auth === "service"
          ? keyHeaders(serviceKey)
          : { Authorization: `Bearer ${auth.token}`, apikey: anonKey })
    }

    return request(fetchImpl, `${origin}/rest/v1/${path}`, { body, headers, method })
  }

  const asUser = (token) => ({ token })

  return {
    access: async (token, orgId) =>
      classify(await call(asUser(token), "POST", "rpc/get_viewer_marketplace_access", { p_org_id: orgId })),
    call,
    identity: async (token) => classify(await call(asUser(token), "GET", "identity_links?select=user_id")),
    tenant: async (token, orgIds) =>
      classify(await call(asUser(token), "GET", `equipment_units?select=id,org_id&org_id=in.(${orgIds.join(",")})`)),
    user: asUser
  }
}

// ---------------------------------------------------------------------------
// Token sources: real Clerk session tokens (live) or locally signed stand-ins (--local-stack)
// ---------------------------------------------------------------------------

function clerkTokenSource({ config, fetch: fetchImpl, generateRsaKey, now, remember }) {
  const sessions = new Map()
  const latest = new Map()
  let foreignKey = null
  const clerk = (method, path, body) =>
    request(fetchImpl, `${CLERK_API}${path}`, {
      body,
      headers: { Accept: "application/json", Authorization: `Bearer ${config.clerk.secretKey}`, "Content-Type": "application/json" },
      method
    })
  const clerkError = (result) => {
    const code = result.json?.errors?.[0]?.code

    return `HTTP ${result.status}${typeof code === "string" ? ` ${code}` : ""}`
  }
  const foreign = () => (foreignKey ??= generateRsaKey())

  async function mint(label, path, body) {
    const result = await clerk("POST", `/sessions/${sessions.get(label)}/tokens${path}`, body)

    if (result.status >= 200 && result.status < 300 && typeof result.json?.jwt === "string") {
      return { token: remember(result.json.jwt) }
    }

    return { error: clerkError(result), status: result.status }
  }

  async function mintSessionToken(label, lifetimeSeconds) {
    const minted = (await mint(label, "", { expires_in_seconds: lifetimeSeconds })).token
      ?? (await mint(label, "", {})).token

    if (!minted) {
      throw new PreflightError(`Clerk did not mint a session token for test user ${label.toUpperCase()}`)
    }

    return minted
  }

  async function templateToken(label, template) {
    const minted = await mint(label, `/${encodeURIComponent(template)}`, {})

    if (minted.token) return minted
    if (minted.status === 404) {
      return { skip: `Clerk JWT template "${template}" not found (runbook step 3)` }
    }

    return { fail: `Clerk could not mint the "${template}" template token (${minted.error})` }
  }

  return {
    claims: (label) => latest.get(label).claims,
    async cleanup() {
      let revoked = 0
      const failures = []

      for (const [label, id] of sessions) {
        const result = await clerk("POST", `/sessions/${id}/revoke`)

        if (result.status >= 200 && result.status < 300) revoked += 1
        else failures.push(`revoking test user ${label.toUpperCase()}'s session failed (${clerkError(result)})`)
      }

      return { failures, note: `${revoked} Clerk session(s) revoked` }
    },
    describe: () => "live: Clerk development instance → Supabase development project",
    async expiredProbe(label) {
      const token = await mintSessionToken(label, EXPIRY_PROBE_LIFETIME_S)

      return { readyAt: decodeJwt(token).payload.exp * 1000 + EXPIRY_MARGIN_MS, token, validNow: true }
    },
    async foreignKey(label) {
      const { header, payload } = decodeJwt(await this.valid(label))

      return remember(signRs256(payload, foreign(), header.kid))
    },
    async missingRole(label) {
      const minted = await templateToken(label, NO_ROLE_TEMPLATE)

      if (!minted.token) return minted

      const { payload } = decodeJwt(minted.token)
      const session = this.claims(label)

      if (payload.role !== undefined) {
        return { fail: `template "${NO_ROLE_TEMPLATE}" carries a role claim; it must leave role out` }
      }
      if (JSON.stringify(audiences(payload.aud)) !== JSON.stringify(audiences(session.aud)) || payload.iss !== session.iss) {
        return { fail: `template "${NO_ROLE_TEMPLATE}" must keep the session token's issuer and audience, so only the role differs` }
      }

      return { evidence: "Clerk-signed (JWT template), no role claim", token: minted.token }
    },
    async start() {
      const instance = await clerk("GET", "/instance")
      const environment = instance.json?.environment_type

      if (instance.status >= 200 && instance.status < 300 && typeof environment === "string" && environment !== "development") {
        throw new RefusedError(`Clerk reports a ${environment} instance; this harness runs only against development`)
      }

      for (const label of ["a", "b"]) {
        const result = await clerk("POST", "/sessions", { user_id: config.users[label] })

        if (!(result.status >= 200 && result.status < 300) || typeof result.json?.id !== "string") {
          throw new PreflightError(
            `Clerk could not create a session for test user ${label.toUpperCase()} (${clerkError(result)}); ` +
              "check the user ID and that the instance is a development instance"
          )
        }

        sessions.set(label, result.json.id)
      }

      for (const label of ["a", "b"]) {
        const { payload } = decodeJwt(await this.valid(label))
        let host = null

        try {
          host = new URL(payload.iss).host
        } catch {
          host = null
        }

        if (!host?.endsWith(CLERK_DEV_FRONTEND_SUFFIX) || new URL(payload.iss).protocol !== "https:") {
          throw new RefusedError(`the session token's issuer is not a https://*${CLERK_DEV_FRONTEND_SUFFIX} development frontend API`)
        }
        if (config.clerk.frontendHost && host !== config.clerk.frontendHost) {
          throw new RefusedError("the session token's issuer is not the instance named by NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY")
        }
        if (payload.sub !== config.users[label]) {
          throw new PreflightError(`the session token for test user ${label.toUpperCase()} names another subject`)
        }
        if (payload.role !== "authenticated") {
          throw new PreflightError(
            'Clerk session tokens carry no "role": "authenticated" claim. Connect the Clerk instance to Supabase ' +
              "(runbook step 2) so Supabase can map them to the authenticated role"
          )
        }
        if (audiences(payload.aud).length === 0) {
          throw new PreflightError(
            'Clerk session tokens carry no "aud" claim. Add one to the session token (runbook step 2); every enabled ' +
              "trusted issuer pins an audience (LE-09)"
          )
        }
      }
    },
    async valid(label) {
      const cached = latest.get(label)

      if (cached && cached.claims.exp * 1000 - now() > MIN_REMAINING_MS) {
        return cached.token
      }

      const token = await mintSessionToken(label, VALID_TOKEN_LIFETIME_S)

      latest.set(label, { claims: decodeJwt(token).payload, token })

      return token
    },
    async wrongAudience(label) {
      const minted = await templateToken(label, WRONG_AUDIENCE_TEMPLATE)

      if (!minted.token) return minted

      const { payload } = decodeJwt(minted.token)
      const session = this.claims(label)
      const pinned = new Set(audiences(session.aud))

      if (audiences(payload.aud).length === 0 || audiences(payload.aud).some((value) => pinned.has(value))) {
        return { fail: `template "${WRONG_AUDIENCE_TEMPLATE}" must set an audience other than the session token's` }
      }
      if (payload.role !== "authenticated" || payload.iss !== session.iss) {
        return { fail: `template "${WRONG_AUDIENCE_TEMPLATE}" must keep role "authenticated" and the issuer, so only the audience differs` }
      }

      return { evidence: "Clerk-signed (JWT template), another audience", token: minted.token }
    },
    async wrongIssuer(label) {
      const claims = { ...this.claims(label), iss: FOREIGN_ISSUER }

      return { evidence: "signed by an issuer the project does not trust", token: remember(signRs256(claims, foreign(), "logloads-authcheck-foreign")) }
    }
  }
}

function localTokenSource({ config, now, remember }) {
  const secret = config.jwtSecret
  const claimsFor = (label, changes = {}) => {
    const issuedAt = Math.floor(now() / 1000)

    return {
      aud: LOCAL_IDENTITY.audience,
      exp: issuedAt + VALID_TOKEN_LIFETIME_S,
      iat: issuedAt,
      iss: LOCAL_IDENTITY.issuer,
      role: "authenticated",
      sub: LOCAL_IDENTITY.subjects[label],
      ...changes
    }
  }
  const signed = (claims, key = secret) => remember(signHs256(claims, key))

  return {
    claims: (label) => claimsFor(label),
    async cleanup() {
      return { failures: [], note: "no Clerk sessions (locally signed tokens)" }
    },
    describe: () => "local stack: locally signed stand-ins for Clerk tokens → disposable Supabase CLI stack",
    async expiredProbe(label) {
      const issuedAt = Math.floor(now() / 1000)

      return { readyAt: now(), token: signed(claimsFor(label, { exp: issuedAt - 120, iat: issuedAt - 900 })), validNow: false }
    },
    async foreignKey(label) {
      return signed(claimsFor(label), randomBytes(32).toString("hex"))
    },
    async missingRole(label) {
      const claims = claimsFor(label)

      delete claims.role

      return { evidence: "validly signed, no role claim", token: signed(claims) }
    },
    async start() {},
    async valid(label) {
      return signed(claimsFor(label))
    },
    async wrongAudience(label) {
      return { evidence: "validly signed, another audience", token: signed(claimsFor(label, { aud: FOREIGN_AUDIENCE })) }
    },
    async wrongIssuer(label) {
      return { evidence: "validly signed, an untrusted issuer", token: signed(claimsFor(label, { iss: FOREIGN_ISSUER })) }
    }
  }
}

// ---------------------------------------------------------------------------
// Fixture (idempotent): linked identities, two organizations, one equipment row each
// ---------------------------------------------------------------------------

async function linkIdentity(db, claims, label) {
  const result = await db.call("service", "POST", "rpc/sync_verified_identity", {
    p_display_name: `LogLoads authcheck ${label.toUpperCase()}`,
    p_issuer: claims.iss,
    p_subject: claims.sub
  })

  if (result.status === 200 && typeof result.json === "string") {
    return result.json
  }

  const code = errorCode(result)
  const hint =
    code === "42501" && /untrusted identity issuer/i.test(String(result.json?.message))
      ? "; add the Clerk issuer to marketplace.trusted_identity_issuers (runbook step 5)"
      : code === "PGRST202" || code === "PGRST106" || result.status === 404
        ? "; apply the normalized-v2 chain and expose the marketplace schema (runbook step 4)"
        : ""

  throw new PreflightError(`linking test user ${label.toUpperCase()} failed (${httpDetail(result)})${hint}`)
}

async function ensureOrganization(db, token, label, userId) {
  const fixture = FIXTURES[label]
  const owner = db.user(token)
  let result = await db.call(owner, "GET", `organizations?select=id&slug=eq.${fixture.slug}`)

  if (result.status !== 200 || !Array.isArray(result.json)) {
    throw new PreflightError(`reading fixture organization ${fixture.slug} failed (${httpDetail(result)})`)
  }

  let orgId = result.json[0]?.id

  if (!orgId) {
    result = await db.call(owner, "POST", "rpc/create_organization", {
      p_display_name: fixture.name,
      p_enable_hauler: true,
      p_home_state: "OR",
      p_slug: fixture.slug
    })

    if (result.status !== 200 || typeof result.json !== "string") {
      const taken = errorCode(result) === "23505" ? `; the slug belongs to an organization test user ${label.toUpperCase()} cannot read` : ""

      throw new PreflightError(`creating fixture organization ${fixture.slug} failed (${httpDetail(result)})${taken}`)
    }

    orgId = result.json
  }

  result = await db.call(
    owner,
    "GET",
    `organization_memberships?select=id&org_id=eq.${orgId}&user_id=eq.${userId}&role=eq.owner&status=eq.active`
  )

  if (result.status !== 200 || !Array.isArray(result.json) || result.json.length !== 1) {
    throw new PreflightError(`test user ${label.toUpperCase()} is not the active owner of fixture organization ${fixture.slug}`)
  }

  result = await db.call(owner, "GET", `equipment_units?select=id&org_id=eq.${orgId}&unit_label=eq.${PROBE_UNIT_LABEL}`)
  let unitId = Array.isArray(result.json) ? result.json[0]?.id : undefined

  if (!unitId) {
    result = await db.call(
      owner,
      "POST",
      "equipment_units?select=id",
      { equipment_code: "log_truck", org_id: orgId, unit_label: PROBE_UNIT_LABEL },
      { Prefer: "return=representation" }
    )
    unitId = Array.isArray(result.json) ? result.json[0]?.id : undefined

    if (!unitId) {
      throw new PreflightError(`adding the probe equipment row to ${fixture.slug} failed (${httpDetail(result)})`)
    }
  }

  return { orgId, unitId }
}

/** Live memberships of B in A (normally none). A leftover means an earlier run was interrupted. */
async function liveMembershipsOfBInA(db, ownerToken, people) {
  const result = await db.call(
    db.user(ownerToken),
    "GET",
    `organization_memberships?select=id,status&org_id=eq.${people.a.orgId}&user_id=eq.${people.b.userId}&status=neq.removed`
  )

  if (result.status !== 200 || !Array.isArray(result.json)) {
    throw new PreflightError(`reading memberships of fixture organization A failed (${httpDetail(result)})`)
  }

  return result.json
}

async function setMembershipStatus(db, token, membershipId, status) {
  const result = await db.call(
    db.user(token),
    "PATCH",
    `organization_memberships?id=eq.${membershipId}&select=id,status`,
    { status },
    { Prefer: "return=representation" }
  )

  return { ok: result.status === 200 && result.json?.[0]?.status === status, result }
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

export function redact(text, secrets) {
  let output = String(text)

  for (const secret of secrets) {
    if (secret && secret.length >= 8) output = output.split(secret).join("[redacted]")
  }

  return output.replace(/eyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]*/g, "[token redacted]")
}

function defaultGenerateRsaKey() {
  return generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey
}

const defaultSleep = (milliseconds) => new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds))

export function renderTable(results) {
  const escape = (value) => String(value).replaceAll("|", "\\|")
  const lines = ["| # | Check | Result | Evidence |", "|---|---|---|---|"]

  CHECKS.forEach((check, index) => {
    const result = results.get(check.id) ?? { evidence: "not run", status: "NOT RUN" }

    lines.push(`| ${index + 1} | ${escape(check.title)} | ${result.status} | ${escape(result.evidence)} |`)
  })

  return lines.join("\n")
}

export async function run({
  argv = [],
  env = {},
  fetch: fetchImpl = globalThis.fetch,
  generateRsaKey = defaultGenerateRsaKey,
  now = Date.now,
  sleep = defaultSleep,
  write = (line) => console.log(line)
} = {}) {
  const parsed = parseArguments(argv, { switches: ["--require", "--local-stack", "--help"] })

  if (!parsed.ok || parsed.positionals.length > 0) {
    write(`${TOOL}: ${parsed.ok ? `unexpected argument ${parsed.positionals[0]}` : parsed.reason}\n${USAGE}`)
    return EXIT.refused
  }

  if (parsed.switches.has("--help")) {
    write(USAGE)
    return EXIT.pass
  }

  const required = parsed.switches.has("--require")
  const mode = parsed.switches.has("--local-stack") ? "local-stack" : "live"
  const resolved = resolveConfig(env, mode)

  if (resolved.refused) {
    write(`${TOOL}: refused: ${resolved.refused.join("; ")}. Nothing was sent.`)
    return EXIT.refused
  }

  if (resolved.missing) {
    write(`${TOOL}: skipped: the ${mode} run needs ${resolved.missing.join(", ")}. Runbook: docs/SECURITY.md section 5.1.`)
    return required ? EXIT.fail : EXIT.pass
  }

  const { config } = resolved
  const secrets = new Set([config.supabase.anonKey, config.supabase.serviceKey, config.clerk?.secretKey, config.jwtSecret])
  const remember = (token) => {
    secrets.add(token)
    return token
  }
  const out = (line) => write(redact(line, secrets))
  const results = new Map()
  const record = (id, status, evidence) => results.set(id, { evidence, status })
  const tokens =
    mode === "live"
      ? clerkTokenSource({ config, fetch: fetchImpl, generateRsaKey, now, remember })
      : localTokenSource({ config, now, remember })
  const db = supabaseClient({ ...config.supabase, fetch: fetchImpl })
  const people = { a: { label: "a" }, b: { label: "b" } }
  const state = { leftovers: 0, membershipId: null, removed: false }
  let refused = null
  let aborted = null

  out(`${TOOL}: ${tokens.describe()}${config.supabase.ref ? ` (project ${config.supabase.ref})` : ""}`)

  try {
    await tokens.start()

    const preflight = await db.call("anon", "GET", "equipment_types?select=code&code=eq.log_truck")

    if (preflight.status !== 200 || !Array.isArray(preflight.json) || preflight.json.length !== 1) {
      throw new PreflightError(
        `the marketplace schema is not reachable through the Data API (${httpDetail(preflight)}); apply the ` +
          "normalized-v2 chain and expose the marketplace schema (runbook step 4)"
      )
    }

    for (const label of ["a", "b"]) {
      await tokens.valid(label)
      people[label].userId = await linkIdentity(db, tokens.claims(label), label)
    }

    const expiry = await tokens.expiredProbe("a")
    const expiryControl = expiry.validNow ? await db.identity(expiry.token) : null

    for (const label of ["a", "b"]) {
      Object.assign(people[label], await ensureOrganization(db, await tokens.valid(label), label, people[label].userId))
    }

    for (const leftover of await liveMembershipsOfBInA(db, await tokens.valid("a"), people)) {
      if (!(await setMembershipStatus(db, await tokens.valid("a"), leftover.id, "removed")).ok) {
        throw new PreflightError("a membership left live by an interrupted run could not be removed")
      }
      state.leftovers += 1
    }

    // AC1: identity and tenant isolation for valid tokens.
    const identityProblems = []

    for (const label of ["a", "b"]) {
      const probe = await db.identity(await tokens.valid(label))

      if (probe.outcome !== "rows" || probe.rows.length !== 1 || probe.rows[0].user_id !== people[label].userId) {
        identityProblems.push(`test user ${label.toUpperCase()}: ${probe.outcome === "rows" ? `${probe.rows.length} link(s), not exactly its own` : describeRefusal(probe)}`)
      }
    }

    record(
      "valid-identity",
      identityProblems.length ? "FAIL" : "PASS",
      identityProblems.length
        ? `${identityProblems.join("; ")}. Check the issuer row's expected_audience against the token's aud`
        : "A and B each resolve to exactly their own app_users row"
    )

    const tenantProblems = []

    for (const [label, other] of [["a", "b"], ["b", "a"]]) {
      const token = await tokens.valid(label)
      const probe = await db.tenant(token, [people.a.orgId, people.b.orgId])
      const own = probe.rows.filter((row) => row.org_id === people[label].orgId)
      const foreign = probe.rows.filter((row) => row.org_id !== people[label].orgId)

      if (probe.outcome !== "rows" || !own.some((row) => row.id === people[label].unitId)) {
        tenantProblems.push(`${label.toUpperCase()} cannot read its own probe row (${probe.detail})`)
      }
      if (foreign.length > 0) {
        tenantProblems.push(`${label.toUpperCase()} read ${foreign.length} row(s) of organization ${other.toUpperCase()}`)
      }

      const ownAccess = await db.access(token, people[label].orgId)
      const otherAccess = await db.access(token, people[other].orgId)

      if (ownAccess.outcome !== "rows") tenantProblems.push(`${label.toUpperCase()}'s own organization did not open (${ownAccess.detail})`)
      if (otherAccess.outcome !== "denied") tenantProblems.push(`${label.toUpperCase()} opened organization ${other.toUpperCase()} (${otherAccess.detail})`)
    }

    record(
      "own-tenant",
      tenantProblems.length ? "FAIL" : "PASS",
      tenantProblems.length
        ? tenantProblems.join("; ")
        : "each reads its own probe row and none of the other's; get_viewer_marketplace_access opens only its own organization"
    )

    // AC2: every bad token for A is refused or resolves to no user. Meaningful only beside a passing control.
    const controlsPassed = !identityProblems.length && !tenantProblems.length
    const expectNoIdentity = async (id, attempt, origin) => {
      if (attempt.skip) return record(id, "SKIP", attempt.skip)
      if (attempt.fail) return record(id, "FAIL", attempt.fail)
      if (!controlsPassed) return record(id, "FAIL", "inconclusive: the valid-token controls (AC1) failed")

      const identity = await db.identity(attempt.token)
      const rows = await db.tenant(attempt.token, [people.a.orgId])
      const leaked = [identity, rows].filter((probe) => probe.outcome === "rows")
      const broken = [identity, rows].find((probe) => probe.outcome === "error")

      if (leaked.length > 0) return record(id, "FAIL", `ACCEPTED: ${origin}; ${identity.detail} identity, ${rows.detail} tenant rows`)
      if (broken) return record(id, "FAIL", `inconclusive: ${broken.detail}`)

      return record(id, "PASS", `${origin}: ${describeRefusal(identity)}`)
    }
    const validA = await tokens.valid("a")

    await expectNoIdentity(
      "forged-tampered",
      { token: remember(tamperPayload(validA, (payload) => ({ ...payload, exp: payload.exp + 3600 }))) },
      "valid token for A with exp extended after signing"
    )
    await expectNoIdentity("forged-foreign-key", { token: await tokens.foreignKey("a") }, "A's claims under a locally generated key")
    await expectNoIdentity("forged-alg-none", { token: remember(unsignedToken(decodeJwt(validA).payload)) }, "A's claims, no signature")

    for (const [id, attempt] of [
      ["wrong-issuer", await tokens.wrongIssuer("a")],
      ["wrong-audience", await tokens.wrongAudience("a")],
      ["missing-role", await tokens.missingRole("a")]
    ]) {
      await expectNoIdentity(id, attempt, attempt.evidence)
    }

    // AC3: invite B into A, B accepts, A removes B; B's next request with the same token loses access.
    record("removed-membership", "FAIL", "did not finish")

    const tokenB = await tokens.valid("b")
    const invited = await db.call(
      db.user(await tokens.valid("a")),
      "POST",
      "organization_memberships?select=id,status",
      { landing_workspace_seat: false, org_id: people.a.orgId, role: "driver", status: "invited", user_id: people.b.userId },
      { Prefer: "return=representation" }
    )

    state.membershipId = invited.json?.[0]?.id ?? null

    if (!(invited.status === 201 && state.membershipId)) {
      record("removed-membership", "FAIL", `A could not invite B (${httpDetail(invited)})`)
    } else if (!(await setMembershipStatus(db, tokenB, state.membershipId, "active")).ok) {
      record("removed-membership", "FAIL", "B could not accept the invitation")
    } else {
      const before = await db.tenant(tokenB, [people.a.orgId])
      const beforeAccess = await db.access(tokenB, people.a.orgId)

      if (before.outcome !== "rows" || beforeAccess.outcome !== "rows") {
        record("removed-membership", "FAIL", `inconclusive: as a member, B could not read A (${before.detail}; access ${beforeAccess.detail})`)
      } else if (!(await setMembershipStatus(db, await tokens.valid("a"), state.membershipId, "removed")).ok) {
        record("removed-membership", "FAIL", "A could not remove B")
      } else {
        state.removed = true

        const after = await db.tenant(tokenB, [people.a.orgId])
        const afterAccess = await db.access(tokenB, people.a.orgId)
        const stillValid = await db.tenant(tokenB, [people.b.orgId])

        if (after.outcome === "rows" || afterAccess.outcome !== "denied") {
          record("removed-membership", "FAIL", `B kept access after removal (${after.detail}; access ${afterAccess.detail})`)
        } else if (stillValid.outcome !== "rows") {
          record("removed-membership", "FAIL", `inconclusive: B's token stopped working altogether (${stillValid.detail})`)
        } else {
          record(
            "removed-membership",
            "PASS",
            `as a member B read A's probe row; after removal the same token read ${after.detail.replace(/^HTTP \d+, /, "")} of A ` +
              `and get_viewer_marketplace_access refused (${afterAccess.detail}), while B's own organization stayed readable`
          )
        }
      }
    }

    // AC2 expired: the short-lived token minted earlier, once it has expired.
    if (expiryControl && expiryControl.outcome !== "rows") {
      record("expired", "FAIL", `inconclusive: the short-lived token was not accepted while valid (${expiryControl.detail})`)
    } else {
      const wait = expiry.readyAt - now()

      if (wait > MAX_EXPIRY_WAIT_MS) {
        record("expired", "FAIL", `the short-lived token outlives the ${MAX_EXPIRY_WAIT_MS / 1000} s wait limit`)
      } else {
        if (wait > 0) {
          out(`${TOOL}: waiting ${Math.ceil(wait / 1000)} s for the short-lived token to expire...`)
          await sleep(wait)
        }

        await expectNoIdentity(
          "expired",
          { token: expiry.token },
          expiry.validNow ? "accepted while valid; after expiry" : "signed with an exp two minutes in the past"
        )
      }
    }
  } catch (error) {
    if (error instanceof RefusedError) refused = error.message
    else aborted = error instanceof PreflightError ? error.message : `unexpected error: ${error?.message ?? error}`
  } finally {
    const failures = []
    const notes = []

    try {
      if (state.membershipId && !state.removed) {
        if ((await setMembershipStatus(db, await tokens.valid("a"), state.membershipId, "removed")).ok) notes.push("removed the membership the run created")
        else failures.push("the membership the run created could not be removed")
      }

      if (people.a.orgId && people.b.userId) {
        const live = await liveMembershipsOfBInA(db, await tokens.valid("a"), people)

        if (live.length > 0) failures.push(`B still holds ${live.length} live membership(s) in A`)
        else notes.push("B holds no live membership in A, as before the run")
      }
    } catch (error) {
      failures.push(`membership cleanup failed: ${error?.message ?? error}`)
    }

    if (state.leftovers > 0) notes.push(`removed ${state.leftovers} membership(s) left by an interrupted run`)

    try {
      const revoked = await tokens.cleanup()

      failures.push(...revoked.failures)
      notes.push(revoked.note)
    } catch (error) {
      failures.push(`session cleanup failed: ${error?.message ?? error}`)
    }

    record("cleanup", failures.length ? "FAIL" : "PASS", [...failures, ...notes].join("; "))
  }

  if (refused) {
    out(`${TOOL}: refused: ${refused}.`)
    out(renderTable(results))
    return EXIT.refused
  }

  if (aborted) out(`${TOOL}: preflight failed: ${aborted}`)

  out(renderTable(results))

  const statuses = CHECKS.map((check) => results.get(check.id)?.status ?? "NOT RUN")
  const failed = statuses.filter((status) => status === "FAIL" || status === "NOT RUN").length
  const skipped = statuses.filter((status) => status === "SKIP").length
  const passed = statuses.filter((status) => status === "PASS").length
  const ok = failed === 0 && !aborted && (skipped === 0 || !required)

  out(
    `${TOOL}: ${ok && skipped === 0 ? "PASS" : ok ? "PASS WITH SKIPS (not a full #112 result)" : "FAIL"}: ` +
      `${passed} passed, ${failed} failed or not run, ${skipped} skipped (${mode}).`
  )

  return ok ? EXIT.pass : EXIT.fail
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  run({ argv: process.argv.slice(2), env: process.env }).then(
    (code) => {
      process.exitCode = code
    },
    (error) => {
      console.error(`${TOOL}: ${error?.message ?? error}`)
      process.exitCode = EXIT.fail
    }
  )
}
