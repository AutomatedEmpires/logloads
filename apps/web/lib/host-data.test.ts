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

  it("does not expose a foreign destination through a corrupt legacy lane", () => {
    const hostOrganizationId = "33333333-3333-4333-8333-333333333332"
    const foreignOrganizationId = "33333333-3333-4333-8333-333333333331"
    const route = services.state.haulRoutes.find(
      (candidate) => candidate.companyId === hostOrganizationId
    )
    const destination = services.state.mills.find(
      (candidate) => candidate.id === route?.millId
    )

    expect(route).toBeDefined()
    expect(destination).toBeDefined()
    if (!route || !destination) return

    const originalCompanyId = destination.companyId
    destination.companyId = foreignOrganizationId

    try {
      const options = getHostPublishingOptions(hostOrganizationId)
      const landing = getHostLandingRecords(hostOrganizationId, "owner").find(
        (candidate) => candidate.id === route.landingId
      )
      const historicalLane = landing?.lanes.find((candidate) => candidate.id === route.id)

      expect(options.routes.some((candidate) => candidate.id === route.id)).toBe(false)
      expect(options.routes.some((candidate) => candidate.millLabel.includes(destination.name))).toBe(false)
      expect(historicalLane?.millLabel).toBe("Destination unavailable")
    } finally {
      destination.companyId = originalCompanyId
    }
  })

  it("never turns an unreported landing road into good", () => {
    const hostOrganizationId = "33333333-3333-4333-8333-333333333332"
    const landing = services.state.landings.find(
      (candidate) => candidate.companyId === hostOrganizationId
    )

    expect(landing).toBeDefined()
    if (!landing) return

    const originalCondition = landing.roadCondition
    landing.roadCondition = null

    try {
      const option = getHostPublishingOptions(hostOrganizationId).landings.find(
        (candidate) => candidate.id === landing.id
      )
      const record = getHostLandingRecords(hostOrganizationId, "owner").find(
        (candidate) => candidate.id === landing.id
      )

      expect(option?.roadCondition).toBe("")
      expect(record?.roadCondition).toBe("not_recorded")
      expect(record?.editable.roadCondition).toBe("")
    } finally {
      landing.roadCondition = originalCondition
    }
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
      const setup = getHostWorkspaceSetup(hostOrganizationId, "owner")
      const labels = setup.mills.map((mill) => mill.label)

      expect(labels.some((label) => label.startsWith("Own pilot destination"))).toBe(true)
      expect(labels.some((label) => label.startsWith("Foreign pilot destination"))).toBe(false)
      expect(labels.some((label) => label.startsWith(template.name))).toBe(true)
      expect(setup.destinations).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: ownId, isActive: true })
      ]))
      expect(setup.destinations.some((destination) => destination.id === foreignId)).toBe(false)
    } finally {
      services.state.mills = services.state.mills.filter(
        (mill) => mill.id !== ownId && mill.id !== foreignId
      )
    }
  })

  it("keeps a retired owned destination manageable but removes it from new lane options", () => {
    const hostOrganizationId = "33333333-3333-4333-8333-333333333332"
    const template = services.state.mills[0]
    const retiredId = "99999999-9999-4999-8999-999999999995"

    expect(template).toBeDefined()
    if (!template) return

    services.state.mills.push({
      ...template,
      companyId: hostOrganizationId,
      id: retiredId,
      isActive: false,
      millCode: "HOST-RETIRED-TEST",
      name: "Retired pilot destination"
    })

    try {
      const setup = getHostWorkspaceSetup(hostOrganizationId, "owner")

      expect(setup.mills.some((mill) => mill.id === retiredId)).toBe(false)
      expect(setup.destinations).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: retiredId, isActive: false })
      ]))
    } finally {
      services.state.mills = services.state.mills.filter((mill) => mill.id !== retiredId)
    }
  })

  it("serializes editable contact details only to a role that can manage destinations", () => {
    const hostOrganizationId = "33333333-3333-4333-8333-333333333332"
    const template = services.state.mills[0]
    const ownedId = "99999999-9999-4999-8999-999999999996"

    expect(template).toBeDefined()
    if (!template) return

    services.state.mills.push({
      ...template,
      companyId: hostOrganizationId,
      id: ownedId,
      millCode: "HOST-SCOPED-TEST",
      name: "Scoped destination"
    })

    try {
      const manager = getHostWorkspaceSetup(hostOrganizationId, "destination_manager")
      const billing = getHostWorkspaceSetup(hostOrganizationId, "billing")

      expect(manager.destinations).toEqual(expect.arrayContaining([
        expect.objectContaining({
          editable: expect.objectContaining({ contactPhone: template.contact.phone }),
          id: ownedId
        })
      ]))
      expect(manager.mills).toEqual([])
      expect(manager.rates).toEqual([])
      expect(billing.destinations).toEqual([])
      expect(billing.mills).toEqual([])
      expect(billing.rates).toEqual([])
    } finally {
      services.state.mills = services.state.mills.filter((mill) => mill.id !== ownedId)
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
