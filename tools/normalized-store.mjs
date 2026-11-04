#!/usr/bin/env node
// Owner-run: deploys the normalized V2 store (architecture/normalized-v2) to one database so the app can use it
// with LOGLOADS_MARKETPLACE_V2_ADAPTER=normalized, and optionally loads the synthetic pilot demo seed. Dry run by
// default; never prints a value. The runbook is docs/INTEGRATIONS.md §15.
//
//   doppler run --project logloads --config stg -- pnpm normalized:store status --expected-project-ref <ref>
//   doppler run --project logloads --config stg -- pnpm normalized:store schema --expected-project-ref <ref>          # plan
//   doppler run --project logloads --config stg -- pnpm normalized:store schema --expected-project-ref <ref> --apply  # Owner
//   doppler run --project logloads --config stg -- pnpm normalized:store seed --expected-project-ref <ref> --apply    # Owner, staging only
//
// A database on this machine (a disposable stack, or CI's) uses --expected-project-ref local.
//
// It reads DATABASE_URL (the migration role, written by tools/provision-supabase-project.mjs),
// LOGLOADS_NORMALIZED_DATABASE_URL (the adapter's login role and its password), LOGLOADS_NORMALIZED_IDENTITY_ISSUER
// and LOGLOADS_NORMALIZED_IDENTITY_AUDIENCE, and needs psql (PostgreSQL 15 or later, 17 recommended) on PATH.
//
// schema --apply, in order, each step one transaction:
//   1. the migration files CI applies, in CI's order (MIGRATION_CHAIN), skipping those the ledger
//      (marketplace.schema_migrations) or the 01-03 baseline objects show are applied; re-running is a no-op;
//   2. the trusted issuer row the adapter asserts (LOGLOADS_NORMALIZED_IDENTITY_ISSUER, its pinned audience);
//   3. the adapter's login role (docs/SECURITY.md §4.1): LOGIN NOINHERIT, no other attribute, member of anon and
//      authenticated only, statement and idle-transaction timeouts. Its password is sent as a SCRAM-SHA-256
//      verifier on psql's stdin, never on a command line and never in plaintext. An existing role is checked and
//      kept (or its password reset with --reset-adapter-password); an unsafe one is refused, never altered;
//   4. verification: ledger, RLS and function invariants, then a login AS the adapter role that runs public discovery.
//
// Safety rules (tested in tools/normalized-store.test.mjs): production signals in the environment refuse the run;
// the project is named on the command line and must match both URLs and, for a hosted project, the config's own
// LOGLOADS_SUPABASE_EXPECTED_PROJECT_REF; connection values reach psql through its environment, never argv; every
// printed line is redacted again as defense in depth.
import { spawnSync as nodeSpawnSync } from "node:child_process"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { parseArguments } from "./operating-state-backup-policy.mjs"
import {
  ADAPTER_ROLE_SETTINGS,
  assessRole,
  checkTargets,
  computeIssuerPlan,
  computeSchemaPlan,
  computeSeedPlan,
  createRedactor,
  EXPECTED_PROJECT_REF_FLAG,
  identityFromEnvironment,
  LEDGER_CHAIN,
  MIGRATION_DIR,
  parseStateLines,
  scramSha256Verifier,
  SEED_FILE,
  SEED_MARKER_ACTION
} from "./normalized-store-policy.mjs"

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const COMMANDS = new Set(["status", "schema", "seed"])
const USAGE = [
  "Usage: node tools/normalized-store.mjs <status | schema | seed> --expected-project-ref <ref | local> [--apply] [--reset-adapter-password] [--verbose]",
  "  status   read-only: what is applied, the issuer row, the adapter role, the seed, and a login as the adapter",
  "  schema   apply the pending migrations, register the issuer, create the adapter login role, verify (dry run without --apply)",
  "  seed     load the synthetic pilot demo seed into an empty, current store (dry run without --apply); never production",
  "Runbook: docs/INTEGRATIONS.md §15."
].join("\n")

