import { readFileSync } from "node:fs"

import { ORGANIZATION_ROLES, ORGANIZATION_ROLE_ACTIONS, type OrganizationRole } from "@logloads/contracts"
import { describe, expect, it } from "vitest"

/**
 * The application role matrix and the database's org_role_can() must agree.
 * They are enforced in different places — services call organizationRoleCan,
 * row-level security calls org_role_can — so a change to one and not the
 * other silently splits authorization: the app permits a write the database
 * refuses, or worse, the database permits one the app believes is blocked.
 *
 * This parses the newest definition of org_role_can and compares it, role by
 * role, against the TypeScript matrix. Update BOTH sides together.
 */
const migration = readFileSync(
  new URL("../../../supabase/migrations/20260716120000_dispatcher_publish_load.sql", import.meta.url),
  "utf8"
)

function sqlActionsFor(role: OrganizationRole): string[] {
  // Matches: when 'role' then array['a','b',...]
  const body = new RegExp(`when '${role}' then array\\[([^\\]]*)\\]`).exec(migration)?.[1]

  if (!body) {
    return []
  }

  return [...body.matchAll(/'([a-z_]+)'/g)].flatMap((match) => (match[1] ? [match[1]] : []))
}

describe("org_role_can matches the application role matrix", () => {
  it("defines every role the application knows", () => {
    for (const role of ORGANIZATION_ROLES) {
      // "viewer" is the SQL `else` fallback rather than a named branch.
      if (role === "viewer") continue

      expect(sqlActionsFor(role), `SQL is missing a branch for ${role}`).not.toHaveLength(0)
    }
  })

  it("grants each role exactly the actions the application grants", () => {
    for (const role of ORGANIZATION_ROLES) {
      if (role === "viewer") continue

      const expected = [...ORGANIZATION_ROLE_ACTIONS[role]].sort()
      const actual = sqlActionsFor(role).sort()

      expect(actual, `org_role_can(${role}) disagrees with ORGANIZATION_ROLE_ACTIONS`).toEqual(expected)
    }
  })

  it("falls back to read-only for an unknown role, matching viewer", () => {
    expect(migration).toContain("else array['view_network']")
    expect([...ORGANIZATION_ROLE_ACTIONS.viewer]).toEqual(["view_network"])
  })

  it("lets dispatchers publish without granting ownership or billing", () => {
    const dispatcher = sqlActionsFor("dispatcher")

    expect(dispatcher).toContain("publish_load")
    expect(dispatcher).not.toContain("manage_members")
    expect(dispatcher).not.toContain("manage_billing")
  })

  it("keeps the helper least-privileged and additive", () => {
    expect(migration).toContain("create or replace function public.org_role_can")
    expect(migration).toContain("revoke execute on function public.org_role_can(uuid, text[]) from public")
    expect(migration).toContain(
      "grant execute on function public.org_role_can(uuid, text[]) to authenticated, service_role"
    )
    expect(migration).not.toContain("to anon")
    expect(migration).not.toContain("drop function")
  })
})
