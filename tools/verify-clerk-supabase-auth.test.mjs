import assert from "node:assert/strict"
import { createHmac, generateKeyPairSync, verify as verifyBytes } from "node:crypto"
import { test } from "node:test"

import {
  CHECKS,
  classify,
  decodeJwt,
  DEV_PROJECT_REFS_ENV,
  FIXTURES,
  LOCAL_IDENTITY,
  LOCAL_JWT_SECRET_ENV,
  NO_ROLE_TEMPLATE,
  redact,
  resolveConfig,
  run,
  signHs256,
  signRs256,
  TEST_USERS_ENV,
  WRONG_AUDIENCE_TEMPLATE
} from "./verify-clerk-supabase-auth.mjs"

// Obviously fake fixtures. Nothing here is, or resembles, a real key, token or project.
const REF = "authcheckfakeproject"
const ORIGIN = `https://${REF}.supabase.co`
const CLERK_HOST = "fake-instance.clerk.accounts.dev"
const CLERK_ISSUER = `https://${CLERK_HOST}`
const SESSION_AUDIENCE = "logloads-dev-fake"
const USER_A = "user_fakeA"
const USER_B = "user_fakeB"
const LOCAL_SECRET = "local-stack-fake-jwt-secret-0123456789abcdef"
const START = 1_900_000_000_000
const { privateKey: CLERK_PRIVATE, publicKey: CLERK_PUBLIC } = generateKeyPairSync("rsa", { modulusLength: 2048 })
const HARNESS_FOREIGN_KEY = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey

function liveEnv(changes = {}) {
  return {
    CLERK_SECRET_KEY: "sk_test_example",
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: `pk_test_${Buffer.from(`${CLERK_HOST}$`).toString("base64")}`,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_example",
    SUPABASE_SERVICE_ROLE_KEY: "sb_secret_example",
    SUPABASE_URL: ORIGIN,
    [DEV_PROJECT_REFS_ENV]: `otherfakeproject, ${REF}`,
    [TEST_USERS_ENV]: `${USER_A},${USER_B}`,
    ...changes
  }
}

const localKey = (role) => signHs256({ iss: "supabase-demo", role }, LOCAL_SECRET)

function localEnv(changes = {}) {
  return {
    LOGLOADS_DB_ENV: "supabase-local-ci",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: localKey("anon"),
    SUPABASE_SERVICE_ROLE_KEY: localKey("service_role"),
    SUPABASE_URL: "http://127.0.0.1:54321",
    [LOCAL_JWT_SECRET_ENV]: LOCAL_SECRET,
    ...changes
  }
}

const json = (status, body) => new Response(body === undefined ? "" : JSON.stringify(body), { status })

/**
 * An in-memory Clerk Backend API plus Supabase gateway, PostgREST and the slice of the normalized schema the
 * harness touches. `secure` behaviour mirrors the real rules; each option breaks one rule to prove the harness
 * notices.
 */
