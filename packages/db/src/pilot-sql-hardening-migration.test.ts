import { readdirSync, readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

/**
 * Contract for 20261103200000_pilot_sql_hardening.sql (#187 HF-19, HF-20, HF-21).
 *
 * The behaviour itself is executed against a fresh database by
 * supabase/verify/20261103200000_pilot_sql_hardening.sql, which tools/db-check.sh
 * runs after every reset (the `migrations` CI check). This file pins the text so a
 * local `pnpm test` catches a regression without a database.
 */
const MIGRATION = "20261103200000_pilot_sql_hardening.sql"
const migrationDirectory = new URL("../../../supabase/migrations/", import.meta.url)

function read(url: URL): string {
  return readFileSync(url, "utf8").replaceAll("\r\n", "\n").toLowerCase()
}

const migration = read(new URL(MIGRATION, migrationDirectory))
/** The migration without its `--` comments, for assertions about what it executes. */
const code = migration.replace(/--[^\n]*/g, "")
const verify = read(new URL(`../../../supabase/verify/${MIGRATION}`, import.meta.url))
const dbCheck = read(new URL("../../../tools/db-check.sh", import.meta.url))

const migrationNames = readdirSync(migrationDirectory)
  .filter((name) => name.endsWith(".sql"))
  .sort()

/** The body of the newest `create or replace function <name>` across every migration. */
function newestDefinition(name: string): string {
  const marker = `create or replace function ${name}(`

  for (const file of [...migrationNames].reverse()) {
    const source = read(new URL(file, migrationDirectory))
    const start = source.lastIndexOf(marker)

    if (start !== -1) {
      const bodyStart = source.indexOf("as $$", start)
      const bodyEnd = source.indexOf("$$;", bodyStart + "as $$".length)

      return source.slice(start, bodyEnd)
    }
  }

  throw new Error(`No migration defines ${name}`)
}

describe("pilot SQL hardening migration (#187)", () => {
  it("HF-19: a missing, empty or blank sub claim is no identity", () => {
    const definition = newestDefinition("public.current_clerk_user_id")

    expect(definition).not.toContain("coalesce(")
    expect(definition).toContain("when pg_catalog.btrim(claims.sub) = '' then null")
    expect(definition).toContain("set search_path = ''")
    expect(migration).toContain("grant execute on function public.current_clerk_user_id() to service_role")
    expect(code).not.toMatch(/grant execute on function public\.current_clerk_user_id\(\) to [^;]*(anon|authenticated)/)
  })

  it("HF-19: no profile can carry an empty or blank Clerk id", () => {
    expect(migration).toContain("add constraint profiles_clerk_user_id_not_blank")
    expect(migration).toContain("check (pg_catalog.btrim(clerk_user_id) <> '')")
  })

  it("HF-19: every SECURITY DEFINER helper pins an empty search_path", () => {
    for (const signature of [
      "public.current_profile_id()",
      "public.is_org_member(uuid)",
      "public.orgs_have_active_relationship(uuid, uuid)",
      "public.load_visible_to_org(uuid, uuid)"
    ]) {
      expect(migration).toContain(`alter function ${signature} set search_path = '';`)
    }

    const requestCapacity = newestDefinition("public.request_capacity")
    expect(requestCapacity).toContain("security definer\nset search_path = ''")
    expect(newestDefinition("public.org_role_can")).toContain("set search_path = ''")
  })

  it("HF-19: request_capacity requires the organization's own driver, truck and attached trailer", () => {
    const requestCapacity = newestDefinition("public.request_capacity")

    expect(requestCapacity).toContain("drivers.company_id = p_company_id")
    expect(requestCapacity).toContain("trucks.company_id = p_company_id")
    expect(requestCapacity).toContain("trucks.archived_at is null")
    expect(requestCapacity).toContain("trailers.truck_id = p_truck_profile_id")
    expect(migration).toContain(
      "grant execute on function public.request_capacity(uuid, uuid, uuid, uuid, uuid, uuid, text) to service_role"
    )
  })

  it("HF-20: mills and destination facilities are member-only and never anonymous", () => {
    expect(migration).toContain("drop policy if exists mills_public_select on public.mills")
    expect(migration).toContain("drop policy if exists destination_facilities_select on public.destination_facilities")
    expect(migration).toMatch(/create policy mills_member_select on public\.mills\s+for select\s+to authenticated\s/)
    expect(migration).toMatch(
      /create policy destination_facilities_member_select on public\.destination_facilities\s+for select\s+to authenticated\s/
    )
    expect(migration).toContain("comment on policy mills_member_select on public.mills")
    expect(migration).toContain(
      "comment on policy destination_facilities_member_select on public.destination_facilities"
    )
    expect(code).not.toMatch(/using\s*\(\s*true\s*\)/)
  })

  it("HF-20: anon loses SELECT on existing and future tables, and nothing else loses it", () => {
    expect(migration).toContain("revoke select on table %s from anon")
    expect(migration).toContain("alter default privileges in schema public\n  revoke select on tables from anon;")
    expect(code).not.toMatch(/revoke [^;]*select[^;]* from [^;]*(authenticated|service_role)/)
  })

  it("HF-21: audit_events is append-only and keeps its actors", () => {
    expect(migration).toContain("on delete restrict")
    expect(migration).toMatch(/before update or delete on public\.audit_events\s+for each row/)
    expect(migration).toContain(
      "revoke update, delete, truncate on table public.audit_events from anon, authenticated, service_role"
    )
    expect(code).not.toContain("on delete set null")
    expect(code).not.toContain("grant update")
    expect(code).not.toContain("grant delete")
    expect(code).not.toContain("grant truncate")
  })

  it("is additive: no data rewrite, no drop of a table or function", () => {
    expect(code).not.toMatch(/\bdelete from\b/)
    expect(code).not.toMatch(/\bupdate public\.(profiles|mills|destination_facilities|audit_events)\b/)
    expect(code).not.toMatch(/\bdrop (table|function)\b/)
  })

  it("is executed against a fresh database by the migrations check", () => {
    expect(dbCheck).toContain("for check in supabase/verify/*.sql")
    expect(dbCheck).toContain("-v on_error_stop=1")
    expect(verify.trimStart()).toMatch(/^-- /)
    expect(verify).toContain("\nbegin;\n")
    expect(verify.trimEnd().endsWith("rollback;")).toBe(true)
    expect(verify).not.toMatch(/\bcommit\b/)
  })
})
