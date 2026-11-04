import "server-only"

import type { Sql, TransactionSql } from "postgres"

import { marketplaceQueryStatement, type MarketplaceQueryName, type MarketplaceQueryValue } from "./normalized-queries"
import { MarketplaceAdapterConfigurationError, MarketplaceRefusalError, MarketplaceStoreError } from "./port"

/**
 * How the server reaches the normalized `marketplace` schema (architecture/normalized-v2).
 *
 * Identity path (docs/SECURITY.md §4): the server authenticates the person through its own session (Clerk, verified by
 * the Clerk SDK) and then calls the schema's functions AS that person. Every call runs in its own transaction that:
 *
 *   1. switches to the database role `authenticated` (or `anon` for public discovery) with `set_config('role', …, true)`;
 *   2. sets `request.jwt.claims` to the session's issuer, Clerk user id and audience, with a 60-second expiry;
 *
 * exactly as PostgREST does after verifying a token. `marketplace.current_user_id()` then resolves the person through
 * `trusted_identity_issuers` and `identity_links`, and every function and row-level security policy applies to them.
 * Both settings are transaction-local, so a pooled connection never carries one person's identity into the next call.
 *
 * The connection's own login role must be unable to do anything by itself: no superuser, no BYPASSRLS, no inherited
 * privileges, no ownership of anything in the schema, no membership of `service_role` or of any superuser, BYPASSRLS
 * or CREATEROLE role, and no membership of any role beyond what `anon` and `authenticated` already reach (HF-22).
 * `checkCredential` proves this on first use and refuses to run otherwise. This is not a service-role path: the
 * service role holds no EXECUTE on any user function in this schema, and this adapter never uses it.
 *
 * Only the functions in `MARKETPLACE_FUNCTIONS` can be called, with their declared argument names and types; every
 * value is a bound parameter. Rows come back as `to_jsonb(row)`, the same JSON PostgREST returns, so the mapping in
 * `normalized-mapping.ts` does not depend on this driver.
 */

export interface MarketplacePrincipal {
  /** An enabled `marketplace.trusted_identity_issuers` row: the Clerk instance's issuer for this environment. */
  issuer: string
  /** The session's Clerk user id (`identity_links.subject`). */
  subject: string
  /** The issuer's pinned `expected_audience` (LE-09). */
  audience: string
}

type ArgumentType = "uuid" | "text" | "integer" | "bigint" | "numeric" | "boolean" | "date" | "jsonb" | "text[]"

interface FunctionSpec {
  args: Readonly<Record<string, ArgumentType>>
  /** Callable in an anonymous (public discovery) session. */
  anonymous: boolean
  /** `rows`: a set-returning function; `value`: one scalar; `void`: nothing. */
  returns: "rows" | "value" | "void"
}

/** The closed list of database functions the adapter may call. Names and argument names match the SQL exactly. */
export const MARKETPLACE_FUNCTIONS = {
  get_marketplace_job: { anonymous: true, args: { p_job_id: "uuid" }, returns: "rows" },
  get_viewer_marketplace_access: { anonymous: false, args: { p_org_id: "uuid" }, returns: "rows" },
  list_authoring_landings: { anonymous: false, args: { p_org_id: "uuid" }, returns: "rows" },
  list_hauler_equipment_options: { anonymous: false, args: { p_org_id: "uuid" }, returns: "rows" },
  list_marketplace_interests: { anonymous: false, args: { p_job_id: "uuid", p_org_id: "uuid", p_side: "text" }, returns: "rows" },
  list_marketplace_jobs: {
    anonymous: true,
    args: { p_accepting_only: "boolean", p_equipment: "text", p_limit: "integer", p_pay_unit: "text", p_query: "text" },
    returns: "rows"
  },
  post_hauler_interest_reply: { anonymous: false, args: { p_body: "text", p_interest_id: "uuid", p_reply_id: "uuid" }, returns: "void" },
  publish_job_posting: {
    anonymous: false,
    args: {
      p_attest_available: "boolean",
      p_description: "text",
      p_destination_label: "text",
      p_duration_days: "integer",
      p_equipment_codes: "text[]",
      p_est_daily_loads: "integer",
      p_est_loads_per_truck_per_day: "numeric",
      p_est_one_way_miles: "integer",
      p_est_tons_per_load: "numeric",
      p_landing_id: "uuid",
      p_pay_amount_cents: "bigint",
      p_pay_note: "text",
      p_pay_unit: "text",
      p_product: "text",
      p_public_road_notes: "text",
      p_title: "text",
      p_trucks_per_day: "integer",
      p_trucks_requested: "integer",
      p_work_starts_on: "date"
    },
    returns: "value"
  },
  reconfirm_job_posting: { anonymous: false, args: { p_job_id: "uuid" }, returns: "value" },
  respond_to_interest: {
    anonymous: false,
    args: { p_body: "text", p_interest_id: "uuid", p_reply_id: "uuid", p_status: "text" },
    returns: "void"
  },
  submit_expression_of_interest: {
    anonymous: false,
    args: {
      p_available_from: "date",
      p_available_until: "date",
      p_contact_preference: "text",
      p_equipment: "jsonb",
      p_hauler_org_id: "uuid",
      p_job_id: "uuid",
      p_message: "text",
      p_trucks_offered: "integer"
    },
    returns: "rows"
  },
  withdraw_interest: { anonymous: false, args: { p_interest_id: "uuid" }, returns: "void" }
} as const satisfies Record<string, FunctionSpec>