// Read-only: one `key|value` line per fact. psql \if skips what does not exist yet, so nothing here can fail on a
// fresh database. Variables: issuer, adapter_role (always passed).
export const STATE_SQL = String.raw`begin read only;
select 'server|' || current_setting('server_version_num');
select 'login|' || session_user::text;
select 'schema|' || (to_regnamespace('marketplace') is not null)::text;
select 'objects|' || ((select count(*) from pg_class c where c.relnamespace = to_regnamespace('marketplace'))
                    + (select count(*) from pg_proc p where p.pronamespace = to_regnamespace('marketplace')))::text;
select 'postgis|' || coalesce((select n.nspname::text from pg_extension e join pg_namespace n on n.oid = e.extnamespace
                               where e.extname = 'postgis'), 'absent');
select 'stamped|' || (coalesce(shobj_description((select d.oid from pg_database d where d.datname = current_database()), 'pg_database'), '')
                      like 'logloads-ci-disposable:%')::text;
select 'b01|' || (to_regclass('marketplace.app_users') is not null)::text;
select 'b02|' || (to_regprocedure('marketplace.has_org_role(uuid, text[], boolean)') is not null)::text;
select 'b03|' || (to_regprocedure('marketplace.open_subscription_cycle(uuid, text, text, timestamptz, timestamptz, text, text, boolean, integer, boolean)') is not null)::text;
select 'inv_rls|' || coalesce(bool_and(c.relrowsecurity), false)::text
from pg_class c where c.relnamespace = to_regnamespace('marketplace') and c.relkind in ('r', 'p');
select 'inv_public_execute|' || (not exists (select 1 from pg_proc p where p.pronamespace = to_regnamespace('marketplace')
                                             and has_function_privilege('public', p.oid, 'EXECUTE')))::text;
select 'inv_search_path|' || (not exists (select 1 from pg_proc p where p.pronamespace = to_regnamespace('marketplace') and p.prosecdef
                                          and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) cfg where cfg like 'search_path=%')))::text;
select to_regclass('marketplace.schema_migrations') is not null as has_ledger,
       to_regclass('marketplace.trusted_identity_issuers') is not null as has_issuers,
       (to_regclass('marketplace.organizations') is not null and to_regclass('marketplace.audit_events') is not null) as has_orgs \gset
\if :has_ledger
select 'ledger|' || coalesce(json_agg(version order by applied_at, version), '[]'::json)::text from marketplace.schema_migrations;
\endif
\if :has_issuers
select 'issuer|' || coalesce((select json_build_object('enabled', i.enabled, 'audience', i.expected_audience)::text
                              from marketplace.trusted_identity_issuers i where i.issuer = :'issuer'), 'absent');
\endif
\if :has_orgs
select 'organizations|' || count(*)::text from marketplace.organizations;
select 'seed|' || count(*)::text from marketplace.audit_events where action = '${SEED_MARKER_ACTION}';
\endif
select 'role|' || coalesce((
  select json_build_object(
    'login', r.rolcanlogin, 'inherit', r.rolinherit, 'superuser', r.rolsuper, 'bypassrls', r.rolbypassrls,
    'createrole', r.rolcreaterole, 'createdb', r.rolcreatedb, 'replication', r.rolreplication,
    'member_of', coalesce((select json_agg(g.rolname::text order by g.rolname)
                           from pg_auth_members m join pg_roles g on g.oid = m.roleid where m.member = r.oid), '[]'::json),
    'reaches', coalesce((select json_agg(p.rolname::text order by p.rolname) from pg_roles p
                         where p.oid <> r.oid and pg_has_role(r.oid, p.oid, 'MEMBER')
                           and not exists (select 1 from pg_roles a where a.rolname in ('anon', 'authenticated')
                                                                       and pg_has_role(a.oid, p.oid, 'MEMBER'))), '[]'::json),
    'privileged', coalesce((select json_agg(p.rolname::text order by p.rolname) from pg_roles p
                            where p.oid <> r.oid and (p.rolsuper or p.rolbypassrls or p.rolcreaterole)
                              and pg_has_role(r.oid, p.oid, 'MEMBER')), '[]'::json),
    'owns', (select count(*) from pg_class c where c.relowner = r.oid and c.relnamespace = to_regnamespace('marketplace'))
          + (select count(*) from pg_proc p where p.proowner = r.oid and p.pronamespace = to_regnamespace('marketplace'))
          + (select count(*) from pg_type t where t.typowner = r.oid and t.typnamespace = to_regnamespace('marketplace'))
          + (select count(*) from pg_namespace n where n.nspowner = r.oid and n.nspname = 'marketplace')
  )::text
  from pg_roles r where r.rolname = :'adapter_role'), 'absent');
rollback;
`

