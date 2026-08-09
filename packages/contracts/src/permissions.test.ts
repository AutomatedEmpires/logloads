import { describe, expect, it } from "vitest"

import { ORGANIZATION_ROLES, organizationRoleCan, type OrganizationRole } from "./permissions"

const PUBLISHING_ROLES: OrganizationRole[] = ["owner", "admin", "dispatcher", "landing_manager"]

describe("organization permissions", () => {
  it("allows landing managers to publish loads but not manage billing", () => {
    expect(organizationRoleCan("landing_manager", "publish_load")).toBe(true)
    expect(organizationRoleCan("landing_manager", "manage_billing")).toBe(false)
  })

  it("keeps drivers scoped to trip execution and requests", () => {
    expect(organizationRoleCan("driver", "request_assignment")).toBe(true)
    expect(organizationRoleCan("driver", "progress_trip")).toBe(true)
    expect(organizationRoleCan("driver", "assign_capacity")).toBe(false)
  })

  it("lets exactly the operating roles publish work", () => {
    for (const role of PUBLISHING_ROLES) {
      expect(organizationRoleCan(role, "publish_load"), `${role} should publish`).toBe(true)
    }

    for (const role of ORGANIZATION_ROLES.filter((candidate) => !PUBLISHING_ROLES.includes(candidate))) {
      expect(organizationRoleCan(role, "publish_load"), `${role} must not publish`).toBe(false)
    }
  })

  it("gives dispatchers the operating actions without ownership or money", () => {
    // Dispatchers run their organization's work end to end.
    expect(organizationRoleCan("dispatcher", "publish_load")).toBe(true)
    expect(organizationRoleCan("dispatcher", "assign_capacity")).toBe(true)
    expect(organizationRoleCan("dispatcher", "progress_trip")).toBe(true)
    expect(organizationRoleCan("dispatcher", "send_operational_notice")).toBe(true)

    // Ownership and money are not theirs.
    expect(organizationRoleCan("dispatcher", "manage_members")).toBe(false)
    expect(organizationRoleCan("dispatcher", "manage_billing")).toBe(false)
  })

  it("keeps viewers read-only", () => {
    expect(organizationRoleCan("viewer", "view_network")).toBe(true)

    for (const action of ["publish_load", "assign_capacity", "request_assignment", "manage_members", "manage_billing"] as const) {
      expect(organizationRoleCan("viewer", action), `viewer must not ${action}`).toBe(false)
    }
  })

  it("keeps billing scoped to money", () => {
    expect(organizationRoleCan("billing", "manage_billing")).toBe(true)
    expect(organizationRoleCan("billing", "publish_load")).toBe(false)
    expect(organizationRoleCan("billing", "assign_capacity")).toBe(false)
  })

  it("lets owners and organization admins manage billing", () => {
    expect(organizationRoleCan("owner", "manage_billing")).toBe(true)
    expect(organizationRoleCan("admin", "manage_billing")).toBe(true)
  })
})