function fakeWorld(options = {}) {
  const local = options.mode === "local"
  const trusted = new Map(
    options.untrustedIssuer
      ? []
      : [[local ? LOCAL_IDENTITY.issuer : CLERK_ISSUER, local ? LOCAL_IDENTITY.audience : SESSION_AUDIENCE]]
  )
  const world = {
    calls: [],
    clock: { now: START },
    links: new Map(),
    memberships: [],
    minted: [],
    orgs: new Map(),
    sessions: new Map(),
    units: [],
    users: new Map()
  }
  let counter = 0
  const id = (kind) => `fake-${kind}-${(counter += 1)}`
  const seconds = () => Math.floor(world.clock.now / 1000)

  function mintClerk(sid, extra) {
    const session = world.sessions.get(sid)
    const issuedAt = seconds()
    const claims = { exp: issuedAt + 60, iat: issuedAt, iss: options.clerkIssuer ?? CLERK_ISSUER, nbf: issuedAt - 5, sid, sub: session.userId, ...extra }

    for (const [key, value] of Object.entries(claims)) if (value === undefined) delete claims[key]
    const token = signRs256(claims, CLERK_PRIVATE, "fake-clerk-kid")

    world.minted.push(token)
    return token
  }

  function clerk(method, path, body) {
    if (method === "GET" && path === "/v1/instance") return json(200, { environment_type: options.environment ?? "development" })
    if (method === "POST" && path === "/v1/sessions") {
      if (![USER_A, USER_B].includes(body.user_id)) return json(404, { errors: [{ code: "resource_not_found" }] })
      const sid = id("session")
      world.sessions.set(sid, { revoked: false, userId: body.user_id })
      return json(200, { id: sid, object: "session" })
    }

    const match = path.match(/^\/v1\/sessions\/([^/]+)\/(tokens|revoke)(?:\/(.+))?$/)
    if (!match || !world.sessions.has(match[1])) return json(404, { errors: [{ code: "resource_not_found" }] })
    const [, sid, action, template] = match

    if (action === "revoke") {
      world.sessions.get(sid).revoked = true
      return json(200, { id: sid, status: "revoked" })
    }
    if (template) {
      const templates = options.templates ?? {
        [NO_ROLE_TEMPLATE]: { aud: SESSION_AUDIENCE },
        [WRONG_AUDIENCE_TEMPLATE]: { aud: "logloads-authcheck-elsewhere", role: "authenticated" }
      }
      if (!templates[template]) return json(404, { errors: [{ code: "resource_not_found" }] })
      return json(200, { jwt: mintClerk(sid, templates[template]), object: "token" })
    }

    const lifetime = typeof body?.expires_in_seconds === "number" && !options.ignoreLifetime ? body.expires_in_seconds : 60
    const role = options.sessionRole === undefined ? "authenticated" : options.sessionRole ?? undefined
    return json(200, {
      jwt: mintClerk(sid, { aud: SESSION_AUDIENCE, exp: seconds() + lifetime, role }),
      object: "token"
    })
  }

  // --- the gateway: verifies the bearer token, then picks the database role -------------------------------
  function verified(token) {
    const parts = token.split(".")
    const decoded = decodeJwt(token)
    if (!decoded) return { error: "PGRST301" }
    const input = Buffer.from(`${parts[0]}.${parts[1]}`)
    let valid = false

    if (decoded.header.alg === "RS256" && !local) {
      valid = verifyBytes("sha256", input, CLERK_PUBLIC, Buffer.from(parts[2], "base64url"))
    } else if (decoded.header.alg === "HS256" && local) {
      valid = createHmac("sha256", LOCAL_SECRET).update(input).digest("base64url") === parts[2]
    }
    if (!valid && !options.gatewaySkipsSignature) return { error: "PGRST301" }
    if (decoded.payload.exp * 1000 <= world.clock.now && !options.gatewayIgnoresExpiry) return { error: "PGRST303" }
    return { claims: decoded.payload }
  }

  function currentUser(claims, role) {
    if (role !== "authenticated" || claims.role !== "authenticated") return null
    const pinned = trusted.get(claims.iss)
    if (pinned === undefined) return null
    if (!options.dbIgnoresAudience && ![claims.aud].flat().includes(pinned)) return null
    if (claims.exp * 1000 <= world.clock.now && !options.dbIgnoresExpiry) return null
    const userId = world.links.get(`${claims.iss}|${claims.sub}`)
    return userId && world.users.get(userId).status === "active" ? userId : null
  }

  const liveStatuses = options.ignoreRemoval ? ["active", "removed"] : ["active"]
  const myOrgs = (me, roles = ["owner", "manager", "staff", "driver"]) =>
    new Set(
      world.memberships
        .filter((m) => m.user_id === me && liveStatuses.includes(m.status) && roles.includes(m.role) && world.orgs.get(m.org_id)?.status === "active")
        .map((m) => m.org_id)
    )

  function filters(params) {
    const tests = []
    for (const [key, raw] of params) {
      if (key === "select") continue
      const [op, ...rest] = raw.split(".")
      const value = rest.join(".")
      if (op === "eq") tests.push((row) => String(row[key]) === value)
      else if (op === "neq") tests.push((row) => String(row[key]) !== value)
      else if (op === "in") tests.push((row) => value.slice(1, -1).split(",").includes(String(row[key])))
    }
    return (row) => tests.every((check) => check(row))
  }

  function postgrest(method, path, params, body, role, me) {
    const denied = (message) => json(role === "anon" ? 401 : 403, { code: "42501", message })
    const select = (rows) => rows.map((row) => Object.fromEntries((params.get("select") ?? "id").split(",").map((column) => [column, row[column]])))
    const overridden = options.override?.({ me, method, params, path, world })

    if (overridden) return overridden
    if (options.redirectPreflight && path === "equipment_types") return new Response("", { headers: { location: "https://elsewhere.example" }, status: 307 })
    if (path === "equipment_types") return options.schemaMissing ? json(406, { code: "PGRST106" }) : json(200, [{ code: "log_truck" }])

    if (path === "rpc/sync_verified_identity") {
      if (role !== "service_role") return denied("permission denied for function sync_verified_identity")
      if (!trusted.has(body.p_issuer)) return denied(`untrusted identity issuer: ${body.p_issuer}`)
      const key = `${body.p_issuer}|${body.p_subject}`
      if (!world.links.has(key)) {
        const userId = id("user")
        world.users.set(userId, { status: "active" })
        world.links.set(key, userId)
      }
      return json(200, world.links.get(key))
    }

    if (role !== "authenticated") return denied("permission denied for table")

    if (path === "identity_links") return json(200, me ? [{ user_id: me }] : [])

    if (path === "organizations" && method === "GET") {
      const rows = [...world.orgs].filter(([orgId, org]) => filters(params)({ ...org, id: orgId }) && world.memberships.some((m) => m.org_id === orgId && m.user_id === me))
      return json(200, rows.map(([orgId]) => ({ id: orgId })))
    }

    if (path === "rpc/create_organization") {
      if (!me) return denied("authentication required")
      if ([...world.orgs.values()].some((org) => org.slug === body.p_slug)) return json(409, { code: "23505" })
      const orgId = id("org")
      world.orgs.set(orgId, { slug: body.p_slug, status: "active" })
      world.memberships.push({ id: id("membership"), org_id: orgId, role: "owner", status: "active", user_id: me })
      return json(200, orgId)
    }

    if (path === "rpc/get_viewer_marketplace_access") {
      if (!me) return denied("Authentication required")
      if (!myOrgs(me).has(body.p_org_id)) return denied("Organization operations are not available")
      return json(200, [{ capabilities: ["interest.express"], organization_id: body.p_org_id }])
    }

    if (path === "organization_memberships") {
      const visible = (m) => myOrgs(me).has(m.org_id) || m.user_id === me

      if (method === "GET") return json(200, select(world.memberships.filter((m) => visible(m) && filters(params)(m))))
      if (method === "POST") {
        if (!myOrgs(me, ["owner"]).has(body.org_id) || body.status !== "invited") return denied("new row violates row-level security policy")
        if (world.memberships.some((m) => m.org_id === body.org_id && m.user_id === body.user_id && m.status !== "removed")) return json(409, { code: "23505" })
        const row = { ...body, id: id("membership") }
        world.memberships.push(row)
        return json(201, select([row]))
      }
      if (method === "PATCH") {
        if (options.failOn?.(path, method, body)) throw new Error("simulated network failure")
        const rows = world.memberships.filter((m) => visible(m) && filters(params)(m))
        for (const row of rows) {
          const owner = myOrgs(me, ["owner"]).has(row.org_id)
          const accepting = row.user_id === me && row.status === "invited" && body.status === "active"
          if (!owner && !accepting && !(row.user_id === me && body.status === "removed")) return denied("members may only accept an invitation or leave")
          row.status = body.status
        }
        return json(200, select(rows))
      }
    }

    if (path === "equipment_units") {
      if (method === "GET") {
        if (options.failOn?.(path, method, body)) throw new Error("simulated network failure")
        return json(200, select(world.units.filter((unit) => myOrgs(me).has(unit.org_id) && filters(params)(unit))))
      }
      if (!myOrgs(me, ["owner", "manager", "staff"]).has(body.org_id)) return denied("new row violates row-level security policy")
      const row = { ...body, id: id("unit") }
      world.units.push(row)
      return json(201, select([row]))
    }

    return json(404, { code: "PGRST202" })
  }

  const anonKey = local ? localKey("anon") : "sb_publishable_example"
  const serviceKey = local ? localKey("service_role") : "sb_secret_example"

  world.fetch = async (url, init = {}) => {
    const target = new URL(url)
    const body = init.body ? JSON.parse(init.body) : undefined
    world.calls.push({ host: target.host, method: init.method, path: target.pathname, redirect: init.redirect })

    if (target.host === "api.clerk.com") {
      if (init.headers.Authorization !== "Bearer sk_test_example") return json(401, { errors: [{ code: "authentication_invalid" }] })
      return clerk(init.method, target.pathname, body)
    }

    const expectedHost = local ? "127.0.0.1:54321" : `${REF}.supabase.co`
    if (target.host !== expectedHost) throw new Error(`unexpected host ${target.host}`)
    const apikey = init.headers.apikey
    if (apikey !== anonKey && apikey !== serviceKey) return json(401, { message: "Invalid API key" })

    let role = apikey === serviceKey ? "service_role" : "anon"
    let me = null
    const bearer = init.headers.Authorization?.replace(/^Bearer /, "")

    if (bearer) {
      const result = verified(bearer)
      if (result.error) return json(401, { code: result.error, message: "JWT verification failed" })
      role = result.claims.role ?? "anon"
      me = currentUser(result.claims, role)
    }

    return postgrest(init.method, target.pathname.replace(/^\/rest\/v1\//, ""), target.searchParams, body, role, me)
  }

  return world
}

async function harness(world, { argv = [], env = liveEnv() } = {}) {
  const lines = []
  const sleeps = []
  const code = await run({
    argv,
    env,
    fetch: world.fetch,
    generateRsaKey: () => HARNESS_FOREIGN_KEY,
    now: () => world.clock.now,
    sleep: async (milliseconds) => {
      sleeps.push(milliseconds)
      world.clock.now += milliseconds
    },
    write: (line) => lines.push(line)
  })

  return { code, output: lines.join("\n"), sleeps }
}

const resultOf = (output, id) => {
  const index = CHECKS.findIndex((check) => check.id === id) + 1
  return output.split("\n").find((line) => line.startsWith(`| ${index} |`))?.split("|")[3]?.trim()
}

const refusingFetch = async () => {
  throw new Error("no request may be sent")
}

// ---------------------------------------------------------------------------

test("with no configuration it skips with the names it needs, and fails only with --require", async () => {
  for (const [argv, expected] of [[[], 0], [["--require"], 1]]) {
    const lines = []
    const code = await run({ argv, env: {}, fetch: refusingFetch, write: (line) => lines.push(line) })

    assert.equal(code, expected)
    assert.match(lines.join("\n"), /skipped: the live run needs SUPABASE_URL, .*CLERK_SECRET_KEY, LOGLOADS_SUPABASE_DEV_PROJECT_REFS, LOGLOADS_AUTH_HARNESS_CLERK_USER_IDS/)
  }

  const local = []
  assert.equal(await run({ argv: ["--local-stack"], env: {}, fetch: refusingFetch, write: (line) => local.push(line) }), 0)
  assert.match(local.join("\n"), /skipped: the local-stack run needs SUPABASE_URL/)
})

test("unknown options and positionals are refused rather than ignored", async () => {
  for (const argv of [["--requir"], ["live"], ["--require=yes"]]) {
    assert.equal(await run({ argv, env: liveEnv(), fetch: refusingFetch, write: () => {} }), 2)
  }
})

test("refuses anything but a development Clerk instance and a listed development project, before any request", async () => {
  const cases = [
    [{ CLERK_SECRET_KEY: "sk_live_example" }, /not a development-instance key/],
    [{ NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_live_example" }, /NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY is not a development-instance key/],
    [{ NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: `pk_test_${Buffer.from("clerk.logloads.example$").toString("base64")}` }, /does not name a \*\.clerk\.accounts\.dev/],
    [{ [DEV_PROJECT_REFS_ENV]: "otherfakeproject" }, /"authcheckfakeproject", which is not listed in LOGLOADS_SUPABASE_DEV_PROJECT_REFS/],
    [{ [DEV_PROJECT_REFS_ENV]: "https://authcheckfakeproject.supabase.co" }, /must list project references only/],
    [{ SUPABASE_URL: "https://logloads.example" }, /names no project reference/],
    [{ SUPABASE_URL: "http://127.0.0.1:54321" }, /loopback stack; the live mode needs a hosted development project/],
    [{ SUPABASE_SERVICE_ROLE_KEY: "sb_publishable_example" }, /SUPABASE_SERVICE_ROLE_KEY holds the wrong kind of key/],
    [{ NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_secret_example" }, /holds the wrong kind of key/],
    [{ SUPABASE_SERVICE_ROLE_KEY: signHs256({ ref: "otherfakeproject", role: "service_role" }, LOCAL_SECRET) }, /belongs to project "otherfakeproject"/],
    [{ NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: signHs256({ ref: REF, role: "service_role" }, LOCAL_SECRET) }, /key for the "service_role" role, not "anon"/],
    [{ [TEST_USERS_ENV]: USER_A }, /exactly two different Clerk user IDs/],
    [{ [TEST_USERS_ENV]: `${USER_A},${USER_A}` }, /exactly two different Clerk user IDs/],
    // A production key is refused even when the rest of the configuration is missing.
    [{ CLERK_SECRET_KEY: "sk_live_example", SUPABASE_URL: "", [TEST_USERS_ENV]: "" }, /not a development-instance key/]
  ]

  for (const [changes, reason] of cases) {
    const lines = []
    const code = await run({ env: liveEnv(changes), fetch: refusingFetch, write: (line) => lines.push(line) })

    assert.equal(code, 2, `expected a refusal for ${JSON.stringify(Object.keys(changes))}`)
    assert.match(lines.join("\n"), reason)
    assert.match(lines.join("\n"), /Nothing was sent/)
  }
})

test("the local-stack mode accepts only the disposable CI stack", () => {
  assert.equal(resolveConfig(localEnv(), "local-stack").ok, true)
  assert.deepEqual(resolveConfig(localEnv({ LOGLOADS_DB_ENV: "" }), "local-stack").missing, ["LOGLOADS_DB_ENV=supabase-local-ci"])
  assert.match(resolveConfig(localEnv({ LOGLOADS_DB_ENV: "ci-disposable" }), "local-stack").refused.join(), /LOGLOADS_DB_ENV=supabase-local-ci/)
  assert.match(resolveConfig(localEnv({ SUPABASE_URL: ORIGIN }), "local-stack").refused.join(), /never a hosted project/)
  assert.match(resolveConfig(localEnv({ [LOCAL_JWT_SECRET_ENV]: "short" }), "local-stack").refused.join(), /shorter than 32/)
})

test("a full live run passes every #112 check against a gateway that enforces the rules", async () => {
  const world = fakeWorld()
  const { code, output, sleeps } = await harness(world, { argv: ["--require"] })

  assert.equal(code, 0, output)
  for (const check of CHECKS) assert.equal(resultOf(output, check.id), "PASS", `${check.id}\n${output}`)
  assert.match(output, /PASS: 11 passed, 0 failed or not run, 0 skipped \(live\)/)

  // Real Clerk session tokens were minted for the run, and every session was revoked afterwards.
  assert.equal(world.sessions.size, 2)
  assert.ok([...world.sessions.values()].every((session) => session.revoked))

  // The expired check waited for the 15 s token, plus the clock-skew margin.
  assert.equal(sleeps.length, 1)
  assert.ok(sleeps[0] > 35_000 && sleeps[0] <= 50_000, `waited ${sleeps[0]} ms`)

  // B ends with no live membership in A: the run's one membership is removed.
  const orgA = [...world.orgs].find(([, org]) => org.slug === FIXTURES.a.slug)[0]
  const userB = world.links.get(`${CLERK_ISSUER}|${USER_B}`)
  assert.deepEqual(world.memberships.filter((m) => m.org_id === orgA && m.user_id === userB).map((m) => m.status), ["removed"])

  // Every request was made without following redirects.
  assert.ok(world.calls.every((call) => call.redirect === "manual"))
})

test("output never contains a key, a token, a Clerk user ID, a row ID or the project reference", async () => {
  const world = fakeWorld()
  const { output } = await harness(world)

  for (const secret of ["sk_test_example", "sb_secret_example", "sb_publishable_example", USER_A, USER_B, REF, ...world.minted]) {
    assert.ok(!output.includes(secret), `output leaked ${secret.slice(0, 12)}…`)
  }
  assert.match(output.split("\n")[0], /Supabase development project \(project ref hidden\)$/)
  assert.doesNotMatch(output, /eyJ[A-Za-z0-9_-]{6,}\./)
  assert.doesNotMatch(output, /fake-(user|org|membership|unit)-\d+/)
})

test("a second run reuses the fixture and repeats the membership check cleanly", async () => {
  const world = fakeWorld()

  assert.equal((await harness(world)).code, 0)
  const orgs = world.orgs.size
  const units = world.units.length
  const second = await harness(world, { argv: ["--require"] })

  assert.equal(second.code, 0, second.output)
  assert.equal(world.orgs.size, orgs)
  assert.equal(world.units.length, units)
  assert.equal(world.memberships.filter((m) => m.role === "driver").length, 2)
  assert.ok(world.memberships.filter((m) => m.role === "driver").every((m) => m.status === "removed"))
})

test("each broken rule fails its own check", async () => {
  const cases = [
    [{ dbIgnoresExpiry: true, gatewayIgnoresExpiry: true }, ["expired"]],
    [{ dbIgnoresAudience: true }, ["wrong-audience"]],
    [{ gatewaySkipsSignature: true }, ["forged-tampered", "forged-foreign-key", "forged-alg-none"]],
    [{ ignoreRemoval: true }, ["removed-membership"]]
  ]

  for (const [options, failing] of cases) {
    const { code, output } = await harness(fakeWorld(options))

    assert.equal(code, 1, JSON.stringify(options))
    for (const check of CHECKS) {
      assert.equal(resultOf(output, check.id), failing.includes(check.id) ? "FAIL" : "PASS", `${JSON.stringify(options)} ${check.id}\n${output}`)
    }
    assert.match(output, /ACCEPTED|kept access/)
  }
})

// Replaces B's read of organization A once B's membership there is removed (the AC3 "after" read).
function afterRemovalReadOfA(response) {
  return ({ me, method, params, path, world }) => {
    const orgA = [...world.orgs].find(([, org]) => org.slug === FIXTURES.a.slug)?.[0]
    const userB = world.links.get(`${CLERK_ISSUER}|${USER_B}`)
    const removed = world.memberships.some((m) => m.org_id === orgA && m.user_id === userB && m.status === "removed")

    if (removed && me === userB && method === "GET" && path === "equipment_units" && params.get("org_id") === `in.(${orgA})`) {
      return response()
    }

    return undefined
  }
}

test("AC3 fails as inconclusive when the read after removal errors instead of returning nothing", async () => {
  const world = fakeWorld({ override: afterRemovalReadOfA(() => json(500, { code: "XX000", message: "internal error" })) })
  const { code, output } = await harness(world)

  assert.equal(code, 1)
  assert.equal(resultOf(output, "removed-membership"), "FAIL")
  assert.match(output, /inconclusive: after removal the read gave HTTP 500 XX000 and access HTTP 403 42501/)
  assert.equal(resultOf(output, "cleanup"), "PASS")
  for (const check of CHECKS.filter((entry) => !["removed-membership", "cleanup"].includes(entry.id))) {
    assert.equal(resultOf(output, check.id), "PASS", check.id)
  }
})

test("AC3 accepts an explicit refusal of the read after removal, from the database or the gateway", async () => {
  for (const [status, code] of [[403, "42501"], [401, "PGRST301"]]) {
    const { code: exit, output } = await harness(fakeWorld({ override: afterRemovalReadOfA(() => json(status, { code })) }))

    assert.equal(exit, 0, output)
    assert.match(output, new RegExp(`after removal the same token was refused A's rows \\(HTTP ${status} ${code}\\)`))
  }
})

test("a token the gateway lets through still passes when the database resolves it to no user", async () => {
  const { code, output } = await harness(fakeWorld({ gatewayIgnoresExpiry: true }))

  assert.equal(code, 0, output)
  assert.match(resultOf(output, "expired"), /PASS/)
  assert.match(output, /accepted while valid; after expiry: resolved to no user \(HTTP 200, 0 rows\)/)
})

test("without the two Clerk JWT templates, those checks are skipped, and --require fails the run", async () => {
  const relaxed = await harness(fakeWorld({ templates: {} }))

  assert.equal(relaxed.code, 0)
  assert.equal(resultOf(relaxed.output, "wrong-audience"), "SKIP")
  assert.equal(resultOf(relaxed.output, "missing-role"), "SKIP")
  assert.match(relaxed.output, /PASS WITH SKIPS \(not a full #112 result\)/)
  assert.match(relaxed.output, /logloads-authcheck-wrong-audience" not found \(runbook step 3\)/)

  assert.equal((await harness(fakeWorld({ templates: {} }), { argv: ["--require"] })).code, 1)
})

test("a misconfigured template fails rather than proving the wrong thing", async () => {
  const { code, output } = await harness(
    fakeWorld({
      templates: {
        [NO_ROLE_TEMPLATE]: { aud: SESSION_AUDIENCE, role: "authenticated" },
        [WRONG_AUDIENCE_TEMPLATE]: { aud: SESSION_AUDIENCE, role: "authenticated" }
      }
    })
  )

  assert.equal(code, 1)
  assert.match(output, /must set an audience other than the session token's/)
  assert.match(output, /carries a role claim; it must leave role out/)
})

test("a template token naming another subject fails, whatever else it gets right", async () => {
  const { code, output } = await harness(
    fakeWorld({
      templates: {
        [NO_ROLE_TEMPLATE]: { aud: SESSION_AUDIENCE, sub: USER_B },
        [WRONG_AUDIENCE_TEMPLATE]: { aud: "logloads-authcheck-elsewhere", role: "authenticated", sub: USER_B }
      }
    })
  )

  assert.equal(code, 1)
  assert.equal(resultOf(output, "wrong-audience"), "FAIL")
  assert.equal(resultOf(output, "missing-role"), "FAIL")
  assert.match(output, /template "logloads-authcheck-wrong-audience" token names another subject than test user A/)
  assert.match(output, /template "logloads-authcheck-no-role" token names another subject than test user A/)
  assert.ok(!output.includes(USER_B))
})

test("session tokens without the Supabase role claim stop the run at preflight, and sessions are still revoked", async () => {
  const world = fakeWorld({ sessionRole: null })
  const { code, output } = await harness(world)

  assert.equal(code, 1)
  assert.match(output, /preflight failed: Clerk session tokens carry no "role": "authenticated" claim/)
  assert.equal(resultOf(output, "valid-identity"), "NOT RUN")
  assert.equal(resultOf(output, "cleanup"), "PASS")
  assert.ok([...world.sessions.values()].every((session) => session.revoked))
  assert.ok(!world.calls.some((call) => call.host.endsWith(".supabase.co")))
})

test("a production Clerk instance or a non-development issuer is refused before Supabase is touched", async () => {
  for (const options of [{ environment: "production" }, { clerkIssuer: "https://clerk.logloads.example" }]) {
    const world = fakeWorld(options)
    const { code, output } = await harness(world)

    assert.equal(code, 2, output)
    assert.match(output, /refused: (Clerk reports a production instance|the session token's issuer is not a https:\/\/\*\.clerk\.accounts\.dev)/)
    assert.ok(!world.calls.some((call) => call.host.endsWith(".supabase.co")))
  }
})

test("a missing trusted-issuer row or an unexposed schema stops at preflight with the runbook step", async () => {
  const untrusted = await harness(fakeWorld({ untrustedIssuer: true }))

  assert.equal(untrusted.code, 1)
  assert.match(untrusted.output, /linking test user A failed \(HTTP 403 42501\); add the Clerk issuer to marketplace\.trusted_identity_issuers \(runbook step 5\)/)

  const schema = await harness(fakeWorld({ schemaMissing: true }))

  assert.equal(schema.code, 1)
  assert.match(schema.output, /marketplace schema is not reachable through the Data API \(HTTP 406 PGRST106\)/)
})

test("a redirect is never followed", async () => {
  const world = fakeWorld({ redirectPreflight: true })
  const { code, output } = await harness(world)

  assert.equal(code, 2)
  assert.match(output, /answered with a redirect; redirects are never followed/)
  assert.ok(!world.calls.some((call) => call.host === "elsewhere.example"))
})

test("an error that first appears during cleanup names neither the project reference nor a test user", async () => {
  let liveMembershipReads = 0
  const world = fakeWorld({
    override: ({ method, params, path }) => {
      if (path === "organization_memberships" && method === "GET" && params.get("status") === "neq.removed") {
        liveMembershipReads += 1
        if (liveMembershipReads === 2) return new Response("", { headers: { location: "https://elsewhere.example" }, status: 307 })
      }
      return undefined
    }
  })
  const { code, output } = await harness(world)

  assert.equal(code, 1, output)
  assert.match(resultOf(output, "cleanup"), /FAIL/)
  assert.match(output, /membership cleanup failed: \[redacted\]\.supabase\.co answered with a redirect/)
  for (const value of [REF, USER_A, USER_B]) assert.ok(!output.includes(value), `output leaked ${value}`)
})

test("a membership left live by an interrupted run is removed first, and said so", async () => {
  const world = fakeWorld()

  assert.equal((await harness(world)).code, 0)
  const orgA = [...world.orgs].find(([, org]) => org.slug === FIXTURES.a.slug)[0]
  const userB = world.links.get(`${CLERK_ISSUER}|${USER_B}`)
  world.memberships.push({ id: "fake-membership-leftover", org_id: orgA, role: "driver", status: "active", user_id: userB })

  const { code, output } = await harness(world)

  assert.equal(code, 0, output)
  assert.match(output, /removed 1 membership\(s\) left by an interrupted run/)
  assert.equal(world.memberships.find((m) => m.id === "fake-membership-leftover").status, "removed")
})

test("cleanup removes the run's membership when the run dies half-way through the membership check", async () => {
  let accepted = false
  const world = fakeWorld({
    failOn: (path, method, body) => {
      if (path === "organization_memberships" && body?.status === "active") accepted = true
      return accepted && path === "equipment_units" && method === "GET"
    }
  })
  const { code, output } = await harness(world)

  assert.equal(code, 1)
  assert.match(output, /preflight failed: unexpected error: simulated network failure/)
  assert.match(resultOf(output, "cleanup"), /PASS/)
  assert.match(output, /removed the membership the run created/)
  assert.ok(world.memberships.filter((m) => m.role === "driver").every((m) => m.status === "removed"))
})

test("the local-stack mode runs the same checks with locally signed tokens", async () => {
  const world = fakeWorld({ mode: "local" })
  const { code, output, sleeps } = await harness(world, { argv: ["--local-stack", "--require"], env: localEnv() })

  assert.equal(code, 0, output)
  for (const check of CHECKS) assert.equal(resultOf(output, check.id), "PASS", `${check.id}\n${output}`)
  assert.deepEqual(sleeps, [])
  assert.ok(!world.calls.some((call) => call.host === "api.clerk.com"))
  assert.match(output, /validly signed, an untrusted issuer: resolved to no user/)
  assert.match(output, /validly signed, no role claim: resolved to no user \(HTTP 401 42501\)/)
  assert.ok(!output.includes(LOCAL_SECRET))
})

test("classify separates gateway rejections, database refusals, empty reads and leaks", () => {
  assert.equal(classify({ json: [{ id: "x" }], status: 200 }).outcome, "rows")
  assert.equal(classify({ json: [], status: 200 }).outcome, "no-rows")
  assert.equal(classify({ json: { code: "42501" }, status: 401 }).outcome, "denied")
  assert.equal(classify({ json: { code: "PGRST303" }, status: 401 }).outcome, "rejected")
  assert.equal(classify({ json: { message: "Invalid JWT" }, status: 401 }).outcome, "rejected")
  assert.equal(classify({ json: { code: "XX000" }, status: 500 }).outcome, "error")
})

test("redact removes known secrets and anything shaped like a JWT", () => {
  const token = signHs256({ sub: "x" }, LOCAL_SECRET)

  assert.equal(redact(`key sb_secret_example and ${token}`, new Set(["sb_secret_example"])), "key [redacted] and [token redacted]")
})
