import "server-only"

import {
  isCurrentPercentageAgreement,
  type HostBillingProfile,
  type HostInvoice,
  type PlatformFeeEvent
} from "@logloads/contracts"

interface HostCardEligibilityAccount {
  activationState?: string
  billingModel: string | null
  organizationId: string
  percentageTermsSnapshot?: {
    acceptedTermsVersion: string
    billingCadence?: string
    currency?: string
    feeBps?: number
  } | null
  subscriptionId?: string | null
}

/**
 * The minimum canonical ledger needed to decide whether opening Stripe's card
 * setup flow is commercially authorized for one host.
 */
export interface HostCardEligibilitySource {
  hostBillingProfiles?: readonly Pick<
    HostBillingProfile,
    "organizationId" | "stripeCustomerId"
  >[]
  hostInvoices: readonly Pick<HostInvoice, "id" | "organizationId" | "status">[]
  organizationBillingAccounts?: readonly HostCardEligibilityAccount[]
  organizationSubscriptions?: readonly {
    billingModel?: string
    id: string
    internalBillingTest?: boolean
    organizationId: string
    stripeCustomerId?: string | null
    stripeSubscriptionId?: string | null
  }[]
  platformFeeEvents: readonly Pick<
    PlatformFeeEvent,
    "invoiceId" | "organizationId" | "status"
  >[]
}

export type HostCardSetupEligibility =
  | {
      allowed: true
      basis:
        | "accepted_percentage_v1"
        | "preserved_legacy_agreement"
        | "preserved_subscription_agreement"
        | "unsettled_obligation"
      existingCustomerId: string | null
      message: null
      profileCustomerId: string | null
    }
  | {
      allowed: false
      basis: "agreement_required" | "conflicting_billing_records"
      message: string
    }

const AGREEMENT_REQUIRED_MESSAGE =
  "Payment method setup opens only after this workspace is approved for percentage billing and accepts the current agreement, or when a preserved obligation still requires collection."

function preservedSubscriptionAgreement(
  account: HostCardEligibilityAccount
): boolean {
  return (
    typeof account.subscriptionId === "string" &&
    account.subscriptionId.length > 0 &&
    account.billingModel !== null &&
    account.billingModel !== "legacy_percentage" &&
    account.billingModel !== "percentage_v1" &&
    account.percentageTermsSnapshot === null &&
    (account.activationState === "configured_dark" ||
      account.activationState === "active" ||
      account.activationState === "suspended")
  )
}

/**
 * Whether this host may transmit a new payment method to Stripe.
 *
 * New percentage activity requires both the exact accepted agreement and the
 * server-owned rollout allowlist. Frozen legacy agreements and unsettled ledger
 * obligations remain serviceable so tightening the new-enrollment gate cannot
 * strand money the parties already committed to.
 */
export function hostCardSetupEligibility(
  source: HostCardEligibilitySource,
  organizationId: string,
  percentageEnrollmentAllowed: boolean
): HostCardSetupEligibility {
  const profiles = (source.hostBillingProfiles ?? []).filter(
    (profile) => profile.organizationId === organizationId
  )
  const accounts = (source.organizationBillingAccounts ?? []).filter(
    (account) => account.organizationId === organizationId
  )

  if (accounts.length > 1 || profiles.length > 1) {
    return {
      allowed: false,
      basis: "conflicting_billing_records",
      message:
        "Payment method setup is unavailable because this workspace has conflicting billing records. Contact LogLoads support before continuing."
    }
  }

  const account = accounts[0]
  const profileCustomerId = profiles[0]?.stripeCustomerId ?? null

  if (
    account &&
    percentageEnrollmentAllowed &&
    isCurrentPercentageAgreement(account)
  ) {
    return {
      allowed: true,
      basis: "accepted_percentage_v1",
      existingCustomerId: profileCustomerId,
      message: null,
      profileCustomerId
    }
  }

  if (
    account?.activationState === "legacy" &&
    account.billingModel === "legacy_percentage" &&
    account.subscriptionId === null &&
    account.percentageTermsSnapshot === null
  ) {
    return {
      allowed: true,
      basis: "preserved_legacy_agreement",
      existingCustomerId: profileCustomerId,
      message: null,
      profileCustomerId
    }
  }

  if (account && preservedSubscriptionAgreement(account)) {
    const subscriptions = (source.organizationSubscriptions ?? []).filter(
      (subscription) => subscription.id === account.subscriptionId
    )
    const subscription = subscriptions[0]

    if (
      subscriptions.length !== 1 ||
      !subscription ||
      subscription.internalBillingTest === true ||
      subscription.organizationId !== organizationId ||
      subscription.billingModel !== account.billingModel ||
      !subscription.stripeCustomerId ||
      !subscription.stripeSubscriptionId ||
      (profileCustomerId !== null &&
        profileCustomerId !== subscription.stripeCustomerId)
    ) {
      return {
        allowed: false,
        basis: "conflicting_billing_records",
        message:
          "Payment method setup is unavailable because this workspace's preserved billing record could not be verified. Contact LogLoads support before continuing."
      }
    }

    return {
      allowed: true,
      basis: "preserved_subscription_agreement",
      existingCustomerId: profileCustomerId ?? subscription.stripeCustomerId,
      message: null,
      profileCustomerId
    }
  }

  const invoices = source.hostInvoices.filter(
    (invoice) => invoice.organizationId === organizationId
  )
  const unsettledInvoiceIds = new Set(
    invoices
      .filter(
        (invoice) =>
          invoice.status === "draft" ||
          invoice.status === "open" ||
          invoice.status === "uncollectible"
      )
      .map((invoice) => invoice.id)
  )
  const invoiceIds = new Set(invoices.map((invoice) => invoice.id))
  const hasUnsettledFee = source.platformFeeEvents.some(
    (event) =>
      event.organizationId === organizationId &&
      (event.status === "accrued" ||
        (event.status === "invoiced" &&
          Boolean(
            !event.invoiceId ||
              !invoiceIds.has(event.invoiceId) ||
              unsettledInvoiceIds.has(event.invoiceId)
          )))
  )

  if (unsettledInvoiceIds.size > 0 || hasUnsettledFee) {
    return {
      allowed: true,
      basis: "unsettled_obligation",
      existingCustomerId: profileCustomerId,
      message: null,
      profileCustomerId
    }
  }

  return {
    allowed: false,
    basis: "agreement_required",
    message: AGREEMENT_REQUIRED_MESSAGE
  }
}
