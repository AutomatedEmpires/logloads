import {
  PERCENTAGE_V1_TERMS_VERSION,
  PLATFORM_FEE_BPS,
  auditEventSchema,
  organizationBillingAccountSchema,
  organizationRoleCan,
  type OrganizationBillingAccount
} from "@logloads/contracts"
import type { LogLoadsDatabaseState } from "@logloads/db"
import { z } from "zod"

import { createNotification } from "./notifications"
import {
  assertCondition,
  assertDomainCondition,
  assertFound,
  createUuid,
  nowIso
} from "./utils"

const acceptInputSchema = z.object({
  acceptedTermsVersion: z.string().trim().min(1).max(120),
  actorUserId: z.string().uuid(),
  organizationId: z.string().uuid()
})

export interface AcceptPercentageBillingAgreementInput {
  acceptedTermsVersion: string
  actorUserId: string
  organizationId: string
}

export interface AcceptPercentageBillingAgreementResult {
  account: OrganizationBillingAccount
  changed: boolean
}

/**
 * Accepts the current host agreement: 5% of host-stated driver pay on top,
 * monthly in arrears, with driver funds remaining entirely off-platform.
 *
 * An unenrolled or explicit legacy account may accept. A provider-bound account
 * may cross over only after its preserved subscription row is terminal
 * (`cancelled` or `expired`); active and delinquent agreements fail closed.
 */
