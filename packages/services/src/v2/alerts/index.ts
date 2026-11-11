/**
 * alerts (#252): saved jobs, job alerts, notification preferences and unsubscribe rules.
 *
 * Pure rules over `packages/contracts/src/v2/alerts/`. A signed-in read or write is bound to the caller's business.
 * An unsubscribe link is a signed token: it needs no signed-in viewer, it carries no email address, and a bad link
 * does not say which mailbox it was for.
 */

import { createHmac, timingSafeEqual } from "node:crypto"

import { z } from "zod"

import {
  MARKETPLACE_NOTIFICATION_CHANNELS,
  MARKETPLACE_NOTIFICATION_PREFERENCE_CATEGORIES,
  type MarketplaceJobAlertCriteria,
  type MarketplaceNotificationPreferenceInput,
  type MarketplaceNotificationPreferenceView,
  type MarketplaceSavedSearchInput,
  type MarketplaceUnsubscribeResult
} from "@logloads/contracts"

const UNAVAILABLE = "Unsubscribe links are not available right now."
const FAILED = "The unsubscribe could not be completed. Try again in a moment."

/** How long a new unsubscribe link lasts unless the caller chooses a shorter time. */
export const ALERT_UNSUBSCRIBE_TTL_SECONDS = 30 * 24 * 60 * 60

/** The longest a link may last. Longer than this is refused rather than minted. */
export const ALERT_UNSUBSCRIBE_MAX_TTL_SECONDS = 90 * 24 * 60 * 60

/** Domain separation so this mac cannot be replayed as another kind of token. Not a secret. */
export const ALERT_UNSUBSCRIBE_PURPOSE = "logloads.alert-unsubscribe.v1"

const uuid = z.string().uuid()

export interface AlertUnsubscribeTarget {
  userId: string
  organizationId: string
  category: MarketplaceNotificationPreferenceView["category"]
  channel: MarketplaceNotificationPreferenceView["channel"]
}

export type AlertUnsubscribeRead =
  | { ok: true; target: AlertUnsubscribeTarget }
  | { ok: false; reason: "invalid" | "expired" }

/** Saving a job the person already saved changes nothing (`saved_jobs` primary key, 26-C). */
export function savedJobSaveChanges(alreadySaved: boolean): boolean {
  return !alreadySaved
}

/** The business the save is for. The job id never chooses it. */
export function planSavedJobWrite(organizationId: string, jobId: string): { organizationId: string; jobId: string } {
  return { jobId, organizationId }
}

export interface JobSearchWrite {
  alertsEnabled: boolean
  criteria: MarketplaceJobAlertCriteria
  kind: "jobs"
  name: string
  organizationId: string
  searchId: string | null
}

/** A job-search write is always kind `jobs`, for the caller's business, never a business named in the input. */
export function planJobSearchWrite(organizationId: string, input: MarketplaceSavedSearchInput<MarketplaceJobAlertCriteria>): JobSearchWrite {
  return {
    alertsEnabled: input.alertsEnabled,
    criteria: input.criteria,
    kind: "jobs",
    name: input.name,
    organizationId,
    searchId: input.searchId ?? null
  }
}

/** One consent change for the caller's business. */
export function planPreferenceWrite(
  organizationId: string,
  input: MarketplaceNotificationPreferenceInput
): MarketplaceNotificationPreferenceInput & { organizationId: string } {
  return { category: input.category, channel: input.channel, enabled: input.enabled, organizationId }
}

/**
 * Every category and channel, in category then channel order. A pair the person has never set is off, with no
 * `updatedAt`. Stored rows are not invented; missing ones are the default the table already applies.
 */
export function notificationPreferenceList(stored: readonly MarketplaceNotificationPreferenceView[]): MarketplaceNotificationPreferenceView[] {
  const byKey = new Map<string, MarketplaceNotificationPreferenceView>()

  for (const row of stored) {
    byKey.set(`${row.category}:${row.channel}`, row)
  }

  return MARKETPLACE_NOTIFICATION_PREFERENCE_CATEGORIES.flatMap((category) =>
    MARKETPLACE_NOTIFICATION_CHANNELS.map((channel) => byKey.get(`${category}:${channel}`) ?? {
      category,
      channel,
      enabled: false,
      updatedAt: null
    })
  )
}

/**
 * Whether a saved job search may queue a notice on each channel. The search's own flag is not consent: the person's
 * `job_alert` preference for that channel has to be on too (`enqueue_job_alerts`, 26-D).
 */
export function jobAlertChannels(
  search: { alertsEnabled: boolean },
  preferences: readonly MarketplaceNotificationPreferenceView[]
): { email: boolean; inApp: boolean } {
  const on = (channel: AlertUnsubscribeTarget["channel"]) => search.alertsEnabled && preferences.some((row) =>
    row.category === "job_alert" && row.channel === channel && row.enabled)

  return { email: on("email"), inApp: on("in_app") }
}

