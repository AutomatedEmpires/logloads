import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

const migration = readFileSync(
  new URL(
    "../../../supabase/migrations/20260721232000_support_requests_state.sql",
    import.meta.url
  ),
  "utf8"
).toLowerCase()

describe("support request operating-state migration", () => {
  it("only backfills the additive collection", () => {
    expect(migration).toContain("jsonb_set(state, '{supportrequests}', '[]'::jsonb, true)")
    expect(migration).toContain("where not (state ? 'supportrequests')")
    expect(migration).not.toContain("set schema_version")
    expect(migration).not.toContain("alter column schema_version")
    expect(migration).not.toContain("state -")
  })
})