export function acceptPercentageBillingAgreement(
  state: LogLoadsDatabaseState,
  rawInput: AcceptPercentageBillingAgreementInput,
  at = nowIso()
): AcceptPercentageBillingAgreementResult {
  const input = acceptInputSchema.parse(rawInput)
  assertDomainCondition(
    input.acceptedTermsVersion === PERCENTAGE_V1_TERMS_VERSION,
    "Refresh the current LogLoads fee agreement before accepting it"
  )
  const actors = state.profiles.filter(
    (candidate) => candidate.id === input.actorUserId && candidate.isActive
  )
  const memberships = state.organizationMemberships.filter(
    (candidate) =>
      candidate.organizationId === input.organizationId &&
      candidate.status === "active" &&
      candidate.userId === input.actorUserId
  )

  assertDomainCondition(
    actors.length === 1 && memberships.length === 1,
    "You are not an active member of this organization"
  )
  assertDomainCondition(
    organizationRoleCan(memberships[0]!.role, "manage_billing"),
    "Only an organization owner, administrator, or billing manager can accept the fee agreement"
  )

  const organizations = state.organizations.filter(
    (candidate) =>
      candidate.id === input.organizationId && !candidate.archivedAt
  )
  assertDomainCondition(organizations.length === 1, "Organization not found")
  assertDomainCondition(
    organizations[0]!.type === "landing_source" ||
      organizations[0]!.type === "destination",
    "Only landing-source or destination host organizations can accept the percentage fee agreement"
  )

  const accounts = state.organizationBillingAccounts.filter(
    (candidate) => candidate.organizationId === input.organizationId
  )
  assertCondition(
    accounts.length === 1,
    accounts.length === 0
      ? `Organization ${input.organizationId} has no billing account`
      : `Organization ${input.organizationId} has conflicting billing accounts`
  )
  const existing = accounts[0]!

  const nonterminalCommercialSubscriptions =
    state.organizationSubscriptions.filter(
      (candidate) =>
        candidate.organizationId === input.organizationId &&
        !candidate.internalBillingTest &&
        candidate.status !== "cancelled" &&
        candidate.status !== "expired"
    )
  assertDomainCondition(
    nonterminalCommercialSubscriptions.length === 0,
    "Every historical commercial subscription must be cancelled or expired before accepting percentage billing"
  )

  if (existing.activationState === "percentage_active") {
    const acceptedTerms = assertFound(
      existing.percentageTermsSnapshot ?? undefined,
      `Organization ${input.organizationId} has no percentage agreement snapshot`
    )
    assertCondition(
      existing.billingModel === "percentage_v1" &&
        existing.subscriptionId === null,
      `Organization ${input.organizationId} has a malformed percentage agreement`
    )
    assertDomainCondition(
      acceptedTerms.acceptedTermsVersion ===
        input.acceptedTermsVersion,
      "This organization already accepted a different version of the fee agreement"
    )

    return { account: existing, changed: false }
  }

  let retiredSubscription:
    | LogLoadsDatabaseState["organizationSubscriptions"][number]
    | null = null

  if (existing.subscriptionId) {
    const subscriptions = state.organizationSubscriptions.filter(
      (candidate) => candidate.id === existing.subscriptionId
    )
    assertCondition(
      subscriptions.length === 1,
      `Billing account ${existing.id} points to a missing or duplicated historical subscription`
    )
    retiredSubscription = subscriptions[0]!
    assertCondition(
      retiredSubscription.organizationId === input.organizationId,
      `Billing account ${existing.id} points to another organization's subscription`
    )
    assertDomainCondition(
      retiredSubscription.status === "cancelled" ||
        retiredSubscription.status === "expired",
      "The historical provider subscription must be cancelled or expired before accepting percentage billing"
    )
  } else {
    assertDomainCondition(
      existing.activationState === "unenrolled" ||
        existing.activationState === "legacy",
      "This billing account cannot accept percentage billing from its current state"
    )
  }

  const account = organizationBillingAccountSchema.parse({
    ...existing,
    activationState: "percentage_active",
    billingModel: "percentage_v1",
    effectiveAt: at,
    percentageTermsSnapshot: {
      acceptedAt: at,
      acceptedByUserId: input.actorUserId,
      acceptedTermsVersion: input.acceptedTermsVersion,
      billingCadence: "monthly_in_arrears",
      currency: "USD",
      feeBps: PLATFORM_FEE_BPS
    },
    subscriptionId: null,
    updatedAt: at
  })

  state.organizationBillingAccounts =
    state.organizationBillingAccounts.map((candidate) =>
      candidate.id === existing.id ? account : candidate
    )
  state.auditEvents.push(
    auditEventSchema.parse({
      action: "percentage_v1_agreement_accepted",
      actorUserId: input.actorUserId,
      createdAt: at,
      entityId: account.id,
      entityType: "organization_billing_account",
      id: createUuid(),
      metadata: {
        acceptedTermsVersion: input.acceptedTermsVersion,
        billingCadence: "monthly_in_arrears",
        currency: "USD",
        feeBps: PLATFORM_FEE_BPS,
        organizationId: input.organizationId,
        previousActivationState: existing.activationState,
        previousBillingModel: existing.billingModel,
        previousSubscriptionId: retiredSubscription?.id ?? null,
        previousSubscriptionOperationalExpiredAt:
          retiredSubscription?.operationalExpiredAt ?? null,
        previousSubscriptionPaymentState:
          retiredSubscription?.paymentState ?? null,
        previousSubscriptionProviderPaymentState:
          retiredSubscription?.providerPaymentState ?? null,
        previousSubscriptionStatus: retiredSubscription?.status ?? null,
        previousSubscriptionStripeCustomerId:
          retiredSubscription?.stripeCustomerId ?? null,
        previousSubscriptionStripeSubscriptionId:
          retiredSubscription?.stripeSubscriptionId ?? null
      }
    })
  )

  createNotification(state, {
    body: `${organizations[0]!.displayName} accepted the LogLoads fee agreement: ${PLATFORM_FEE_BPS / 100}% of stated driver pay, charged to the host on completed truckloads and billed monthly in arrears. Driver pay remains a direct host-to-driver obligation.`,
    relatedEntityId: account.id,
    relatedEntityType: "organization_billing_account",
    title: "Fee agreement accepted",
    type: "system_alert",
    userId: input.actorUserId
  })

  return { account, changed: true }
}
