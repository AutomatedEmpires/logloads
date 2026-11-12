import "server-only"

import { createHash } from "node:crypto"

import { after } from "next/server"

import {
  postingFreshness,
  type MarketplaceDraftLandingContext,
  type MarketplaceInterestView,
  type MarketplaceJobCardView,
  type MarketplaceJobDraft,
  type MarketplaceJobStopStatus
} from "@logloads/contracts"

import { captureServerEvent, isAnalyticsEnabled } from "@/lib/analytics"

import { requestRefusesTracking, type HeaderReader } from "./consent"
import {
  buildProductEvent,
  productEventSide,
  productValue,
  type ConfirmationRoute,
  type ProductEventOutcome,
  type ProductEventProperties,
  type ServerProductEventName
} from "./events"

export type { ProductEventOutcome } from "./events"

/**
 * Server capture for the product events (#286). Call sites (#330) use `recordProductEvent` after the write they
 * describe has committed, never on a click or a page load; it sends inside `after()` from `next/server`, so the
 * response never waits for PostHog:
 *
 *     await recordProductEvent("job_published", () => jobPublishedProperties({ ... }), { actor: viewer })
 *
 * It never throws and never makes the action fail. It sends nothing when PostHog is not configured, when the request
 * asks not to be tracked (`DNT: 1` or `Sec-GPC: 1`), or when the properties fail the event's schema or the
 * personal-data guard. People and businesses appear only as pseudonymous ids; server events create no PostHog person
 * profile and are not located by IP address.
 */

/** Who acted. The distinct id is the person's pseudonymous id, or the business's when no one is signed in. */
export interface ProductEventActor {
  userId?: string | null
  organizationId?: string | null
}

export interface ServerCaptureOptions {
  actor: ProductEventActor
  /** The request's headers. Omitted: the current request's, from `next/headers`. `null`: there is no request. */
  headers?: HeaderReader | null
}

/** Added to every server event: no person profile for a pseudonymous id, and no location from the server's IP. */
export const SERVER_EVENT_PRIVACY = Object.freeze({ $geoip_disable: true, $process_person_profile: false })

/** The distinct id for events with no person and no business. */
export const SERVER_DISTINCT_ID = "logloads-server"

const PSEUDONYM_NAMESPACE = "logloads:product-events:v1"
const PSEUDONYM_PREFIX = { interest: "i", organization: "o", user: "u" } as const

export type PseudonymKind = keyof typeof PSEUDONYM_PREFIX

/**
 * A stable pseudonymous id for a person, a business or an inquiry: the first 128 bits of SHA-256 over a fixed
 * namespace, the kind and the id. PostHog never holds the raw id, so its events cannot be joined to LogLoads records,
 * logs or error reports by id; the same id always gives the same pseudonym, so funnels and joins still work.
 */
export function pseudonymousId(kind: PseudonymKind, id: string): string {
  const digest = createHash("sha256").update(`${PSEUDONYM_NAMESPACE}:${kind}:${id.trim().toLowerCase()}`).digest("hex")
  return `${PSEUDONYM_PREFIX[kind]}_${digest.slice(0, 32)}`
}

export function productEventDistinctId(actor: ProductEventActor): string {
  if (actor.userId) {
    return pseudonymousId("user", actor.userId)
  }

  return actor.organizationId ? pseudonymousId("organization", actor.organizationId) : SERVER_DISTINCT_ID
}

async function currentRequestHeaders(): Promise<HeaderReader | null> {
  try {
    const { headers } = await import("next/headers")
    return await headers()
  } catch {
    // Outside a request (a scheduled job): no signal was sent, so none is refused.
    return null
  }
}

function warnDropped(name: string, problems: readonly string[]): void {
  // Keys and rule codes only, never values (quality bar B5).
  console.warn(`[analytics] dropped product event ${name}: ${problems.join(" ")}`)
}

