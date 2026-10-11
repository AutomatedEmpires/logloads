import { randomUUID } from "node:crypto"

import {
  reviewTagSchema,
  summarizeReviews,
  tripReviewSchema,
  type ReputationSummary,
  type TripReview
} from "@logloads/contracts"
import type { LogLoadsDatabaseState } from "@logloads/db"
import { z } from "zod"

import { assertCondition, assertFound, createUuid, nowIso } from "./utils"

/**
 * Two-sided post-haul reviews. Only a participant organization of a *completed*
 * cross-org trip may review, and only in the direction that matches their side.
 * The subject (who is rated) is derived server-side from the trip's assignment and
 * load — the client never chooses it. One review per (trip, direction); a repeat
 * submission edits the existing one.
 */
export const submitTripReviewInputSchema = z.object({
  tripId: z.string().uuid(),
  direction: z.enum(["host_rates_hauler", "hauler_rates_host"]),
  stars: z.number().int().min(1).max(5),
  tags: z.array(reviewTagSchema).max(6).default([]),
  note: z.string().trim().max(1000).optional().nullable(),
  raterUserId: z.string().uuid(),
  raterOrganizationId: z.string().uuid()
})

interface TripSides {
  hostOrganizationId: string
  haulerOrganizationId: string
  driverProfileId: string
  loadPostingId: string
  assignmentId: string
}

function resolveTripSides(state: LogLoadsDatabaseState, tripId: string): TripSides {
  const trip = assertFound(
    state.tripsV2.find((candidate) => candidate.id === tripId),
    `Trip ${tripId} was not found`
  )
  assertCondition(trip.status === "completed", "You can only review a completed haul.")

  const assignment = assertFound(
    state.assignments.find((candidate) => candidate.id === trip.assignmentId),
    `Assignment ${trip.assignmentId} was not found`
  )
  const load = assertFound(
    state.loadPostings.find((candidate) => candidate.id === assignment.loadPostingId),
    `Load posting ${assignment.loadPostingId} was not found`
  )
  const driver = assertFound(
    state.driverProfiles.find((candidate) => candidate.id === assignment.driverProfileId),
    `Driver profile ${assignment.driverProfileId} was not found`
  )

  const haulerOrganizationId = driver.companyId
  assertCondition(Boolean(haulerOrganizationId), "This haul has no hauling organization on record.")
  assertCondition(
    load.companyId !== haulerOrganizationId,
    "There's nothing to review — this haul stayed within one organization."
  )

  return {
    assignmentId: assignment.id,
    driverProfileId: driver.id,
    haulerOrganizationId: haulerOrganizationId as string,
    hostOrganizationId: load.companyId,
    loadPostingId: load.id
  }
}

export function submitTripReview(state: LogLoadsDatabaseState, rawInput: unknown): TripReview {
  const input = submitTripReviewInputSchema.parse(rawInput)
  const sides = resolveTripSides(state, input.tripId)

  // The rater must be on the side the direction claims; the subject is derived.
  const expectedRaterOrg = input.direction === "host_rates_hauler" ? sides.hostOrganizationId : sides.haulerOrganizationId
  assertCondition(
    input.raterOrganizationId === expectedRaterOrg,
    "You can only review the other side of a haul you took part in."
  )

  const subjectOrganizationId =
    input.direction === "host_rates_hauler" ? sides.haulerOrganizationId : sides.hostOrganizationId
  const subjectDriverProfileId = input.direction === "host_rates_hauler" ? sides.driverProfileId : null

  // One person can't author BOTH sides of a haul — otherwise a member of both the
  // host and hauler orgs (a shared dispatcher, or sock-puppets) could fabricate a
  // two-sided track record. The opposite side must be a different reviewer.
  const oppositeDirection = input.direction === "host_rates_hauler" ? "hauler_rates_host" : "host_rates_hauler"
  const oppositeSide = state.tripReviews.find(
    (review) => review.tripId === input.tripId && review.direction === oppositeDirection
  )
  assertCondition(
    !oppositeSide || oppositeSide.raterUserId !== input.raterUserId,
    "You can't review both sides of the same haul."
  )

  const timestamp = nowIso()
  const existing = state.tripReviews.find(
    (review) => review.tripId === input.tripId && review.direction === input.direction
  )

  const base = {
    assignmentId: sides.assignmentId,
    createdAt: existing?.createdAt ?? timestamp,
    direction: input.direction,
    id: existing?.id ?? createUuid(),
    loadPostingId: sides.loadPostingId,
    note: input.note ?? null,
    raterOrganizationId: input.raterOrganizationId,
    raterUserId: input.raterUserId,
    stars: input.stars,
    subjectDriverProfileId,
    subjectOrganizationId,
    tags: input.tags,
    tripId: input.tripId,
    updatedAt: timestamp
  }

  const saved = tripReviewSchema.parse(base)

  state.tripReviews = existing
    ? state.tripReviews.map((review) => (review.id === saved.id ? saved : review))
    : [...state.tripReviews, saved]

  state.auditEvents.push({
    action: "trip_review_submitted",
    actorUserId: input.raterUserId,
    createdAt: timestamp,
    entityId: saved.id,
    entityType: "trip_review",
    id: randomUUID(),
    metadata: { direction: saved.direction, stars: saved.stars, tripId: saved.tripId }
  })

  return saved
}

// --- Read models -----------------------------------------------------------------