export type MarketplaceFunctionName = keyof typeof MARKETPLACE_FUNCTIONS

export type MarketplaceArgumentValue = string | number | boolean | null | undefined | readonly string[] | readonly object[]

export type MarketplaceCallArguments<F extends MarketplaceFunctionName> = {
  [K in keyof (typeof MARKETPLACE_FUNCTIONS)[F]["args"]]?: MarketplaceArgumentValue
}

/** The two organizations an inquiry belongs to, as the caller's row-level security lets them see it. */
export interface MarketplaceInquiryParties {
  jobId: string
  jobOrganizationId: string
  haulerOrganizationId: string
}

/** The reasons `marketplace.abuse_reports.reason` accepts (01_schema.sql). */
export type StoredAbuseReason = "inaccurate_pay" | "nonexistent_job" | "spam" | "impersonation" | "unsafe_disclosure" | "abuse" | "other"

/** A report row the reporter may read back (HF-16 grants the reporter these columns of their own reports). */
export interface StoredListingReport {
  id: string
  createdAt: string
}

/** What a unit of work can do inside one identity-bound transaction. */
export interface MarketplaceCalls {
  /** Rows as JSON objects (`rows`), `[value]` (`value`) or `[]` (`void`). */
  call<F extends MarketplaceFunctionName>(fn: F, args: MarketplaceCallArguments<F>): Promise<unknown[]>
  inquiryParties(interestId: string): Promise<MarketplaceInquiryParties | null>
  /** Rows (JSON objects) of one catalogued table statement (`MARKETPLACE_QUERIES`, normalized-queries.ts). */
  query(name: MarketplaceQueryName, values: readonly MarketplaceQueryValue[]): Promise<unknown[]>
  /**
   * UX-09 (#132): the organization's jobs that have inquiries, as `INQUIRY_JOBS` rows (JSON). Row-level security
   * applies as for any direct read: only the owning desk sees them.
   */
  inquiryJobs(organizationId: string): Promise<unknown[]>
  /**
   * #213: the person the claims resolve to (`VIEWER_PERSON`, or `null` when they resolve to no one) and that person's
   * active memberships of active businesses (`VIEWER_MEMBERSHIPS`, `get_viewer_marketplace_access` rows), as JSON.
   */
  viewerSession(): Promise<{ person: unknown; memberships: unknown[] }>

  // --- Listing reports (UX-07, #130): the schema has no function for these, so they are two fixed statements that
  // run as the person under `abuse_reports`' row-level security and column grants (02_access.sql, HF-16).
  /** The person's own open or in-review report of a job posting, if any. */
  standingListingReport(jobId: string): Promise<StoredListingReport | null>
  /** Files a report of a job posting. The reporter is always the caller (`abuse_reports_insert`, default column). */
  fileListingReport(report: { jobId: string; reason: StoredAbuseReason; details: string | null }): Promise<StoredListingReport>
}

export interface MarketplaceDb {
  /** Public discovery: the `anon` role, no identity, read-only. */
  asAnon<T>(work: (calls: MarketplaceCalls) => Promise<T>): Promise<T>
  /** One transaction as the given person (`authenticated` role). Read-only unless `readOnly` is false. */
  asUser<T>(principal: MarketplacePrincipal, work: (calls: MarketplaceCalls) => Promise<T>, options?: { readOnly?: boolean }): Promise<T>
  close(): Promise<void>
}

const CLAIMS_TTL_SECONDS = 60
const ANON_CLAIMS = JSON.stringify({ role: "anon" })

