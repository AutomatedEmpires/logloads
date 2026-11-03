import { createInMemoryDatabase } from "@logloads/db"
import { describe, expect, it } from "vitest"

import { createLogLoadsServices } from "./index"

// Seed trip ...415 is on Summit's load, en route to the landing, driven by
// Summit's driver ...228. Summit's dispatcher is ...224.
const SUMMIT = "33333333-3333-4333-8333-333333333332"
const SUMMIT_DRIVER = "22222222-2222-4222-8222-222222222228"
const SUMMIT_DISPATCHER = "22222222-2222-4222-8222-222222222224"
const TRIP = "24242424-2424-4424-8424-242424242415"

type ProgressInput = Parameters<ReturnType<typeof createLogLoadsServices>["progressTripStatus"]>[0]

/** A web boundary forwards client JSON into the input, so the source arrives as whatever the client sent. */
function clientInput(input: Omit<ProgressInput, "source">, source: unknown): ProgressInput {
  return { ...input, source } as ProgressInput
}

describe("trip event source", () => {
  it("is derived from the actor and ignores the value the client chose", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())

    const byDriver = services.progressTripStatus(clientInput({
      actorUserId: SUMMIT_DRIVER,
      nextStatus: "checked_in",
      organizationId: SUMMIT,
      tripId: TRIP
    }, "system"))

    expect(byDriver.event?.source).toBe("driver")

    const byDispatcher = services.progressTripStatus(clientInput({
      actorUserId: SUMMIT_DISPATCHER,
      nextStatus: "loading",
      organizationId: SUMMIT,
      tripId: TRIP
    }, "driver"))

    expect(byDispatcher.event?.source).toBe("dispatcher")

    const recorded = services.state.tripEvents.filter((event) => event.tripId === TRIP).slice(-2)

    expect(recorded.map((event) => [event.actorUserId, event.source])).toEqual([
      [SUMMIT_DRIVER, "driver"],
      [SUMMIT_DISPATCHER, "dispatcher"]
    ])
  })

  it("is derived when the caller sends no source at all", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())

    expect(services.progressTripStatus({
      actorUserId: SUMMIT_DRIVER,
      nextStatus: "checked_in",
      organizationId: SUMMIT,
      tripId: TRIP
    }).event?.source).toBe("driver")
  })
})
