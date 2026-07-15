import { createInMemoryDatabase } from "@logloads/db"
import { describe, expect, it } from "vitest"

import { createLogLoadsServices } from "./index"

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
      provider: "cloudinary" as const,
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
})
