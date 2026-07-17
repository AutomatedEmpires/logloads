import { entitlementSchema, organizationMembershipSchema } from "@logloads/contracts"
import { createInMemoryDatabase } from "@logloads/db"
import { describe, expect, it } from "vitest"

import { createLogLoadsServices, type LogLoadsServices } from "./index"

const HOST_ORG = "33333333-3333-4333-8333-333333333332"
const HAULER_ORG = "33333333-3333-4333-8333-333333333331"
const HOST_OWNER = "22222222-2222-4222-8222-222222222223"
const HOST_DISPATCHER = "22222222-2222-4222-8222-222222222224"
const MILL = "99999999-9999-4999-8999-999999999991"

function landingInput(overrides: Record<string, unknown> = {}) {
  return {
    actorUserId: HOST_OWNER,
    addressLine1: "1 Ridge Spur",
    city: "Bend",
    contact: { email: "cole@summit.example", name: "Cole Summit", phone: "555-3001" },
    coordinates: { lat: 44.05, lng: -121.31 },
    name: "Blue River Spur",
    organizationId: HOST_ORG,
    postalCode: "97701",
    state: "OR",
    ...overrides
  }
}

/** Gives an actor a role in an organization so a boundary can be probed from it. */
function grantMembership(
  services: LogLoadsServices,
  options: { userId: string; organizationId: string; role: "viewer" | "landing_manager" | "dispatcher"; index: number }
) {
  const suffix = options.index.toString().padStart(2, "0")

  services.state.organizationMemberships.push(organizationMembershipSchema.parse({
    createdAt: "2026-06-05T00:00:00.000Z",
    id: `3e3e3e3e-3e3e-4e3e-8e3e-3e3e3e3e3e${suffix}`,
    organizationId: options.organizationId,
    role: options.role,
    status: "active",
    updatedAt: "2026-06-05T00:00:00.000Z",
    userId: options.userId
  }))
}

/** Replaces the org's plan so the landing allowance is a known number. */
function setLandingAllowance(services: LogLoadsServices, organizationId: string, limit: number | null) {
  services.state.entitlements = services.state.entitlements.filter(
    (entitlement) => entitlement.organizationId !== organizationId
  )
  services.state.entitlements.push(entitlementSchema.parse({
    activeLandingLimit: limit,
    activeTruckLimit: null,
    createdAt: "2026-06-05T00:00:00.000Z",
    currentPeriodEndsAt: null,
    features: [],
    id: "3f3f3f3f-3f3f-4f3f-8f3f-3f3f3f3f3f01",
    organizationId,
    product: "landing_operations",
    status: "active",
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    updatedAt: "2026-06-05T00:00:00.000Z"
  }))
}

describe("creating a landing", () => {
  it("puts the landing on the host's own organization", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    setLandingAllowance(services, HOST_ORG, null)

    const landing = services.createLanding(landingInput())

    // The organization is stamped from the actor's context, never chosen.
    expect(landing.companyId).toBe(HOST_ORG)
    expect(landing.isActive).toBe(true)
    expect(landing.name).toBe("Blue River Spur")
    expect(services.state.auditEvents.some((event) =>
      event.action === "landing_created" && event.entityId === landing.id
    )).toBe(true)
  })

  it("makes the landing publishable straight away", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    setLandingAllowance(services, HOST_ORG, null)

    const landing = services.createLanding(landingInput())

    // The whole point: a landing nobody can post work from is not a landing.
    // This mirrors the filter the publishing options actually apply.
    const publishable = services.state.landings.filter(
      (candidate) => candidate.companyId === HOST_ORG && candidate.isActive
    )

    expect(publishable.map((candidate) => candidate.id)).toContain(landing.id)
  })

  it("refuses a dispatcher, who runs work rather than establishing sites", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    setLandingAllowance(services, HOST_ORG, null)

    // Dana Dispatch is a real dispatcher in this org and may publish work from a
    // landing; she deliberately holds no manage_landing.
    expect(() =>
      services.createLanding(landingInput({ actorUserId: HOST_DISPATCHER }))
    ).toThrow(/cannot manage landing/)
  })

  it("lets a landing manager establish one", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    setLandingAllowance(services, HOST_ORG, null)
    const manager = "3c3c3c3c-3c3c-4c3c-8c3c-3c3c3c3c3c01"

    grantMembership(services, { index: 1, organizationId: HOST_ORG, role: "landing_manager", userId: manager })

    expect(services.createLanding(landingInput({ actorUserId: manager })).companyId).toBe(HOST_ORG)
  })

  it("refuses a viewer", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    setLandingAllowance(services, HOST_ORG, null)
    const viewer = "3c3c3c3c-3c3c-4c3c-8c3c-3c3c3c3c3c02"

    grantMembership(services, { index: 2, organizationId: HOST_ORG, role: "viewer", userId: viewer })

    expect(() =>
      services.createLanding(landingInput({ actorUserId: viewer }))
    ).toThrow(/cannot manage landing/)
  })

  it("refuses an actor who is not a member of the organization", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    setLandingAllowance(services, HAULER_ORG, null)

    expect(() =>
      services.createLanding(landingInput({ organizationId: HAULER_ORG }))
    ).toThrow(/not an active member/)
  })
})

