import {
  PERCENTAGE_V1_TERMS_VERSION,
  PLATFORM_FEE_BPS
} from "@logloads/contracts"
import { createInMemoryDatabase } from "@logloads/db"
import { describe, expect, it } from "vitest"

import { createLogLoadsServices } from "./index"
import { DomainRefusalError } from "./utils"

const HOST = "33333333-3333-4333-8333-333333333332"
const HOST_OWNER = "22222222-2222-4222-8222-222222222223"
const HOST_DISPATCHER = "22222222-2222-4222-8222-222222222224"
const HOST_LANDING = "66666666-6666-4666-8666-666666666662"
const FLEET = "33333333-3333-4333-8333-333333333334"
const FLEET_OWNER = "22222222-2222-4222-8222-222222222227"
const ACCEPTED_AT = "2026-08-04T12:00:00.000Z"

function acceptanceInput() {
  return {
    acceptedTermsVersion: PERCENTAGE_V1_TERMS_VERSION,
    actorUserId: HOST_OWNER,
    organizationId: HOST
  }
}

function markHostLegacy(
  services: ReturnType<typeof createLogLoadsServices>
) {
  const account = services.state.organizationBillingAccounts.find(
    (candidate) => candidate.organizationId === HOST
  )

  if (!account) throw new Error("Seed host billing account missing")
  account.activationState = "legacy"
  account.billingModel = "legacy_percentage"
  account.percentageTermsSnapshot = null
  account.subscriptionId = null
  return account
}

