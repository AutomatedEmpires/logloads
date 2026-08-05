import { organizationMembershipSchema } from "@logloads/contracts"
import { createInMemoryDatabase } from "@logloads/db"
import { describe, expect, it } from "vitest"

import { createLogLoadsServices } from "./index"
import { DomainRefusalError } from "./utils"

const DRIVER_USER = "22222222-2222-4222-8222-222222222221"
const DRIVER_PROFILE = "44444444-4444-4444-8444-444444444441"
const FLEET_ORG = "33333333-3333-4333-8333-333333333331"

describe("driver profile service", () => {
  it("updates fuel assumptions through an authorized service transition", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())

    const result = services.updateDriverEconomics({
      actorUserId: DRIVER_USER,
      driverProfileId: DRIVER_PROFILE,
      fuelEconomyMpg: 7.2,
      fuelPriceCentsPerGallon: 390,
      organizationId: FLEET_ORG
    })

    expect(result.driver.preferredFuelPriceCentsPerGallon).toBe(390)
    expect(result.truck.fuelEconomyMpg).toBe(7.2)
    expect(services.state.auditEvents.some((event) => event.action === "driver_economics_updated")).toBe(true)
  })

  it("rejects another user attempting to change a driver profile", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())

    expect(() => services.updateDriverEconomics({
      actorUserId: "22222222-2222-4222-8222-222222222224",
      driverProfileId: DRIVER_PROFILE,
      fuelEconomyMpg: 7.2,
      fuelPriceCentsPerGallon: 390,
      organizationId: FLEET_ORG
    })).toThrow()
  })

  it("stores only immutable uploads scoped to the resolved media target", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const context = {
      actorUserId: DRIVER_USER,
      driverProfileId: DRIVER_PROFILE,
      kind: "profile" as const,
      organizationId: FLEET_ORG
    }
    const target = services.getDriverMediaTarget(context)
    const uploadedAt = new Date().toISOString()
    const photo = {
      bytes: 125_000,
      format: "jpg" as const,
      height: 900,
      provider: "supabase" as const,
      publicId: `${target.publicIdPrefix}/uploads/11111111-1111-4111-8111-111111111111`,
      uploadedAt,
      version: 1,
      width: 1200
    }

    expect(services.saveDriverMediaReference({ ...context, photo })).toEqual(photo)
    expect(services.getDriverMediaTarget(context).photo).toEqual(photo)
    expect(() => services.saveDriverMediaReference({
      ...context,
      photo: { ...photo, publicId: `logloads/${FLEET_ORG}/profile/not-this-driver/uploads/bad` }
    })).toThrow(/does not belong/)
  })

  it("revokes private media and profile writes when the user, organization, or exact membership is inactive", () => {
    const assertRevoked = (
      revoke: (services: ReturnType<typeof createLogLoadsServices>) => void
    ) => {
      const services = createLogLoadsServices(createInMemoryDatabase())
      const beforeAuditCount = services.state.auditEvents.length

      revoke(services)

      expect(() => services.getDriverMediaTarget({
        actorUserId: DRIVER_USER,
        driverProfileId: DRIVER_PROFILE,
        kind: "profile",
        organizationId: FLEET_ORG
      })).toThrow(/own driver profile while it is active/)
      expect(() => services.updateDriverEconomics({
        actorUserId: DRIVER_USER,
        driverProfileId: DRIVER_PROFILE,
        fuelEconomyMpg: 7.2,
        fuelPriceCentsPerGallon: 390,
        organizationId: FLEET_ORG
      })).toThrow(/own driver profile while it is active/)
      expect(services.state.auditEvents).toHaveLength(beforeAuditCount)
    }

    assertRevoked((services) => {
      const profile = services.state.profiles.find((candidate) => candidate.id === DRIVER_USER)

      if (!profile) throw new Error("Driver user fixture missing")
      profile.isActive = false
    })
    assertRevoked((services) => {
      const organization = services.state.organizations.find(
        (candidate) => candidate.id === FLEET_ORG
      )

      if (!organization) throw new Error("Fleet organization fixture missing")
      organization.archivedAt = "2026-08-05T12:00:00.000Z"
    })
    assertRevoked((services) => {
      const membership = services.state.organizationMemberships.find(
        (candidate) =>
          candidate.organizationId === FLEET_ORG && candidate.userId === DRIVER_USER
      )

      if (!membership) throw new Error("Driver membership fixture missing")
      membership.status = "suspended"
    })
  })

  it("does not reactivate a historical profile through an unrelated active membership", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())

    services.state.organizationMemberships.push(organizationMembershipSchema.parse({
      createdAt: "2026-08-05T12:00:00.000Z",
      id: "19191919-1919-4919-8919-191919191919",
      organizationId: HOST_ORG,
      role: "driver",
      status: "active",
      updatedAt: "2026-08-05T12:00:00.000Z",
      userId: DRIVER_USER
    }))

    expect(() => services.getDriverMediaTarget({
      actorUserId: DRIVER_USER,
      driverProfileId: DRIVER_PROFILE,
      kind: "profile",
      organizationId: HOST_ORG
    })).toThrow(/own driver profile while it is active/)
  })
})

