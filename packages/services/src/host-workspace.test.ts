import {
  entitlementSchema,
  hostBillingProfileSchema,
  organizationMembershipSchema,
  userSchema
} from "@logloads/contracts"
import { createInMemoryDatabase } from "@logloads/db"
import { describe, expect, it } from "vitest"

import { createLogLoadsServices, type LogLoadsServices } from "./index"
import type { CreateMillInput } from "./host-workspace"

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

function landingDetailsInput(landingId: string, overrides: Record<string, unknown> = {}) {
  return {
    actorUserId: HOST_OWNER,
    communicationInstructions: "Call the loader before the bridge.",
    entranceLat: 44.051,
    entranceLng: -121.311,
    gateInstructions: "Use the day code from dispatch.",
    landingId,
    loadingEquipment: ["heel-boom loader"],
    organizationId: HOST_ORG,
    privateRoadNotes: "Stay right at the fork.",
    publicApproximateArea: "Bend, OR — north woods",
    safetyRequirements: ["Hard hat and hi-vis outside the cab"],
    stagingInstructions: "Stage nose-out on the gravel apron.",
    turnaroundConstraints: ["No chip vans above the bridge"],
    ...overrides
  }
}

/** Gives an actor a role in an organization so a boundary can be probed from it. */
function grantMembership(
  services: LogLoadsServices,
  options: { userId: string; organizationId: string; role: "viewer" | "landing_manager" | "destination_manager" | "dispatcher"; index: number }
) {
  const suffix = options.index.toString().padStart(2, "0")

  services.state.profiles.push(userSchema.parse({
    clerkUserId: `clerk-host-workspace-${suffix}`,
    companyId: options.organizationId,
    createdAt: "2026-06-05T00:00:00.000Z",
    email: `host-workspace-${suffix}@example.com`,
    fullName: `Host workspace boundary ${suffix}`,
    id: options.userId,
    isActive: true,
    phone: "555-0100",
    role: "driver",
    updatedAt: "2026-06-05T00:00:00.000Z",
    verificationStatus: "pending"
  }))
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
  markBillingAccountLegacy(services, organizationId)
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

/** Removes the current percentage grant when a test is isolating old plan behavior. */
function markBillingAccountLegacy(services: LogLoadsServices, organizationId: string) {
  const account = services.state.organizationBillingAccounts.find(
    (candidate) => candidate.organizationId === organizationId
  )

  if (!account) throw new Error("Seed billing account missing")
  account.activationState = "legacy"
  account.billingModel = "legacy_percentage"
  account.percentageTermsSnapshot = null
}

/**
 * Puts a card on file for an organization, which is what publishing now requires:
 * the platform fee is charged to the host, so work that cannot be billed cannot
 * go on the network.
 *
 * Written straight into the document because there is no services-level way to
 * attach one: card attachment is a Stripe round trip and lives in the web layer,
 * which a services test cannot reach. This writes the row that flow produces, and
 * the row contract is what refuses a status that does not carry its own facts.
 */
function attachCard(services: LogLoadsServices, organizationId: string) {
  services.state.hostBillingProfiles.push(hostBillingProfileSchema.parse({
    attachedAt: "2026-06-05T00:00:00.000Z",
    createdAt: "2026-06-05T00:00:00.000Z",
    defaultPaymentMethodId: "pm_test_host_workspace",
    id: "34343434-3434-4434-8434-3434343434f1",
    lastFailureAt: null,
    lastFailureReason: null,
    organizationId,
    paymentMethodBrand: "visa",
    paymentMethodLast4: "4242",
    status: "attached",
    stripeCustomerId: "cus_test_host_workspace",
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

    services.setLandingActive({
      actorUserId: HOST_OWNER,
      isActive: false,
      landingId: first.id,
      organizationId: HOST_ORG
    })

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
    services.setLandingActive({ actorUserId: HOST_OWNER, isActive: false, landingId: retired.id, organizationId: HOST_ORG })
    services.createLanding(landingInput({ name: "Second Spur" }))

    // The slot is spoken for now, so switching the old one back on must refuse
    // rather than quietly put the org over its plan.
    expect(() =>
      services.setLandingActive({ actorUserId: HOST_OWNER, isActive: true, landingId: retired.id, organizationId: HOST_ORG })
    ).toThrow(/plan covers 1 active landing/)
  })

  it("leaves an organization whose live plan states no cap unmetered", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    setLandingAllowance(services, HOST_ORG, null)

    services.createLanding(landingInput())
    services.createLanding(landingInput({ name: "Second Spur" }))

    expect(services.activeLandingLimitFor(HOST_ORG)).toBeNull()
  })

  it("treats an accepted percentage agreement as uncapped without a subscription entitlement", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    services.state.entitlements = services.state.entitlements.filter(
      (entitlement) => entitlement.organizationId !== HOST_ORG
    )
    services.state.landings = services.state.landings.filter(
      (landing) => landing.companyId !== HOST_ORG
    )

    expect(services.activeLandingLimitFor(HOST_ORG)).toBeNull()
    services.createLanding(landingInput())
    services.createLanding(landingInput({ name: "Second Percentage Spur" }))
    expect(services.countActiveLandings(HOST_ORG)).toBe(2)
  })

  it("lets the current percentage agreement outrank a preserved historical landing cap", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const account = services.state.organizationBillingAccounts.find(
      (candidate) => candidate.organizationId === HOST_ORG
    )
    const percentageTermsSnapshot = structuredClone(account?.percentageTermsSnapshot ?? null)

    expect(percentageTermsSnapshot).not.toBeNull()
    setLandingAllowance(services, HOST_ORG, 1)
    if (!account || !percentageTermsSnapshot) return

    account.activationState = "percentage_active"
    account.billingModel = "percentage_v1"
    account.percentageTermsSnapshot = percentageTermsSnapshot
    services.state.landings = services.state.landings.filter(
      (landing) => landing.companyId !== HOST_ORG
    )

    expect(services.activeLandingLimitFor(HOST_ORG)).toBeNull()
    services.createLanding(landingInput())
    services.createLanding(landingInput({ name: "Second current-model landing" }))
    expect(services.countActiveLandings(HOST_ORG)).toBe(2)
  })

  it("does not choose an uncapped percentage account by array order when billing accounts conflict", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const account = services.state.organizationBillingAccounts.find(
      (candidate) => candidate.organizationId === HOST_ORG
    )
    const percentageTermsSnapshot = structuredClone(account?.percentageTermsSnapshot ?? null)

    expect(account).toBeDefined()
    expect(percentageTermsSnapshot).not.toBeNull()
    setLandingAllowance(services, HOST_ORG, 1)
    if (!account || !percentageTermsSnapshot) return

    account.activationState = "percentage_active"
    account.billingModel = "percentage_v1"
    account.percentageTermsSnapshot = percentageTermsSnapshot
    services.state.organizationBillingAccounts.push({
      ...structuredClone(account),
      activationState: "legacy",
      billingModel: "legacy_percentage",
      id: "4f4f4f4f-4f4f-4f4f-8f4f-4f4f4f4f4f01",
      percentageTermsSnapshot: null
    })

    // Publishing already blocks this corrupt state. Workspace capacity must do
    // the same, never granting unlimited setup because `.find()` saw the
    // percentage row first.
    expect(services.activeLandingLimitFor(HOST_ORG)).toBe(1)
  })

  it("does not activate percentage capacity before the agreement becomes effective", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const account = services.state.organizationBillingAccounts.find(
      (candidate) => candidate.organizationId === HOST_ORG
    )

    expect(account).toBeDefined()
    if (!account) return

    account.effectiveAt = "2100-01-01T00:00:00.000Z"
    services.state.entitlements = services.state.entitlements.filter(
      (entitlement) => entitlement.organizationId !== HOST_ORG
    )

    expect(services.activeLandingLimitFor(HOST_ORG)).toBe(0)
  })

  it("does not grant uncapped landings to a percentage account without accepted terms", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    services.state.entitlements = services.state.entitlements.filter(
      (entitlement) => entitlement.organizationId !== HOST_ORG
    )
    services.state.organizationBillingAccounts =
      services.state.organizationBillingAccounts.map((account) =>
        account.organizationId === HOST_ORG
          ? { ...account, percentageTermsSnapshot: null }
          : account
      )

    expect(services.activeLandingLimitFor(HOST_ORG)).toBe(0)
    expect(() => services.createLanding(landingInput())).toThrow(
      /does not cover any active landings/
    )
  })

  it("does not read a lapsed plan as an unlimited one", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    markBillingAccountLegacy(services, HOST_ORG)
    setLandingAllowance(services, HOST_ORG, 3)
    services.state.landings = services.state.landings.filter(
      (landing) => landing.companyId !== HOST_ORG
    )

    // "A live plan states no cap" and "there is no live plan" are different
    // answers. Collapsing them means the Stripe webhook writing `cancelled`
    // LIFTS the cap — a lapsed host creating landings without end while a
    // paying one is held to three. The advertised limit failing open is worse
    // than never having enforced it.
    for (const status of ["past_due", "cancelled"] as const) {
      services.state.entitlements = services.state.entitlements.map((entitlement) =>
        entitlement.organizationId === HOST_ORG ? { ...entitlement, status } : entitlement
      )

      expect(services.activeLandingLimitFor(HOST_ORG)).toBe(0)
      expect(() => services.createLanding(landingInput({ name: `Lapsed ${status}` })))
        .toThrow(/does not cover any active landings/)
    }
  })

  it("refuses an organization carrying no plan at all", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    markBillingAccountLegacy(services, HOST_ORG)
    services.state.entitlements = services.state.entitlements.filter(
      (entitlement) => entitlement.organizationId !== HOST_ORG
    )

    expect(services.activeLandingLimitFor(HOST_ORG)).toBe(0)
    expect(() => services.createLanding(landingInput())).toThrow(/does not cover any active landings/)
  })

  it("lets a live uncapped plan beat a capped one rather than the reverse", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    setLandingAllowance(services, HOST_ORG, 1)
    services.state.entitlements.push(entitlementSchema.parse({
      activeLandingLimit: null,
      activeTruckLimit: null,
      createdAt: "2026-06-05T00:00:00.000Z",
      currentPeriodEndsAt: null,
      features: [],
      id: "3f3f3f3f-3f3f-4f3f-8f3f-3f3f3f3f3f02",
      organizationId: HOST_ORG,
      product: "enterprise",
      status: "active",
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      updatedAt: "2026-06-05T00:00:00.000Z"
    }))

    // A plan that granted no cap said so for the whole organization; a stated
    // number sitting beside it cannot take back what the other one gave.
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
    const dispatcher = services.state.dispatcherProfiles.find((profile) => profile.companyId === HOST_ORG)!

    services.setLandingActive({ actorUserId: HOST_OWNER, isActive: false, landingId: landing.id, organizationId: HOST_ORG })

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
        driverPayCents: 52_500,
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

  it("stops a draft written before the retirement from being published after it", () => {
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
      routeName: "Draft lane"
    })
    const rate = services.createRate({
      actorUserId: HOST_OWNER,
      amountCents: 4_000,
      effectiveDate: "2026-06-25",
      organizationId: HOST_ORG,
      rateType: "per_ton"
    })
    const dispatcher = services.state.dispatcherProfiles.find((profile) => profile.companyId === HOST_ORG)!
    const draft = services.createLoadPostingWithPolicy({
      accessRequirements: [],
      actorUserId: HOST_OWNER,
      campaignEndDate: null,
      campaignStartDate: null,
      companyId: HOST_ORG,
      dailyTruckCountNeeded: 1,
      dispatcherContact: dispatcher.contact,
      dispatcherProfileId: dispatcher.id,
      driverPayCents: 52_500,
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
      status: "draft",
      title: "Drafted before retirement",
      weatherNotes: null
    })

    // A draft outliving the landing it names is the whole point of a draft, so
    // publishing one is the second way work reaches the network — and the host
    // Work page offers exactly that button.
    services.setLandingActive({ actorUserId: HOST_OWNER, isActive: false, landingId: landing.id, organizationId: HOST_ORG })

    expect(() =>
      services.openDraftLoadPosting({
        actorUserId: HOST_OWNER,
        loadPostingId: draft.id,
        organizationId: HOST_ORG
      })
    ).toThrow(/is retired/)

    expect(services.state.loadPostings.find((load) => load.id === draft.id)?.status).toBe("draft")
    expect(services.state.truckSlots.some((slot) => slot.loadPostingId === draft.id)).toBe(false)
  })

  it("refuses a posting that names a landing nobody has", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const dispatcher = services.state.dispatcherProfiles.find((profile) => profile.companyId === HOST_ORG)!

    // The guard reads a landing off the id it is given; a missing one must fail
    // closed rather than sail through for want of anything to check.
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
        driverPayCents: 52_500,
        dropoffMillId: MILL,
        equipmentRequirements: [],
        estimatedTonsPerLoad: 27,
        loadDate: "2026-06-25",
        loadType: "saw_logs",
        loaderContact: null,
        loaderProfileId: null,
        organizationId: HOST_ORG,
        pickupLandingId: "11111111-2222-4333-8444-555555555555",
        rateId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3",
        recurringSchedule: null,
        roadCondition: "good",
        routeId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3",
        scheduleType: "one_off",
        status: "open",
        title: "Landing does not exist",
        weatherNotes: null
      })
    ).toThrow(/landing was not found/)
  })
})

