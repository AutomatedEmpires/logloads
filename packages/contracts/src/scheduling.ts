import { z } from "zod"

import { haversineMiles, type Coordinates } from "./geo"

/**
 * Scheduling integrity: can this driver, truck and trailer physically be where
 * this haul needs them, given everything they are already committed to?
 *
 * Pure. Every value it needs is passed in, so the same function answers for the
 * service (which blocks) and for browse annotation (which explains). There must
 * never be a second implementation — an annotation that disagrees with the gate
 * is worse than no annotation, because the driver is told a slot is takeable and
 * then refused.
 *
 * The thresholds live here as exported data rather than as private helpers
 * inside a service, because a rule nobody can read is a rule that quietly
 * changes: an adversarial pass on a sibling product restored a deleted honesty
 * rule and every test still passed.
 *
 * ── WHAT A SLOT MEANS ─────────────────────────────────────────────────────────
 * A truck slot IS the loading appointment at the landing. Loading happens INSIDE
 * that window, so occupancy does not add a landing-service term on top of it:
 *
 *   occupancyStart = slot.startAt - preTripMinutes
 *   occupancyEnd   = slot.endAt + loadedRunMinutes + millServiceMinutes
 *
 * This resolves two findings the design left open. Adding a landing service
 * duration after the slot window would count the loading twice — once as the
 * window it was booked in, once as work after it — and no test would catch it
 * because both sides would use the same wrong constant. And anchoring the end at
 * `slot.endAt` is only safe because slots are per-truck-turn windows: on a
 * single wide window it would mean one load per driver per day, platform-wide.
 * Narrow slots are what make the pessimistic anchor honest, and the anchor is
 * deliberately pessimistic — the host may call the truck in at any point inside
 * the window, so the driver has sold the whole window.
 *
 * `millServiceMinutes` survives because the mill turn has no slot of its own.
 */

// ── Buffers ───────────────────────────────────────────────────────────────────

export interface SchedulingBuffers {
  /** DVIR walk-around before rolling. The buffer and the inspection are one event. */
  preTripMinutes: number
  /** Turn time at the destination. The mill has no slot, so this is not double-counted. */
  millServiceMinutes: number
  interAssignmentBufferMinutes: number
  deadheadAverageMph: number
  /** Straight-line miles understate logging roads; this converts them. */
  roadCircuityFactor: number
  deadheadMinimumMinutes: number
  /** A loaded log truck runs behind plan; 1.0 makes every back-to-back look feasible. */
  runTimeSafetyFactor: number
}

export const SCHEDULING_BUFFER_DEFAULTS: SchedulingBuffers = {
  deadheadAverageMph: 45,
  deadheadMinimumMinutes: 15,
  interAssignmentBufferMinutes: 30,
  millServiceMinutes: 30,
  preTripMinutes: 30,
  roadCircuityFactor: 1.3,
  runTimeSafetyFactor: 1.15
}

/**
 * Floors, not just ranges. Every one of these numbers is a way to defeat the
 * conflict check by zeroing it, so the driver-protective ones cannot reach zero:
 * a configuration claiming a truck needs no transit time between hauls is not a
 * configuration, it is a bypass.
 *
 * The overlap test itself is buffer-independent — with every buffer at zero a
 * literal interval overlap still conflicts — which is why the pure functions
 * accept a plain `SchedulingBuffers` and only RESOLUTION goes through this
 * schema. That separation is what negative control 6 exercises.
 */
export const schedulingBuffersSchema = z.object({
  deadheadAverageMph: z.number().min(10).max(70),
  deadheadMinimumMinutes: z.number().int().min(10).max(120),
  interAssignmentBufferMinutes: z.number().int().min(15).max(240),
  millServiceMinutes: z.number().int().min(0).max(480),
  preTripMinutes: z.number().int().min(15).max(240),
  roadCircuityFactor: z.number().min(1).max(2),
  runTimeSafetyFactor: z.number().min(1).max(2)
})

/**
 * Whose risk each number is.
 *
 * Driver-protective values resolve from the platform default and the DRIVER's
 * own side only. A host override of them is ignored — a host who could shorten
 * the transit time the platform requires between a driver's hauls could book
 * that driver into a day they cannot physically drive, which is the exact harm
 * this module exists to prevent.
 */
