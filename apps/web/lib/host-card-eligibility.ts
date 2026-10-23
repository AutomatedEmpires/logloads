import "server-only"

import {
  isCurrentHostFeeAgreement,
  type HostBillingProfile,
  type HostFeeAgreement,
  type HostInvoice,
  type PlatformFeeEvent
} from "@logloads/contracts"

/**
 * The minimum canonical ledger needed to decide whether opening Stripe's card
 * setup flow is commercially authorized for one host.
 */
export interface HostCardEligibilitySource {
  hostBillingProfiles?: readonly Pick<
    HostBillingProfile,
    "organizationId" | "stripeCustomerId"
  >[]
  hostFeeAgreements: readonly Pick<
    HostFeeAgreement,
    "feeBps" | "organizationId" | "termsVersion"
  >[]
  hostInvoices: readonly Pick<HostInvoice, "id" | "organizationId" | "status">[]
  platformFeeEvents: readonly Pick<
    PlatformFeeEvent,
    "invoiceId" | "organizationId" | "status"
  >[]
}

export type HostCardSetupEligibility =
  | {
      allowed: true
      basis: "accepted_fee_agreement" | "unsettled_obligation"
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
  "Accept the LogLoads fee terms before adding a payment card. The card is what the monthly 2% host fee is charged to."

/**
 * Whether this host may send a new payment method to Stripe.
 *
 * A card is collected for exactly two reasons: the host accepted the current fee
 * terms, so the fee on its future loads will be charged to the card; or the host
 * still owes fees or bills that need a card to be settled. Anything else would be
 * collecting a card nothing can be charged to.
 */
export function hostCardSetupEligibility(
  source: HostCardEligibilitySource,
  organizationId: string
): HostCardSetupEligibility {
  const profiles = (source.hostBillingProfiles ?? []).filter(
    (profile) => profile.organizationId === organizationId
  )
  const agreements = source.hostFeeAgreements.filter(
    (agreement) => agreement.organizationId === organizationId
  )

  if (agreements.length > 1 || profiles.length > 1) {
    return {
      allowed: false,
      basis: "conflicting_billing_records",
      message:
        "Payment method setup is unavailable because this workspace has conflicting billing records. Contact LogLoads support before continuing."
    }
  }

  const profileCustomerId = profiles[0]?.stripeCustomerId ?? null

  if (isCurrentHostFeeAgreement(agreements[0])) {
    return {
      allowed: true,
      basis: "accepted_fee_agreement",
      existingCustomerId: profileCustomerId,
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
