/**
 * alerts (#252): saved jobs, job alerts and notification preferences — free for haulers (UX spec §5.9, §8.19). Views
 * and inputs for `MarketplaceAlertsPort` (apps/web/lib/marketplace-v2/port.ts); saved job searches use the shared
 * `MarketplaceSavedSearchView`. #252 adds its schemas and rules here and in `packages/services/src/v2/alerts/`.
 */

import type { MarketplaceId, MarketplaceNotificationChannel } from "../../marketplace-port-v3"
import type { MarketplacePay } from "../../marketplace-v2"

/** `list_saved_jobs.availability`. An unavailable job shows nothing but that it is gone. */
export const MARKETPLACE_SAVED_JOB_AVAILABILITY = ["open", "paused", "closed", "unavailable"] as const
export type MarketplaceSavedJobAvailability = (typeof MARKETPLACE_SAVED_JOB_AVAILABILITY)[number]

/** A job the person saved, public listing fields only; each is `null` once the job is unavailable. */
export interface MarketplaceSavedJobView {
  jobId: MarketplaceId
  savedAt: string
  availability: MarketplaceSavedJobAvailability
  title: string | null
  posterName: string | null
  pay: MarketplacePay | null
  origin: { label: string; stateCode: string | null } | null
  startsOn: string | null
  endsOn: string | null
  trucksTotal: number | null
  lastConfirmedAt: string | null
  lastModifiedAt: string | null
}

/** `notification_preferences.category`. Team invitation emails are transactional and have no preference. */
export const MARKETPLACE_NOTIFICATION_PREFERENCE_CATEGORIES = ["inquiry_reply", "targeted_invitation", "job_alert"] as const
export type MarketplaceNotificationPreferenceCategory = (typeof MARKETPLACE_NOTIFICATION_PREFERENCE_CATEGORIES)[number]

/** One consent, for the person in the active business. Off unless the person turned it on. */
export interface MarketplaceNotificationPreferenceView {
  category: MarketplaceNotificationPreferenceCategory
  channel: MarketplaceNotificationChannel
  enabled: boolean
  /** `null` when never set (the default, off). */
  updatedAt: string | null
}

export interface MarketplaceNotificationPreferenceInput {
  category: MarketplaceNotificationPreferenceCategory
  channel: MarketplaceNotificationChannel
  enabled: boolean
}