export const DRIVER_PROTECTIVE_BUFFER_KEYS = [
  "deadheadAverageMph",
  "deadheadMinimumMinutes",
  "interAssignmentBufferMinutes",
  "preTripMinutes",
  "roadCircuityFactor",
  "runTimeSafetyFactor"
] as const satisfies ReadonlyArray<keyof SchedulingBuffers>

/** Site facts. The mill's turn time belongs to the mill, not to the driver. */
export const SITE_RESOLVED_BUFFER_KEYS = [
  "millServiceMinutes"
] as const satisfies ReadonlyArray<keyof SchedulingBuffers>

export interface BufferResolutionInput {
  /** The driver's own or their organization's stated values. Honoured. */
  driverOverride?: Partial<SchedulingBuffers> | null
  /** The host's stated values. Honoured ONLY for site-resolved keys. */
  hostOverride?: Partial<SchedulingBuffers> | null
  /** `mill.slotWindowMinutes`, when the mill has stated one. */
  millServiceMinutes?: number | null
}

export function resolveSchedulingBuffers(input: BufferResolutionInput = {}): SchedulingBuffers {
  const resolved: SchedulingBuffers = { ...SCHEDULING_BUFFER_DEFAULTS }

  for (const key of DRIVER_PROTECTIVE_BUFFER_KEYS) {
    const stated = input.driverOverride?.[key]

    if (typeof stated === "number") {
      resolved[key] = stated
    }
  }

  for (const key of SITE_RESOLVED_BUFFER_KEYS) {
    const stated = input.hostOverride?.[key]

    if (typeof stated === "number") {
      resolved[key] = stated
    }
  }

  if (typeof input.millServiceMinutes === "number") {
    resolved.millServiceMinutes = input.millServiceMinutes
  }

  return schedulingBuffersSchema.parse(resolved)
}

// ── Occupancy ─────────────────────────────────────────────────────────────────

export interface Occupancy {
  assignmentId: string | null
  driverProfileId: string
  truckProfileId: string
  trailerProfileId: string | null
  startAt: string
  endAt: string
  originCoordinates: Coordinates
  terminusCoordinates: Coordinates
  /**
   * What a viewer may be told about this commitment. The CALLER decides, because
   * only the caller knows what this viewer is already allowed to see: a host
   * approving a driver from another organization learns the times and nothing
   * else. This module never invents identity.
   */
  label: string
}

export interface OccupancyInput {
  assignmentId?: string | null
  driverProfileId: string
  truckProfileId: string
  trailerProfileId?: string | null
  slot: { startAt: string; endAt: string }
  route: { estimatedRunTimeMinutes: number }
  originCoordinates: Coordinates
  terminusCoordinates: Coordinates
  buffers: SchedulingBuffers
  label?: string
}

const MINUTE_MS = 60_000

function shiftMinutes(instant: string, minutes: number): string {
  return new Date(new Date(instant).getTime() + minutes * MINUTE_MS).toISOString()
}

export function minutesBetween(from: string, to: string): number {
  return (new Date(to).getTime() - new Date(from).getTime()) / MINUTE_MS
}

export function loadedRunMinutes(
  route: { estimatedRunTimeMinutes: number },
  buffers: SchedulingBuffers
): number {
  return Math.ceil(route.estimatedRunTimeMinutes * buffers.runTimeSafetyFactor)
}

export function buildOccupancy(input: OccupancyInput): Occupancy {
  return {
    assignmentId: input.assignmentId ?? null,
    driverProfileId: input.driverProfileId,
    endAt: shiftMinutes(
      input.slot.endAt,
      loadedRunMinutes(input.route, input.buffers) + input.buffers.millServiceMinutes
    ),
    label: input.label ?? "Committed elsewhere",
    originCoordinates: input.originCoordinates,
    startAt: shiftMinutes(input.slot.startAt, -input.buffers.preTripMinutes),
    terminusCoordinates: input.terminusCoordinates,
    trailerProfileId: input.trailerProfileId ?? null,
    truckProfileId: input.truckProfileId
  }
}

// ── Deadhead and separation ───────────────────────────────────────────────────

/**
 * Pairwise, never baked into the interval: it depends on where the previous haul
 * ENDED and where the next one STARTS. The minimum applies even when the mill
 * and the next landing are the same point — fuel, scale, a break.
 *
 * Deadhead from and to the driver's own home base is deliberately NOT part of
 * this. The first and last legs of a driver's day are the driver's business.
 */
