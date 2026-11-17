import {
  isCurrentPercentageAgreement,
  PERCENTAGE_FEE_RETIRED_CODE,
  PERCENTAGE_FEE_RETIRED_MESSAGE,
  PERCENTAGE_V1_TERMS_VERSION,
  PLATFORM_FEE_BPS
} from "@logloads/contracts"
import { createInMemoryDatabase } from "@logloads/db"
import { afterEach, describe, expect, it, vi } from "vitest"

import { createLogLoadsServices } from "./index"
import {
  acceptPercentageBillingAgreement,
  PercentageFeeRetiredError
} from "./percentage-billing"
import { DomainRefusalError } from "./utils"

/**
 * The completed-load percentage fee is retired. These tests hold the service
 * boundary to two promises: nothing can create a new percentage agreement,
 * however it is called, and every agreement accepted before the retirement
 * stays exactly as it was recorded.
 */

const HOST = "33333333-3333-4333-8333-333333333332"
const HOST_OWNER = "22222222-2222-4222-8222-222222222223"
const HOST_DISPATCHER = "22222222-2222-4222-8222-222222222224"
const HOST_LANDING = "66666666-6666-4666-8666-666666666662"
const FLEET = "33333333-3333-4333-8333-333333333334"
const FLEET_OWNER = "22222222-2222-4222-8222-222222222227"
const ACCEPTED_AT = "2026-08-04T12:00:00.000Z"

type Services = ReturnType<typeof createLogLoadsServices>

function acceptanceInput() {
  return {
    acceptedTermsVersion: PERCENTAGE_V1_TERMS_VERSION,
    actorUserId: HOST_OWNER,
    organizationId: HOST
  }
}

function hostAccount(services: Services) {
  const account = services.state.organizationBillingAccounts.find(
    (candidate) => candidate.organizationId === HOST
  )

  if (!account) throw new Error("Seed host billing account missing")
  return account
}

function markHostUnenrolled(services: Services) {
  const account = hostAccount(services)
  account.activationState = "unenrolled"
  account.billingModel = null
  account.percentageTermsSnapshot = null
  account.subscriptionId = null
  return account
}

function markHostLegacy(services: Services) {
  const account = hostAccount(services)
  account.activationState = "legacy"
  account.billingModel = "legacy_percentage"
  account.percentageTermsSnapshot = null
  account.subscriptionId = null
  return account
}

function activeHistoricalSubscription(services: Services) {
  markHostLegacy(services)
  const configured = services.configureOrganizationSubscription(
    {
      acceptedAt: "2026-07-30T12:00:00.000Z",
      acceptedByUserId: HOST_OWNER,
      acceptedTermsVersion: "subscription-v1-2026-07-28",
      configuredByUserId: HOST_OWNER,
      operatingMarketIds: [HOST_LANDING],
      organizationId: HOST,
      planCode: "network_25"
    },
    "2026-07-30T12:00:00.000Z"
  ).subscription
  services.activateOrganizationSubscription(
    {
      actorUserId: HOST_OWNER,
      organizationId: HOST,
      subscriptionId: configured.id
    },
    "2026-07-30T13:00:00.000Z"
  )

  return services.activateAuthorizedOrganizationSubscriptionFromProvider(
    {
      currentPeriodEnd: "2026-08-31T00:00:00.000Z",
      currentPeriodStart: "2026-07-31T00:00:00.000Z",
      providerInvoiceId: "in_percentagetransition001",
      stripeCustomerId: "cus_percentage_transition_001",
      stripeSubscriptionId: "sub_percentage_transition_001",
      subscriptionId: configured.id
    },
    "2026-07-31T00:01:00.000Z"
  ).subscription
}

function terminalHistoricalSubscription(services: Services) {
  const subscription = activeHistoricalSubscription(services)
  const stored = services.state.organizationSubscriptions.find(
    (candidate) => candidate.id === subscription.id
  )!
  stored.status = "cancelled"
  stored.operationalExpiredAt = "2026-08-03T00:00:00.000Z"
  return stored
}

/**
 * The account exactly as the retired acceptance stored it before the
 * retirement. History tests start from this row rather than calling the
 * service, because the service can no longer write it.
 */
function seedHistoricalAcceptance(services: Services, at = ACCEPTED_AT) {
  const account = hostAccount(services)
  account.activationState = "percentage_active"
  account.billingModel = "percentage_v1"
  account.effectiveAt = at
  account.percentageTermsSnapshot = {
    acceptedAt: at,
    acceptedByUserId: HOST_OWNER,
    acceptedTermsVersion: PERCENTAGE_V1_TERMS_VERSION,
    billingCadence: "monthly_in_arrears",
    currency: "USD",
    feeBps: PLATFORM_FEE_BPS
  }
  account.subscriptionId = null
  account.updatedAt = at
  return account
}