describe("the plan's landing allowance", () => {
  it("binds, because the plan already advertises it", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    // The host plan grants one active landing and says so on the billing page.
    // Nothing enforced it before, which cost nothing only because landings could
    // not be created at all.
    setLandingAllowance(services, HOST_ORG, 1)
    services.state.landings = services.state.landings.filter(
      (landing) => landing.companyId !== HOST_ORG
    )

    services.createLanding(landingInput())

    expect(() => services.createLanding(landingInput({ name: "Second Spur" })))
      .toThrow(/plan covers 1 active landing/)
    expect(services.countActiveLandings(HOST_ORG)).toBe(1)
  })

  it("counts only active landings, so retiring one frees the slot", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    setLandingAllowance(services, HOST_ORG, 1)
    services.state.landings = services.state.landings.filter(
      (landing) => landing.companyId !== HOST_ORG
    )

    const first = services.createLanding(landingInput())

    services.updateLanding({ ...landingInput(), isActive: false, landingId: first.id })

    expect(services.countActiveLandings(HOST_ORG)).toBe(0)
    expect(services.createLanding(landingInput({ name: "Second Spur" })).isActive).toBe(true)
  })

  it("does not charge an edit against the allowance it already holds", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    setLandingAllowance(services, HOST_ORG, 1)
    services.state.landings = services.state.landings.filter(
      (landing) => landing.companyId !== HOST_ORG
    )

    const landing = services.createLanding(landingInput())

    // The org is at its limit. Renaming the landing it already has is not a
    // request for capacity, so it must not be refused as one.
    const renamed = services.updateLanding({
      ...landingInput({ name: "Blue River Spur North" }),
      landingId: landing.id
    })

    expect(renamed.name).toBe("Blue River Spur North")
  })

  it("treats a reactivation as the request for capacity it is", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    setLandingAllowance(services, HOST_ORG, 1)
    services.state.landings = services.state.landings.filter(
      (landing) => landing.companyId !== HOST_ORG
    )

    const retired = services.createLanding(landingInput())
    services.updateLanding({ ...landingInput(), isActive: false, landingId: retired.id })
    services.createLanding(landingInput({ name: "Second Spur" }))

    // The slot is spoken for now, so switching the old one back on must refuse
    // rather than quietly put the org over its plan.
    expect(() =>
      services.updateLanding({ ...landingInput(), isActive: true, landingId: retired.id })
    ).toThrow(/plan covers 1 active landing/)
  })

  it("leaves an organization with no stated limit unmetered", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    setLandingAllowance(services, HOST_ORG, null)

    services.createLanding(landingInput())
    services.createLanding(landingInput({ name: "Second Spur" }))

    expect(services.activeLandingLimitFor(HOST_ORG)).toBeNull()
  })
})

