/**
 * alerts (#252): saved jobs, job alerts and notification preferences — free for haulers (UX spec §5.9, §8.19). Views
 * and inputs for `MarketplaceAlertsPort` (apps/web/lib/marketplace-v2/port.ts); saved job searches use the shared
 * `MarketplaceSavedSearchView`. Schemas parse the write inputs. An unknown field is refused, never stored.
 */

import { z } from "zod"

import type { MarketplaceId, MarketplaceNotificationChannel, MarketplaceSavedSearchInput } from "../../marketplace-port-v3"
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

/**
 * Filters a hauler saves with a job search. A place is one they typed. There is no device location, and no address
 * that could be an email.
 */
export interface MarketplaceJobAlertCriteria {
  equipment: string[]
  place: string | null
  radiusMiles: number | null
  stateCode: string | null
}

/** What an unsubscribe link tells the person. It never names an email address or whose link it was. */
export const MARKETPLACE_UNSUBSCRIBE_OUTCOMES = ["unsubscribed", "invalid", "expired"] as const
export type MarketplaceUnsubscribeOutcome = (typeof MARKETPLACE_UNSUBSCRIBE_OUTCOMES)[number]

export interface MarketplaceUnsubscribeResult {
  outcome: MarketplaceUnsubscribeOutcome
}

const equipmentCode = z.string().regex(/^[a-z][a-z0-9_]{1,40}$/, "Choose equipment from the list.")

const stateCode = z.union([
  z.null(),
  z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "Use a two-letter state.")
])

const place = z.union([
  z.null(),
  z.string().trim().min(1, "Name a place.").max(120, "Use a shorter place name.").refine((value) => !value.includes("@"), {
    message: "Name a place, not an email address."
  })
])

/** Equipment, a named place and a distance. Defaults are "any". Extra fields are refused. */
export const marketplaceJobAlertCriteriaSchema: z.ZodType<MarketplaceJobAlertCriteria, z.ZodTypeDef, unknown> = z.object({
  equipment: z.array(equipmentCode).max(20, "Choose 20 kinds of equipment or fewer.").default([]),
  place: place.default(null),
  radiusMiles: z.union([
    z.null(),
    z.number().int("Use a whole number of miles.").min(5, "Choose a distance from 5 to 500 miles.").max(500, "Choose a distance from 5 to 500 miles.")
  ]).default(null),
  stateCode: stateCode.default(null)
}).strict()

const savedSearchFields = {
  alertsEnabled: z.boolean({ required_error: "Choose whether this search sends alerts." }),
  criteria: marketplaceJobAlertCriteriaSchema,
  name: z.string().trim().min(1, "Name the search.").max(80, "Use a name of 80 characters or fewer."),
  searchId: z.string().uuid("That saved search was not found.").optional()
}

/** A new or edited job search. `searchId` is present only when editing one of the person's own searches. */
export const marketplaceSavedJobSearchInputSchema: z.ZodType<MarketplaceSavedSearchInput<MarketplaceJobAlertCriteria>, z.ZodTypeDef, unknown> = z.object(savedSearchFields).strict().superRefine((value, ctx) => {
  if (new TextEncoder().encode(JSON.stringify(value.criteria)).length > 4096) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "That search is too large.", path: ["criteria"] })
  }
})

/** One consent change. Category and channel are the only ones the store records. */
export const marketplaceNotificationPreferenceInputSchema: z.ZodType<MarketplaceNotificationPreferenceInput, z.ZodTypeDef, unknown> = z.object({
  category: z.enum(MARKETPLACE_NOTIFICATION_PREFERENCE_CATEGORIES, { errorMap: () => ({ message: "Choose a notification the person can turn off." }) }),
  channel: z.enum(["in_app", "email"], { errorMap: () => ({ message: "Choose email or in the app." }) }),
  enabled: z.boolean({ required_error: "Choose on or off." })
}).strict()

/** A job id the person wants to save or remove. */
export const marketplaceSavedJobIdSchema: z.ZodType<string, z.ZodTypeDef, unknown> = z.string().uuid("That job was not found.")