export function deadheadMinutes(
  previous: Occupancy,
  next: Occupancy,
  buffers: SchedulingBuffers
): number {
  const miles = haversineMiles(previous.terminusCoordinates, next.originCoordinates)

  return Math.max(
    buffers.deadheadMinimumMinutes,
    Math.ceil((miles * buffers.roadCircuityFactor) / buffers.deadheadAverageMph * 60)
  )
}

export function separationMinutes(
  previous: Occupancy,
  next: Occupancy,
  buffers: SchedulingBuffers
): number {
  return buffers.interAssignmentBufferMinutes + deadheadMinutes(previous, next, buffers)
}

/** Half-open: a gap exactly equal to the required separation is feasible. */
export function feasibleInOrder(
  previous: Occupancy,
  next: Occupancy,
  buffers: SchedulingBuffers
): boolean {
  return minutesBetween(previous.endAt, next.startAt) >= separationMinutes(previous, next, buffers)
}

/**
 * Two commitments conflict exactly when NEITHER can follow the other. Order-free
 * by construction, so `conflicts(a, b) === conflicts(b, a)` is a property of the
 * shape rather than something the caller has to remember. Genuine interval
 * overlap is subsumed: both orderings fail.
 */
export function conflicts(
  left: Occupancy,
  right: Occupancy,
  buffers: SchedulingBuffers
): boolean {
  return !feasibleInOrder(left, right, buffers) && !feasibleInOrder(right, left, buffers)
}

// ── Result shape ──────────────────────────────────────────────────────────────

export const schedulingDimensions = ["driver", "truck", "trailer", "availability"] as const
export type SchedulingDimension = (typeof schedulingDimensions)[number]

export const schedulingConflictKinds = [
  "overlap",
  "insufficient_transit",
  "declared_unavailable"
] as const
export type SchedulingConflictKind = (typeof schedulingConflictKinds)[number]

export const schedulingCautionKinds = [
  "unconstrained",
  "outside_declared_availability",
  "long_day"
] as const
export type SchedulingCautionKind = (typeof schedulingCautionKinds)[number]

export interface SchedulingConflict {
  dimension: SchedulingDimension
  kind: SchedulingConflictKind
  conflictingAssignmentId: string | null
  conflictingLabel: string
  window: { startAt: string; endAt: string }
  requiredGapMinutes: number
  actualGapMinutes: number
}

export interface SchedulingCaution {
  kind: SchedulingCautionKind
  detail: string
}

export interface SchedulingCheck {
  conflicts: SchedulingConflict[]
  cautions: SchedulingCaution[]
}

/** Blocking iff there is at least one conflict. Cautions never block. */
export function isBlocked(check: SchedulingCheck): boolean {
  return check.conflicts.length > 0
}

/**
 * Which assignment states hold a resource. A cancelled or declined request holds
 * nothing, and a completed haul is in the past — counting either would block a
 * driver out of work they are free to take.
 */
export const OCCUPYING_ASSIGNMENT_STATUSES = [
  "requested",
  "offered",
  "accepted",
  "checked_in",
  "loading",
  "hauled"
] as const

export function assignmentOccupies(status: string): boolean {
  return (OCCUPYING_ASSIGNMENT_STATUSES as readonly string[]).includes(status)
}

// ── Dimensions ────────────────────────────────────────────────────────────────

/**
 * The three resource dimensions are checked INDEPENDENTLY, and that independence
 * is the feature rather than a special case:
 * - driver — a driver with three trucks is still one human in one place, so
 *   swapping trucks cannot launder a driver conflict;
 * - truck — a truck shared by two drivers is caught even though the ids differ;
 * - trailer — null claims nothing, so a haul booked without a trailer produces
 *   no trailer entry at all.
 */
function sharedDimensions(left: Occupancy, right: Occupancy): SchedulingDimension[] {
  const dimensions: SchedulingDimension[] = []

  if (left.driverProfileId === right.driverProfileId) {
    dimensions.push("driver")
  }

  if (left.truckProfileId === right.truckProfileId) {
    dimensions.push("truck")
  }

  if (
    left.trailerProfileId !== null &&
    right.trailerProfileId !== null &&
    left.trailerProfileId === right.trailerProfileId
  ) {
    dimensions.push("trailer")
  }

  return dimensions
}

