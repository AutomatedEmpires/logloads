import {
  PERCENTAGE_FEE_RETIRED_CODE,
  PERCENTAGE_FEE_RETIRED_MESSAGE,
  type OrganizationBillingAccount
} from "@logloads/contracts"
import type { LogLoadsDatabaseState } from "@logloads/db"

import { DomainRefusalError } from "./utils"

/**
 * The retired percentage agreement.
 *
 * The completed-load percentage fee is retired (docs/DECISIONS.md, 2026-11-01:
 * no new percentage obligation may be created by current code). This module
 * keeps the acceptance entry point only so every caller that still reaches it,
 * including a direct service call, meets one typed refusal. Agreements accepted
 * before the retirement live on `organizationBillingAccounts` and are never read
 * or rewritten here.
 */

export interface AcceptPercentageBillingAgreementInput {
  acceptedTermsVersion: string
  actorUserId: string
  organizationId: string
}

/** The shape a successful acceptance returned before the retirement. */
export interface AcceptPercentageBillingAgreementResult {
  account: OrganizationBillingAccount
  changed: boolean
}

/**
 * The refusal of a new percentage-fee agreement or accrual.
 *
 * A domain refusal, so every HTTP boundary answers it as a 4xx policy refusal
 * rather than a server fault. `code` is stable so a caller can recognise the
 * refusal without matching on wording.
 */
export class PercentageFeeRetiredError extends DomainRefusalError {
  readonly code = PERCENTAGE_FEE_RETIRED_CODE

  constructor() {
    super(PERCENTAGE_FEE_RETIRED_MESSAGE)
  }
}

/**
 * Refuses a new percentage-fee agreement, always.
 *
 * It reads nothing and writes nothing: no billing account, audit event or
 * notification. Every caller gets the same refusal whatever its role,
 * organization or input, so the answer reveals nothing about what exists, and
 * a retry is answered identically. `LOGLOADS_PERCENTAGE_ENROLLMENT` is not
 * consulted, so enabling it cannot reopen acceptance.
 */
export function acceptPercentageBillingAgreement(
  state: LogLoadsDatabaseState,
  input: AcceptPercentageBillingAgreementInput,
  at?: string
): never {
  // The parameters stay so existing callers keep compiling. None of them can
  // change the answer.
  void state
  void input
  void at

  throw new PercentageFeeRetiredError()
}
