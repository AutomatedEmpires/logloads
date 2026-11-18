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
 * Email is the worker beside the port: `deliverEmailBatch` sends only to `LOGLOADS_EMAIL_TEST_RECIPIENTS`, and the
 * unsubscribe route stops a valid link. The Find Trucks matcher stays off (`truckAlertsSupported` false). A 12-month
 * verification lapse still reports `noticesWaiting`: the outbox has no `verification_lapsed` category.
 * SPF, DKIM and DMARC on the sending domain are not verified here; gate C stays closed until they are.
 */
export const normalizedNotify: NormalizedFeature<"notify"> = {
  methods: () => unavailableMarketplaceV2Feature("notify"),
  supported: false
}

export { deliverEmailBatch, sendViaResend } from "./deliver"
export { emailDeliveryConfig } from "./config"
export { rememberSuppression, resetSuppressions, suppressionHashes } from "./suppression"
export { applyEmailUnsubscribe, unsubscribePage, unsubscribeToken, UNSUBSCRIBE_CONFIRMATION } from "./unsubscribe"