describe("retiring without rewriting", () => {
  it("changes only whether work happens there", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    setLandingAllowance(services, HOST_ORG, null)
    const landing = services.createLanding(landingInput())

    // Someone renames it after this page was rendered.
    services.updateLanding({ ...landingInput({ name: "Renamed by someone else" }), landingId: landing.id })

    const retired = services.setLandingActive({
      actorUserId: HOST_OWNER,
      isActive: false,
      landingId: landing.id,
      organizationId: HOST_ORG
    })

    // Retiring must not carry a stale copy of the record back with it and undo
    // their edit. It sends an id and a flag; there is nothing stale to send.
    expect(retired.isActive).toBe(false)
    expect(retired.name).toBe("Renamed by someone else")
    expect(services.state.auditEvents.some((event) =>
      event.action === "landing_retired" && event.entityId === landing.id
    )).toBe(true)
  })

  it("keeps an edit from touching whether the landing is active at all", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    setLandingAllowance(services, HOST_ORG, null)
    const landing = services.createLanding(landingInput())

    services.setLandingActive({
      actorUserId: HOST_OWNER,
      isActive: false,
      landingId: landing.id,
      organizationId: HOST_ORG
    })

    // One way to retire, one way to edit. An edit form cannot resurrect a
    // retired landing as a side effect of saving a new phone number.
    const edited = services.updateLanding({
      ...landingInput({ name: "Still retired" }),
      landingId: landing.id
    })

    expect(edited.isActive).toBe(false)
  })

  it("records nothing when the landing is already in that state", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    setLandingAllowance(services, HOST_ORG, null)
    const landing = services.createLanding(landingInput())

    const unchanged = services.setLandingActive({
      actorUserId: HOST_OWNER,
      isActive: true,
      landingId: landing.id,
      organizationId: HOST_ORG
    })

    // The audit log says what changed. A retirement in the history of a landing
    // that was never retired is a transition nobody made, and a reader
    // reconstructing this landing's life would believe it.
    expect(unchanged.updatedAt).toBe(landing.updatedAt)
    expect(services.state.auditEvents.filter((event) =>
      ["landing_retired", "landing_restored"].includes(event.action) && event.entityId === landing.id
    )).toHaveLength(0)
  })

  it("refuses to retire another organization's landing", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const foreign = services.state.landings.find((landing) => landing.companyId !== HOST_ORG)

    expect(foreign).toBeDefined()
    expect(() =>
      services.setLandingActive({
        actorUserId: HOST_OWNER,
        isActive: false,
        landingId: foreign!.id,
        organizationId: HOST_ORG
      })
    ).toThrow(/belongs to another organization/)
  })
})