/** One round trip: no search path (every name is schema-qualified), the API role, and the claims. */
const SESSION_SETUP =
  "select set_config('search_path', '', true), set_config('role', $1::text, true), set_config('request.jwt.claims', $2::text, true)"

const INQUIRY_PARTIES =
  "select to_jsonb(e) as row from (select id, job_id, job_org_id, hauler_org_id from marketplace.expressions_of_interest where id = $1::text::uuid) as e"

/**
 * UX-09 (#132): the organization's jobs that have inquiries, with the landing each is posted at and the equipment
 * codes it asks for. Only existing columns, read under the caller's row-level security (`job_postings_read`,
 * `landings_read`, `job_equipment_read`, `interests_read`): a person outside the organization's landing desk gets no
 * rows. Never `landing_private_details`.
 */
const INQUIRY_JOBS = `
select to_jsonb(j) as row from (
  select jp.id as job_id,
         l.id as landing_id,
         l.name as landing_name,
         coalesce((select array_agg(e.equipment_code::text order by e.equipment_code)
                   from marketplace.job_posting_equipment e where e.job_id = jp.id), array[]::text[]) as equipment_codes
  from marketplace.job_postings jp
  left join marketplace.landings l on l.id = jp.landing_id
  where jp.org_id = $1::text::uuid
    and exists (select 1 from marketplace.expressions_of_interest i where i.job_id = jp.id and i.job_org_id = jp.org_id)
  order by jp.id
) as j`

/**
 * #213: the person `current_user_id()` resolves the claims to, with their email only once a provider verified it.
 * Row-level security (`app_users_read`, `user_contacts_self_or_support`) shows a person their own rows.
 */
const VIEWER_PERSON = `
select to_jsonb(u) as row from (
  select a.id,
         a.display_name,
         (select c.email from marketplace.user_contacts c where c.user_id = a.id and c.email_verified_at is not null) as email
  from marketplace.app_users a
  where a.id = marketplace.current_user_id()
) as u`

/**
 * #213: the person's active memberships of active businesses, oldest first, each as the schema's own
 * `get_viewer_marketplace_access` row (role, seat, hauler profile and capabilities). `memberships_read` and
 * `organizations_read` show a person their own memberships and businesses; the function re-checks both. One
 * statement, so every row comes from one snapshot: a membership removed or a business suspended before it runs is
 * simply absent.
 */
const VIEWER_MEMBERSHIPS = `
with mine as materialized (
  select m.org_id, m.created_at
  from marketplace.organization_memberships m
  join marketplace.organizations o on o.id = m.org_id and o.status = 'active'
  where m.user_id = marketplace.current_user_id()
    and m.status = 'active'
)
select to_jsonb(a) as row
from mine
cross join lateral marketplace.get_viewer_marketplace_access(mine.org_id) as a
order by mine.created_at, mine.org_id`

/**
 * Listing reports (UX-07, #130). Only the reporter's own reports are read (`reporter_user_id = current_user_id()`;
 * a platform admin could otherwise see everyone's), and only the columns HF-16 grants. The insert names only the
 * columns `authenticated` may write; `reporter_user_id` takes its default, the caller.
 */
export const STANDING_LISTING_REPORT =
  "select to_jsonb(r) as row from (select id, created_at from marketplace.abuse_reports" +
  " where reporter_user_id = marketplace.current_user_id() and target_kind = 'job_posting' and target_id = $1::text::uuid" +
  " and status in ('open', 'reviewing') order by created_at desc limit 1) as r"

export const FILE_LISTING_REPORT =
  "with r as (insert into marketplace.abuse_reports (target_kind, target_id, reason, details)" +
  " values ('job_posting', $1::text::uuid, $2::text, $3::text) returning id, created_at)" +
  " select to_jsonb(r) as row from r"

function storedReport(row: unknown): StoredListingReport | null {
  const record = row as Record<string, unknown> | undefined
  return record && typeof record.id === "string" && typeof record.created_at === "string" ? { createdAt: record.created_at, id: record.id } : null
}

