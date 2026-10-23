import { describe, expect, it } from "vitest"

import { auditStateSnapshot, createInMemoryDatabase, createLaunchDatabase } from "./index"

describe("createLaunchDatabase", () => {
  it("starts every collection the seed has, and leaves all but the admin profile empty", () => {
    const launch = createLaunchDatabase()
    const seed = createInMemoryDatabase()

    expect(Object.keys(launch).sort()).toEqual(Object.keys(seed).sort())

    const populated = Object.entries(launch)
      .filter(([, rows]) => (rows as unknown[]).length > 0)
      .map(([table]) => table)
      .sort()

    expect(populated).toEqual(["profiles"])
  })

  it("carries only the unclaimed platform admin, so no sample person reaches a real deployment", () => {
    const launch = createLaunchDatabase()

    expect(launch.profiles).toHaveLength(1)
    expect(launch.profiles[0]).toMatchObject({
      clerkUserId: "clerk-admin-1",
      companyId: null,
      id: "11111111-1111-4111-8111-111111111111",
      isActive: true,
      role: "admin"
    })
    // Negative control: the seed this is cut from is a populated operation.
    const seed = createInMemoryDatabase()
    expect(seed.profiles.length).toBeGreaterThan(1)
    expect(seed.organizations.length).toBeGreaterThan(0)
    expect(seed.loadPostings.length).toBeGreaterThan(0)
  })

  it("is a valid stored document with nothing withheld or reported", () => {
    const audit = auditStateSnapshot(createLaunchDatabase())

    expect(audit.missingCollections).toEqual([])
    expect(audit.defects).toEqual([])
    expect(audit.withheldRows).toEqual({})
    expect(audit.state?.profiles).toHaveLength(1)
  })

  it("returns an independent document each time", () => {
    const first = createLaunchDatabase()
    first.profiles[0]!.fullName = "Changed"
    first.organizations.push({} as never)

    const second = createLaunchDatabase()

    expect(second.profiles[0]?.fullName).toBe("LogLoads Admin")
    expect(second.organizations).toEqual([])
  })
})
