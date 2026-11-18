import "server-only"

import type { PrivacyRequestStore } from "./store"

/**
 * privacy (#343): the privacy request path (legal review §6.6 item 1), the browser-location rule (§6.6 item 4) and the
 * hauler-profile listing checks (§6.5).
 *
 * Where requests are kept: nowhere yet, so this returns `null` and the in-app form sends people to the email address.
 * The pilot's `operating_state` support requests do not fit (they need an account, which an emailed request may not
 * have, and know only problem and feature reports), so requests need their own normalized-v2 stage: a
 * `privacy_requests` table, its audit rows through `write_audit`, and store functions that meet `PrivacyRequestStore`
 * (./store.ts), with the reference behaviour in ./memory-store.ts. That stage needs the `logloads.db-schema` resource;
 * when it lands, this returns the normalized store for the normalized adapter.
 */
export function privacyRequestStore(): PrivacyRequestStore | null {
  return null
}

export type { PrivacyReceiveResult, PrivacyRequestStore } from "./store"
export {
  checkPrivacyIdentity,
  closePrivacyRequest,
  myPrivacyRequests,
  openPrivacyRequestForRelease,
  privacyStaffQueue,
  recordEmailedPrivacyRequest,
  sendPrivacyIdentityCode,
  submitPrivacyRequest,
  type PrivacyIdentityCodeSender,
  type PrivacyPerson,
  type PrivacyStaff
} from "./requests"