function activeHistoricalSubscription(
  services: ReturnType<typeof createLogLoadsServices>
) {
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

describe("percentage_v1 agreement acceptance", () => {
  it("moves an explicit legacy host to the exact current agreement without rewriting frozen work", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    markHostLegacy(services)
    const assignmentsBefore = structuredClone(services.state.assignments)

    const result = services.acceptPercentageBillingAgreement(
      acceptanceInput(),
      ACCEPTED_AT
    )

    expect(result.changed).toBe(true)
    expect(result.account).toMatchObject({
      activationState: "percentage_active",
      billingModel: "percentage_v1",
      effectiveAt: ACCEPTED_AT,
      percentageTermsSnapshot: {
        acceptedAt: ACCEPTED_AT,
        acceptedByUserId: HOST_OWNER,
        acceptedTermsVersion: PERCENTAGE_V1_TERMS_VERSION,
        billingCadence: "monthly_in_arrears",
        currency: "USD",
        feeBps: PLATFORM_FEE_BPS
      },
      subscriptionId: null
    })
    expect(services.state.assignments).toEqual(assignmentsBefore)
    expect(
      services.state.auditEvents.filter(
        (event) => event.action === "percentage_v1_agreement_accepted"
      )
    ).toHaveLength(1)
    expect(
      services.state.notifications.filter(
        (notification) => notification.relatedEntityId === result.account.id
      )
    ).toHaveLength(1)
  })

  it.each(["pending", "verified"] as const)(
    "allows a %s host workspace to accept the current agreement",
    (verificationStatus) => {
      const services = createLogLoadsServices(createInMemoryDatabase())
      const organization = services.state.organizations.find(
        (candidate) => candidate.id === HOST
      )

      if (!organization) throw new Error("Seed host organization missing")

      markHostLegacy(services)
      organization.verificationStatus = verificationStatus

      expect(
        services.acceptPercentageBillingAgreement(
          acceptanceInput(),
          ACCEPTED_AT
        )
      ).toMatchObject({
        changed: true,
        account: {
          activationState: "percentage_active",
          billingModel: "percentage_v1"
        }
      })
    }
  )

  it.each([
    { archivedAt: null, verificationStatus: "rejected" as const },
    { archivedAt: null, verificationStatus: "suspended" as const },
    {
      archivedAt: "2026-08-04T11:59:00.000Z",
      verificationStatus: "verified" as const
    }
  ])(
    "refuses a $verificationStatus host workspace with archivedAt=$archivedAt without writing",
    ({ archivedAt, verificationStatus }) => {
      const services = createLogLoadsServices(createInMemoryDatabase())
      const organization = services.state.organizations.find(
        (candidate) => candidate.id === HOST
      )

      if (!organization) throw new Error("Seed host organization missing")

      markHostLegacy(services)
      organization.archivedAt = archivedAt
      organization.verificationStatus = verificationStatus
      const before = structuredClone(services.state)

      expect(() =>
        services.acceptPercentageBillingAgreement(
          acceptanceInput(),
          ACCEPTED_AT
        )
      ).toThrow(/workspace is locked/)
      expect(services.state).toEqual(before)
    }
  )

  it("makes an exact retry a no-op", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    markHostLegacy(services)
    const first = services.acceptPercentageBillingAgreement(
      acceptanceInput(),
      ACCEPTED_AT
    )
    const auditCount = services.state.auditEvents.length
    const notificationCount = services.state.notifications.length

    const retry = services.acceptPercentageBillingAgreement(
      acceptanceInput(),
      "2026-08-04T12:05:00.000Z"
    )

    expect(retry).toEqual({ account: first.account, changed: false })
    expect(services.state.auditEvents).toHaveLength(auditCount)
    expect(services.state.notifications).toHaveLength(notificationCount)
  })

  it("refuses an unauthorized member and any non-host organization", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    markHostLegacy(services)

    expect(() =>
      services.acceptPercentageBillingAgreement(
        { ...acceptanceInput(), actorUserId: HOST_DISPATCHER },
        ACCEPTED_AT
      )
    ).toThrow(/owner, administrator, or billing manager/)
    expect(() =>
      services.acceptPercentageBillingAgreement(
        {
          acceptedTermsVersion: PERCENTAGE_V1_TERMS_VERSION,
          actorUserId: FLEET_OWNER,
          organizationId: FLEET
        },
        ACCEPTED_AT
      )
    ).toThrow(/landing-source or destination host organizations/)
  })

  it("refuses active and past-due provider subscriptions", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const subscription = activeHistoricalSubscription(services)
    const activeBefore = structuredClone(services.state)

    expect(() =>
      services.acceptPercentageBillingAgreement(
        acceptanceInput(),
        ACCEPTED_AT
      )
    ).toThrow(/must be cancelled or expired/)
    expect(services.state).toEqual(activeBefore)

    const stored = services.state.organizationSubscriptions.find(
      (candidate) => candidate.id === subscription.id
    )!
    stored.status = "past_due"
    stored.paymentState = "past_due"
    stored.providerPaymentState = "past_due"
    const pastDueBefore = structuredClone(services.state)

    expect(() =>
      services.acceptPercentageBillingAgreement(
        acceptanceInput(),
        ACCEPTED_AT
      )
    ).toThrow(DomainRefusalError)
    expect(services.state).toEqual(pastDueBefore)
  })

  it("refuses a detached nonterminal commercial subscription", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    activeHistoricalSubscription(services)
    const account = services.state.organizationBillingAccounts.find(
      (candidate) => candidate.organizationId === HOST
    )!
    account.subscriptionId = null
    const before = structuredClone(services.state)

    expect(() =>
      services.acceptPercentageBillingAgreement(
        acceptanceInput(),
        ACCEPTED_AT
      )
    ).toThrow(/Every historical commercial subscription must be cancelled or expired/)
    expect(services.state).toEqual(before)
  })

  it("refuses a nonterminal conversion target when the pointed source is terminal", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const source = activeHistoricalSubscription(services)
    const storedSource = services.state.organizationSubscriptions.find(
      (candidate) => candidate.id === source.id
    )!
    storedSource.status = "cancelled"
    storedSource.operationalExpiredAt = "2026-08-03T00:00:00.000Z"
    services.state.organizationSubscriptions.push({
      ...structuredClone(storedSource),
      convertedFromPlanCode: storedSource.planCode,
      convertedFromSubscriptionId: storedSource.id,
      currentPeriodEnd: null,
      currentPeriodStart: null,
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
      operationalActivatedAt: null,
      operationalExpiredAt: null,
      paymentState: "none",
      providerPaymentState: "none",
      status: "pending",
      stripeCustomerId: null,
      stripeSubscriptionId: null
    })
    const before = structuredClone(services.state)

    expect(() =>
      services.acceptPercentageBillingAgreement(
        acceptanceInput(),
        ACCEPTED_AT
      )
    ).toThrow(/Every historical commercial subscription must be cancelled or expired/)
    expect(services.state).toEqual(before)
  })

  it("fails closed when an already-percentage account has detached subscription exposure", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    activeHistoricalSubscription(services)
    const account = services.state.organizationBillingAccounts.find(
      (candidate) => candidate.organizationId === HOST
    )!
    account.activationState = "percentage_active"
    account.billingModel = "percentage_v1"
    account.effectiveAt = ACCEPTED_AT
    account.percentageTermsSnapshot = {
      acceptedAt: ACCEPTED_AT,
      acceptedByUserId: HOST_OWNER,
      acceptedTermsVersion: PERCENTAGE_V1_TERMS_VERSION,
      billingCadence: "monthly_in_arrears",
      currency: "USD",
      feeBps: PLATFORM_FEE_BPS
    }
    account.subscriptionId = null
    const before = structuredClone(services.state)

    expect(() =>
      services.acceptPercentageBillingAgreement(
        acceptanceInput(),
        "2026-08-04T12:05:00.000Z"
      )
    ).toThrow(/Every historical commercial subscription must be cancelled or expired/)
    expect(services.state).toEqual(before)
  })

  it("crosses over a terminal subscription idempotently without rewriting provider history", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const subscription = activeHistoricalSubscription(services)
    const stored = services.state.organizationSubscriptions.find(
      (candidate) => candidate.id === subscription.id
    )!
    stored.status = "cancelled"
    stored.operationalExpiredAt = "2026-08-03T00:00:00.000Z"
    const historicalBefore = structuredClone(
      services.state.organizationSubscriptions
    )

    const accepted = services.acceptPercentageBillingAgreement(
      acceptanceInput(),
      ACCEPTED_AT
    )

    expect(accepted.changed).toBe(true)
    expect(accepted.account).toMatchObject({
      activationState: "percentage_active",
      billingModel: "percentage_v1",
      subscriptionId: null
    })
    expect(services.state.organizationSubscriptions).toEqual(historicalBefore)
    expect(
      services.state.auditEvents
        .filter((event) => event.action === "percentage_v1_agreement_accepted")
        .at(-1)?.metadata
    ).toMatchObject({
      previousSubscriptionId: subscription.id,
      previousSubscriptionOperationalExpiredAt:
        "2026-08-03T00:00:00.000Z",
      previousSubscriptionStatus: "cancelled",
      previousSubscriptionStripeCustomerId:
        "cus_percentage_transition_001",
      previousSubscriptionStripeSubscriptionId:
        "sub_percentage_transition_001"
    })

    const auditCount = services.state.auditEvents.length
    expect(
      services.acceptPercentageBillingAgreement(
        acceptanceInput(),
        "2026-08-04T12:05:00.000Z"
      )
    ).toEqual({ account: accepted.account, changed: false })
    expect(services.state.organizationSubscriptions).toEqual(historicalBefore)
    expect(services.state.auditEvents).toHaveLength(auditCount)
  })

  it("acknowledges delayed provider lifecycle after crossover without reviving subscription billing", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const subscription = activeHistoricalSubscription(services)
    const stored = services.state.organizationSubscriptions.find(
      (candidate) => candidate.id === subscription.id
    )!
    stored.status = "cancelled"
    stored.operationalExpiredAt = "2026-08-03T00:00:00.000Z"

    const accepted = services.acceptPercentageBillingAgreement(
      acceptanceInput(),
      ACCEPTED_AT
    )
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
    expect(
      services.state.organizationBillingAccounts.find(
        (account) => account.organizationId === HOST
      )
    ).toEqual(accepted.account)
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
    const subscription = activeHistoricalSubscription(services)
    const staleSubscriptionAccount = structuredClone(
      services.state.organizationBillingAccounts.find(
        (account) => account.organizationId === HOST
      )!
    )
    const stored = services.state.organizationSubscriptions.find(
      (candidate) => candidate.id === subscription.id
    )!
    stored.status = "cancelled"
    stored.operationalExpiredAt = "2026-08-03T00:00:00.000Z"
    services.acceptPercentageBillingAgreement(acceptanceInput(), ACCEPTED_AT)
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

  it("fails before mutating terminal provider history for a malformed percentage account", () => {
    for (const defect of ["subscription_pointer", "missing_terms"] as const) {
      const services = createLogLoadsServices(createInMemoryDatabase())
      const subscription = activeHistoricalSubscription(services)
      const stored = services.state.organizationSubscriptions.find(
        (candidate) => candidate.id === subscription.id
      )!
      stored.status = "cancelled"
      stored.operationalExpiredAt = "2026-08-03T00:00:00.000Z"
      const accepted = services.acceptPercentageBillingAgreement(
        acceptanceInput(),
        ACCEPTED_AT
      )
      if (defect === "subscription_pointer") {
        accepted.account.subscriptionId = stored.id
      } else {
        accepted.account.percentageTermsSnapshot = null
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