function describeConflict(
  candidate: Occupancy,
  existing: Occupancy,
  dimension: SchedulingDimension,
  buffers: SchedulingBuffers
): SchedulingConflict {
  // Report the gap for the ordering the caller was probably attempting: whichever
  // of the two comes first in time. Both orderings failed, so either is honest;
  // the earlier one is the one a human is thinking about.
  const candidateFirst = candidate.startAt <= existing.startAt
  const previous = candidateFirst ? candidate : existing
  const next = candidateFirst ? existing : candidate
  const requiredGapMinutes = separationMinutes(previous, next, buffers)
  const actualGapMinutes = minutesBetween(previous.endAt, next.startAt)

  return {
    actualGapMinutes,
    conflictingAssignmentId: existing.assignmentId,
    conflictingLabel: existing.label,
    dimension,
    kind: actualGapMinutes < 0 ? "overlap" : "insufficient_transit",
    requiredGapMinutes,
    window: { endAt: existing.endAt, startAt: existing.startAt }
  }
}

export function checkResourceConflicts(
  candidate: Occupancy,
  existing: readonly Occupancy[],
  buffers: SchedulingBuffers
): SchedulingConflict[] {
  const found: SchedulingConflict[] = []

  for (const other of existing) {
    if (other.assignmentId !== null && other.assignmentId === candidate.assignmentId) {
      continue
    }

    const dimensions = sharedDimensions(candidate, other)

    if (dimensions.length === 0 || !conflicts(candidate, other, buffers)) {
      continue
    }

    for (const dimension of dimensions) {
      found.push(describeConflict(candidate, other, dimension, buffers))
    }
  }

  return found
}

// ── Availability: a fourth, asymmetric dimension ──────────────────────────────

export interface AvailabilityWindowLike {
  startAt: string
  endAt: string
  status: string
}

/**
 * Availability is asymmetric on purpose, and the asymmetry is the product
 * decision:
 * - a window that says `unavailable` and overlaps the haul is a HARD conflict —
 *   the driver said they were off, and that is binding;
 * - no window covering the haul is a CAUTION, never a conflict. Silence is not
 *   a refusal. A driver who has declared nothing at all stays bookable and
 *   visible, because requiring a declaration would empty every board overnight:
 *   nothing has ever required drivers to maintain windows, so nobody has.
 *
 * Never auto-create a window to make this pass. Minting a covering window on the
 * driver's behalf is precisely the act that erases the signal the check exists
 * to produce — it converts "we do not know" into a fabricated "yes".
 */
export function checkAvailability(
  candidate: Occupancy,
  windows: readonly AvailabilityWindowLike[]
): SchedulingCheck {
  const declaredUnavailable = windows.filter(
    (window) =>
      window.status === "unavailable" &&
      window.startAt < candidate.endAt &&
      window.endAt > candidate.startAt
  )

  if (declaredUnavailable.length > 0) {
    return {
      cautions: [],
      conflicts: declaredUnavailable.map((window) => ({
        actualGapMinutes: 0,
        conflictingAssignmentId: null,
        conflictingLabel: "Declared unavailable",
        dimension: "availability" as const,
        kind: "declared_unavailable" as const,
        requiredGapMinutes: 0,
        window: { endAt: window.endAt, startAt: window.startAt }
      }))
    }
  }

  if (windows.length === 0) {
    return {
      cautions: [
        {
          detail: "This driver has not declared availability, so nothing here is ruled out.",
          kind: "unconstrained"
        }
      ],
      conflicts: []
    }
  }

  const covered = windows.some(
    (window) =>
      window.status !== "unavailable" &&
      window.startAt <= candidate.startAt &&
      window.endAt >= candidate.endAt
  )

  if (covered) {
    return { cautions: [], conflicts: [] }
  }

  return {
    cautions: [
      {
        detail: "This haul falls outside the availability the driver has posted.",
        kind: "outside_declared_availability"
      }
    ],
    conflicts: []
  }
}

// ── The whole check ───────────────────────────────────────────────────────────

export function evaluateSchedulingCheck(input: {
  candidate: Occupancy
  existing: readonly Occupancy[]
  windows: readonly AvailabilityWindowLike[]
  buffers: SchedulingBuffers
}): SchedulingCheck {
  const availability = checkAvailability(input.candidate, input.windows)

  return {
    cautions: availability.cautions,
    conflicts: [
      ...checkResourceConflicts(input.candidate, input.existing, input.buffers),
      ...availability.conflicts
    ]
  }
}