/** What the connection's login role may be: nothing by itself, and able to become only `anon` and `authenticated`. */
export const CREDENTIAL_CHECK = `
select to_jsonb(c) as row from (
  select r.rolsuper as superuser,
         r.rolbypassrls as bypass_rls,
         r.rolinherit as inherits,
         r.rolcreaterole as create_role,
         r.rolreplication as replication,
         coalesce((select pg_has_role(r.oid, x.oid, 'MEMBER') from pg_roles x where x.rolname = 'service_role'), false) as service_role_member,
         coalesce((select pg_has_role(r.oid, x.oid, 'SET') from pg_roles x where x.rolname = 'authenticated'), false) as can_become_authenticated,
         coalesce((select pg_has_role(r.oid, x.oid, 'SET') from pg_roles x where x.rolname = 'anon'), false) as can_become_anon,
         exists (select 1 from pg_namespace n where n.nspname = 'marketplace' and n.nspowner = r.oid) as owns_marketplace,
         -- HF-22: owning any table, view, sequence, function or type in the schema also bypasses its RLS and grants.
         (exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                  where n.nspname = 'marketplace' and c.relowner = r.oid)
          or exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                     where n.nspname = 'marketplace' and p.proowner = r.oid)
          or exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                     where n.nspname = 'marketplace' and t.typowner = r.oid)) as owns_marketplace_objects,
         -- HF-22: any role the login role can reach that anon or authenticated cannot (for example
         -- pg_write_all_data, pg_execute_server_program or a table-owning role) is refused.
         coalesce((select array_agg(p.rolname::text order by p.rolname)
                   from pg_roles p
                   where p.oid <> r.oid
                     and pg_has_role(r.oid, p.oid, 'MEMBER')
                     and not exists (select 1 from pg_roles a
                                     where a.rolname in ('anon', 'authenticated') and pg_has_role(a.oid, p.oid, 'MEMBER'))),
                  array[]::text[]) as other_memberships,
         -- HF-22: membership, direct or through other roles, of any role that is a superuser, bypasses RLS or can
         -- create roles (for example postgres or supabase_admin) is refused even though NOINHERIT withholds its
         -- privileges, because the login role could SET ROLE to it.
         coalesce((select array_agg(p.rolname::text order by p.rolname)
                   from pg_roles p
                   where p.oid <> r.oid
                     and (p.rolsuper or p.rolbypassrls or p.rolcreaterole)
                     and pg_has_role(r.oid, p.oid, 'MEMBER')), array[]::text[]) as privileged_memberships
  from pg_roles r
  -- The login role itself: a role set at connection time (startup options) cannot stand in for it.
  where r.rolname = session_user
) as c`

export interface CredentialFacts {
  superuser: boolean
  bypass_rls: boolean
  inherits: boolean
  create_role: boolean
  replication: boolean
  service_role_member: boolean
  can_become_authenticated: boolean
  can_become_anon: boolean
  owns_marketplace: boolean
  /** It owns a table, view, sequence, function or type in the `marketplace` schema. */
  owns_marketplace_objects: boolean
  /** Roles with superuser, BYPASSRLS or CREATEROLE that the login role belongs to, directly or indirectly. */
  privileged_memberships: string[]
  /** Roles the login role belongs to, directly or indirectly, that neither anon nor authenticated reaches. */
  other_memberships: string[]
}

/** The reasons a login role is unsafe for this adapter; empty when it is safe. */
export function credentialProblems(facts: CredentialFacts | null | undefined): string[] {
  if (!facts) {
    return ["the login role could not be inspected"]
  }

  return [
    facts.superuser && "it is a superuser",
    facts.bypass_rls && "it bypasses row-level security",
    facts.inherits && "it inherits the privileges of roles it belongs to (use NOINHERIT)",
    facts.create_role && "it can create roles",
    facts.replication && "it is a replication role",
    facts.service_role_member && "it is a member of service_role",
    !facts.can_become_authenticated && "it cannot switch to the authenticated role",
    !facts.can_become_anon && "it cannot switch to the anon role",
    facts.owns_marketplace && "it owns the marketplace schema",
    facts.owns_marketplace_objects !== false && "it owns objects in the marketplace schema",
    (!Array.isArray(facts.privileged_memberships) || facts.privileged_memberships.length > 0) &&
      `it belongs to a privileged role (${Array.isArray(facts.privileged_memberships) ? facts.privileged_memberships.join(", ") : "unknown"})`,
    (!Array.isArray(facts.other_memberships) || facts.other_memberships.length > 0) &&
      `it belongs to roles other than anon and authenticated (${Array.isArray(facts.other_memberships) ? facts.other_memberships.join(", ") : "unknown"})`
  ].filter((problem): problem is string => typeof problem === "string")
}

function principalField(value: unknown, name: string, min: number, max: number): string {
  const text = typeof value === "string" ? value.trim() : ""

  if (text.length < min || text.length > max) {
    throw new MarketplaceAdapterConfigurationError(`The marketplace identity ${name} is missing or invalid`)
  }

  return text
}

