import { readdirSync, readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

const migrationsDirectory = new URL("../../../supabase/migrations/", import.meta.url)
const migrationFiles = readdirSync(migrationsDirectory).filter((file) => file.endsWith(".sql"))
const schema = migrationFiles
  .map((file) => readFileSync(new URL(file, migrationsDirectory), "utf8"))
  .join("\n")
  .replaceAll("\r\n", "\n")
  .toLowerCase()

describe("database schema contract", () => {
  it("creates only the canonical document and the shared rate limiter", () => {
    const tables = [...schema.matchAll(/create table if not exists (public\.\w+)/g)].map(
      (match) => match[1]
    )

    expect(tables.sort()).toEqual(["public.operating_state", "public.rate_limit_windows"])
    expect(schema).not.toContain("create extension")
    expect(schema).not.toContain("security definer")
    expect(schema).not.toContain("grant truncate")
  })

  it("keeps the canonical row service-role only with least privilege", () => {
    expect(schema).toContain("alter table public.operating_state enable row level security")
    expect(schema).toContain(
      "revoke all on table public.operating_state from public, anon, authenticated, service_role"
    )
    expect(schema).toContain(
      "grant select, insert, update on table public.operating_state to service_role"
    )
    expect(schema).not.toMatch(/grant [^;]*delete[^;]*on table public\.operating_state/)
  })

  it("uses one atomic upsert for fixed-window consumption", () => {
    expect(schema).toContain("primary key (bucket, key_hash)")
    expect(schema).toContain("on conflict (bucket, key_hash) do update")
    expect(schema).toContain("windows.request_count + 1")
    expect(schema).toContain("when windows.reset_at <= v_now then 1")
  })

  it("keeps the rate-limit table and RPC service-role only", () => {
    expect(schema).toContain("alter table public.rate_limit_windows enable row level security")
    expect(schema).toContain(
      "revoke all on table public.rate_limit_windows\n  from public, anon, authenticated, service_role"
    )
    expect(schema).toContain(
      "grant execute on function public.consume_rate_limit(text, text, bigint)\n  to service_role"
    )
    expect(schema).toContain("security invoker")
  })

  it("bounds stale pseudonymous rows without racing active windows", () => {
    expect(schema).toContain("limit 25")
    expect(schema).toContain("for update skip locked")
    expect(schema).toContain("delete from public.rate_limit_windows as stale")
  })

  it("accepts only HMAC-shaped identifier hashes", () => {
    expect(schema).toContain("key_hash ~ '^[0-9a-f]{64}$'")
    expect(schema).toContain("p_key_hash !~ '^[0-9a-f]{64}$'")
  })

  it("stops new objects from arriving pre-granted to anon and authenticated", () => {
    expect(schema).toContain(
      "revoke insert, update, delete, truncate on tables from anon, authenticated"
    )
    expect(schema).toContain("revoke execute on functions from anon, authenticated")
  })
})
