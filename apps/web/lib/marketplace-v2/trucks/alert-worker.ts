import "server-only"

import { HAULER_AVAILABILITY_FRESH_DAYS } from "@logloads/contracts"
import { planTruckAlerts, type TruckAlertCandidate, type TruckAlertSearch } from "@logloads/services"

/**
 * trucks (#251): the availability-alert matcher, for the notification worker (#253).
 *
 * Like the job-alert matcher (`enqueueJobAlerts`, `MarketplaceV2NotificationWorker`), it acts for no person and runs on
 * the worker's own service-role connection, which no page reaches. It hands each saved truck search the fresh reports
 * that match it (`planTruckAlerts`), and the store queues the notices: it re-checks that the business is still listed
 * and the report still open, re-checks the person's consent per channel, and writes each dedupe key once
 * (`enqueue_truck_alerts`, requested in #251's catalogue entry). In the app and by email only; never SMS.
 *
 * Idempotent: a run repeated, or retried after a failure, queues nothing twice, because every notice's dedupe key is
 * the same (`truck_alert:{search}:{report}:{channel}`) and the outbox keeps it unique. Keys already queued are left out
 * before the 50-report cap, so a search with more matches than one batch gets the rest on the next run. One search
 * failing does not stop the others; it is counted, and the next run tries it again.
 *
 * Not wired: the service-role functions it needs are not in stage 01–29 (see #251).
 */

/** A saved truck search with alerts on, and its owner's `truck_alert` consents in that business. */
export interface TruckAlertWorkerSearch extends TruckAlertSearch {
  consents: ReadonlyArray<{ channel: string; enabled: boolean }>
}

/** What the worker's service-role store gives the matcher. */
export interface TruckAlertWorkerStore {
  /** Saved searches of kind `trucks` with alerts on, at businesses whose plan has availability alerts. */
  alertingTruckSearches(): Promise<TruckAlertWorkerSearch[]>
  /** Open reports of listed, active businesses reported at or after `since`. */
  truckAlertCandidates(since: string): Promise<TruckAlertCandidate[]>
  /**
   * The dedupe keys already in the outbox for one search (recent ones are enough: older reports are stale). Left out
   * before the batch cap, so a search with more matches than one batch moves on to the next ones.
   */
  queuedTruckAlertKeys(savedSearchId: string): Promise<string[]>
  /** Queue the alerts for one search's matching reports (1–50). Returns how many notices were written. */
  enqueueTruckAlerts(savedSearchId: string, reportIds: readonly string[]): Promise<{ queued: number }>
}

export interface TruckAlertRun {
  /** Searches considered. */
  searches: number
  /** Searches whose matching reports the store accepted. */
  handedOver: number
  /** Notices the store wrote this run (0 on a repeat). */
  queued: number
  /** Searches whose hand-over failed; the next run tries them again. */
  failed: number
}

const DAY_MS = 86_400_000

/** One matching pass over every alerting truck search. */
export async function runTruckAlertMatching(store: TruckAlertWorkerStore, now: Date): Promise<TruckAlertRun> {
  const since = new Date(now.getTime() - HAULER_AVAILABILITY_FRESH_DAYS * DAY_MS).toISOString()
  const searches = await store.alertingTruckSearches()
  const candidates = searches.length > 0 ? await store.truckAlertCandidates(since) : []
  const result: TruckAlertRun = { failed: 0, handedOver: 0, queued: 0, searches: searches.length }

  for (const search of searches) {
    try {
      const sent = new Set(await store.queuedTruckAlertKeys(search.id))
      const plan = planTruckAlerts(search, candidates, search.consents, now, sent)

      if (plan.reportIds.length === 0) continue

      const { queued } = await store.enqueueTruckAlerts(search.id, plan.reportIds)

      result.handedOver += 1
      result.queued += queued
    } catch {
      // Logged by the worker that runs this, with its own request id; no search or business detail is kept here.
      result.failed += 1
    }
  }

  return result
}