/** `now` plus the default lifetime. */
export function alertUnsubscribeExpiry(now: Date, ttlSeconds = ALERT_UNSUBSCRIBE_TTL_SECONDS): Date {
  return new Date(now.getTime() + ttlSeconds * 1000)
}

function usableSecret(secret: string): boolean {
  return secret.length >= 16 && secret.trim() === secret
}

function failClosed(): never {
  throw new Error(UNAVAILABLE)
}

function mac(secret: string, payload: Buffer): Buffer {
  return createHmac("sha256", secret).update(ALERT_UNSUBSCRIBE_PURPOSE).update(payload).digest()
}

function macMatches(secret: string, payload: Buffer, given: Buffer): boolean {
  const expected = mac(secret, payload)
  const candidate = given.length === expected.length ? given : Buffer.alloc(expected.length)

  return timingSafeEqual(expected, candidate) && given.length === expected.length
}

function canonical(target: AlertUnsubscribeTarget, exp: number): string {
  return JSON.stringify({ c: target.category, e: exp, h: target.channel, o: target.organizationId, u: target.userId, v: 1 })
}

function assertTarget(target: AlertUnsubscribeTarget): void {
  const category: readonly string[] = MARKETPLACE_NOTIFICATION_PREFERENCE_CATEGORIES
  const channel: readonly string[] = MARKETPLACE_NOTIFICATION_CHANNELS

  if (!uuid.safeParse(target.userId).success || !uuid.safeParse(target.organizationId).success) failClosed()
  if (!category.includes(target.category) || !channel.includes(target.channel)) failClosed()
}

/**
 * A link the person can open without signing in. The payload is the preference it turns off and when it expires.
 * It has no email address. `expiresAt` has to be in the future and within 90 days.
 */
export function signAlertUnsubscribeToken(target: AlertUnsubscribeTarget, secret: string, expiresAt: Date, now: Date): string {
  if (!usableSecret(secret)) failClosed()
  assertTarget(target)

  const exp = Math.floor(expiresAt.getTime() / 1000)
  const nowSeconds = Math.floor(now.getTime() / 1000)

  if (!Number.isSafeInteger(exp) || exp <= nowSeconds || exp > nowSeconds + ALERT_UNSUBSCRIBE_MAX_TTL_SECONDS) failClosed()

  const payload = Buffer.from(canonical(target, exp), "utf8")

  return `${payload.toString("base64url")}.${mac(secret, payload).toString("base64url")}`
}

const PART = /^[A-Za-z0-9_-]+$/

function invalid(): AlertUnsubscribeRead {
  return { ok: false, reason: "invalid" }
}

/** Checks the signature before the expiry, so a tampered expired link is invalid, not expired. */
export function readAlertUnsubscribeToken(token: string, secret: string, now: Date): AlertUnsubscribeRead {
  if (!usableSecret(secret) || token.length < 3 || token.length > 512) return invalid()

  const parts = token.split(".")

  if (parts.length !== 2 || !parts[0] || !parts[1] || !PART.test(parts[0]) || !PART.test(parts[1])) return invalid()

  const payload = Buffer.from(parts[0], "base64url")
  const given = Buffer.from(parts[1], "base64url")

  if (!macMatches(secret, payload, given)) return invalid()

  let parsed: unknown

  try {
    parsed = JSON.parse(payload.toString("utf8"))
  } catch {
    return invalid()
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return invalid()

  const record = parsed as Record<string, unknown>
  const keys = Object.keys(record)
  const expected = ["c", "e", "h", "o", "u", "v"]

  if (keys.length !== expected.length || expected.some((key) => !Object.prototype.hasOwnProperty.call(record, key))) {
    return invalid()
  }

  if (record.v !== 1 || typeof record.e !== "number" || !Number.isSafeInteger(record.e)) return invalid()

  const target: AlertUnsubscribeTarget = {
    category: record.c as AlertUnsubscribeTarget["category"],
    channel: record.h as AlertUnsubscribeTarget["channel"],
    organizationId: String(record.o),
    userId: String(record.u)
  }

  try {
    assertTarget(target)
  } catch {
    return invalid()
  }

  if (record.e <= Math.floor(now.getTime() / 1000)) return { ok: false, reason: "expired" }

  return { ok: true, target }
}

/**
 * Turns the preference off when the token is intact and current. No viewer is required. The result names the outcome
 * only. A store failure is replaced with a fixed sentence so it cannot carry an address or an id back to the caller.
 */
export async function applyAlertUnsubscribe(
  token: string,
  secret: string,
  now: Date,
  disable: (target: AlertUnsubscribeTarget) => Promise<void> | void
): Promise<MarketplaceUnsubscribeResult> {
  const read = readAlertUnsubscribeToken(token, secret, now)

  if (!read.ok) return { outcome: read.reason === "expired" ? "expired" : "invalid" }

  try {
    await disable(read.target)
  } catch {
    throw new Error(FAILED)
  }

  return { outcome: "unsubscribed" }
}