function delayedProviderInput(
  subscription: ReturnType<typeof activeHistoricalSubscription>
) {
  return {
    currentPeriodEnd: subscription.currentPeriodEnd as string,
    currentPeriodStart: subscription.currentPeriodStart as string,
    paymentState: "none" as const,
    providerEffectiveAt: "2026-08-03T00:00:00.000Z",
    status: "cancelled" as const,
    stripeCustomerId: subscription.stripeCustomerId as string,
    stripeSubscriptionId: subscription.stripeSubscriptionId as string,
    subscriptionId: subscription.id
  }
}

function acceptanceAudits(services: Services) {
  return services.state.auditEvents.filter(
    (event) => event.action === "percentage_v1_agreement_accepted"
  )
}

function expectRetiredRefusal(attempt: () => unknown) {
  let caught: unknown

  try {
    attempt()
  } catch (error) {
    caught = error
  }

  expect(caught).toBeInstanceOf(PercentageFeeRetiredError)
  // A domain refusal, so every HTTP boundary answers it as a 4xx policy
  // refusal rather than a 500.
  expect(caught).toBeInstanceOf(DomainRefusalError)
  expect((caught as PercentageFeeRetiredError).code).toBe(
    PERCENTAGE_FEE_RETIRED_CODE
  )
  expect((caught as Error).message).toBe(PERCENTAGE_FEE_RETIRED_MESSAGE)
}

describe("a new percentage agreement is refused", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it.each([
    {
      label: "an unenrolled host",
      prepare: markHostUnenrolled
    },
    {
      label: "an explicit legacy host",
      prepare: markHostLegacy
    },
    {
      label: "a host whose historical subscription is terminal",
      prepare: terminalHistoricalSubscription
    },
    {
      label: "a host that already accepted percentage-v1-2026-08-03",
      prepare: (services: Services) => seedHistoricalAcceptance(services)
    }
  ])("refuses $label and writes nothing", ({ prepare }) => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    prepare(services)
    const before = structuredClone(services.state)

    expectRetiredRefusal(() =>
      services.acceptPercentageBillingAgreement(acceptanceInput(), ACCEPTED_AT)
    )
    expect(services.state).toEqual(before)
  })

  it("refuses a host with no billing account at all", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    services.state.organizationBillingAccounts =
      services.state.organizationBillingAccounts.filter(
        (account) => account.organizationId !== HOST
      )
    const before = structuredClone(services.state)

    expectRetiredRefusal(() =>
      services.acceptPercentageBillingAgreement(acceptanceInput(), ACCEPTED_AT)
    )
    expect(services.state).toEqual(before)
  })

  it("gives every caller the same refusal, whoever they are and whatever they send", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    markHostUnenrolled(services)
    const before = structuredClone(services.state)

    // The old rules refused these callers for different reasons. One constant
    // answer means the refusal cannot be used to learn about a member, an
    // organization or an input rule.
    for (const input of [
      { ...acceptanceInput(), actorUserId: HOST_DISPATCHER },
      {
        acceptedTermsVersion: PERCENTAGE_V1_TERMS_VERSION,
        actorUserId: FLEET_OWNER,
        organizationId: FLEET
      },
      { ...acceptanceInput(), acceptedTermsVersion: "attacker-selected" },
      { acceptedTermsVersion: "", actorUserId: "not-a-uuid", organizationId: "" }
    ]) {
      expectRetiredRefusal(() =>
        services.acceptPercentageBillingAgreement(input, ACCEPTED_AT)
      )
    }
    expect(services.state).toEqual(before)
  })

  it("refuses the same way on every retry and leaves no audit or notification", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    markHostLegacy(services)
    const before = structuredClone(services.state)

    for (const at of [ACCEPTED_AT, "2026-08-04T12:05:00.000Z", undefined]) {
      expectRetiredRefusal(() =>
        services.acceptPercentageBillingAgreement(acceptanceInput(), at)
      )
    }

    expect(acceptanceAudits(services)).toHaveLength(0)
    expect(services.state.notifications).toEqual(before.notifications)
    expect(services.state).toEqual(before)
  })

  it("refuses the free function as well as the bound service method", () => {
    const state = createInMemoryDatabase()
    const before = structuredClone(state)

    expectRetiredRefusal(() =>
      acceptPercentageBillingAgreement(state, acceptanceInput(), ACCEPTED_AT)
    )
    expect(state).toEqual(before)
  })

  it("holds even when both percentage flags are set to enabled", () => {
    // The flags stay as they are and stay dark in every environment. This proves
    // that switching them on still cannot reopen enrollment or accrual.
    vi.stubEnv("LOGLOADS_PERCENTAGE_ENROLLMENT", "enabled")
    vi.stubEnv("LOGLOADS_PERCENTAGE_ALLOWED_ORGANIZATION_IDS", HOST)
    vi.stubEnv("LOGLOADS_FEE_COLLECTION", "enabled")
    const services = createLogLoadsServices(createInMemoryDatabase())
    markHostUnenrolled(services)
    const before = structuredClone(services.state)

    expectRetiredRefusal(() =>
      services.acceptPercentageBillingAgreement(acceptanceInput(), ACCEPTED_AT)
    )
    expect(services.state).toEqual(before)
  })
})

