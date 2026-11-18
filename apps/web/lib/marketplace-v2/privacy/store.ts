import type { MarketplacePrivacyAuditRow, MarketplacePrivacyRequestRecord } from "@logloads/contracts"

/**
 * The privacy request store (#343). Every write is one transaction that also appends its audit rows, so a request
 * never exists, or changes, without its audit rows. A request is a staff queue entry from the moment it is stored:
 * the queue is the store's open requests (`listOpen`), not a second table that could fall out of step.
 *
 * `memoryPrivacyRequestStore` (./memory-store.ts) is the reference the tests run. The normalized store will meet the
 * same contract once its schema stage exists (the stage is specified on logloads#343). Until then
 * `privacyRequestStore()` (./index.ts) has no store, and the request form points people to the email address instead.
 */

export type PrivacyReceiveResult =
  | { created: true; request: MarketplacePrivacyRequestRecord }
  /**
   * Nothing was written. `same_submission`: a request with the same channel and submission key exists (a retried
   * post, or the same email recorded twice). `already_open`: the same person already has an open request of this kind.
   */
  | { created: false; reason: "same_submission" | "already_open"; request: MarketplacePrivacyRequestRecord }

export interface PrivacyRequestStore {
  /** The account whose sign-in address is `email` (lower case), or `null`. Never shown to the requester. */
  accountForEmail(email: string): Promise<{ userId: string } | null>

  /**
   * In one transaction: return the request with the same channel and submission key if there is one; otherwise, when
   * `dedupeOpen`, return the same person's open request of the same kind if there is one; otherwise insert `record` and
   * append `audit`. Two concurrent calls with the same key store one request.
   */
  receive(record: MarketplacePrivacyRequestRecord, audit: MarketplacePrivacyAuditRow, options: { dedupeOpen: boolean }): Promise<PrivacyReceiveResult>

  get(requestId: string): Promise<MarketplacePrivacyRequestRecord | null>

  /**
   * In one transaction: replace the request with `next` and append `audit`, only while its `updatedAt` is still
   * `expectedUpdatedAt`. `false` when it changed meanwhile; nothing is written then.
   */
  update(next: MarketplacePrivacyRequestRecord, expectedUpdatedAt: string, audit: readonly MarketplacePrivacyAuditRow[]): Promise<boolean>

  /** Open requests (`awaiting_identity`, `in_progress`), the earliest due first, at most `limit`. */
  listOpen(limit: number): Promise<MarketplacePrivacyRequestRecord[]>

  /** The requests about one account, newest first, at most `limit`. */
  listForSubject(userId: string, limit: number): Promise<MarketplacePrivacyRequestRecord[]>
}
