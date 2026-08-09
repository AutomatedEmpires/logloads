import { createInMemoryDatabase } from "@logloads/db"
import { describe, expect, it } from "vitest"

import { createLogLoadsServices } from "./index"

describe("operational attention projection", () => {
  it("fails closed for invalid notice times and honors exact visibility boundaries", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const organizationId = "33333333-3333-4333-8333-333333333331"
    const actorUserId = "22222222-2222-4222-8222-222222222224"
    const template = services.state.operationalNotices.find(
      (notice) => notice.organizationId === organizationId
    )
    const at = Date.parse("2026-08-08T20:00:00.000Z")

    if (!template) {
      throw new Error("Expected an operational notice fixture")
    }

    services.state.operationalNotices.push(
      {
        ...template,
        effectiveAt: "not-a-timestamp",
        expiresAt: null,
        id: "31313131-3131-4131-8131-313131313117"
      },
      {
        ...template,
        effectiveAt: new Date(at).toISOString(),
        expiresAt: new Date(at + 1).toISOString(),
        id: "31313131-3131-4131-8131-313131313118"
      },
      {
        ...template,
        effectiveAt: new Date(at - 1).toISOString(),
        expiresAt: new Date(at).toISOString(),
        id: "31313131-3131-4131-8131-313131313119"
      },
      {
        ...template,
        effectiveAt: new Date(at - 1).toISOString(),
        expiresAt: "not-a-timestamp",
        id: "31313131-3131-4131-8131-313131313120"
      }
    )

    expect(
      services.operationalNoticeVisibleToActor({
        actorUserId,
        at,
        noticeId: "31313131-3131-4131-8131-313131313117",
        organizationId
      })
    ).toBe(false)
    expect(
      services.operationalNoticeVisibleToActor({
        actorUserId,
        at,
        noticeId: "31313131-3131-4131-8131-313131313118",
        organizationId
      })
    ).toBe(true)
    expect(
      services.operationalNoticeVisibleToActor({
        actorUserId,
        at,
        noticeId: "31313131-3131-4131-8131-313131313119",
        organizationId
      })
    ).toBe(false)
    expect(
      services.operationalNoticeVisibleToActor({
        actorUserId,
        at,
        noticeId: "31313131-3131-4131-8131-313131313120",
        organizationId
      })
    ).toBe(false)
  })

  it("returns only currently effective notices that belong to or affect the workspace", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const viewerOrganizationId = "33333333-3333-4333-8333-333333333331"
    const viewerStaffUserId = "22222222-2222-4222-8222-222222222224"
    const foreignOrganizationId = "33333333-3333-4333-8333-333333333332"
    const template = services.state.operationalNotices.find(
      (notice) => notice.organizationId === viewerOrganizationId
    )

    if (!template) {
      throw new Error("Expected an operational notice fixture")
    }

    const current = Date.now()
    services.state.operationalNotices.push(
      {
        ...template,
        effectiveAt: new Date(current - 60_000).toISOString(),
        expiresAt: new Date(current + 60_000).toISOString(),
        id: "31313131-3131-4131-8131-313131313121",
        relatedLoadId: null,
        title: "Current workspace notice"
      },
      {
        ...template,
        effectiveAt: new Date(current + 60_000).toISOString(),
        expiresAt: null,
        id: "31313131-3131-4131-8131-313131313122",
        relatedLoadId: null,
        title: "Scheduled workspace notice"
      },
      {
        ...template,
        effectiveAt: new Date(current - 120_000).toISOString(),
        expiresAt: new Date(current - 60_000).toISOString(),
        id: "31313131-3131-4131-8131-313131313123",
        relatedLoadId: null,
        title: "Ended workspace notice"
      },
      {
        ...template,
        effectiveAt: new Date(current - 60_000).toISOString(),
        expiresAt: null,
        id: "31313131-3131-4131-8131-313131313124",
        organizationId: foreignOrganizationId,
        relatedLoadId: null,
        title: "Foreign workspace notice"
      }
    )

    const attentionIds = new Set(
      services.listAttentionItems({
        actorUserId: viewerStaffUserId,
        organizationId: viewerOrganizationId
      }).map((item) => item.id)
    )

    expect(attentionIds).toContain("31313131-3131-4131-8131-313131313121")
    expect(attentionIds).not.toContain("31313131-3131-4131-8131-313131313122")
    expect(attentionIds).not.toContain("31313131-3131-4131-8131-313131313123")
    expect(attentionIds).not.toContain("31313131-3131-4131-8131-313131313124")
  })

  it("does not surface capacity pressure for a load the workspace cannot see", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const viewerOrganizationId = "33333333-3333-4333-8333-333333333331"
    const viewerStaffUserId = "22222222-2222-4222-8222-222222222224"
    const foreignLoad = services.state.loadPostings.find(
      (load) => load.companyId !== viewerOrganizationId &&
        services.state.opportunityCapacities.some((capacity) => capacity.loadPostingId === load.id)
    )
    const capacity = services.state.opportunityCapacities.find(
      (candidate) => candidate.loadPostingId === foreignLoad?.id
    )

    if (!foreignLoad || !capacity) {
      throw new Error("Expected a foreign load with capacity")
    }

    capacity.visibilityMode = "direct_offer"
    capacity.remainingTruckloads = 0
    capacity.completedTruckloads = 0
    capacity.totalTruckloads = Math.max(1, capacity.totalTruckloads)
    services.state.directOffers = services.state.directOffers.filter(
      (offer) => offer.loadPostingId !== foreignLoad.id
    )

    expect(
      services.listVisibleLoadsForOrganization(viewerOrganizationId).some(
        (load) => load.id === foreignLoad.id
      )
    ).toBe(false)
    expect(
      services.listAttentionItems({
        actorUserId: viewerStaffUserId,
        organizationId: viewerOrganizationId
      }).some(
        (item) => item.id === `capacity-${capacity.id}`
      )
    ).toBe(false)
  })

  it("does not expose field notice bodies through discovery visibility alone", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const viewerOrganizationId = "33333333-3333-4333-8333-333333333331"
    const foreignLoad = services.state.loadPostings.find(
      (load) => load.companyId !== viewerOrganizationId &&
        services.state.opportunityCapacities.some((capacity) => capacity.loadPostingId === load.id)
    )
    const capacity = services.state.opportunityCapacities.find(
      (candidate) => candidate.loadPostingId === foreignLoad?.id
    )
    const viewerDriver = services.state.driverProfiles.find(
      (driver) => driver.companyId === viewerOrganizationId
    )
    const assignmentTemplate = services.state.assignments.find(
      (assignment) => assignment.driverProfileId === viewerDriver?.id
    )
    const noticeTemplate = services.state.operationalNotices[0]
    const viewerProfile = services.state.profiles.find(
      (profile) => profile.id === viewerDriver?.userId
    )
    const viewerMembership = services.state.organizationMemberships.find(
      (membership) =>
        membership.organizationId === viewerOrganizationId &&
        membership.userId === viewerDriver?.userId &&
        membership.status === "active"
    )

    if (
      !foreignLoad ||
      !capacity ||
      !viewerDriver ||
      !assignmentTemplate ||
      !noticeTemplate ||
      !viewerProfile ||
      !viewerMembership
    ) {
      throw new Error("Expected foreign load, capacity, viewer driver, assignment, notice, and actor fixtures")
    }

    capacity.visibilityMode = "open_network"
    services.state.assignments = services.state.assignments.filter(
      (assignment) =>
        assignment.loadPostingId !== foreignLoad.id ||
        assignment.driverProfileId !== viewerDriver.id
    )
    services.state.operationalNotices.push({
      ...noticeTemplate,
      effectiveAt: new Date(Date.now() - 60_000).toISOString(),
      expiresAt: null,
      id: "31313131-3131-4131-8131-313131313125",
      organizationId: foreignLoad.companyId,
      relatedLoadId: foreignLoad.id,
      title: "Private field direction"
    })

    expect(
      services.listVisibleLoadsForOrganization(viewerOrganizationId).some(
        (load) => load.id === foreignLoad.id
      )
    ).toBe(true)
    expect(
      services.listAttentionItems({
        actorUserId: viewerDriver.userId,
        organizationId: viewerOrganizationId
      }).some(
        (item) => item.id === "31313131-3131-4131-8131-313131313125"
      )
    ).toBe(false)

    services.state.assignments.push({
      ...assignmentTemplate,
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddd25",
      loadPostingId: foreignLoad.id,
      status: "accepted"
    })

    expect(
      services.listAttentionItems({
        actorUserId: viewerDriver.userId,
        organizationId: viewerOrganizationId
      }).some(
        (item) => item.id === "31313131-3131-4131-8131-313131313125"
      )
    ).toBe(true)

    const secondDriverUserId = "22222222-2222-4222-8222-222222222229"
    services.state.profiles.push({
      ...viewerProfile,
      email: "second-driver@attention.test",
      id: secondDriverUserId
    })
    services.state.organizationMemberships.push({
      ...viewerMembership,
      id: "12121212-1212-4212-8212-121212121229",
      role: "driver",
      userId: secondDriverUserId
    })
    services.state.driverProfiles.push({
      ...viewerDriver,
      id: "44444444-4444-4444-8444-444444444429",
      licenseNumber: "SECOND-DRIVER",
      userId: secondDriverUserId
    })

    expect(
      services.listAttentionItems({
        actorUserId: secondDriverUserId,
        organizationId: viewerOrganizationId
      }).some((item) => item.id === "31313131-3131-4131-8131-313131313125")
    ).toBe(false)
  })

  it("does not serialize host notice bodies to a billing-only member", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const organizationId = "33333333-3333-4333-8333-333333333331"
    const billingUserId = "22222222-2222-4222-8222-222222222224"
    const membership = services.state.organizationMemberships.find(
      (candidate) =>
        candidate.organizationId === organizationId &&
        candidate.userId === billingUserId &&
        candidate.status === "active"
    )
    const ownLoad = services.state.loadPostings.find(
      (load) => load.companyId === organizationId
    )
    const noticeTemplate = services.state.operationalNotices[0]

    if (!membership || !ownLoad || !noticeTemplate) {
      throw new Error("Expected host membership, load, and notice fixtures")
    }

    membership.role = "billing"
    services.state.operationalNotices.push({
      ...noticeTemplate,
      effectiveAt: new Date(Date.now() - 60_000).toISOString(),
      expiresAt: null,
      id: "31313131-3131-4131-8131-313131313126",
      organizationId,
      relatedLoadId: ownLoad.id,
      title: "Private host field direction"
    })

    expect(
      services.listAttentionItems({ actorUserId: billingUserId, organizationId })
        .some((item) => item.id === "31313131-3131-4131-8131-313131313126")
    ).toBe(false)
  })

  it("does not let discovery visibility grant operational-notice write authority", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const haulingOrganizationId = "33333333-3333-4333-8333-333333333331"
    const actorUserId = "22222222-2222-4222-8222-222222222224"
    const foreignLoad = services.state.loadPostings.find(
      (load) =>
        load.companyId !== haulingOrganizationId &&
        services.state.opportunityCapacities.some(
          (capacity) => capacity.loadPostingId === load.id
        )
    )
    const capacity = services.state.opportunityCapacities.find(
      (candidate) => candidate.loadPostingId === foreignLoad?.id
    )
    const haulingDriver = services.state.driverProfiles.find(
      (driver) => driver.companyId === haulingOrganizationId
    )
    const assignmentTemplate = services.state.assignments.find(
      (assignment) => assignment.driverProfileId === haulingDriver?.id
    ) ?? services.state.assignments[0]

    if (!foreignLoad || !capacity || !haulingDriver || !assignmentTemplate) {
      throw new Error("Expected foreign load, capacity, driver, and assignment fixtures")
    }

    capacity.visibilityMode = "open_network"
    services.state.assignments = services.state.assignments.filter((assignment) => {
      const driver = services.state.driverProfiles.find(
        (candidate) => candidate.id === assignment.driverProfileId
      )

      return !(
        assignment.loadPostingId === foreignLoad.id &&
        driver?.companyId === haulingOrganizationId
      )
    })

    expect(
      services.listVisibleLoadsForOrganization(haulingOrganizationId)
        .some((load) => load.id === foreignLoad.id)
    ).toBe(true)
    expect(() =>
      services.createOperationalNotice({
        actorUserId,
        body: "Discovery alone must not permit private field instructions.",
        organizationId: haulingOrganizationId,
        relatedLoadId: foreignLoad.id,
        severity: "watch",
        title: "Unauthorized field notice"
      })
    ).toThrow(/cannot publish an operational notice/)

    services.state.assignments.push({
      ...assignmentTemplate,
      driverProfileId: haulingDriver.id,
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddd28",
      loadPostingId: foreignLoad.id,
      status: "accepted"
    })

    expect(
      services.createOperationalNotice({
        actorUserId,
        body: "The accepted hauling crew may coordinate its active work.",
        organizationId: haulingOrganizationId,
        relatedLoadId: foreignLoad.id,
        severity: "watch",
        title: "Authorized crew notice"
      }).relatedLoadId
    ).toBe(foreignLoad.id)
  })

  it("notifies accepted crews but not pending requesters about field notices", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const organizationId = "33333333-3333-4333-8333-333333333331"
    const actorUserId = "22222222-2222-4222-8222-222222222224"
    const load = services.state.loadPostings.find((candidate) => candidate.companyId === organizationId)
    const assignmentTemplate = services.state.assignments.find(
      (assignment) => assignment.loadPostingId === load?.id
    ) ?? services.state.assignments[0]

    if (!load || !assignmentTemplate) {
      throw new Error("Expected a host load and assignment fixture")
    }

    services.state.assignments = services.state.assignments.filter(
      (assignment) => assignment.loadPostingId !== load.id
    )
    services.state.assignments.push(
      {
        ...assignmentTemplate,
        id: "dddddddd-dddd-4ddd-8ddd-dddddddddd26",
        loadPostingId: load.id,
        status: "requested"
      },
      {
        ...assignmentTemplate,
        id: "dddddddd-dddd-4ddd-8ddd-dddddddddd27",
        loadPostingId: load.id,
        status: "accepted"
      }
    )

    const notice = services.createOperationalNotice({
      actorUserId,
      body: "Use the signed route pack for the current bridge hold.",
      organizationId,
      relatedLoadId: load.id,
      severity: "watch",
      title: "Bridge hold"
    })

    expect(
      services.state.notifications.filter(
        (notification) => notification.relatedEntityId === notice.id
      )
    ).toHaveLength(1)
  })
})