describe("editing a landing", () => {
  it("keeps optional fields an update never mentioned", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    setLandingAllowance(services, HOST_ORG, null)
    const landing = services.createLanding(landingInput({
      accessNotes: "Turn at the second gate.",
      roadCondition: "muddy"
    }))

    // A caller that says nothing about the approach notes is not asking for
    // them to be deleted. Only an explicit null clears.
    const renamed = services.updateLanding({
      actorUserId: HOST_OWNER,
      addressLine1: landing.addressLine1,
      city: landing.city,
      contact: landing.contact,
      coordinates: landing.coordinates,
      landingId: landing.id,
      name: "Renamed only",
      organizationId: HOST_ORG,
      postalCode: landing.postalCode,
      state: landing.state
    })

    expect(renamed.name).toBe("Renamed only")
    expect(renamed.accessNotes).toBe("Turn at the second gate.")
    expect(renamed.roadCondition).toBe("muddy")

    // And an explicit null still clears, because that is a real instruction.
    const cleared = services.updateLanding({
      ...landingInput({ accessNotes: null, name: "Cleared" }),
      landingId: landing.id
    })

    expect(cleared.accessNotes).toBeNull()
  })

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

describe("maintaining a landing driver briefing", () => {
  it("stamps ownership and assignment-only visibility, then audits the verification", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    setLandingAllowance(services, HOST_ORG, null)
    const landing = services.createLanding(landingInput())

    const details = services.upsertLandingDetails(landingDetailsInput(landing.id))

    expect(details.landingId).toBe(landing.id)
    expect(details.controlledByOrganizationId).toBe(HOST_ORG)
    expect(details.exactLocationVisibility).toBe("assigned_only")
    expect(details.gateInstructions).toBe("Use the day code from dispatch.")
    expect(details.lastVerifiedAt).toBe(details.updatedAt)
    expect(services.state.auditEvents).toContainEqual(expect.objectContaining({
      action: "landing_details_created",
      entityId: details.id,
      entityType: "rich_landing_details"
    }))
  })

  it("updates the one briefing without changing its identity or creation time", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    setLandingAllowance(services, HOST_ORG, null)
    const landing = services.createLanding(landingInput())
    const original = services.upsertLandingDetails(landingDetailsInput(landing.id))

    const updated = services.upsertLandingDetails(landingDetailsInput(landing.id, {
      gateInstructions: "Gate is open; check in by radio.",
      safetyRequirements: ["Eye protection at the scale"]
    }))

    expect(updated.id).toBe(original.id)
    expect(updated.createdAt).toBe(original.createdAt)
    expect(updated.gateInstructions).toBe("Gate is open; check in by radio.")
    expect(services.state.richLandingDetails.filter((item) => item.landingId === landing.id)).toHaveLength(1)
    expect(services.state.auditEvents).toContainEqual(expect.objectContaining({
      action: "landing_details_updated",
      entityId: original.id
    }))
  })

  it("deduplicates repeated list facts and refuses conflicting stored rows", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    setLandingAllowance(services, HOST_ORG, null)
    const landing = services.createLanding(landingInput())
    const original = services.upsertLandingDetails(landingDetailsInput(landing.id, {
      // The limit is on unique facts, not repeated lines pasted by a user.
      // This is intentionally over the raw 12-line cap and only one after
      // normalization, so max-before-dedupe would fail this regression.
      loadingEquipment: Array.from({ length: 13 }, () => "heel-boom loader")
    }))

    expect(original.loadingEquipment).toEqual(["heel-boom loader"])

    services.state.richLandingDetails.push({
      ...original,
      id: "4d4d4d4d-4d4d-4d4d-8d4d-4d4d4d4d4d01"
    })

    expect(() => services.upsertLandingDetails(landingDetailsInput(landing.id)))
      .toThrow(/conflicting driver briefing records/)
  })

  it("lets a landing manager verify details but refuses a dispatcher", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    setLandingAllowance(services, HOST_ORG, null)
    const landing = services.createLanding(landingInput())
    const manager = "3c3c3c3c-3c3c-4c3c-8c3c-3c3c3c3c3c04"

    grantMembership(services, { index: 4, organizationId: HOST_ORG, role: "landing_manager", userId: manager })

    expect(services.upsertLandingDetails(landingDetailsInput(landing.id, { actorUserId: manager })).id).toBeTruthy()
    expect(() => services.upsertLandingDetails(landingDetailsInput(landing.id, {
      actorUserId: HOST_DISPATCHER
    }))).toThrow(/cannot manage landing/)
  })

  it("refuses another organization's landing or an already cross-wired briefing", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    setLandingAllowance(services, HOST_ORG, null)
    const foreignLanding = services.state.landings.find((landing) => landing.companyId !== HOST_ORG)

    expect(foreignLanding).toBeDefined()
    expect(() => services.upsertLandingDetails(landingDetailsInput(foreignLanding!.id)))
      .toThrow(/belongs to another organization/)

    const ownLanding = services.createLanding(landingInput())
    services.upsertLandingDetails(landingDetailsInput(ownLanding.id))
    services.state.richLandingDetails = services.state.richLandingDetails.map((details) =>
      details.landingId === ownLanding.id
        ? { ...details, controlledByOrganizationId: HAULER_ORG }
        : details
    )

    expect(() => services.upsertLandingDetails(landingDetailsInput(ownLanding.id)))
      .toThrow(/briefing belongs to another organization/)
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

describe("creating a destination", () => {
  function millInput(overrides: Partial<CreateMillInput> = {}): CreateMillInput {
    return {
      actorUserId: HOST_OWNER,
      addressLine1: "88 Scale House Rd",
      city: "Gilchrist",
      contact: { email: "scale@gilchrist.example", name: "Scale House", phone: "555-4001" },
      coordinates: { lat: 43.48, lng: -121.68 },
      name: "Gilchrist Veneer",
      organizationId: HOST_ORG,
      postalCode: "97737",
      roadCondition: "wet",
      state: "OR",
      ...overrides
    }
  }

  it("records an organization destination that is immediately usable in a lane", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    setLandingAllowance(services, HOST_ORG, null)
    const landing = services.createLanding(landingInput())

    const mill = services.createMill(millInput())

    expect(mill.companyId).toBe(HOST_ORG)
    expect(mill.millCode).toMatch(/^HOST-[A-Z0-9]+-[A-F0-9]{32}$/)
    expect(mill.roadCondition).toBe("wet")
    expect(services.state.auditEvents.some(
      (event) => event.action === "mill_created" && event.entityId === mill.id
    )).toBe(true)

    const route = services.createHaulRoute({
      actorUserId: HOST_OWNER,
      estimatedDistanceMiles: 18,
      estimatedRunTimeMinutes: 35,
      landingId: landing.id,
      millId: mill.id,
      organizationId: HOST_ORG,
      roadCondition: "good",
      routeName: "Blue River to Gilchrist"
    })

    expect(route.millId).toBe(mill.id)
  })

  it("uses globally unique internal codes even when destination name stems match", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const north = services.createMill(millInput({ name: "Gilchrist Veneer North" }))
    const south = services.createMill(millInput({ name: "Gilchrist Veneer South" }))

    expect(north.millCode).not.toBe(south.millCode)
  })

  it("refuses a member whose role cannot manage destinations or publish", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const viewerId = "22222222-2222-4222-8222-222222222299"

    grantMembership(services, { index: 41, organizationId: HOST_ORG, role: "viewer", userId: viewerId })

    expect(() =>
      services.createMill(millInput({ actorUserId: viewerId }))
    ).toThrow(/cannot manage destination/)
  })

  it("lets a destination manager maintain destinations without granting load publication", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const managerId = "22222222-2222-4222-8222-222222222298"
    grantMembership(services, {
      index: 42,
      organizationId: HOST_ORG,
      role: "destination_manager",
      userId: managerId
    })

    const mill = services.createMill(millInput({ actorUserId: managerId }))
    const updated = services.updateMill({
      ...millInput({ actorUserId: managerId, city: "La Pine" }),
      millId: mill.id
    })
    const retired = services.setMillActive({
      actorUserId: managerId,
      isActive: false,
      millId: mill.id,
      organizationId: HOST_ORG
    })

    expect(updated.city).toBe("La Pine")
    expect(retired.isActive).toBe(false)
    expect(() => services.createHaulRoute({
      actorUserId: managerId,
      estimatedDistanceMiles: 12,
      estimatedRunTimeMinutes: 25,
      landingId: services.state.landings.find((landing) => landing.companyId === HOST_ORG)!.id,
      millId: MILL,
      organizationId: HOST_ORG,
      roadCondition: "good",
      routeName: "Manager cannot publish"
    })).toThrow(/cannot publish load/)
  })

  it("uses name, city, and state to detect a workspace duplicate", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    services.createMill(millInput())

    expect(() =>
      services.createMill(millInput({ addressLine1: "Different street" }))
    ).toThrow(/already on file/)

    expect(() => services.createMill(millInput({ state: "WA" }))).not.toThrow()
  })

  it("trims and bounds destination data before it reaches the canonical document", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const mill = services.createMill(millInput({
      contact: { email: " SCALE@GILCHRIST.EXAMPLE ", name: " Scale House ", phone: " 555-4001 " },
      name: " Gilchrist Veneer ",
      state: "or"
    }))

    expect(mill.name).toBe("Gilchrist Veneer")
    expect(mill.state).toBe("OR")
    expect(mill.contact).toEqual({
      email: "scale@gilchrist.example",
      name: "Scale House",
      phone: "555-4001"
    })
    expect(() => services.createMill(millInput({ name: "x".repeat(121) }))).toThrow()
    expect(() => services.createMill(millInput({ state: "Oregon" }))).toThrow(/two-letter state code/)
    expect(() => services.createMill(millInput({
      contact: { email: null, name: "Scale House", phone: "       " }
    }))).toThrow(/usable destination phone/)
  })

  it("lets the owning host correct and retire a destination without changing its identity", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const mill = services.createMill(millInput())
    const updated = services.updateMill({
      ...millInput({ city: "La Pine", roadCondition: "muddy" }),
      millId: mill.id
    })

    expect(updated.id).toBe(mill.id)
    expect(updated.millCode).toBe(mill.millCode)
    expect(updated.city).toBe("La Pine")
    expect(updated.roadCondition).toBe("muddy")

    const retired = services.setMillActive({
      actorUserId: HOST_OWNER,
      isActive: false,
      millId: mill.id,
      organizationId: HOST_ORG
    })

    expect(retired.isActive).toBe(false)
    expect(services.state.auditEvents.some(
      (event) => event.action === "mill_retired" && event.entityId === mill.id
    )).toBe(true)
  })

  it("refuses corrections to a shared destination and refuses retired destinations in new lanes", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const landing = services.state.landings.find((candidate) => candidate.companyId === HOST_ORG)
    const mill = services.createMill(millInput())

    expect(landing).toBeDefined()
    expect(() => services.updateMill({ ...millInput(), millId: MILL })).toThrow(/destination was not found/)

    services.setMillActive({
      actorUserId: HOST_OWNER,
      isActive: false,
      millId: mill.id,
      organizationId: HOST_ORG
    })

    expect(() => services.createHaulRoute({
      actorUserId: HOST_OWNER,
      estimatedDistanceMiles: 18,
      estimatedRunTimeMinutes: 35,
      landingId: landing!.id,
      millId: mill.id,
      organizationId: HOST_ORG,
      roadCondition: "good",
      routeName: "Retired destination lane"
    })).toThrow(/destination was not found/)
  })

  it("keeps a submitted destination invisible to other organizations' lanes", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const mill = services.createMill(millInput())
    const haulerLanding = services.state.landings.find(
      (landing) => landing.companyId === HAULER_ORG
    )

    expect(haulerLanding).toBeDefined()

    // The refusal reads exactly like a missing record so the endpoint cannot
    // become an oracle for another organization's private destinations.
    expect(() =>
      services.createHaulRoute({
        actorUserId: HOST_DISPATCHER,
        estimatedDistanceMiles: 12,
        estimatedRunTimeMinutes: 25,
        landingId: haulerLanding!.id,
        millId: mill.id,
        organizationId: HAULER_ORG,
        roadCondition: "good",
        routeName: "Oak to Gilchrist"
      })
    ).toThrow(/destination was not found/)
  })

  it("scopes destination reads to shared and organization-owned records", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const owned = services.createMill(millInput())
    const foreign = {
      ...owned,
      companyId: HAULER_ORG,
      id: "99999999-9999-4999-8999-999999999998",
      millCode: "HOST-FOREIGN-SCOPED"
    }
    services.state.mills.push(foreign)

    const visible = services.listMillsForOrganization(HOST_ORG)

    expect(visible.some((mill) => mill.id === owned.id)).toBe(true)
    expect(visible.some((mill) => mill.id === MILL)).toBe(true)
    expect(visible.some((mill) => mill.id === foreign.id)).toBe(false)
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

  it("lets a new host prepare owned records but blocks live work until explicit plan activation", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())

    // This is the whole point of the slice, so it is asserted rather than
    // inferred from the parts. Before this, every record below was uncreatable
    // in-product and a real host could never publish anything: the builder
    // refused, and told them to contact a support desk that does not exist for
    // records onboarding never made.
    //
    // The seed is loaded — the destination it hauls to is a platform record and
    // has to come from somewhere — but the organization is minted here and owns
    // nothing at the start. What this proves is that a host needs no seeded
    // records OF ITS OWN, which is the thing that was untrue.
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

    const posting = {
      accessRequirements: [],
      actorUserId,
      campaignEndDate: null,
      campaignStartDate: null,
      companyId: organizationId,
      dailyTruckCountNeeded: 1,
      dispatcherContact: dispatcher!.contact,
      dispatcherProfileId: dispatcher!.id,
      // What one truckload pays the driver. The host states it; the fee is
      // charged to the host on top of it.
      driverPayCents: 52_500,
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
    }

    // Workspace setup is free, but no legacy fee or paid plan is invented for a
    // new host. A card reference alone cannot silently enroll it either.
    expect(() => services.createLoadPostingWithPolicy(posting)).toThrow(
      /accept the current LogLoads fee agreement/
    )
    expect(services.state.loadPostings.some((load) => load.title === posting.title)).toBe(false)

    attachCard(services, organizationId)

    expect(() => services.createLoadPostingWithPolicy(posting)).toThrow(
      /accept the current LogLoads fee agreement/
    )
    expect(
      services.state.organizationBillingAccounts.find(
        (account) => account.organizationId === organizationId
      )
    ).toMatchObject({
      activationState: "unenrolled",
      billingModel: null,
      subscriptionId: null
    })
    expect(services.state.truckSlots.some(
      (slot) =>
        services.state.loadPostings.some(
          (load) => load.id === slot.loadPostingId && load.title === posting.title
        )
    )).toBe(false)
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
