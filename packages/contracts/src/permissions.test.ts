import { describe, expect, it } from "vitest"

import { organizationRoleCan } from "./permissions"

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
})