/** Sends one server product event. `properties: null` (a builder said there is nothing to record) sends nothing. */
export async function captureProductEvent<N extends ServerProductEventName>(
  name: N,
  properties: ProductEventProperties<N> | null,
  options: ServerCaptureOptions
): Promise<ProductEventOutcome> {
  try {
    if (properties === null) {
      return "skipped"
    }

    if (productEventSide(name) !== "server") {
      warnDropped(name, ["(event):not_a_server_event"])
      return "invalid"
    }

    const built = buildProductEvent(name, properties)

    if (!built.ok) {
      warnDropped(name, built.problems)
      return "invalid"
    }

    if (!isAnalyticsEnabled()) {
      return "disabled"
    }

    const headers = options.headers === undefined ? await currentRequestHeaders() : options.headers

    if (requestRefusesTracking(headers)) {
      return "declined"
    }

    await captureServerEvent(built.event.name, productEventDistinctId(options.actor), {
      ...built.event.properties,
      ...SERVER_EVENT_PRIVACY
    })
    return "sent"
  } catch {
    return "invalid"
  }
}

/**
 * What a call site uses (§6): records one server product event for a write that has just committed, without making
 * the response wait. The request's privacy headers are read now, while the request is in scope, and the event is sent
 * inside `after()` from `next/server` once the response has gone. Outside a request (a scheduled job, a script) there
 * is no response to wait for and no signal to read, so it is sent in the background.
 *
 * `build` makes the properties from what the call site holds, with one of the builders below; `null` records nothing.
 * Like `captureProductEvent` it never throws, and a builder that throws records nothing, so analytics never fails the
 * write it describes.
 */