/** `request.jwt.claims` for one person, as Supabase would set them from a verified Clerk session token. */
export function principalClaims(principal: MarketplacePrincipal, now = Date.now()): string {
  const iat = Math.floor(now / 1000)

  return JSON.stringify({
    aud: principalField(principal.audience, "audience", 1, 200),
    exp: iat + CLAIMS_TTL_SECONDS,
    iat,
    iss: principalField(principal.issuer, "issuer", 8, 300),
    role: "authenticated",
    sub: principalField(principal.subject, "subject", 1, 255)
  })
}

function serialize(value: MarketplaceArgumentValue, type: ArgumentType, name: string): string | null {
  if (value === null || value === undefined) {
    return null
  }

  switch (type) {
    case "uuid":
    case "text":
    case "date":
      if (typeof value !== "string") break
      return value
    case "integer":
    case "bigint":
      if (typeof value !== "number" || !Number.isSafeInteger(value)) break
      return String(value)
    case "numeric":
      if (typeof value !== "number" || !Number.isFinite(value)) break
      return String(value)
    case "boolean":
      if (typeof value !== "boolean") break
      return value ? "true" : "false"
    case "jsonb":
      return JSON.stringify(value)
    case "text[]":
      if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) break
      return JSON.stringify(value)
  }

  throw new TypeError(`Argument ${name} must be a ${type}`)
}

/**
 * The SQL for one catalogued call, with named arguments and bound values. Undefined arguments are left out so the
 * function's own default applies. Pure; exported for tests.
 */
export function marketplaceCallStatement<F extends MarketplaceFunctionName>(
  fn: F,
  args: MarketplaceCallArguments<F>
): { text: string; values: Array<string | null> } {
  if (!Object.prototype.hasOwnProperty.call(MARKETPLACE_FUNCTIONS, fn)) {
    throw new TypeError(`${String(fn)} is not a catalogued marketplace function`)
  }

  const spec: FunctionSpec = MARKETPLACE_FUNCTIONS[fn]
  const values: Array<string | null> = []
  const named = Object.entries(args as Record<string, MarketplaceArgumentValue>)
    .filter(([, value]) => value !== undefined)
    .map(([name, value]) => {
      const type = Object.prototype.hasOwnProperty.call(spec.args, name) ? spec.args[name] : undefined

      if (!type) {
        throw new TypeError(`${name} is not an argument of marketplace.${String(fn)}`)
      }

      const serialized = serialize(value, type, name)

      if (serialized === null) {
        return `${name} => null::${type}`
      }

      values.push(serialized)
      // Every parameter is sent as text and converted by the server. Typing the placeholder directly ($1::jsonb,
      // $1::boolean, $1::date) would make the driver apply its own serializer to the already-serialized value.
      const placeholder = `$${values.length}::text`

      if (type === "text") {
        return `${name} => ${placeholder}`
      }

      return type === "text[]"
        ? `${name} => array(select jsonb_array_elements_text(${placeholder}::jsonb))`
        : `${name} => ${placeholder}::${type}`
    })

  const call = `marketplace.${String(fn)}(${named.join(", ")})`
  const text = spec.returns === "rows"
    ? `select to_jsonb(r) as row from ${call} as r`
    : spec.returns === "value"
      ? `select to_jsonb(${call}) as value`
      : `select 1 as done from ${call} as r`

  return { text, values }
}

const REFUSAL_CODES = new Set(["23514", "42501", "P0002"])
const NOT_ALLOWED = "This is not available to your account."
const CONFLICT = "This changed while you were working on it. Reload the page and try again."

function sqlState(error: unknown): string | null {
  if (!error || typeof error !== "object") return null
  const candidate = error as { name?: unknown; code?: unknown }
  return candidate.name === "PostgresError" && typeof candidate.code === "string" && /^[0-9A-Z]{5}$/.test(candidate.code)
    ? candidate.code
    : null
}

/**
 * Store errors become errors that are safe to show. Business-rule (23514), access (42501) and not-found (P0002)
 * refusals keep the database's message, which is written for people; a bare grant failure ("permission denied …")
 * becomes a plain refusal. Everything else — malformed input, conflicts, timeouts, connection failures — becomes a
 * generic error whose message names no host, role, table or value.
 */
