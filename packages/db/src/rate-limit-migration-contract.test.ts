import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

const migration = readFileSync(
  new URL(
    "../../../supabase/migrations/20260713053327_shared_rate_limit_windows.sql",
    import.meta.url
  ),
  "utf8"
).replaceAll("\r\n", "\n").toLowerCase()

describe("shared rate-limit migration contract", () => {
  it("uses one atomic upsert for fixed-window consumption", () => {
    expect(migration).toContain("primary key (bucket, key_hash)")
    expect(migration).toContain("on conflict (bucket, key_hash) do update")
    expect(migration).toContain("windows.request_count + 1")
    expect(migration).toContain("when windows.reset_at <= v_now then 1")
  })

  it("keeps the table and RPC service-role only", () => {
    expect(migration).toContain("enable row level security")
    expect(migration).toContain(
      "revoke all on table public.rate_limit_windows\n  from public, anon, authenticated, service_role"
    )
    expect(migration).toContain(
      "grant execute on function public.consume_rate_limit(text, text, bigint)\n  to service_role"
    )
    expect(migration).toContain("security invoker")
    expect(migration).not.toContain("security definer")
    expect(migration).not.toContain("grant truncate")
  })

  it("bounds stale pseudonymous rows without racing active windows", () => {
    expect(migration).toContain("limit 25")
    expect(migration).toContain("for update skip locked")
    expect(migration).toContain("delete from public.rate_limit_windows as stale")
  })

  it("accepts only HMAC-shaped identifier hashes", () => {
    expect(migration).toContain("key_hash ~ '^[0-9a-f]{64}$'")
    expect(migration).toContain("p_key_hash !~ '^[0-9a-f]{64}$'")
  })
})
