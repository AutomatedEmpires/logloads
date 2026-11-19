import "server-only"

import type { NormalizedFeature } from "../normalized-adapter"
import { unavailableMarketplaceV2Feature } from "../port"

/**
 * notify (#253): in-app notices stay unavailable.
 *
 * Listing them needs a statement in `normalized-queries.ts`, and turning this group on needs the port v3 support
 * test. Both files belong to another active task, so these methods still refuse with `MarketplaceFeatureUnavailableError`
 * and reach no store.
 *
 * Email is the worker beside the port (#405): `runEmailWorker` claims due rows (`/api/v2/notify/deliver`, CRON_SECRET,
 * not scheduled), checks the durable suppression list (stage 46), and sends with a per-notice Resend Idempotency-Key.
 * It sends only to `LOGLOADS_EMAIL_TEST_RECIPIENTS`: `planEmailDelivery` and `sendViaResend` both check. The
 * unsubscribe route stops a valid link, and the provider webhook records deliveries, bounces and complaints. The Find
 * Trucks matcher stays off (`truckAlertsSupported` false). A 12-month verification lapse still reports
 * `noticesWaiting`: the outbox has no `verification_lapsed` category. SPF, DKIM and DMARC on the sending domain are
 * not verified here; gate C stays closed until they are.
 */
export const normalizedNotify: NormalizedFeature<"notify"> = {
  methods: () => unavailableMarketplaceV2Feature("notify"),
  supported: false
}

export { deliverEmailBatch, sendViaResend } from "./deliver"
export { emailDeliveryConfig } from "./config"
export { applyEmailUnsubscribe, unsubscribePage, unsubscribeToken, UNSUBSCRIBE_CONFIRMATION } from "./unsubscribe"
export { emailWorkerReadiness, runEmailWorker } from "./worker"