export function translateStoreError(error: unknown): Error {
  if (
    error instanceof MarketplaceRefusalError ||
    error instanceof MarketplaceStoreError ||
    error instanceof MarketplaceAdapterConfigurationError
  ) {
    return error
  }

  const code = sqlState(error)

  if (code && REFUSAL_CODES.has(code)) {
    const text = error instanceof Error ? error.message.trim() : ""

    return new MarketplaceRefusalError(!text || /^permission denied/i.test(text) ? NOT_ALLOWED : text.slice(0, 300), code)
  }

  if (code === "23505" || code === "40001" || code === "40P01") {
    return new MarketplaceRefusalError(CONFLICT, code)
  }

  return new MarketplaceStoreError(undefined, code, error)
}

function rowsOf(result: readonly unknown[], column: "row" | "value"): unknown[] {
  return result.map((record) => (record as Record<string, unknown>)[column])
}

function callsFor(tx: TransactionSql, anonymous: boolean): MarketplaceCalls {
  return {
    async call(fn, args) {
      if (anonymous && !MARKETPLACE_FUNCTIONS[fn].anonymous) {
        throw new TypeError(`marketplace.${fn} needs a signed-in person`)
      }

      const { text, values } = marketplaceCallStatement(fn, args)
      const result = await tx.unsafe(text, values)
      const returns = MARKETPLACE_FUNCTIONS[fn].returns

      return returns === "rows" ? rowsOf(result, "row") : returns === "value" ? rowsOf(result, "value").slice(0, 1) : []
    },

    async inquiryParties(interestId) {
      if (anonymous) {
        throw new TypeError("Inquiries need a signed-in person")
      }

      const [row] = rowsOf(await tx.unsafe(INQUIRY_PARTIES, [interestId]), "row") as Array<Record<string, unknown> | undefined>

      if (!row || typeof row.job_id !== "string" || typeof row.job_org_id !== "string" || typeof row.hauler_org_id !== "string") {
        return null
      }

      return { haulerOrganizationId: row.hauler_org_id, jobId: row.job_id, jobOrganizationId: row.job_org_id }
    },

    async query(name, values) {
      if (anonymous) {
        throw new TypeError(`${name} needs a signed-in person`)
      }

      const statement = marketplaceQueryStatement(name, values)
      return rowsOf(await tx.unsafe(statement.text, statement.values), "row")
    },

    async inquiryJobs(organizationId) {
      if (anonymous) {
        throw new TypeError("Inquiries need a signed-in person")
      }

      return rowsOf(await tx.unsafe(INQUIRY_JOBS, [organizationId]), "row")
    },

    async viewerSession() {
      if (anonymous) {
        throw new TypeError("A session needs a signed-in person")
      }

      const [person] = rowsOf(await tx.unsafe(VIEWER_PERSON), "row")

      // No person, no memberships: claims that resolve to no one read nothing, so the second query is not run.
      return person ? { memberships: rowsOf(await tx.unsafe(VIEWER_MEMBERSHIPS), "row"), person } : { memberships: [], person: null }
    },

    async standingListingReport(jobId) {
      if (anonymous) {
        throw new TypeError("Reports need a signed-in person")
      }

      const [row] = rowsOf(await tx.unsafe(STANDING_LISTING_REPORT, [jobId]), "row")
      return storedReport(row)
    },

    async fileListingReport({ details, jobId, reason }) {
      if (anonymous) {
        throw new TypeError("Reports need a signed-in person")
      }

      const [row] = rowsOf(await tx.unsafe(FILE_LISTING_REPORT, [jobId, reason, details]), "row")
      const report = storedReport(row)

      if (!report) {
        throw new MarketplaceStoreError()
      }

      return report
    }
  }
}

export interface PostgresMarketplaceDbOptions {
  /** A connection string for the restricted login role. Never printed. */
  url?: string
  /** An existing postgres.js client (tests). Its connection must belong to the same kind of restricted role. */
  sql?: Sql
  /** Pool size when `url` is given. */
  max?: number
}

async function connect(url: string, max: number): Promise<Sql> {
  const { default: postgres } = await import("postgres")

  return postgres(url, {
    connect_timeout: 10,
    connection: { application_name: "logloads-web-marketplace-v2" },
    idle_timeout: 30,
    max,
    onnotice: () => undefined,
    // Transaction-mode poolers (Supabase Supavisor) do not keep prepared statements between transactions.
    prepare: false
  })
}