export function listReviewsForOrganization(state: LogLoadsDatabaseState, organizationId: string): TripReview[] {
  return state.tripReviews.filter((review) => review.subjectOrganizationId === organizationId)
}

export function getReputationForOrganization(state: LogLoadsDatabaseState, organizationId: string): ReputationSummary {
  return summarizeReviews(listReviewsForOrganization(state, organizationId))
}

export function getReputationForDriver(state: LogLoadsDatabaseState, driverProfileId: string): ReputationSummary {
  return summarizeReviews(state.tripReviews.filter((review) => review.subjectDriverProfileId === driverProfileId))
}

export interface OrgReliability {
  organizationId: string
  completedTrips: number
  completionRate: number | null
  onTimeRate: number | null
  avgRating: number | null
  ratedTrips: number
}

/**
 * An organization's track record as a hauler/counterpart, derived from existing
 * assignments + trips (no new bookkeeping): how often it finishes what it starts,
 * delivers on time (from review signals), and its average rating.
 */
export function getReliabilityForOrganization(state: LogLoadsDatabaseState, organizationId: string): OrgReliability {
  const driverIds = new Set(
    state.driverProfiles.filter((driver) => driver.companyId === organizationId).map((driver) => driver.id)
  )
  const orgAssignments = state.assignments.filter((assignment) => driverIds.has(assignment.driverProfileId))

  const completed = orgAssignments.filter((assignment) => assignment.status === "completed").length
  // Only count cancellations that happened AFTER the haul was assigned. A host
  // declining a request (cancelled while still "requested", so assignedAt is null)
  // is not the hauler failing to finish, and must not drag down its completion.
  const abandoned = orgAssignments.filter(
    (assignment) => assignment.status === "cancelled" && Boolean(assignment.assignedAt)
  ).length
  const finished = completed + abandoned

  const reviews = listReviewsForOrganization(state, organizationId)
  const onTime = reviews.filter((review) => review.tags.includes("on_time")).length
  const late = reviews.filter((review) => review.tags.includes("late")).length
  const timed = onTime + late
  const summary = summarizeReviews(reviews)

  return {
    avgRating: summary.avgRating,
    completedTrips: completed,
    completionRate: finished === 0 ? null : completed / finished,
    onTimeRate: timed === 0 ? null : onTime / timed,
    organizationId,
    ratedTrips: summary.ratedCount
  }
}

/** The window a driver's request and approval counts cover. */
export const DRIVER_TRACK_RECORD_WINDOW_DAYS = 365

export interface DriverTrackRecord {
  /** Requests this driver made inside the window. */
  requested: number
  /** Of those, how many a host approved (assignedAt set), whatever happened next. */
  approved: number
  /** Of those, how many a host declined. Undecided requests are neither. */
  declined: number
  /** Hauls this driver completed, all time. */
  completedHauls: number
  /** Host reviews of this driver that said anything about timing (on time or late). */
  timedReviews: number
  /** Of those, how many said on time. */
  onTimeReviews: number
  /** States of the landings and mills on this driver's completed hauls, sorted. */
  statesHauled: string[]
}

/**
 * A driver's own track record, derived from records LogLoads already keeps — no
 * self-reported figure. Requests and approvals are windowed so an old season
 * doesn't stand in for current work; completions, timing and geography are all
 * time because they describe what the driver has actually done.
 */
export function getDriverTrackRecord(
  state: LogLoadsDatabaseState,
  driverProfileId: string,
  at = new Date().toISOString()
): DriverTrackRecord {
  const windowStart = new Date(Date.parse(at) - DRIVER_TRACK_RECORD_WINDOW_DAYS * 86_400_000).toISOString()
  const windowed = state.assignments.filter((assignment) =>
    assignment.driverProfileId === driverProfileId &&
    assignment.requestedAt >= windowStart &&
    assignment.requestedAt <= at
  )
  const completedTrips = state.tripsV2.filter(
    (trip) => trip.driverProfileId === driverProfileId && trip.status === "completed"
  )
  const states = new Set<string>()

  for (const trip of completedTrips) {
    const load = state.loadPostings.find((posting) => posting.id === trip.loadPostingId)
    const landing = load ? state.landings.find((candidate) => candidate.id === load.pickupLandingId) : undefined
    const mill = load ? state.mills.find((candidate) => candidate.id === load.dropoffMillId) : undefined

    for (const stateCode of [landing?.state, mill?.state]) {
      if (stateCode) {
        states.add(stateCode.trim().toUpperCase())
      }
    }
  }

  const reviews = state.tripReviews.filter(
    (review) => review.direction === "host_rates_hauler" && review.subjectDriverProfileId === driverProfileId
  )
  const onTimeReviews = reviews.filter((review) => review.tags.includes("on_time")).length
  const lateReviews = reviews.filter((review) => review.tags.includes("late")).length

  return {
    approved: windowed.filter((assignment) => Boolean(assignment.assignedAt)).length,
    completedHauls: completedTrips.length,
    declined: windowed.filter((assignment) => assignment.status === "declined").length,
    onTimeReviews,
    requested: windowed.length,
    statesHauled: [...states].sort(),
    timedReviews: onTimeReviews + lateReviews
  }
}

/** Whether a review already exists for a given trip + direction (drives UI state). */
export function hasTripReview(
  state: LogLoadsDatabaseState,
  tripId: string,
  direction: "host_rates_hauler" | "hauler_rates_host"
): boolean {
  return state.tripReviews.some((review) => review.tripId === tripId && review.direction === direction)
}