describe("agreements accepted before the retirement stay readable", () => {
  it("leaves a stored percentage-v1-2026-08-03 agreement exactly as recorded", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const account = hostAccount(services)
    const recorded = structuredClone(account)

    // The seed host accepted the agreement before the retirement.
    expect(isCurrentPercentageAgreement(account)).toBe(true)

    expectRetiredRefusal(() =>
      services.acceptPercentageBillingAgreement(acceptanceInput(), ACCEPTED_AT)
    )

    expect(hostAccount(services)).toEqual(recorded)
    expect(hostAccount(services).percentageTermsSnapshot).toEqual({
      acceptedAt: recorded.percentageTermsSnapshot?.acceptedAt,
      acceptedByUserId: HOST_OWNER,
      acceptedTermsVersion: PERCENTAGE_V1_TERMS_VERSION,
      billingCadence: "monthly_in_arrears",
      currency: "USD",
      feeBps: PLATFORM_FEE_BPS
    })
    expect(isCurrentPercentageAgreement(hostAccount(services))).toBe(true)
  })

  it("acknowledges delayed provider lifecycle after a historical crossover without reviving subscription billing", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const stored = terminalHistoricalSubscription(services)
    const accepted = structuredClone(seedHistoricalAcceptance(services))
    const historicalBefore = structuredClone(stored)
    const providerInput = delayedProviderInput(stored)

    const delayed = services.bindOrganizationSubscriptionProvider(
      providerInput,
      "2026-08-04T12:10:00.000Z"
    )
    const redelivery = services.bindOrganizationSubscriptionProvider(
      providerInput,
      "2026-08-04T12:11:00.000Z"
    )

    expect(delayed).toMatchObject({ changed: false, outcome: "historical_ignored" })
    expect(redelivery).toMatchObject({ changed: false, outcome: "historical_ignored" })
    expect(
      services.state.organizationSubscriptions.find(
        (candidate) => candidate.id === stored.id
      )
    ).toEqual(historicalBefore)
    expect(hostAccount(services)).toEqual(accepted)
    expect(
      services.state.auditEvents.filter(
        (event) =>
          event.action === "historical_subscription_provider_lifecycle_ignored" &&
          event.entityId === stored.id
      )
    ).toHaveLength(1)
  })

  it("fails before mutating terminal provider history when billing accounts conflict", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const stored = terminalHistoricalSubscription(services)
    const staleSubscriptionAccount = structuredClone(hostAccount(services))
    seedHistoricalAcceptance(services)
    services.state.organizationBillingAccounts.push({
      ...staleSubscriptionAccount,
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1"
    })
    const before = structuredClone(services.state)

    expect(() =>
      services.bindOrganizationSubscriptionProvider(
        delayedProviderInput(stored),
        "2026-08-04T12:10:00.000Z"
      )
    ).toThrow(/conflicting billing accounts/)
    expect(services.state).toEqual(before)
  })

  it("fails before mutating terminal provider history for a malformed historical agreement", () => {
    for (const defect of ["subscription_pointer", "missing_terms"] as const) {
      const services = createLogLoadsServices(createInMemoryDatabase())
      const stored = terminalHistoricalSubscription(services)
      const account = seedHistoricalAcceptance(services)
      if (defect === "subscription_pointer") {
        account.subscriptionId = stored.id
      } else {
        account.percentageTermsSnapshot = null
      }
      const before = structuredClone(services.state)

      expect(() =>
        services.bindOrganizationSubscriptionProvider(
          delayedProviderInput(stored),
          "2026-08-04T12:10:00.000Z"
        )
      ).toThrow(/invalid percentage_v1 billing account/)
      expect(services.state).toEqual(before)
    }
  })
})