// Read-only, as the adapter's own login role: who it is, and that it can become anon and run public discovery.
export const ADAPTER_LOGIN_SQL = String.raw`begin read only;
select 'adapter_login|' || json_build_object('user', r.rolname::text, 'superuser', r.rolsuper, 'bypassrls', r.rolbypassrls,
                                             'inherit', r.rolinherit)::text
from pg_roles r where r.rolname = session_user;
select set_config('role', 'anon', true) as login_role, set_config('request.jwt.claims', '{"role":"anon"}', true) as login_claims \gset
select 'adapter_discovery|' || count(*)::text from marketplace.list_marketplace_jobs();
rollback;
`

export const ISSUER_SQL = String.raw`insert into marketplace.trusted_identity_issuers (issuer, label, expected_audience, enabled)
values (:'issuer', 'LogLoads web server (normalized adapter)', :'audience', true)
on conflict (issuer) do nothing;
`

/** The role statements. The name is checked against ADAPTER_ROLE_PATTERN first; the verifier is base64 and `$:`. */
export function createRoleSql(role, verifier) {
  const settings = Object.entries(ADAPTER_ROLE_SETTINGS).map(([name, value]) => `alter role ${role} set ${name} = '${value}';`)

  return [
    "do $$",
    "begin",
    `  if exists (select 1 from pg_roles where rolname = '${role}') then`,
    "    raise exception 'the adapter login role already exists; nothing was changed' using errcode = '42710';",
    "  end if;",
    "end",
    "$$;",
    `create role ${role} with login noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls password '${verifier}';`,
    `grant anon, authenticated to ${role};`,
    ...settings,
    ""
  ].join("\n")
}

export function resetPasswordSql(role, verifier) {
  return `alter role ${role} password '${verifier}';\n`
}

const KEPT_PG_VARIABLES = new Set(["PGOPTIONS", "PGCONNECT_TIMEOUT", "PGSSLROOTCERT"])

/** The child environment for one psql run: the target's connection in PG* variables, nothing inherited that could redirect it. */
export function connectionEnvironment(parent, target) {
  const child = {}

  for (const [key, value] of Object.entries(parent)) {
    if (/^PG/i.test(key) && !KEPT_PG_VARIABLES.has(key.toUpperCase())) continue
    child[key] = value
  }

  Object.assign(child, {
    PGAPPNAME: "logloads-normalized-store",
    PGCLIENTENCODING: "UTF8",
    PGCONNECT_TIMEOUT: parent.PGCONNECT_TIMEOUT || "15",
    PGDATABASE: target.database,
    PGHOST: target.host,
    PGPORT: String(target.port),
    PGUSER: target.user
  })

  if (target.password) child.PGPASSWORD = target.password
  if (target.hosted || target.sslmode) child.PGSSLMODE = target.sslmode ?? "require"

  return child
}

function createPsql({ env, redact, spawnSync }) {
  return (target, args, input = "") => {
    const result = spawnSync("psql", ["-X", "-q", "-v", "ON_ERROR_STOP=1", ...args], {
      encoding: "utf8",
      env: connectionEnvironment(env, target),
      input,
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    })

    return {
      ok: !result.error && result.status === 0,
      status: result.status,
      stderr: redact(String(result.stderr ?? "")),
      stdout: redact(String(result.stdout ?? ""))
    }
  }
}

/** The lines worth showing from psql's output: errors with their detail, or notices with --verbose. */
function psqlLines(text, { notices = false, limit = 15 } = {}) {
  const wanted = notices ? /^(?:psql:.*)?(?:ERROR|NOTICE|WARNING|DETAIL|HINT):/ : /^(?:psql:.*)?(?:ERROR|FATAL|DETAIL|HINT):|^psql: error/

  return String(text)
    .split(/\r?\n/)
    .map((line) => line.replace(/^psql:.*?:\d+: /, ""))
    .filter((line) => wanted.test(line))
    .slice(0, limit)
}

