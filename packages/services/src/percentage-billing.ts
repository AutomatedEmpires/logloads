import type { OrganizationBillingAccount } from "@logloads/contracts"
import type { LogLoadsDatabaseState } from "@logloads/db"

import { DomainRefusalError } from "./utils"

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
 * Refuses a new percentage-fee agreement. Stored billing accounts stay as they
 * are. The 2026-11-04 founder decision retired this model, and no caller,
 * including a direct service call, may create another obligation.
 */
export function acceptPercentageBillingAgreement(
  _state: LogLoadsDatabaseState,
  _rawInput: AcceptPercentageBillingAgreementInput,
  _at?: string
): AcceptPercentageBillingAgreementResult {
  void _state
  void _rawInput
  void _at
  throw new DomainRefusalError(
    "The completed-load percentage fee is retired and cannot be accepted."
  )
}