export async function recordProductEvent<N extends ServerProductEventName>(
  name: N,
  build: () => ProductEventProperties<N> | null,
  options: { actor: ProductEventActor }
): Promise<void> {
  try {
    const properties = build()

    if (properties === null) {
      return
    }

    const headers = await currentRequestHeaders()
    const send = async () => {
      await captureProductEvent(name, properties, { actor: options.actor, headers })
    }

    try {
      after(send)
    } catch {
      // Outside a request scope: nothing to wait for.
      void send()
    }
  } catch {
    // The builder could not read what the call site holds: nothing is recorded.
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Property builders: one per server event, from what its call site already holds. They read ids, enums and counts
// from the port's views and leave every name, message, title and place behind.
// ---------------------------------------------------------------------------------------------------------------

const RENEWAL_GRACE_MS = 2 * 60_000

function confirmedAge(job: Pick<MarketplaceJobCardView, "lastConfirmedAt">, now: string): number | null {
  if (!job.lastConfirmedAt) {
    return null
  }

  const days = Math.floor((Date.parse(now) - Date.parse(job.lastConfirmedAt)) / 86_400_000)
  return Number.isFinite(days) ? Math.min(Math.max(days, 0), 3650) : null
}

function stateOf(landing: Pick<MarketplaceDraftLandingContext, "stateCode"> | null | undefined): string | null {
  const code = landing?.stateCode?.trim().toUpperCase() ?? ""
  return /^[A-Z]{2}$/.test(code) ? code : null
}

/** `publishJobAction`: the published job's id, the validated draft and the landing it was posted at. */
export function jobPublishedProperties(input: {
  organizationId: string
  jobId: string
  draft: Pick<MarketplaceJobDraft, "equipment" | "payAmount" | "payUnit" | "product" | "trucksRequested">
  landing?: Pick<MarketplaceDraftLandingContext, "stateCode"> | null
}): ProductEventProperties<"job_published"> {
  return {
    equipment_count: input.draft.equipment.length,
    job: input.jobId,
    org: pseudonymousId("organization", input.organizationId),
    pay_stated: typeof input.draft.payAmount === "number" && input.draft.payAmount > 0,
    pay_unit: input.draft.payUnit ?? null,
    product: productValue(input.draft.product),
    state: stateOf(input.landing),
    trucks_requested: input.draft.trucksRequested
  }
}

/**
 * `expressInterestAction`: the interest the port returned. `renewed` is true when the inquiry already existed (a
 * re-send updates the same inquiry), so first sends and renewals can be told apart.
 */
export function interestSubmittedProperties(input: {
  interest: Pick<MarketplaceInterestView, "contactPreference" | "createdAt" | "equipment" | "haulerOrganization" | "id" | "job" | "trucksOffered">
  now: string
}): ProductEventProperties<"interest_submitted"> {
  const age = Date.parse(input.now) - Date.parse(input.interest.createdAt)

  return {
    contact_route: input.interest.contactPreference,
    equipment_lines: input.interest.equipment.length,
    interest: pseudonymousId("interest", input.interest.id),
    job: input.interest.job.id,
    org: pseudonymousId("organization", input.interest.haulerOrganization.id),
    renewed: Number.isFinite(age) && age > RENEWAL_GRACE_MS,
    trucks_offered: input.interest.trucksOffered
  }
}

/**
 * `respondToInterestAction` (side `landing`) and `haulerReplyAction` (side `hauler`). A landing marking an inquiry
 * "viewed" is not an answer, so it returns `null` and nothing is sent.
 */
export function interestRepliedProperties(input: {
  organizationId: string
  interestId: string
  side: "landing" | "hauler"
  decision: string
}): ProductEventProperties<"interest_replied"> | null {
  const outcome = input.side === "hauler" ? "replied" : input.decision

  if (outcome !== "replied" && outcome !== "declined") {
    return null
  }

  return {
    interest: pseudonymousId("interest", input.interestId),
    org: pseudonymousId("organization", input.organizationId),
    outcome,
    side: input.side
  }
}

/** `confirmHaulerAvailabilityAction`: how many truck types were re-stated, and how the confirmation arrived. */
export function availabilityReconfirmedProperties(input: {
  organizationId: string
  confirmed: number
  via: ConfirmationRoute
  signedIn: boolean
}): ProductEventProperties<"availability_reconfirmed"> {
  return {
    org: pseudonymousId("organization", input.organizationId),
    signed_in: input.signedIn,
    truck_types: Math.max(0, Math.min(200, Math.trunc(input.confirmed))),
    via: input.via
  }
}

type ConfirmableJob = Pick<MarketplaceJobCardView, "expiresAt" | "id" | "lastConfirmedAt" | "lastModifiedAt">

/** The listing's freshness band and confirmation age just before the poster acted; `null` for unreadable timestamps. */
function freshnessBefore(job: ConfirmableJob, now: string) {
  try {
    return { days_since_confirmed: confirmedAge(job, now), freshness_before: postingFreshness(job, now).band }
  } catch {
    return null
  }
}

/**
 * `reconfirmJobAction` (`resumed: false`) and the jobs group's resume (`resumed: true`). `job` is the listing as it was
 * before the confirmation, so `freshness_before` says whether the poster acted before or after it went stale. Returns
 * `null`, so nothing is sent, when the listing's timestamps cannot be read.
 */
export function jobReconfirmedProperties(input: {
  organizationId: string
  job: ConfirmableJob
  via: ConfirmationRoute
  resumed: boolean
  now: string
}): ProductEventProperties<"job_reconfirmed"> | null {
  const before = freshnessBefore(input.job, input.now)

  return before
    ? {
        ...before,
        job: input.job.id,
        org: pseudonymousId("organization", input.organizationId),
        resumed: input.resumed,
        via: input.via
      }
    : null
}

/** The jobs group's pause, mark-filled and close. `job` is the listing as it was before it stopped. */
export function jobStoppedProperties(input: {
  organizationId: string
  job: ConfirmableJob
  status: MarketplaceJobStopStatus
  via: ConfirmationRoute
  now: string
}): ProductEventProperties<"job_stopped"> | null {
  const before = freshnessBefore(input.job, input.now)

  return before
    ? {
        ...before,
        job: input.job.id,
        org: pseudonymousId("organization", input.organizationId),
        status: input.status,
        via: input.via
      }
    : null
}