describe("retiring a landing", () => {
  it("stops work being published from it, rather than only hiding the picker", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    setLandingAllowance(services, HOST_ORG, null)
    const landing = services.createLanding(landingInput())
    const route = services.createHaulRoute({
      actorUserId: HOST_OWNER,
      estimatedDistanceMiles: 40,
      estimatedRunTimeMinutes: 70,
      landingId: landing.id,
      millId: MILL,
      organizationId: HOST_ORG,
      roadCondition: "good",
      routeName: "Retired lane"
    })
    const rate = services.createRate({
      actorUserId: HOST_OWNER,
      amountCents: 4_000,
      effectiveDate: "2026-06-25",
      organizationId: HOST_ORG,
      rateType: "per_ton"
    })
    const dispatcher = services.state.dispatcherProfiles[0]!

    services.updateLanding({ ...landingInput(), isActive: false, landingId: landing.id })

    // Hiding it from the builder's picker is not enforcement: the REST route
    // takes a landing id straight from the caller.
    expect(() =>
      services.createLoadPostingWithPolicy({
        accessRequirements: [],
        actorUserId: HOST_OWNER,
        campaignEndDate: null,
        campaignStartDate: null,
        companyId: HOST_ORG,
        dailyTruckCountNeeded: 1,
        dispatcherContact: dispatcher.contact,
        dispatcherProfileId: dispatcher.id,
        dropoffMillId: MILL,
        equipmentRequirements: [],
        estimatedTonsPerLoad: 27,
        loadDate: "2026-06-25",
        loadType: "saw_logs",
        loaderContact: null,
        loaderProfileId: null,
        organizationId: HOST_ORG,
        pickupLandingId: landing.id,
        rateId: rate.id,
        recurringSchedule: null,
        roadCondition: "good",
        routeId: route.id,
        scheduleType: "one_off",
        status: "open",
        title: "Should not publish",
        weatherNotes: null
      })
    ).toThrow(/is retired/)

    // And nothing half-made is left behind.
    expect(services.state.loadPostings.some((load) => load.title === "Should not publish")).toBe(false)
  })
})

describe("editing a landing", () => {
  it("refuses to touch another organization's landing", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    setLandingAllowance(services, HOST_ORG, null)
    const foreign = services.state.landings.find((landing) => landing.companyId === HAULER_ORG)
      ?? services.state.landings.find((landing) => landing.companyId !== HOST_ORG)

    expect(foreign).toBeDefined()

    // The actor holds manage_landing in their own org. That is not a licence to
    // rewrite somebody else's site.
    expect(() =>
      services.updateLanding({ ...landingInput(), landingId: foreign!.id })
    ).toThrow(/belongs to another organization/)
  })
})

describe("creating a haul route", () => {
  it("records the lane from the host's landing to the destination", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    setLandingAllowance(services, HOST_ORG, null)
    const landing = services.createLanding(landingInput())

    const route = services.createHaulRoute({
      actorUserId: HOST_OWNER,
      estimatedDistanceMiles: 42.5,
      estimatedRunTimeMinutes: 75,
      landingId: landing.id,
      millId: MILL,
      organizationId: HOST_ORG,
      roadCondition: "good",
      routeName: "Blue River to Cascade"
    })

    expect(route.companyId).toBe(HOST_ORG)
    expect(route.landingId).toBe(landing.id)
  })

  it("is open to a dispatcher, who publishes the work it carries", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    setLandingAllowance(services, HOST_ORG, null)
    const landing = services.createLanding(landingInput())

    // A route is the plumbing a posting needs. Every role that may publish must
    // be able to produce one, or publish_load is hollow.
    const route = services.createHaulRoute({
      actorUserId: HOST_DISPATCHER,
      estimatedDistanceMiles: 42.5,
      estimatedRunTimeMinutes: 75,
      landingId: landing.id,
      millId: MILL,
      organizationId: HOST_ORG,
      roadCondition: "good",
      routeName: "Blue River to Cascade"
    })

    expect(route.id).toBeTruthy()
  })

  it("refuses a lane that starts at someone else's landing", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const foreign = services.state.landings.find((landing) => landing.companyId !== HOST_ORG)

    expect(foreign).toBeDefined()

    expect(() =>
      services.createHaulRoute({
        actorUserId: HOST_OWNER,
        estimatedDistanceMiles: 10,
        estimatedRunTimeMinutes: 20,
        landingId: foreign!.id,
        millId: MILL,
        organizationId: HOST_ORG,
        roadCondition: "good",
        routeName: "Not mine"
      })
    ).toThrow(/belongs to another organization/)
  })

  it("refuses a destination that does not exist", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    setLandingAllowance(services, HOST_ORG, null)
    const landing = services.createLanding(landingInput())

    expect(() =>
      services.createHaulRoute({
        actorUserId: HOST_OWNER,
        estimatedDistanceMiles: 10,
        estimatedRunTimeMinutes: 20,
        landingId: landing.id,
        millId: "11111111-2222-4333-8444-555555555555",
        organizationId: HOST_ORG,
        roadCondition: "good",
        routeName: "Nowhere"
      })
    ).toThrow(/destination was not found/)
  })
})