const HOST_ORG = "33333333-3333-4333-8333-333333333332"
const HOST_OWNER = "22222222-2222-4222-8222-222222222223"
const OTHER_DRIVER_USER = "22222222-2222-4222-8222-222222222222"

function uploadTruckPhoto(services: ReturnType<typeof createLogLoadsServices>) {
  const context = {
    actorUserId: DRIVER_USER,
    driverProfileId: DRIVER_PROFILE,
    kind: "truck" as const,
    organizationId: FLEET_ORG
  }
  const target = services.getDriverMediaTarget(context)

  services.saveDriverMediaReference({
    ...context,
    photo: {
      bytes: 125_000,
      format: "jpg" as const,
      height: 900,
      provider: "supabase" as const,
      publicId: `${target.publicIdPrefix}/uploads/22222222-2222-4222-8222-333333333333`,
      uploadedAt: new Date().toISOString(),
      version: 1,
      width: 1200
    }
  })
}

describe("featured truck photo", () => {
  it.each([
    ["missing", undefined],
    ["malformed", "not-a-uuid"],
    ["nonexistent", "44444444-4444-4444-8444-444444444499"]
  ])("types a %s target as a caller-visible domain refusal", (_label, driverProfileId) => {
    const services = createLogLoadsServices(createInMemoryDatabase())

    expect(() =>
      services.getFeaturedTruckPhotoReference({
        driverProfileId,
        viewerOrganizationId: FLEET_ORG,
        viewerUserId: OTHER_DRIVER_USER
      })
    ).toThrow(DomainRefusalError)
  })

  it("refuses to feature a rig that has no photo, then features it once one exists", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const input = {
      actorUserId: DRIVER_USER,
      driverProfileId: DRIVER_PROFILE,
      featured: true,
      organizationId: FLEET_ORG
    }

    expect(() => services.setFeaturedTruckPhoto(input)).toThrow(/Upload a truck photo/)

    uploadTruckPhoto(services)

    expect(services.setFeaturedTruckPhoto(input).featureTruckPhoto).toBe(true)
    expect(services.state.auditEvents.some((event) => event.action === "truck_photo_featured")).toBe(true)
  })

  it("only the driver features their own profile", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())

    uploadTruckPhoto(services)

    expect(() => services.setFeaturedTruckPhoto({
      actorUserId: OTHER_DRIVER_USER,
      driverProfileId: DRIVER_PROFILE,
      featured: true,
      organizationId: FLEET_ORG
    })).toThrow(/your own driver profile/)
  })

  it("stops serving a featured truck as soon as the driver's roster identity is suspended", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())

    uploadTruckPhoto(services)
    services.setFeaturedTruckPhoto({
      actorUserId: DRIVER_USER,
      driverProfileId: DRIVER_PROFILE,
      featured: true,
      organizationId: FLEET_ORG
    })
    const membership = services.state.organizationMemberships.find(
      (candidate) =>
        candidate.organizationId === FLEET_ORG && candidate.userId === DRIVER_USER
    )

    if (!membership) throw new Error("Driver membership fixture missing")
    membership.status = "suspended"

    expect(() => services.getFeaturedTruckPhotoReference({
      driverProfileId: DRIVER_PROFILE,
      viewerOrganizationId: FLEET_ORG,
      viewerUserId: OTHER_DRIVER_USER
    })).toThrow(/not active/)
  })

  it("serves the featured photo to the driver's own outfit and to a host with the driver's assignment — nobody else, nothing unfeatured", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())

    uploadTruckPhoto(services)

    const viewerInput = {
      driverProfileId: DRIVER_PROFILE,
      viewerOrganizationId: FLEET_ORG,
      viewerUserId: OTHER_DRIVER_USER
    }

    // Not featured yet: nothing is served, to anyone.
    expect(() => services.getFeaturedTruckPhotoReference(viewerInput)).toThrow(/not featured/)

    services.setFeaturedTruckPhoto({
      actorUserId: DRIVER_USER,
      driverProfileId: DRIVER_PROFILE,
      featured: true,
      organizationId: FLEET_ORG
    })

    // Same outfit sees it.
    expect(services.getFeaturedTruckPhotoReference(viewerInput).publicId).toContain("/truck/")

    // Before the driver has any work on the host's board, the host sees nothing.
    expect(() =>
      services.getFeaturedTruckPhotoReference({
        driverProfileId: DRIVER_PROFILE,
        viewerOrganizationId: HOST_ORG,
        viewerUserId: HOST_OWNER
      })
    ).toThrow(/not visible/)

    // Once the driver requests the host's published load, the host's owner
    // sees the rig — dispatch deciding on a request is exactly who looks.
    const load = services.createLoadPostingWithPolicy({
      accessRequirements: [],
      actorUserId: HOST_OWNER,
      campaignEndDate: null,
      campaignStartDate: null,
      companyId: HOST_ORG,
      dailyTruckCountNeeded: 1,
      dispatcherContact: { email: "dispatch@summit.example", name: "Cole Cedar", phone: "555-3001" },
      dispatcherProfileId: "55555555-5555-4555-8555-555555555553",
      driverPayCents: 52_500,
      dropoffMillId: "99999999-9999-4999-8999-999999999991",
      equipmentRequirements: ["pole-trailer"],
      estimatedTonsPerLoad: 27,
      loadDate: "2026-06-25",
      loadType: "saw_logs",
      loaderContact: null,
      loaderProfileId: null,
      organizationId: HOST_ORG,
      pickupLandingId: "66666666-6666-4666-8666-666666666662",
      rateId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3",
      recurringSchedule: null,
      roadCondition: "good",
      routeId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3",
      scheduleType: "one_off",
      status: "open",
      title: "Featured photo runtime load",
      weatherNotes: null
    })
    const slot = services.state.truckSlots.find((candidate) => candidate.loadPostingId === load.id)

    expect(slot).toBeDefined()
    if (!slot) return

    services.upsertAvailabilityWindow({
      driverProfileId: DRIVER_PROFILE,
      endAt: "2026-06-25T23:59:00.000Z",
      notes: "Featured photo fixture window.",
      preferredRouteIds: [],
      recurringSchedule: null,
      startAt: "2026-06-25T00:00:00.000Z",
      status: "available",
      truckProfileId: "77777777-7777-4777-8777-777777777771"
    })
    services.requestCapacityWithPolicy({
      actorUserId: DRIVER_USER,
      driverProfileId: DRIVER_PROFILE,
      loadPostingId: load.id,
      organizationId: FLEET_ORG,
      trailerProfileId: "88888888-8888-4888-8888-888888888881",
      truckProfileId: "77777777-7777-4777-8777-777777777771",
      truckSlotId: slot.id
    }, { at: "2026-06-25T12:00:00.000Z" })

    expect(
      services.getFeaturedTruckPhotoReference({
        driverProfileId: DRIVER_PROFILE,
        viewerOrganizationId: HOST_ORG,
        viewerUserId: HOST_OWNER
      }).publicId
    ).toContain("/truck/")

    // A viewer with no membership in the stated organization is refused.
    expect(() =>
      services.getFeaturedTruckPhotoReference({
        driverProfileId: DRIVER_PROFILE,
        viewerOrganizationId: HOST_ORG,
        viewerUserId: OTHER_DRIVER_USER
      })
    ).toThrow(/not authorized/)

    // Un-featuring turns the tap off at the next request.
    services.setFeaturedTruckPhoto({
      actorUserId: DRIVER_USER,
      driverProfileId: DRIVER_PROFILE,
      featured: false,
      organizationId: FLEET_ORG
    })
    expect(() => services.getFeaturedTruckPhotoReference(viewerInput)).toThrow(/not featured/)
  })
})