export async function runNormalizedStore({
  argv,
  env = process.env,
  root = REPO_ROOT,
  spawnSync = nodeSpawnSync,
  stderr = (line) => process.stderr.write(`${line}\n`),
  stdout = (line) => process.stdout.write(`${line}\n`)
}) {
  const [command, ...rest] = argv

  if (!command || command === "--help" || command === "-h") {
    stdout(USAGE)
    return command ? 0 : 2
  }

  const refuseRun = (reason) => {
    stderr(`normalized-store: refused: ${reason}`)
    return 2
  }

  if (!COMMANDS.has(command)) return refuseRun(`unknown command ${command}; use status, schema or seed`)

  const parsed = parseArguments(rest, { switches: ["--apply", "--reset-adapter-password", "--verbose"], values: [EXPECTED_PROJECT_REF_FLAG] })

  if (!parsed.ok) return refuseRun(parsed.reason)
  if (parsed.positionals.length > 0) return refuseRun(`unexpected argument ${parsed.positionals[0]}`)

  const apply = parsed.switches.has("--apply")
  const resetPassword = parsed.switches.has("--reset-adapter-password")
  const verbose = parsed.switches.has("--verbose")

  if (apply && command === "status") return refuseRun("status is read-only; --apply belongs to schema or seed")
  if (resetPassword && command !== "schema") return refuseRun("--reset-adapter-password belongs to schema")

  const targets = checkTargets({ env, expectedRef: parsed.options[EXPECTED_PROJECT_REF_FLAG] })
  const redact = createRedactor([
    env.DATABASE_URL?.trim(),
    env.LOGLOADS_NORMALIZED_DATABASE_URL?.trim(),
    targets.ok ? targets.migration.password : null,
    targets.ok ? targets.adapter.password : null
  ])
  const log = (line) => stdout(redact(line))
  const fail = (line) => {
    stderr(redact(`normalized-store: ${line}`))
    return 1
  }

  if (!targets.ok) return refuseRun(redact(targets.reason))

  const identity = identityFromEnvironment(env)

  if (!identity.ok) return refuseRun(identity.reason)

  const { adapter, migration } = targets
  const psql = createPsql({ env, redact, spawnSync })
  const variables = ["-v", `issuer=${identity.issuer}`, "-v", `audience=${identity.audience}`, "-v", `adapter_role=${adapter.role}`]

  const version = spawnSync("psql", ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true })

  if (version.error || version.status !== 0) {
    return fail("psql is not on PATH; install the PostgreSQL client (17 recommended): https://www.postgresql.org/download/")
  }

  const readState = (target = migration) => {
    const result = psql(target, ["-t", "-A", ...variables, "-f", "-"], STATE_SQL)

    return result.ok ? { ok: true, state: parseStateLines(result.stdout) } : { ok: false, lines: psqlLines(result.stderr) }
  }

  log(`normalized-store: ${command}${apply ? " --apply" : command === "status" ? " (read-only)" : " (dry run: nothing is changed)"}. Values are never printed.`)
  log(`target       project ${targets.ref} (${migration.kind}), database ${migration.database}, migration role ${migration.role}`)
  log(`adapter      login role ${adapter.role} (${adapter.kind}), from LOGLOADS_NORMALIZED_DATABASE_URL`)
  log(`psql         ${String(version.stdout).trim().replace(/^psql \(PostgreSQL\) /, "")}`)

  const initial = readState()

  if (!initial.ok) {
    for (const line of initial.lines) log(`             ${line}`)
    return fail("could not read the target database's state; check DATABASE_URL and that the project is not paused")
  }

  let state = initial.state
  const describe = (current) => {
    const schemaPlan = computeSchemaPlan(current)
    const issuerPlan = computeIssuerPlan(current.issuer, identity)
    const role = assessRole(current.role)

    return { issuerPlan, role, schemaPlan, seedPlan: computeSeedPlan(current, schemaPlan, issuerPlan) }
  }
  let plans = describe(state)

  const schemaLine = (plan) => {
    if (plan.status === "conflict") return `schema       REFUSED: ${plan.reason}`
    if (plan.status === "current") return `schema       up to date (ledger ${LEDGER_CHAIN.join(",")})`

    return `schema       pending: ${plan.pending.map((entry) => entry.file).join(", ")}`
  }
  const roleLine = ({ role }) => {
    if (role.status === "absent") return `role         ${adapter.role} is absent`
    if (role.status === "unsafe") return `role         REFUSED: ${adapter.role} ${role.problems.join("; ")} (docs/SECURITY.md §4.1); it is never altered here`

    return `role         ${adapter.role} is present and meets docs/SECURITY.md §4.1`
  }
  const issuerLine = ({ issuerPlan }) =>
    issuerPlan.action === "conflict"
      ? `issuer       REFUSED: ${issuerPlan.reason}`
      : `issuer       the LOGLOADS_NORMALIZED_IDENTITY_ISSUER row is ${issuerPlan.action === "present" ? "registered, with its audience pinned" : "not registered yet"}`
  const seedLine = ({ seedPlan }) =>
    seedPlan.action === "present"
      ? "seed         the synthetic pilot demo seed is loaded"
      : seedPlan.action === "load"
        ? "seed         not loaded (the store is empty)"
        : `seed         ${command === "seed" ? "REFUSED: " : "cannot load: "}${seedPlan.reason}`

  const server = typeof state.server === "number" ? `${Math.floor(state.server / 10000)}.${state.server % 10000}` : "?"

  log(`state        PostgreSQL ${server}; marketplace schema ${state.schema ? `present (${state.objects ?? 0} objects)` : "absent"}`)
  log(schemaLine(plans.schemaPlan))
  log(issuerLine(plans))
  log(roleLine(plans))

  const adapterLogin = () => {
    const result = psql(adapter, ["-t", "-A", "-f", "-"], ADAPTER_LOGIN_SQL)

    if (!result.ok) {
      for (const line of psqlLines(result.stderr)) log(`             ${line}`)
      log("login        FAILED as the adapter role: the password in LOGLOADS_NORMALIZED_DATABASE_URL, the host or the pooler is wrong (schema --apply --reset-adapter-password resets the password)")
      return false
    }

    const facts = parseStateLines(result.stdout)
    const login = facts.adapter_login ?? {}
    const safe = login.user === adapter.role && login.superuser === false && login.bypassrls === false && login.inherit === false

    log(
      safe
        ? `login        as ${adapter.role}: NOINHERIT, no superuser or BYPASSRLS; as anon, public discovery returned ${facts.adapter_discovery ?? 0} job(s)`
        : `login        FAILED: the adapter's login is not the restricted role ${adapter.role}`
    )
    return safe && typeof facts.adapter_discovery === "number"
  }

  // ------------------------------------------------------------------------------------------- status
  if (command === "status") {
    log(seedLine(plans))
    const ready = plans.schemaPlan.status === "current" && plans.issuerPlan.action === "present" && plans.role.status === "compliant"
    const invariants = ready && state.inv_rls === true && state.inv_public_execute === true && state.inv_search_path === true

    if (ready) log(`checks       RLS on every table, no function executable by PUBLIC, SECURITY DEFINER search_path pinned: ${invariants ? "ok" : "FAILED"}`)

    const loggedIn = ready && invariants && adapterLogin()

    log(loggedIn ? "Result: the normalized store is ready for the adapter." : "Result: not ready; follow the lines above (docs/INTEGRATIONS.md §15).")
    return loggedIn ? 0 : 1
  }

  // ------------------------------------------------------------------------------------------- seed
  if (command === "seed") {
    log(seedLine(plans))

    if (plans.seedPlan.action === "conflict") return fail("nothing was changed")
    if (plans.seedPlan.action === "present") {
      log("Result: the seed is already loaded; it is never loaded twice.")
      return 0
    }

    if (!apply) {
      log("plan         load 4 synthetic businesses (pilot ids), 9 people linked to their pilot Clerk ids under the adapter's issuer,")
      log("             2 landings with private details, 5 jobs (3 open), 6 trucks and 1 availability report, in one transaction")
      log("Result: dry run only. Re-run with --apply to load the seed (staging or a disposable database only).")
      return 0
    }

    const result = psql(migration, ["-t", "-A", "-v", "VERBOSITY=verbose", ...variables, "--single-transaction", "-f", resolve(root, SEED_FILE)])

    if (!result.ok) {
      for (const line of psqlLines(result.stderr)) log(`             ${line}`)
      return fail("the seed failed and was rolled back; nothing was changed")
    }

    for (const line of result.stdout.split(/\r?\n/).filter((entry) => entry.startsWith("seed|"))) log(`seed         ${line.slice(5)}`)

    const after = readState()

    if (!after.ok || Number(after.state.seed) !== 1) return fail("the seed reported success but its marker is not readable")

    log("Result: the synthetic pilot demo seed is loaded. It is not real activity.")
    return 0
  }

  // ------------------------------------------------------------------------------------------- schema
  if (plans.schemaPlan.status === "conflict" || plans.issuerPlan.action === "conflict" || plans.role.status === "unsafe") {
    return fail("nothing was changed")
  }

  const roleAction = plans.role.status === "absent" ? "create" : resetPassword ? "reset-password" : "keep"
  const pending = plans.schemaPlan.status === "current" ? [] : plans.schemaPlan.pending

  if (pending.some((entry) => entry.file.startsWith("18_"))) {
    log("note         18 revokes EXECUTE from PUBLIC on every function the migration role creates later, in every schema of")
    log("             this database (architecture/normalized-v2/ARCHITECTURE.md §4, deployment note)")
  }

  log(`plan         ${pending.length === 0 ? "no migration to apply" : `apply ${pending.length} file(s), each in one transaction, in CI's order`}`)
  log(`plan         ${plans.issuerPlan.action === "register" ? "register the issuer row (enabled, audience pinned)" : "keep the issuer row"}`)
  log(
    `plan         ${
      roleAction === "create"
        ? `create ${adapter.role}: LOGIN NOINHERIT, member of anon and authenticated only, statement_timeout ${ADAPTER_ROLE_SETTINGS.statement_timeout}`
        : roleAction === "reset-password"
          ? `reset the password of ${adapter.role} to the one in LOGLOADS_NORMALIZED_DATABASE_URL`
          : `keep ${adapter.role} and its password`
    }`
  )

  if (!apply) {
    log("Result: dry run only. Re-run with --apply to make these changes.")
    return 0
  }

  for (const entry of pending) {
    const started = Date.now()
    const result = psql(migration, ["-v", "VERBOSITY=verbose", "--single-transaction", "-f", resolve(root, MIGRATION_DIR, entry.file)])

    if (verbose || !result.ok) {
      for (const line of psqlLines(`${result.stdout}\n${result.stderr}`, { limit: verbose ? 200 : 15, notices: verbose })) log(`             ${line}`)
    }

    if (!result.ok) return fail(`${entry.file} failed and was rolled back; the files before it stay applied (the ledger records them). Fix the cause and re-run`)

    log(`applied      ${entry.file} (${Math.round((Date.now() - started) / 1000)}s)`)
  }

  if (plans.issuerPlan.action === "register") {
    const result = psql(migration, [...variables, "--single-transaction", "-f", "-"], ISSUER_SQL)

    if (!result.ok) {
      for (const line of psqlLines(result.stderr)) log(`             ${line}`)
      return fail("registering the issuer row failed")
    }

    log("applied      issuer row registered")
  }

  if (roleAction !== "keep") {
    const verifier = scramSha256Verifier(adapter.password)
    const quiet = createRedactor([verifier])
    const sql = roleAction === "create" ? createRoleSql(adapter.role, verifier) : resetPasswordSql(adapter.role, verifier)
    const result = psql(migration, ["--single-transaction", "-f", "-"], sql)

    if (!result.ok) {
      for (const line of psqlLines(quiet(result.stderr))) log(`             ${quiet(line)}`)
      return fail(`${roleAction === "create" ? "creating" : "resetting the password of"} ${adapter.role} failed and was rolled back`)
    }

    log(`applied      ${adapter.role} ${roleAction === "create" ? "created" : "password reset"} (sent as a SCRAM-SHA-256 verifier)`)
  }

  const after = readState()

  if (!after.ok) return fail("could not re-read the database after applying")

  state = after.state
  plans = describe(state)
  log(schemaLine(plans.schemaPlan))
  log(issuerLine(plans))
  log(roleLine(plans))

  const invariants = state.inv_rls === true && state.inv_public_execute === true && state.inv_search_path === true

  log(`checks       RLS on every table, no function executable by PUBLIC, SECURITY DEFINER search_path pinned: ${invariants ? "ok" : "FAILED"}`)

  if (plans.schemaPlan.status !== "current" || plans.issuerPlan.action !== "present" || plans.role.status !== "compliant" || !invariants) {
    return fail("the store is not in the expected state after applying")
  }

  if (!adapterLogin()) return fail("the adapter cannot use the store yet")

  log(`Result: the normalized store is deployed to project ${targets.ref}. Next: seed (staging only) or point the app at it (docs/INTEGRATIONS.md §15).`)
  return 0
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runNormalizedStore({ argv: process.argv.slice(2) }).then((code) => {
    process.exitCode = code
  })
}