/** The normalized store over a direct PostgreSQL connection (postgres.js). */
export function createPostgresMarketplaceDb(options: PostgresMarketplaceDbOptions): MarketplaceDb {
  if (!options.sql && !options.url) {
    throw new MarketplaceAdapterConfigurationError("The normalized marketplace store has no connection configured")
  }

  let client: Promise<Sql> | null = null
  let checked = false

  async function ready(): Promise<Sql> {
    client ??= options.sql ? Promise.resolve(options.sql) : connect(options.url as string, options.max ?? 5)
    const sql = await client

    if (!checked) {
      const [facts] = rowsOf(await sql.unsafe(CREDENTIAL_CHECK), "row") as Array<CredentialFacts | undefined>
      const problems = credentialProblems(facts)

      if (problems.length > 0) {
        throw new MarketplaceAdapterConfigurationError(
          `The normalized marketplace connection is refused because its login role is unsafe: ${problems.join("; ")}`
        )
      }

      checked = true
    }

    return sql
  }

  async function run<T>(mode: "read only" | "read write", role: "anon" | "authenticated", claims: string, work: (calls: MarketplaceCalls) => Promise<T>): Promise<T> {
    try {
      const sql = await ready()
      const result = await sql.begin(mode, async (tx) => {
        await tx.unsafe(SESSION_SETUP, [role, claims])
        return work(callsFor(tx, role === "anon"))
      })

      return result as T
    } catch (error) {
      throw translateStoreError(error)
    }
  }

  return {
    asAnon: async (work) => run("read only", "anon", ANON_CLAIMS, work),

    asUser: async (principal, work, runOptions) =>
      run(runOptions?.readOnly === false ? "read write" : "read only", "authenticated", principalClaims(principal), work),

    async close() {
      if (client && !options.sql) {
        const sql = await client.catch(() => null)
        client = null
        await sql?.end({ timeout: 5 })
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Identity linking (#213)
// ---------------------------------------------------------------------------------------------------------------

/**
 * The person to create or link, from the server session only: the configured issuer, the session's Clerk user id
 * (`identity_links.subject`), a display name, and an email address that is stored only when the provider verified it.
 */
export interface MarketplaceIdentityToLink {
  issuer: string
  subject: string
  displayName: string
  email: string | null
  emailVerified: boolean
}

/**
 * Links a signed-in person to the normalized store through `marketplace.sync_verified_identity`, the schema's own
 * server-side identity bridge (03, hardened in 16 B-5). The schema grants that function to `service_role` only, and
 * the marketplace connection can never become `service_role` (HF-22), so linking runs over a separate login role
 * that can become `service_role` and nothing else, and calls only this one function.
 */
export interface MarketplaceIdentitySync {
  /** The `app_users.id` the identity now resolves to (created on first sign-in, the same one afterwards). */
  link(identity: MarketplaceIdentityToLink): Promise<string>
  close(): Promise<void>
}

/** What the identity-sync login role may be: nothing by itself, and able to become only `service_role`. */
export const IDENTITY_SYNC_CREDENTIAL_CHECK = `
select to_jsonb(c) as row from (
  select r.rolsuper as superuser,
         r.rolbypassrls as bypass_rls,
         r.rolinherit as inherits,
         r.rolcreaterole as create_role,
         r.rolreplication as replication,
         coalesce((select pg_has_role(r.oid, x.oid, 'SET') from pg_roles x where x.rolname = 'service_role'), false) as can_become_service_role,
         exists (select 1 from pg_namespace n where n.nspname = 'marketplace' and n.nspowner = r.oid) as owns_marketplace,
         (exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                  where n.nspname = 'marketplace' and c.relowner = r.oid)
          or exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                     where n.nspname = 'marketplace' and p.proowner = r.oid)
          or exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                     where n.nspname = 'marketplace' and t.typowner = r.oid)) as owns_marketplace_objects,
         -- Any role reachable other than service_role and the roles service_role itself reaches: anon, authenticated,
         -- pg_write_all_data or a table owner would let this credential do more than link identities.
         coalesce((select array_agg(p.rolname::text order by p.rolname)
                   from pg_roles p
                   where p.oid <> r.oid
                     and p.rolname <> 'service_role'
                     and pg_has_role(r.oid, p.oid, 'MEMBER')
                     and not exists (select 1 from pg_roles s
                                     where s.rolname = 'service_role' and pg_has_role(s.oid, p.oid, 'MEMBER'))),
                  array[]::text[]) as other_memberships,
         -- Membership of a superuser, BYPASSRLS or CREATEROLE role other than service_role itself, which holds
         -- BYPASSRLS on Supabase but no table privilege in this schema (02's trust model).
         coalesce((select array_agg(p.rolname::text order by p.rolname)
                   from pg_roles p
                   where p.oid <> r.oid
                     and p.rolname <> 'service_role'
                     and (p.rolsuper or p.rolbypassrls or p.rolcreaterole)
                     and pg_has_role(r.oid, p.oid, 'MEMBER')), array[]::text[]) as privileged_memberships
  from pg_roles r
  where r.rolname = session_user
) as c`

export interface IdentitySyncCredentialFacts {
  superuser: boolean
  bypass_rls: boolean
  inherits: boolean
  create_role: boolean
  replication: boolean
  can_become_service_role: boolean
  owns_marketplace: boolean
  owns_marketplace_objects: boolean
  other_memberships: string[]
  privileged_memberships: string[]
}

/** The reasons a login role is unsafe for identity linking; empty when it is safe. */
export function identitySyncCredentialProblems(facts: IdentitySyncCredentialFacts | null | undefined): string[] {
  if (!facts) {
    return ["the login role could not be inspected"]
  }

  const list = (value: unknown) => (Array.isArray(value) ? value.join(", ") : "unknown")

  return [
    facts.superuser && "it is a superuser",
    facts.bypass_rls && "it bypasses row-level security",
    facts.inherits && "it inherits the privileges of roles it belongs to (use NOINHERIT)",
    facts.create_role && "it can create roles",
    facts.replication && "it is a replication role",
    !facts.can_become_service_role && "it cannot switch to the service_role role",
    facts.owns_marketplace && "it owns the marketplace schema",
    facts.owns_marketplace_objects !== false && "it owns objects in the marketplace schema",
    (!Array.isArray(facts.privileged_memberships) || facts.privileged_memberships.length > 0) &&
      `it belongs to a privileged role (${list(facts.privileged_memberships)})`,
    (!Array.isArray(facts.other_memberships) || facts.other_memberships.length > 0) &&
      `it belongs to roles other than service_role (${list(facts.other_memberships)})`
  ].filter((problem): problem is string => typeof problem === "string")
}

const WORKER_CLAIMS = JSON.stringify({ role: "service_role" })

const SYNC_VERIFIED_IDENTITY =
  "select to_jsonb(marketplace.sync_verified_identity(p_issuer => $1::text, p_subject => $2::text, p_display_name => $3::text, " +
  "p_email => $4::text, p_email_verified => $5::text::boolean)) as value"

const UUID_TEXT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Identity linking over a direct PostgreSQL connection as the identity-sync login role (postgres.js). */
export function createPostgresIdentitySync(options: PostgresMarketplaceDbOptions): MarketplaceIdentitySync {
  if (!options.sql && !options.url) {
    throw new MarketplaceAdapterConfigurationError("The normalized identity link has no connection configured")
  }

  let client: Promise<Sql> | null = null
  let checked = false

  async function ready(): Promise<Sql> {
    client ??= options.sql ? Promise.resolve(options.sql) : connect(options.url as string, options.max ?? 1)
    const sql = await client

    if (!checked) {
      const [facts] = rowsOf(await sql.unsafe(IDENTITY_SYNC_CREDENTIAL_CHECK), "row") as Array<IdentitySyncCredentialFacts | undefined>
      const problems = identitySyncCredentialProblems(facts)

      if (problems.length > 0) {
        throw new MarketplaceAdapterConfigurationError(
          `The normalized identity link connection is refused because its login role is unsafe: ${problems.join("; ")}`
        )
      }

      checked = true
    }

    return sql
  }

  return {
    async link(identity) {
      const issuer = principalField(identity.issuer, "issuer", 8, 300)
      const subject = principalField(identity.subject, "subject", 1, 255)
      const displayName = identity.displayName.trim().slice(0, 120)
      const email = identity.emailVerified && identity.email?.trim() ? identity.email.trim() : null

      try {
        const sql = await ready()
        const userId = await sql.begin("read write", async (tx) => {
          await tx.unsafe(SESSION_SETUP, ["service_role", WORKER_CLAIMS])
          const [value] = rowsOf(await tx.unsafe(SYNC_VERIFIED_IDENTITY, [issuer, subject, displayName, email, email ? "true" : "false"]), "value")
          return value
        })

        if (typeof userId !== "string" || !UUID_TEXT.test(userId)) {
          throw new MarketplaceStoreError()
        }

        return userId
      } catch (error) {
        throw translateStoreError(error)
      }
    },

    async close() {
      if (client && !options.sql) {
        const sql = await client.catch(() => null)
        client = null
        await sql?.end({ timeout: 5 })
      }
    }
  }
}
