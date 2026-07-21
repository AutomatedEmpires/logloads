import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { getHostPublishingOptions } from "./host-data"
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
  })
})
