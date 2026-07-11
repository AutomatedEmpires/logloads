import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

const migration = readFileSync(
  new URL(
    "../../../supabase/migrations/20260711034301_canonical_operating_state.sql",
    import.meta.url
  ),
  "utf8"
).toLowerCase()

describe("canonical operating-state migration contract", () => {
  it("is additive and upgrades the legacy review shape", () => {
    expect(migration).toContain("add column if not exists schema_version")
    expect(migration).toContain("add column if not exists version")
    expect(migration).toContain("jsonb_set(state, '{tripreviews}', '[]'::jsonb, true)")
    expect(migration).toContain("where not (state ? 'tripreviews')")
  })

  it("keeps the canonical row service-role only with least privilege", () => {
    expect(migration).toContain("enable row level security")
    expect(migration).toContain(
      "revoke all on table public.operating_state from public, anon, authenticated, service_role"
    )
    expect(migration).toContain(
      "grant select, insert, update on table public.operating_state to service_role"
    )
    expect(migration).not.toContain("security definer")
    expect(migration).not.toContain("grant delete")
    expect(migration).not.toContain("grant truncate")
  })
})
