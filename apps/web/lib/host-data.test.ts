import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { getHostLandingRecords, getHostPublishingOptions, getHostWorkspaceSetup } from "./host-data"
import { services } from "./services"

describe("host publishing options", () => {
  it("selects the organization's dispatcher when one user dispatches for multiple companies", () => {
    const sharedDispatcher = services.state.dispatcherProfiles.find((profile) => {
      const activeOrganizationIds = new Set(
        services.state.organizationMemberships
          .filter((membership) => membership.userId === profile.userId && membership.status === "active")
          .map((membership) => membership.organizationId)
      )

      return activeOrganizationIds.size > 1
    })
    const targetMembership = services.state.organizationMemberships.find(
      (membership) =>
        membership.userId === sharedDispatcher?.userId &&
        membership.status === "active" &&
        membership.organizationId !== sharedDispatcher.companyId
    )
    const ownedDispatcher = services.state.dispatcherProfiles.find(
      (profile) => profile.companyId === targetMembership?.organizationId
    )

    expect(sharedDispatcher && targetMembership && ownedDispatcher).toBeTruthy()
    if (!sharedDispatcher || !targetMembership || !ownedDispatcher) return

    const options = getHostPublishingOptions(targetMembership.organizationId)

    expect(options.dispatcher).toMatchObject({
      id: ownedDispatcher.id,
      name: ownedDispatcher.contact.name
    })
    expect(options.dispatcher?.id).not.toBe(sharedDispatcher.id)
    expect(options.billingModel).toBe("percentage_v1")
    expect(options.billingActivationState).toBe("percentage_active")
  })
})

describe("host workspace destinations", () => {
  it("offers shared and owned destinations without leaking another organization's submission", () => {
    const hostOrganizationId = "33333333-3333-4333-8333-333333333332"
    const foreignOrganizationId = "33333333-3333-4333-8333-333333333331"
    const template = services.state.mills[0]
    const ownId = "99999999-9999-4999-8999-999999999993"
    const foreignId = "99999999-9999-4999-8999-999999999994"

    expect(template).toBeDefined()
    if (!template) return

    services.state.mills.push(
      {
        ...template,
        companyId: hostOrganizationId,
        id: ownId,
        millCode: "HOST-OWN-TEST",
        name: "Own pilot destination"
      },
      {
        ...template,
        companyId: foreignOrganizationId,
        id: foreignId,
        millCode: "HOST-FOREIGN-TEST",
        name: "Foreign pilot destination"
      }
    )

    try {
      const labels = getHostWorkspaceSetup(hostOrganizationId).mills.map((mill) => mill.label)

      expect(labels.some((label) => label.startsWith("Own pilot destination"))).toBe(true)
      expect(labels.some((label) => label.startsWith("Foreign pilot destination"))).toBe(false)
      expect(labels.some((label) => label.startsWith(template.name))).toBe(true)
    } finally {
      services.state.mills = services.state.mills.filter(
        (mill) => mill.id !== ownId && mill.id !== foreignId
      )
    }
  })
})

describe("host landing records", () => {
  const hostOrganizationId = "33333333-3333-4333-8333-333333333332"
  const landingId = "66666666-6666-4666-8666-666666666662"

  it("only serializes the private briefing for a role that may manage landings", () => {
    const summary = getHostLandingRecords(hostOrganizationId, "viewer").find((landing) => landing.id === landingId)
    const manageable = getHostLandingRecords(hostOrganizationId, "landing_manager").find((landing) => landing.id === landingId)

    expect(summary?.details).toBeNull()
    expect(manageable?.details?.gateInstructions).toBeTruthy()
    expect(manageable?.accessPolicy).toBe("assigned_only")
    expect(manageable?.accessPolicyLine).toMatch(/only to drivers after you approve/)
  })

  it("ignores a detail row controlled by another organization", () => {
    const index = services.state.richLandingDetails.findIndex((details) => details.landingId === landingId)
    const original = services.state.richLandingDetails[index]

    expect(original).toBeDefined()
    if (!original) return

    services.state.richLandingDetails[index] = {
      ...original,
      controlledByOrganizationId: "33333333-3333-4333-8333-333333333331",
      gateInstructions: "FOREIGN GATE SECRET",
      loadingEquipment: ["foreign loader"]
    }

    try {
      const record = getHostLandingRecords(hostOrganizationId, "landing_manager").find((landing) => landing.id === landingId)

      expect(record?.details?.gateInstructions).toBe("")
      expect(record?.loadingEquipment).toEqual([])
    } finally {
      services.state.richLandingDetails[index] = original
    }
  })

  it("does not choose arbitrarily between duplicate owned briefings", () => {
    const original = services.state.richLandingDetails.find((details) => details.landingId === landingId)
    const duplicateId = "4e4e4e4e-4e4e-4e4e-8e4e-4e4e4e4e4e01"

    expect(original).toBeDefined()
    if (!original) return

    services.state.richLandingDetails.push({
      ...original,
      gateInstructions: "CONFLICTING GATE SECRET",
      id: duplicateId
    })

    try {
      const record = getHostLandingRecords(hostOrganizationId, "landing_manager").find(
        (landing) => landing.id === landingId
      )

      expect(record?.details?.gateInstructions).toBe("")
      expect(record?.loadingEquipment).toEqual([])
    } finally {
      services.state.richLandingDetails = services.state.richLandingDetails.filter(
        (details) => details.id !== duplicateId
      )
    }
  })
})
