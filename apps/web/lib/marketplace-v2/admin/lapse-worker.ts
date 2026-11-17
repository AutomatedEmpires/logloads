import "server-only"

import { verificationLapsed } from "@logloads/services"

import { MarketplaceStoreError } from "../port"
import { verificationLapseFromRow } from "./mapping"

/**
 * admin (#255): the 12-month verification lapse job (lead decision on #251; legal review §7.3 item 4).
 *
 * Like the job-alert and truck-alert matchers, it acts for no person and runs on a worker's own service-role
 * connection, which no page reaches. The store does the work in one statement per batch
 * (`lapse_expired_org_verifications`, service role only, SQL posted on #255): it moves each business whose review
 * turned 12 months old (`verified_at + interval '12 months' <= now()`, in UTC) from `verified` to `pending`, clears
 * the review date and reviewer, and writes one `organization.verification_lapsed` audit row, all under
 * `FOR UPDATE SKIP LOCKED`, so two runs never lapse or audit the same business twice. Find Trucks (#251) and every
 * other reader gate only on `verification_status = 'verified'`, so none of them computes a review's age.
 *
 * Idempotent: a repeated or retried run lapses nothing twice, because a lapsed business is no longer `verified`. The
 * job checks every row the store returns against the rule (`verificationLapsed`, by the store's own clock) and fails
 * loudly on a review lapsed early, which would be a drift between the SQL and this rule.
 *
 * The business's notice: the store queues it in the same transaction once #253 adds the `verification_lapsed`
 * category (the follow-up is on #253), so a lapse and its notice can never come apart. Until then `noticesQueued` is 0
 * and `noticesWaiting` counts the businesses that were not told.
 *
 * Not wired: the function needs a schema stage, and a worker binds this to its service-role connection.
 */

/** What the worker's service-role store gives the job. */
export interface VerificationLapseStore {
  /** `lapse_expired_org_verifications(p_limit)`: lapses up to `limit` due reviews, oldest first, and returns their rows. */
  lapseExpiredVerifications(limit: number): Promise<unknown[]>
}

export interface VerificationLapseOptions {
  /** Reviews per statement, 1–500. */
  batchSize?: number
  /** Statements per run, at least 1. A run that stops here with a full batch leaves the rest to the next run. */
  maxBatches?: number
}

export interface VerificationLapseRun {
  /** Statements run. */
  batches: number
  /** Reviews moved off `verified` this run (0 on a repeat). */
  lapsed: number
  /** Notices the store queued with the lapses. */
  noticesQueued: number
  /** Lapsed businesses the store queued no notice for (every one, until #253 adds the category). */
  noticesWaiting: number
  /** False when the run stopped at `maxBatches` with more possibly due. */
  complete: boolean
}

const DEFAULT_BATCH = 100
const MAX_BATCH = 500
const DEFAULT_MAX_BATCHES = 20

/** One lapse pass: batches until the store returns a short batch, or `maxBatches`. */
export async function runVerificationLapse(store: VerificationLapseStore, options: VerificationLapseOptions = {}): Promise<VerificationLapseRun> {
  const batchSize = options.batchSize ?? DEFAULT_BATCH
  const maxBatches = options.maxBatches ?? DEFAULT_MAX_BATCHES

  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > MAX_BATCH) {
    throw new RangeError(`batchSize must be a whole number from 1 to ${MAX_BATCH}`)
  }

  if (!Number.isInteger(maxBatches) || maxBatches < 1) {
    throw new RangeError("maxBatches must be a whole number of at least 1")
  }

  const run: VerificationLapseRun = { batches: 0, complete: false, lapsed: 0, noticesQueued: 0, noticesWaiting: 0 }

  while (run.batches < maxBatches) {
    const rows = await store.lapseExpiredVerifications(batchSize)

    run.batches += 1

    for (const lapse of rows.map(verificationLapseFromRow)) {
      if (!verificationLapsed(lapse.previousVerifiedAt, new Date(lapse.lapsedAt))) {
        // Logged by the worker that runs this, with its own request id; no business detail is kept in the message.
        throw new MarketplaceStoreError(undefined, "22000")
      }

      run.lapsed += 1
      run.noticesQueued += lapse.noticesQueued
      if (lapse.noticesQueued === 0) run.noticesWaiting += 1
    }

    if (rows.length < batchSize) {
      run.complete = true
      break
    }
  }

  return run
}