describe("creating a rate", () => {
  it("records what the organization pays to haul", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())

    const rate = services.createRate({
      actorUserId: HOST_OWNER,
      amountCents: 4_250,
      effectiveDate: "2026-06-25",
      organizationId: HOST_ORG,
      rateType: "per_ton"
    })

    expect(rate.companyId).toBe(HOST_ORG)
    expect(rate.baseRate).toEqual({ amountCents: 4_250, currency: "USD" })
    expect(rate.fuelSurchargeCents).toBe(0)
  })

  it("refuses a viewer", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const viewer = "3c3c3c3c-3c3c-4c3c-8c3c-3c3c3c3c3c03"

    grantMembership(services, { index: 3, organizationId: HOST_ORG, role: "viewer", userId: viewer })

    expect(() =>
      services.createRate({
        actorUserId: viewer,
        amountCents: 4_250,
        effectiveDate: "2026-06-25",
        organizationId: HOST_ORG,
        rateType: "per_ton"
      })
    ).toThrow(/cannot publish load/)
  })
})

describe("host onboarding", () => {
  it("gives a new host the dispatch contact publishing demands", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())

    const account = services.createAccount({
      accountType: "timber_organization",
      email: "new@timberco.example",
      fullName: "Pat Timber",
      organizationName: "Timber Co",
      path: "host",
      phone: "555-9100",
      region: "Central Oregon"
    })

    const organizationId = account.memberships[0]?.organization.id

    expect(organizationId).toBeTruthy()

    // Publishing refuses without a dispatch coordinate, and a host that just
    // signed up has no one else to be it.
    const dispatcher = services.state.dispatcherProfiles.find(
      (profile) => profile.companyId === organizationId
    )

    expect(dispatcher).toBeDefined()
    expect(dispatcher?.userId).toBe(account.profile.id)
    expect(dispatcher?.contact.name).toBe("Pat Timber")
    expect(dispatcher?.contact.phone).toBe("555-9100")
  })

  it("takes a brand-new host from sign-up to published work with no seed data", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())

    // This is the whole point of the slice, so it is asserted end to end rather
    // than inferred from the parts. Before this, every record below was
    // uncreatable in-product and a real host could never publish anything: the
    // builder refused, and told them to contact a support desk that does not
    // exist for records onboarding never made.
    const account = services.createAccount({
      accountType: "timber_organization",
      email: "owner@newtimber.example",
      fullName: "Robin Cedar",
      organizationName: "New Timber",
      path: "host",
      phone: "555-9300",
      region: "Central Oregon"
    })

    const actorUserId = account.profile.id
    const organizationId = account.memberships[0]!.organization.id

    const landing = services.createLanding({
      ...landingInput(),
      actorUserId,
      organizationId
    })

    const route = services.createHaulRoute({
      actorUserId,
      estimatedDistanceMiles: 42.5,
      estimatedRunTimeMinutes: 75,
      landingId: landing.id,
      millId: MILL,
      organizationId,
      roadCondition: "good",
      routeName: "New Timber to Cascade"
    })

    const rate = services.createRate({
      actorUserId,
      amountCents: 4_250,
      effectiveDate: "2026-06-25",
      organizationId,
      rateType: "per_ton"
    })

    const dispatcher = services.state.dispatcherProfiles.find(
      (profile) => profile.companyId === organizationId
    )

    expect(dispatcher).toBeDefined()

    const load = services.createLoadPostingWithPolicy({
      accessRequirements: [],
      actorUserId,
      campaignEndDate: null,
      campaignStartDate: null,
      companyId: organizationId,
      dailyTruckCountNeeded: 1,
      dispatcherContact: dispatcher!.contact,
      dispatcherProfileId: dispatcher!.id,
      dropoffMillId: route.millId,
      equipmentRequirements: [],
      estimatedTonsPerLoad: 27,
      loadDate: "2026-06-25",
      loadType: "saw_logs",
      loaderContact: null,
      loaderProfileId: null,
      organizationId,
      pickupLandingId: landing.id,
      rateId: rate.id,
      recurringSchedule: null,
      roadCondition: "good",
      routeId: route.id,
      scheduleType: "one_off",
      status: "open",
      title: "First haul off the new spur",
      weatherNotes: null
    })

    expect(load.status).toBe("open")
    expect(load.pickupLandingId).toBe(landing.id)

    // And the work is real capacity a driver can request, not an orphan record.
    expect(services.state.truckSlots.some((slot) => slot.loadPostingId === load.id)).toBe(true)
  })

  it("does not invent a dispatch contact for a driver", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())

    const account = services.createAccount({
      accountType: "owner_operator",
      email: "new@driver.example",
      fullName: "Sam Driver",
      path: "driver",
      phone: "555-9200",
      region: "Central Oregon"
    })

    expect(services.state.dispatcherProfiles.some(
      (profile) => profile.userId === account.profile.id
    )).toBe(false)
  })
})
