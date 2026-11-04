/**
 * Per-user write limits for the pilot writes that reach the shared
 * operating_state document through more than one door (HF-02, #187).
 *
 * The API route and the cockpit server action for the same write spend the
 * same bucket, so a user has one budget per kind of write, not one per door.
 * Each runs before any write, on top of the shared 120/min `api-actor` bucket
 * the API routes already spend.
 */
export interface WriteLimit {
  bucket: string
  limit: number
  windowMs: number
}

export const OPERATIONAL_NOTICE_WRITE_LIMIT: WriteLimit = Object.freeze({
  bucket: "operational-notice-create",
  limit: 10,
  windowMs: 60_000
})

export const TRIP_EVENT_WRITE_LIMIT: WriteLimit = Object.freeze({
  bucket: "trip-event-create",
  limit: 30,
  windowMs: 60_000
})
