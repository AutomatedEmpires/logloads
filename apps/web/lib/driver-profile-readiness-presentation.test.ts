import { describe, expect, it, vi } from "vitest"

import {
  getDriverProfileReadiness,
  shouldShowDriverReadiness
} from "@/components/v3/DriverPages"

vi.mock("server-only", () => ({}))

const completeInput = {
  accountName: "Alex Driver",
  availability: {
    id: "availability-1",
    notes: null,
    status: "available" as const,
    windowLabel: "Today, 6:00 AM - 6:00 PM"
  },
  credentialVault: {
    blockedNotice: null,
    headline: "At least one assigned rig is cleared to request loads.",
    satisfied: true
  },
  driverName: "Alex Driver",
  equipmentLabel: "Truck 14 with log trailer",
  verifications: [{ status: "verified" as const }]
}

describe("driver profile readiness presentation", () => {
  it("keeps incomplete readiness guidance visible after the welcome handoff is gone", () => {
    const readiness = getDriverProfileReadiness({
      ...completeInput,
      availability: null
    })

    expect(readiness.complete).toBe(false)
    expect(readiness.nextStep?.key).toBe("availability")
    expect(readiness.nextStep?.actionHref).toBe("#driver-availability")
    expect(shouldShowDriverReadiness(readiness, false)).toBe(true)
  })

  it("hides completed guidance on an ordinary return but can show it in a fresh welcome", () => {
    const readiness = getDriverProfileReadiness(completeInput)

    expect(readiness.complete).toBe(true)
    expect(readiness.completedCount).toBe(readiness.steps.length)
    expect(readiness.nextStep).toBeNull()
    expect(shouldShowDriverReadiness(readiness, false)).toBe(false)
    expect(shouldShowDriverReadiness(readiness, true)).toBe(true)
  })

  it("keeps a pending verification visible without pretending the driver can act on it", () => {
    const readiness = getDriverProfileReadiness({
      ...completeInput,
      verifications: [{ status: "pending" as const }]
    })
    const verification = readiness.steps.find((step) => step.key === "verification")

    expect(readiness.complete).toBe(false)
    expect(readiness.nextStep).toBeNull()
    expect(verification).toMatchObject({
      actionHref: null,
      actionLabel: null,
      complete: false
    })
    expect(verification?.detail).toContain("in review")
    expect(shouldShowDriverReadiness(readiness, false)).toBe(true)
  })
})
