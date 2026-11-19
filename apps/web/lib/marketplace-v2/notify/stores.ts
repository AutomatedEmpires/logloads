import "server-only"

import { normalizedAdapterConfiguration } from "../adapter"
import { createPostgresMarketplaceDb, type MarketplaceDb } from "../normalized-db"
import { createPostgresNotificationWorker, type NotificationWorkerDb } from "./worker-db"

/**
 * One connection pool per database URL for the notify routes, kept for the life of the server instance (as
 * `basins/notice.ts` does). The unsubscribe route no longer opens a pool for every request.
 */
let anon: { db: MarketplaceDb; key: string } | null = null
let worker: { db: NotificationWorkerDb; key: string } | null = null

/** The restricted marketplace connection, used signed out for 31-U's `unsubscribe_with_token`. */
export function notifyAnonDb(): MarketplaceDb {
  const url = normalizedAdapterConfiguration().databaseUrl

  if (anon?.key !== url) anon = { db: createPostgresMarketplaceDb({ url }), key: url }

  return anon.db
}

/** The worker's service_role connection (`worker-db.ts`). */
export function notifyWorkerDb(url: string): NotificationWorkerDb {
  if (worker?.key !== url) worker = { db: createPostgresNotificationWorker({ url }), key: url }

  return worker.db
}
