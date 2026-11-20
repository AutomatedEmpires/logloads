import { OPERATING_STATE_REQUEST_TIMEOUT_MS } from "@logloads/db"

/**
 * Per-user write limits for the pilot writes that reach the shared
 * operating_state document through more than one door (HF-02, #187).
 *
 * The API route and the cockpit server action for the same write spend the
 * same bucket, so a user has one budget per kind of write, not one per door.
 * Each runs before any write, on top of the shared 120/min `api-actor` bucket
 * the API routes already spend.
 *
 * Each check waits as long for the rate-limit store as the write it guards
 * waits for the operating-state store (`timeoutMs`), not the 1.5 s other checks
 * get. Both live in the same Supabase project, so on a slow but answering
 * store a driver's trip progression is not refused at the check while the
 * write itself would have landed. The check still fails closed: a store that
 * errors, or does not answer within that time, refuses the write
 * (`docs/SECURITY.md` §2).
 */
export interface WriteLimit {
  bucket: string
  limit: number
  windowMs: number
  timeoutMs: number
}

export const OPERATIONAL_NOTICE_WRITE_LIMIT: WriteLimit = Object.freeze({
  bucket: "operational-notice-create",
  limit: 10,
  timeoutMs: OPERATING_STATE_REQUEST_TIMEOUT_MS,
  windowMs: 60_000
})

export const TRIP_EVENT_WRITE_LIMIT: WriteLimit = Object.freeze({
  bucket: "trip-event-create",
  limit: 30,
  timeoutMs: OPERATING_STATE_REQUEST_TIMEOUT_MS,
  windowMs: 60_000
})
