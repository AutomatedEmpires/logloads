import {
  auditEventSchema,
  computePlatformFeeCents,
  deterministicUuidV5,
  FEE_BPS_SCALE,
  hostInvoiceSchema,
  invoicePeriodFor,
  invoiceSubtotalCents,
  LEGACY_PERCENTAGE_ELIGIBLE_CURRENCY,
  percentageFeeEventId,
  platformFeeEventId,
  platformFeeEventSchema,
  PLATFORM_FEE_BPS,
  readFrozenDriverPay,
  type Assignment,
  type AssignmentStatus,
  type HostInvoice,
  type HostInvoiceStatus,
  type InvoicePeriod,
  type LoadPosting,
  type OrganizationAction,
  type PlatformFeeEvent,
  type TripV2
} from "@logloads/contracts"
import type { LogLoadsDatabaseState } from "@logloads/db"

import { haulHasBillableDelivery } from "./haul-completion"
import { assertOrganizationAction, getActiveOrganizationContext } from "./operating-network"
import { assertCondition, assertFound, createUuid, nowIso } from "./utils"

/**
 * The permanent percentage ledger: what legacy and percentage_v1 completed
 * movements accrued, what a host owes, and the monthly bill each fee lands on.
 * Subscription-v1 never writes these rows; its movement usage lives separately.
 *
 * WHAT IS BEING CHARGED. A host posts a load and states what it pays the driver.
 * LogLoads charges the HOST a percentage of that stated pay, ON TOP of it, once
 * the load is completed. Nothing in this module reduces driver pay, and nothing
 * here holds, escrows, routes or pays out driver money: driver funds move host →
 * driver directly and off-platform. The only money LogLoads collects is its own
 * fee, charged in arrears to a card the host attached, and even that is recorded
 * here rather than moved — no function in this file performs I/O.
 *
 * WHY EVERY WRITE IS IDEMPOTENT ON A DETERMINISTIC ID. The whole database is one
 * JSONB document read and written whole under a version compare-and-swap. On a
 * conflict the caller's mutation is REPLAYED against a fresh draft, so any write
 * that is not idempotent bills twice under nothing more exotic than two hosts
 * saving at the same moment. There is no unique index, no foreign key and no
 * CHECK constraint behind this store: a deterministic id plus an explicit
 * "already present?" assertion made INSIDE the same mutation as the write is the
 * entire defence against double-billing.
 *
 * WHY IT IS PURE-ISH. Every function takes the draft state and a clock, mutates
 * the draft, and returns. No Stripe call, no network, no `Date.now()` hidden
 * inside a branch. That is what lets the guards above be tested at all, and what
 * lets the caller run them inside the compare-and-swap mutator where they must
 * run to mean anything.
 *
 * WHY REFUSALS ARE TYPED RATHER THAN THROWN. Accrual runs inside the same
 * mutation as the completion the host and driver just agreed on. A throw would
 * roll that agreement back, so a billing-side gap (a load posted before hosts
 * stated driver pay) must not be able to destroy an operating record. Refusals a
 * caller could legitimately hit are therefore discriminated outcomes with no
 * `event`/`invoice` field at all, so a caller cannot read one as success without
 * the compiler stopping them. Refusals that can only mean a caller bug or an
 * authorization failure still throw.
 */

// ── Deterministic ids ─────────────────────────────────────────────────────────

/**
 * The namespace every host invoice id is derived under. FROZEN FOREVER.
 *
 * Changing it re-mints the id of every bill ever opened. Distinct from the fee
 * event namespace so a fee and a bill can never collide on one id.
 */
const HOST_INVOICE_NAMESPACE = "2d9f6c1a-4b83-4f0e-9a71-6e5c8d3b47f2"

/**
 * @deprecated Import `LEGACY_PERCENTAGE_ELIGIBLE_CURRENCY` from contracts.
 * Retained for the existing services package export while callers migrate.
 */
export const LEGACY_PLATFORM_FEE_CURRENCY =
  LEGACY_PERCENTAGE_ELIGIBLE_CURRENCY

/**
 * The id of one host's primary bill for one calendar month. Same host, same
 * month, same primary id, forever.
 *
 * `periodStart` must already be the CANONICAL start `invoicePeriodFor` emits.
 * The same month boundary has several valid ISO spellings, and deriving from the
 * caller's spelling would let "2026-07-01T00:00:00Z" and
 * "2026-07-01T00:00:00.000Z" mint two bills for the same month.
 */
export function hostInvoiceId(organizationId: string, canonicalPeriodStart: string): string {
  return deterministicUuidV5(
    HOST_INVOICE_NAMESPACE,
    `${organizationId.toLowerCase()}:${canonicalPeriodStart}`
  )
}

/**
 * The id of a recovery bill for fees repaired after that month's earlier bill
 * was already opened.
 *
 * A bound or paid provider invoice is immutable. Mutating its local subtotal
 * would make LogLoads disagree with Stripe, so a late fee gets a deterministic
 * supplemental bill instead. The sequence is derived from the already-committed
 * bills in the same compare-and-swap mutation, making concurrent replays converge
 * on one id rather than minting duplicates.
 */
function supplementalHostInvoiceId(
  organizationId: string,
  canonicalPeriodStart: string,
  sequence: number
): string {
  return deterministicUuidV5(
    HOST_INVOICE_NAMESPACE,
    `${organizationId.toLowerCase()}:${canonicalPeriodStart}:supplemental:${sequence}`
  )
}

// ── What may be billed ────────────────────────────────────────────────────────

/**
 * Whether an assignment in this status can carry a delivered haul.
 *
 * An exhaustive record, not an `includes` list: adding an assignment status will
 * not compile until somebody decides whether a host owes a fee for it.
 *
 * `hauled` is billable because the assignment row lags the trip. A host confirms
 * the delivered record while the trip is at the destination or unloading, and the
 * assignment only reaches `completed` when the trip does. Refusing `hauled` would
 * silently skip the fee on a haul both parties already agreed was delivered.
 */
const ASSIGNMENT_STATUS_CAN_CARRY_A_COMPLETED_HAUL: Record<AssignmentStatus, boolean> = {
  accepted: false,
  cancelled: false,
  checked_in: false,
  completed: true,
  declined: false,
  hauled: true,
  loading: false,
  offered: false,
  requested: false
}

/**
 * Which statuses a bill may be marked paid from.
 *
 * Exhaustive for the same reason: a status is a claim to the host about their
 * money, and an unmapped one would make that claim with nothing behind it.
 * `uncollectible` stays payable because a host can pay a written-off bill late.
 * `draft` cannot: nothing was ever issued, so nothing can have been paid.
 */
const INVOICE_CAN_BE_PAID_FROM: Record<HostInvoiceStatus, boolean> = {
  draft: false,
  open: true,
  paid: false,
  uncollectible: true,
  void: false
}

/**
 * Which statuses a bill may be written off from. `paid` is deliberately absent:
 * writing off a paid bill would erase a payment that actually happened.
 */
const INVOICE_CAN_BE_UNCOLLECTIBLE_FROM: Record<HostInvoiceStatus, boolean> = {
  draft: false,
  open: true,
  paid: false,
  uncollectible: false,
  void: false
}

// ── Local helpers ─────────────────────────────────────────────────────────────

/**
 * The acting member, with the right to perform a money action asserted.
 *
 * `actorUserId` and `organizationId` are REQUIRED here, unlike the operating
 * surfaces where they default to the demo actor and organization. Web boundaries
 * forward client JSON straight into these inputs, and a defaulted organization on
 * a billing call would read, void or bill the wrong host's money. Absent is
 * refused rather than substituted.
 */
function billingContext(
  state: LogLoadsDatabaseState,
  input: { actorUserId?: string; organizationId?: string },
  action: OrganizationAction
) {
  const actorUserId = input.actorUserId
  const organizationId = input.organizationId

  assertCondition(
    typeof actorUserId === "string" && actorUserId.length > 0,
    "actorUserId is required for a platform fee action"
  )
  assertCondition(
    typeof organizationId === "string" && organizationId.length > 0,
    "organizationId is required for a platform fee action"
  )

  // getActiveOrganizationContext refuses anyone who is not an ACTIVE member of
  // this organization, which is the membership half of the rule; the action
  // assertion below is the permission half.
  const context = getActiveOrganizationContext(state, actorUserId, organizationId)

  assertOrganizationAction(context, action)

  return context
}

/**
 * A local audit insert rather than the one in operating-network.ts, which is not
 * exported. Every money-affecting write in this module records who did it, to
 * what, and enough metadata to explain the amount without re-deriving it.
 */
function insertBillingAuditEvent(
  state: LogLoadsDatabaseState,
  input: {
    action: string
    actorUserId: string | null
    entityId: string
    entityType: string
    metadata: Record<string, unknown>
    at: string
  }
): void {
  state.auditEvents.push(
    auditEventSchema.parse({
      action: input.action,
      actorUserId: input.actorUserId,
      createdAt: input.at,
      entityId: input.entityId,
      entityType: input.entityType,
      id: createUuid(),
      metadata: input.metadata
    })
  )
}

/**
 * Half-open containment, compared as instants. A fee stamped exactly at the
 * boundary belongs to the month that starts there and not to the one that ends
 * there, so consecutive bills neither overlap nor leave a gap.
 */
function withinPeriod(instant: string, period: InvoicePeriod): boolean {
  const at = Date.parse(instant)

  return at >= Date.parse(period.periodStart) && at < Date.parse(period.periodEnd)
}

/**
 * The canonical UTC calendar month the caller named, or a refusal.
 *
 * Compared as instants rather than strings because the same boundary has several
 * valid ISO spellings; returned canonically because the invoice id is derived
 * from it.
 */
function canonicalPeriod(periodStart: string, periodEnd: string): InvoicePeriod {
  const period = invoicePeriodFor(periodStart)

  assertCondition(
    Date.parse(period.periodStart) === Date.parse(periodStart) &&
      Date.parse(period.periodEnd) === Date.parse(periodEnd),
    "A bill covers exactly one UTC calendar month, from its first instant to the first instant of the next"
  )

  return period
}

function feeEventsForOrganization(
  state: LogLoadsDatabaseState,
  organizationId: string
): PlatformFeeEvent[] {
  return state.platformFeeEvents.filter((event) => event.organizationId === organizationId)
}

// ── Accrual ───────────────────────────────────────────────────────────────────

export interface AccruePlatformFeeInput {
  assignmentId: string
  /**
   * ATTRIBUTION ONLY — never authorization. Accrual is not a discretionary money
   * action somebody chooses to take; it is the ledger recording a completion the
   * caller was already authorized to settle. Gating it on `manage_billing` would
   * mean a dispatcher confirming a delivery silently fails to bill for it, since
   * dispatchers deliberately hold no billing right. The actor is recorded so the
   * charge can be traced back to the person who settled the haul.
   */
  actorUserId?: string | null
  /**
   * A caller may assert the rate it expects, but never override the rate the host
   * accepted. The accepted assignment snapshot is the sole billing authority.
   */
  feeBps?: number
}

export type AccruePlatformFeeResult =
  /** A fee was written for this assignment by this call. */
  | { outcome: "accrued"; event: PlatformFeeEvent }
  /** A fee already existed. Nothing was written. THE DOUBLE-BILLING DEFENCE. */
  | { outcome: "already_accrued"; event: PlatformFeeEvent }
  /** The load states no driver pay, so there is no base to charge a percentage of. */
  | { outcome: "no_basis"; assignmentId: string; reason: string }
  /** Nobody has agreed this haul was delivered, so nothing is owed yet. */
  | { outcome: "not_completed"; assignmentId: string; reason: string }

/**
 * The delivered haul behind an assignment, as the two parties agreed it.
 *
 * Completion here means the HOST CONFIRMED the driver's delivered record.
 * Driver-payment receipt remains independent evidence and is not a fee gate.
 */
function confirmedHaulForAssignment(
  state: LogLoadsDatabaseState,
  assignment: Assignment
): TripV2 | undefined {
  return state.tripsV2.find(
    (trip) =>
      trip.assignmentId === assignment.id &&
      trip.completionStatus === "confirmed" &&
      trip.status === "completed"
  )
}

/** The percentage obligation exists only once both independent facts exist. */
function percentageFeeTriggerAt(trip: TripV2): string | null {
  if (!trip.completionConfirmedAt || !trip.completedAt) {
    return null
  }

  const confirmationTime = Date.parse(trip.completionConfirmedAt)
  const physicalCompletionTime = Date.parse(trip.completedAt)

  if (
    !Number.isFinite(confirmationTime) ||
    !Number.isFinite(physicalCompletionTime)
  ) {
    return null
  }

  return physicalCompletionTime >= confirmationTime
    ? trip.completedAt
    : trip.completionConfirmedAt
}

function frozenPlatformFeeBps(termsSnapshot: Record<string, unknown>): number | null {
  const hostFee = termsSnapshot.hostFee

  if (!hostFee || typeof hostFee !== "object" || Array.isArray(hostFee)) {
    return null
  }

  const acceptedHostFee = hostFee as Record<string, unknown>
  const rateBps = acceptedHostFee.rateBps

  // Legacy assignments explicitly said fee collection was disabled. A frozen
  // number inside disabled terms is not authority to accrue a debt.
  if (acceptedHostFee.collectionState !== "accrues_monthly_in_arrears") {
    return null
  }

  return (
    typeof rateBps === "number" &&
    Number.isSafeInteger(rateBps) &&
    rateBps >= 0 &&
    rateBps <= FEE_BPS_SCALE
  )
    ? rateBps
    : null
}

/**
 * New work is legacy only when acceptance froze that explicit model. The
 * snapshot fallback preserves pre-cutover assignments which carried active
 * percentage terms before `billingModel` existed; it must never classify a new,
 * unenrolled assignment as legacy.
 */
export function assignmentUsesLegacyPercentageBilling(assignment: Assignment): boolean {
  if (assignment.billingModel === "legacy_percentage") {
    return true
  }

  if (assignment.billingModel !== null) {
    return false
  }

  return frozenPlatformFeeBps(assignment.termsSnapshot) !== null
}

/** Current percentage_v1 plus frozen historical percentage obligations. */
export function assignmentUsesPercentageBilling(assignment: Assignment): boolean {
  return assignment.billingModel === "percentage_v1" ||
    assignmentUsesLegacyPercentageBilling(assignment)
}

/**
 * Records the fee for one completed load. AT MOST ONE PER ASSIGNMENT, EVER.
 *
 * Idempotent by design rather than by luck: completion confirmation can be
 * retried by a client that lost the response, and a compare-and-swap conflict
 * replays this whole function against a fresh draft. Both paths land on the same
 * deterministic id, find the existing fee, write nothing, and return it.
 *
 * The at-most-one check matches on the deterministic id OR on the assignment. The
 * id alone would miss a fee that reached the ledger under some other id — a hand
 * repair, an import, a future code path — and would then raise a second charge
 * for a load that was already billed.
 *
 * `driverPayCents` and `feeBps` are FROZEN onto the event. The charge must stay
 * explainable after the posting is edited, cancelled or archived, and a later rate
 * change must re-rate nothing.
 */
export function accruePlatformFee(
  state: LogLoadsDatabaseState,
  input: AccruePlatformFeeInput,
  at = nowIso()
): AccruePlatformFeeResult {
  const assignmentId = input.assignmentId

  assertCondition(
    typeof assignmentId === "string" && assignmentId.length > 0,
    "assignmentId is required to accrue a platform fee"
  )

  // A missing assignment or a missing posting is a broken caller, not a state a
  // host can reach, so it throws rather than returning a refusal somebody might
  // log and move past.
  const assignment = assertFound(
    state.assignments.find((candidate) => candidate.id === assignmentId),
    `Assignment ${assignmentId} was not found`
  )
  const load: LoadPosting = assertFound(
    state.loadPostings.find((candidate) => candidate.id === assignment.loadPostingId),
    `Load posting ${assignment.loadPostingId} was not found`
  )

  const movementId = assignment.loadMovementId ?? assignment.id
  const eventId = assignment.billingModel === "percentage_v1"
    ? percentageFeeEventId(movementId)
    : platformFeeEventId(assignment.id)
  const movementAssignmentIds = new Set(
    state.assignments
      .filter((candidate) => (candidate.loadMovementId ?? candidate.id) === movementId)
      .map((candidate) => candidate.id)
  )
  const existing = state.platformFeeEvents.find(
    (candidate) =>
      candidate.id === eventId ||
      candidate.loadMovementId === movementId ||
      movementAssignmentIds.has(candidate.assignmentId)
  )

  // Deliberately BEFORE the completion and basis checks. A fee that was legitimately
  // raised must survive a later edit that would no longer qualify the load — and
  // re-checking first would let a retry after such an edit fall through to a refusal
  // that reads like "nothing was ever charged".
  if (existing) {
    const expectedBillingModel = assignment.billingModel === "percentage_v1"
      ? "percentage_v1"
      : "legacy_percentage"
    assertCondition(
      existing.organizationId === load.companyId &&
        existing.loadPostingId === load.id &&
        existing.loadMovementId === movementId &&
        movementAssignmentIds.has(existing.assignmentId) &&
        existing.billingModel === expectedBillingModel,
      `Platform fee ${existing.id} is cross-wired to another host, load, movement, or billing model`
    )
    return { event: existing, outcome: "already_accrued" }
  }

  if (!assignmentUsesPercentageBilling(assignment)) {
    return {
      assignmentId: assignment.id,
      outcome: "no_basis",
      reason:
        "This assignment is not frozen to percentage billing; subscription usage cannot enter the percentage-fee ledger"
    }
  }

  const subscriptionUsage = state.networkUsageEvents.find(
    (usage) =>
      usage.status !== "reversed" &&
      (
        usage.loadMovementId === movementId ||
        movementAssignmentIds.has(usage.assignmentId)
      )
  )

  if (subscriptionUsage) {
    return {
      assignmentId: assignment.id,
      outcome: "no_basis",
      reason: `Physical movement ${movementId} already has Network usage ${subscriptionUsage.id}`
    }
  }

  if (!ASSIGNMENT_STATUS_CAN_CARRY_A_COMPLETED_HAUL[assignment.status]) {
    return {
      assignmentId: assignment.id,
      outcome: "not_completed",
      reason: `This haul is ${assignment.status.replaceAll("_", " ")}; a fee is charged on completed loads only`
    }
  }

  const trip = confirmedHaulForAssignment(state, assignment)

  if (!trip) {
    return {
      assignmentId: assignment.id,
      outcome: "not_completed",
      reason: "Nobody has confirmed what this haul delivered, so there is nothing to charge for yet"
    }
  }

  if (!haulHasBillableDelivery(trip)) {
    return {
      assignmentId: assignment.id,
      outcome: "not_completed",
      reason:
        "The confirmed completion records no physical delivery, so no platform fee is owed"
    }
  }

  const percentageV1 = assignment.billingModel === "percentage_v1"
  if (!percentageV1 && !assignment.driverPaymentReceivedAt) {
    return {
      assignmentId: assignment.id,
      outcome: "not_completed",
      reason:
        "This legacy agreement earns its fee only after the assigned driver confirms receipt of the stated pay"
    }
  }

  if (
    !percentageV1 &&
    (
      assignment.driverPaymentReceivedAmountCents === null ||
      !assignment.driverPaymentReceivedCurrency
    )
  ) {
    return {
      assignmentId: assignment.id,
      outcome: "no_basis",
      reason:
        "This legacy receipt does not record the amount and currency the driver actually received"
    }
  }

  if (
    !trip.completionConfirmedAt ||
    !Number.isFinite(Date.parse(trip.completionConfirmedAt))
  ) {
    return {
      assignmentId: assignment.id,
      outcome: "no_basis",
      reason:
        "The confirmed haul has no trustworthy completion timestamp; review it before billing"
    }
  }

  const percentageTriggerAt = percentageV1
    ? percentageFeeTriggerAt(trip)
    : null

  if (percentageV1 && !percentageTriggerAt) {
    return {
      assignmentId: assignment.id,
      outcome: "no_basis",
      reason:
        "The confirmed haul has no trustworthy physical-completion and host-confirmation timestamps; review it before billing"
    }
  }

  const frozenDriverPay = readFrozenDriverPay(assignment.termsSnapshot)

  if (!frozenDriverPay) {
    // Accruing zero here would put a real fee row on a load with no stated pay, and
    // a percentage of nothing presented as a charge is a fabricated one. The refusal
    // carries no event, so a caller cannot mistake it for a charge.
    return {
      assignmentId: assignment.id,
      outcome: "no_basis",
      reason:
        "This assignment has no frozen driver pay and currency, so a fee cannot be derived honestly"
    }
  }

  if (
    frozenDriverPay.currency !==
    LEGACY_PERCENTAGE_ELIGIBLE_CURRENCY
  ) {
    return {
      assignmentId: assignment.id,
      outcome: "no_basis",
      reason:
        `Percentage fees can accrue only for ${LEGACY_PERCENTAGE_ELIGIBLE_CURRENCY} work; this assignment remains unbilled`
    }
  }

  const driverPayCents = frozenDriverPay.amountCents
  const feeBps = frozenPlatformFeeBps(assignment.termsSnapshot)

  if (feeBps === null) {
    return {
      assignmentId: assignment.id,
      outcome: "no_basis",
      reason:
        "This assignment has no active authoritative platform-fee terms frozen at host acceptance"
    }
  }

  assertCondition(
    input.feeBps === undefined || input.feeBps === feeBps,
    `The requested fee rate ${String(input.feeBps)} bps does not match the accepted ${feeBps} bps`
  )
  const actorUserId = input.actorUserId ?? null
  // Percentage-v1 earns only when physical completion and host confirmation are
  // both true, so the later timestamp is authoritative regardless of event order.
  // Historical legacy agreements retain their accepted receipt trigger exactly;
  // deploying the new model must never create debts for earlier unpaid movements.
  const occurredAt = percentageV1
    ? percentageTriggerAt as string
    : assignment.driverPaymentReceivedAt as string

  const event = platformFeeEventSchema.parse({
    assignmentId: assignment.id,
    billingModel:
      assignment.billingModel === "percentage_v1"
        ? "percentage_v1"
        : "legacy_percentage",
    createdAt: at,
    driverPayCents,
    feeBps,
    feeCents: computePlatformFeeCents(driverPayCents, feeBps),
    id: eventId,
    invoiceId: null,
    loadPostingId: load.id,
    loadMovementId: movementId,
    occurredAt,
    // The HOST organization that posted the work. Derived from the posting, never
    // taken from the caller: whoever asks for the accrual does not get to name who
    // is charged, and it can never be the hauling side.
    organizationId: load.companyId,
    status: "accrued",
    truckSlotId: assignment.truckSlotId,
    updatedAt: at,
    voidReason: null
  })

  state.platformFeeEvents.push(event)
  insertBillingAuditEvent(state, {
    action: "platform_fee_accrued",
    actorUserId,
    at,
    entityId: event.id,
    entityType: "platform_fee_event",
    metadata: {
      assignmentId: assignment.id,
      driverPayCents: event.driverPayCents,
      feeBps: event.feeBps,
      feeCents: event.feeCents,
      loadPostingId: load.id,
      organizationId: event.organizationId,
      loadMovementId: movementId,
      billingTrigger: percentageV1
        ? "host_completion"
        : "driver_payment_receipt",
      receivedAmountCents: percentageV1
        ? null
        : assignment.driverPaymentReceivedAmountCents,
      receivedCurrency: percentageV1
        ? null
        : assignment.driverPaymentReceivedCurrency,
      tripId: trip.id
    }
  })

  return { event, outcome: "accrued" }
}

export interface PlatformFeeReconciliationResult {
  assignmentId: string
  eventId: string | null
  outcome: AccruePlatformFeeResult["outcome"] | "error"
  reason: string | null
}

/**
 * Repairs movements that are missing their deterministic fee. Percentage-v1
 * revisits host-confirmed physical deliveries; legacy revisits only movements
 * whose driver confirmed receipt under the historical agreement. Movement
 * identity makes the scan replay-safe, and one malformed row cannot block the
 * rest.
 */
export function reconcileMissingPlatformFees(
  state: LogLoadsDatabaseState,
  at = nowIso()
): PlatformFeeReconciliationResult[] {
  const movementsWithFees = new Set(
    state.platformFeeEvents.map((event) => event.loadMovementId)
  )
  const missing = state.assignments
    .filter(
      (assignment) => {
        const movementId = assignment.loadMovementId ?? assignment.id
        const confirmedTrip = confirmedHaulForAssignment(state, assignment)
        const triggerSatisfied = assignment.billingModel === "percentage_v1"
          ? Boolean(confirmedTrip && haulHasBillableDelivery(confirmedTrip))
          : Boolean(
              assignment.driverPaymentReceivedAt &&
              confirmedTrip &&
              haulHasBillableDelivery(confirmedTrip)
            )
        return assignmentUsesPercentageBilling(assignment) &&
          triggerSatisfied &&
          !movementsWithFees.has(movementId)
      }
    )
    .sort(
      (left, right) =>
        (confirmedHaulForAssignment(state, left)?.completionConfirmedAt ?? "")
          .localeCompare(
            confirmedHaulForAssignment(state, right)?.completionConfirmedAt ?? ""
          ) || left.id.localeCompare(right.id)
    )

  return missing.map((assignment) => {
    try {
      const result = accruePlatformFee(
        state,
        {
          actorUserId: assignment.billingModel === "percentage_v1"
            ? null
            : assignment.driverPaymentReceivedByUserId,
          assignmentId: assignment.id
        },
        at
      )

      if (result.outcome === "accrued" || result.outcome === "already_accrued") {
        return {
          assignmentId: assignment.id,
          eventId: result.event.id,
          outcome: result.outcome,
          reason: null
        }
      }

      return {
        assignmentId: assignment.id,
        eventId: null,
        outcome: result.outcome,
        reason: result.reason
      }
    } catch (error) {
      const reason = (
        error instanceof Error ? error.message : "Unknown platform-fee reconciliation failure"
      ).slice(0, 300)

      insertBillingAuditEvent(state, {
        action: "platform_fee_reconciliation_failed",
        actorUserId: null,
        at,
        entityId: assignment.id,
        entityType: "assignment",
        metadata: {
          completionConfirmedAt:
            confirmedHaulForAssignment(state, assignment)?.completionConfirmedAt ?? null,
          reason
        }
      })

      return {
        assignmentId: assignment.id,
        eventId: null,
        outcome: "error",
        reason
      }
    }
  })
}

// ── Void ──────────────────────────────────────────────────────────────────────

export interface VoidPlatformFeeInput {
  actorUserId?: string
  organizationId?: string
  assignmentId: string
  reason: string
}

export type VoidPlatformFeeResult =
  | { outcome: "voided"; event: PlatformFeeEvent }
  | { outcome: "already_voided"; event: PlatformFeeEvent }
  /** Nothing was ever accrued for this assignment — a reversal has nothing to undo. */
  | { outcome: "no_fee"; assignmentId: string; reason: string }

/**
 * Withdraws a fee whose completion was reversed or disputed.
 *
 * A void, not a delete. The row stays as the evidence that a charge was raised and
 * withdrawn, and `invoiceSubtotalCents` counts a voided fee as zero, so it can
 * never reach a bill.
 *
 * An INVOICED fee is refused. The host has already been told they owe that amount;
 * removing it from a bill that was issued would restate a bill after the fact.
 * Reversing an issued charge is a credit note, which is a different record and a
 * different Stripe object.
 */
export function voidPlatformFee(
  state: LogLoadsDatabaseState,
  input: VoidPlatformFeeInput,
  at = nowIso()
): VoidPlatformFeeResult {
  const context = billingContext(state, input, "manage_billing")
  const assignmentId = input.assignmentId
  const reason = typeof input.reason === "string" ? input.reason.trim() : ""

  assertCondition(
    typeof assignmentId === "string" && assignmentId.length > 0,
    "assignmentId is required to void a platform fee"
  )
  assertCondition(reason.length > 0, "Say why this fee is being withdrawn")
  assertCondition(reason.length <= 300, "Keep the void reason under 300 characters")

  const eventId = platformFeeEventId(assignmentId)
  const event = state.platformFeeEvents.find(
    (candidate) => candidate.id === eventId || candidate.assignmentId === assignmentId
  )

  if (!event) {
    return {
      assignmentId,
      outcome: "no_fee",
      reason: "No platform fee was ever accrued for this haul, so there is nothing to withdraw"
    }
  }

  // Checked even though the fee was found by assignment: one host must never be
  // able to withdraw another host's charge. An authorization failure, so it throws.
  assertCondition(
    event.organizationId === context.organizationId,
    "This platform fee belongs to another organization"
  )

  if (event.status === "voided") {
    // A reversal confirmation can be retried, and a compare-and-swap conflict
    // replays this function. Neither may write a second audit event claiming the
    // fee was withdrawn twice.
    return { event, outcome: "already_voided" }
  }

  assertCondition(
    event.status !== "invoiced",
    `This fee is already on invoice ${event.invoiceId ?? "(unknown)"}; reverse it with a credit note, not a void`
  )

  // Re-parsed through the row contract so the storage invariants (a voided fee must
  // say why) are enforced at write time and not only on the next read.
  const voided = platformFeeEventSchema.parse({
    ...event,
    status: "voided",
    updatedAt: at,
    voidReason: reason
  })

  state.platformFeeEvents = state.platformFeeEvents.map((candidate) =>
    candidate.id === event.id ? voided : candidate
  )
  insertBillingAuditEvent(state, {
    action: "platform_fee_voided",
    actorUserId: context.actorUserId,
    at,
    entityId: voided.id,
    entityType: "platform_fee_event",
    metadata: {
      assignmentId: voided.assignmentId,
      feeCents: voided.feeCents,
      organizationId: voided.organizationId,
      reason,
      // What the fee was before it was withdrawn, so the withdrawal is explainable
      // without reconstructing the row's history.
      previousStatus: event.status
    }
  })

  return { event: voided, outcome: "voided" }
}

// ── The monthly bill ──────────────────────────────────────────────────────────

export interface OpenInvoiceForPeriodInput {
  actorUserId?: string
  organizationId?: string
  periodStart: string
  periodEnd: string
}

export type OpenInvoiceForPeriodResult =
  | { outcome: "opened"; invoice: HostInvoice }
  /** Every currently accrued fee for this month was already billed. */
  | { outcome: "already_open"; invoice: HostInvoice }
  /** No fee accrued in the month, so no bill exists to send. */
  | { outcome: "nothing_to_bill"; periodStart: string; periodEnd: string; reason: string }

/**
 * Refuse to materialize money from a ledger whose movement identity is
 * ambiguous. Snapshot audit keeps conflicting rows visible for repair, so the
 * billing boundary itself must fail closed before any subtotal reaches Stripe.
 */
export function assertPlatformFeeLedgerCanInvoice(
  state: LogLoadsDatabaseState,
  organizationId: string
): void {
  const activeFees = state.platformFeeEvents.filter(
    (event) => event.status !== "voided"
  )
  const organizationFees = activeFees.filter(
    (event) => event.organizationId === organizationId
  )

  for (const fee of organizationFees) {
    const feeClaims = activeFees.filter(
      (candidate) => candidate.loadMovementId === fee.loadMovementId
    )
    assertCondition(
      feeClaims.length === 1,
      `Physical movement ${fee.loadMovementId} has ${feeClaims.length} active platform-fee claims; invoice opening is blocked for review`
    )

    const usageClaims = state.networkUsageEvents.filter(
      (usage) =>
        usage.status !== "reversed" &&
        usage.loadMovementId === fee.loadMovementId
    )
    assertCondition(
      usageClaims.length === 0,
      `Physical movement ${fee.loadMovementId} has both a platform fee and Network usage; invoice opening is blocked for review`
    )

    const assignments = state.assignments.filter(
      (assignment) => assignment.id === fee.assignmentId
    )
    const loads = state.loadPostings.filter(
      (load) => load.id === fee.loadPostingId
    )
    assertCondition(
      assignments.length === 1 && loads.length === 1,
      `Platform fee ${fee.id} does not resolve to exactly one assignment and load; invoice opening is blocked for review`
    )
    const assignment = assignments[0]!
    const load = loads[0]!
    const billingModelMatches =
      assignment.billingModel === fee.billingModel ||
      (fee.billingModel === "legacy_percentage" && assignment.billingModel === null)
    const frozenPay = readFrozenDriverPay(assignment.termsSnapshot)
    const frozenFeeBps = frozenPlatformFeeBps(assignment.termsSnapshot)
    assertCondition(
      assignment.loadPostingId === load.id &&
        load.companyId === fee.organizationId &&
        (assignment.loadMovementId ?? assignment.id) === fee.loadMovementId &&
        assignment.truckSlotId === fee.truckSlotId &&
        billingModelMatches &&
        frozenPay?.currency === LEGACY_PERCENTAGE_ELIGIBLE_CURRENCY &&
        frozenPay.amountCents === fee.driverPayCents &&
        frozenFeeBps === fee.feeBps,
      `Platform fee ${fee.id} is cross-wired to its host, load, movement, slot, billing model, or frozen terms; invoice opening is blocked for review`
    )
  }
}

function openInvoiceForOrganizationPeriod(
  state: LogLoadsDatabaseState,
  input: {
    actorUserId: string | null
    organizationId: string
    periodStart: string
    periodEnd: string
  },
  at: string
): OpenInvoiceForPeriodResult {
  const period = canonicalPeriod(input.periodStart, input.periodEnd)

  assertCondition(
    Date.parse(period.periodEnd) <= Date.parse(at),
    "This period is still accruing; the platform fee is billed monthly in arrears"
  )

  assertPlatformFeeLedgerCanInvoice(state, input.organizationId)

  const billable = feeEventsForOrganization(state, input.organizationId)
    .filter((event) => event.status === "accrued" && withinPeriod(event.occurredAt, period))
    .sort(
      (left, right) =>
        Date.parse(left.occurredAt) - Date.parse(right.occurredAt) || left.id.localeCompare(right.id)
    )
  const primaryInvoiceId = hostInvoiceId(input.organizationId, period.periodStart)
  const primaryIdMatch = state.hostInvoices.find(
    (candidate) => candidate.id === primaryInvoiceId
  )
  const existing = state.hostInvoices
    .filter(
      (candidate) =>
        candidate.organizationId === input.organizationId &&
        Date.parse(candidate.periodStart) === Date.parse(period.periodStart)
    )
    .sort(
      (left, right) =>
        Date.parse(left.createdAt) - Date.parse(right.createdAt) || left.id.localeCompare(right.id)
    )

  assertCondition(
    !primaryIdMatch || existing.some((candidate) => candidate.id === primaryInvoiceId),
    `Primary host invoice ${primaryInvoiceId} is already attached to another organization or period`
  )

  if (billable.length === 0) {
    if (existing[0]) {
      return { invoice: existing[0], outcome: "already_open" }
    }

    return {
      outcome: "nothing_to_bill",
      periodEnd: period.periodEnd,
      periodStart: period.periodStart,
      reason: "No platform fee accrued in this period, and there is no monthly fee or minimum"
    }
  }

  // Never mutate a previously opened bill. Collection reads an invoice, performs
  // provider I/O, then binds the Stripe id; changing its amount during that gap
  // could charge the old subtotal while storing the new one. A supplemental bill
  // keeps both provider amounts immutable and independently reconcilable.
  let invoiceId = primaryInvoiceId

  if (existing.length > 0) {
    let sequence = 2

    invoiceId = supplementalHostInvoiceId(
      input.organizationId,
      period.periodStart,
      sequence
    )

    while (state.hostInvoices.some((candidate) => candidate.id === invoiceId)) {
      sequence += 1
      invoiceId = supplementalHostInvoiceId(
        input.organizationId,
        period.periodStart,
        sequence
      )
    }
  }
  const invoice = hostInvoiceSchema.parse({
    createdAt: at,
    feeEventIds: billable.map((event) => event.id),
    id: invoiceId,
    issuedAt: at,
    organizationId: input.organizationId,
    paidAt: null,
    periodEnd: period.periodEnd,
    periodStart: period.periodStart,
    status: "open",
    stripeInvoiceId: null,
    subtotalCents: invoiceSubtotalCents(billable),
    updatedAt: at,
    voidedAt: null
  })
  const billedIds = new Set(billable.map((event) => event.id))

  state.hostInvoices.push(invoice)
  state.platformFeeEvents = state.platformFeeEvents.map((event) =>
    billedIds.has(event.id)
      ? platformFeeEventSchema.parse({
          ...event,
          invoiceId: invoice.id,
          status: "invoiced",
          updatedAt: at
        })
      : event
  )
  insertBillingAuditEvent(state, {
    action: "host_invoice_opened",
    actorUserId: input.actorUserId,
    at,
    entityId: invoice.id,
    entityType: "host_invoice",
    metadata: {
      feeEventCount: billable.length,
      organizationId: invoice.organizationId,
      periodEnd: invoice.periodEnd,
      periodStart: invoice.periodStart,
      supplemental: existing.length > 0,
      subtotalCents: invoice.subtotalCents
    }
  })

  return { invoice, outcome: "opened" }
}

/**
 * Closes one UTC calendar month for one host: collects every fee still `accrued`
 * in the period, opens a bill for them, and flips them to `invoiced`.
 *
 * IDEMPOTENT PER FEE. The primary id is derived from the host and canonical month
 * start. A normal repeated run finds no accrued fees and returns that existing
 * bill untouched. If recovery adds a fee after an earlier bill opened, the fee
 * moves to a deterministic supplemental bill rather than mutating a provider
 * amount that may already be finalized. A compare-and-swap replay sees the fee as
 * `invoiced` and therefore cannot bill it twice.
 *
 * IN ARREARS. A period that has not ended yet is refused: it can still accrue, so
 * billing it would charge a host for a month that is not finished.
 *
 * NO BILL WHEN NOTHING ACCRUED. There is no monthly host fee and no minimum, so a
 * host who completed no loads must receive nothing at all — not a bill for zero.
 *
 * `status` is `open` with `issuedAt` set because the amount is fixed and owed the
 * moment the month closes. `issuedAt` is when LogLoads closed the period, which is
 * deliberately not a claim that Stripe has delivered anything; `stripeInvoiceId`
 * stays null until the collection step records the object it created. Opening the
 * LogLoads row first is what makes the amount auditable before any external call.
 */
export function openInvoiceForPeriod(
  state: LogLoadsDatabaseState,
  input: OpenInvoiceForPeriodInput,
  at = nowIso()
): OpenInvoiceForPeriodResult {
  const context = billingContext(state, input, "manage_billing")

  return openInvoiceForOrganizationPeriod(
    state,
    {
      actorUserId: context.actorUserId,
      organizationId: context.organizationId,
      periodEnd: input.periodEnd,
      periodStart: input.periodStart
    },
    at
  )
}

export function openClosedPeriodInvoices(
  state: LogLoadsDatabaseState,
  input: { periodEnd: string; periodStart: string },
  at = nowIso()
): OpenInvoiceForPeriodResult[] {
  const period = canonicalPeriod(input.periodStart, input.periodEnd)

  assertCondition(
    Date.parse(period.periodEnd) <= Date.parse(at),
    "This period is still accruing; the platform fee is billed monthly in arrears"
  )

  const organizationIds = Array.from(
    new Set(
      state.platformFeeEvents
        .filter(
          (event) =>
            event.status === "accrued" &&
            withinPeriod(event.occurredAt, period)
        )
        .map((event) => event.organizationId)
    )
  ).sort()

  return organizationIds.map((organizationId) =>
    openInvoiceForOrganizationPeriod(
      state,
      {
        actorUserId: null,
        organizationId,
        periodEnd: period.periodEnd,
        periodStart: period.periodStart
      },
      at
    )
  )
}

/**
 * Materializes every closed UTC month that still contains accrued fees.
 *
 * A scheduler outage can cross several month boundaries. Closing only the month
 * immediately before the current run strands older accrued rows forever because
 * the collection pass can discover invoices, not raw fee events. Deriving the
 * distinct periods from those rows makes catch-up bounded by real work, oldest
 * first, and reuses the deterministic monthly opener for idempotency.
 */
export function openAllClosedPeriodInvoices(
  state: LogLoadsDatabaseState,
  at = nowIso()
): OpenInvoiceForPeriodResult[] {
  const cutoff = Date.parse(at)

  assertCondition(Number.isFinite(cutoff), "The billing run time must be a parsable instant")

  const periods = new Map<string, InvoicePeriod>()

  for (const event of state.platformFeeEvents) {
    if (event.status !== "accrued") {
      continue
    }

    const period = invoicePeriodFor(event.occurredAt)

    if (Date.parse(period.periodEnd) <= cutoff) {
      periods.set(period.periodStart, period)
    }
  }

  return Array.from(periods.values())
    .sort((left, right) => left.periodStart.localeCompare(right.periodStart))
    .flatMap((period) => openClosedPeriodInvoices(state, period, at))
}

export interface InvoiceSettlementInput {
  actorUserId?: string
  organizationId?: string
  invoiceId: string
  /** What Stripe collected it as, for reconciliation. LogLoads holds no funds. */
  stripeInvoiceId?: string | null
  /** Why it was written off. Recorded on the audit event, which is where it belongs. */
  reason?: string | null
}

export interface InvoiceSettlementResult {
  changed: boolean
  invoice: HostInvoice
}

function settleInvoice(
  state: LogLoadsDatabaseState,
  input: InvoiceSettlementInput,
  at: string,
  settlement: {
    action: string
    allowedFrom: Record<HostInvoiceStatus, boolean>
    refusal: string
    status: Extract<HostInvoiceStatus, "paid" | "uncollectible">
  }
): InvoiceSettlementResult {
  const context = billingContext(state, input, "manage_billing")
  const invoiceId = input.invoiceId

  assertCondition(
    typeof invoiceId === "string" && invoiceId.length > 0,
    "invoiceId is required to settle a bill"
  )

  const invoice = assertFound(
    state.hostInvoices.find((candidate) => candidate.id === invoiceId),
    `Host invoice ${invoiceId} was not found`
  )

  assertCondition(
    invoice.organizationId === context.organizationId,
    "This bill belongs to another organization"
  )

  if (invoice.status === settlement.status) {
    // Payment providers retry their notifications, and a compare-and-swap conflict
    // replays this function. Neither may record a second settlement.
    return { changed: false, invoice }
  }

  assertCondition(
    settlement.allowedFrom[invoice.status],
    `${settlement.refusal} (this bill is ${invoice.status})`
  )

  const settled = hostInvoiceSchema.parse({
    ...invoice,
    paidAt: settlement.status === "paid" ? at : invoice.paidAt,
    status: settlement.status,
    stripeInvoiceId: input.stripeInvoiceId ?? invoice.stripeInvoiceId ?? null,
    updatedAt: at
  })

  state.hostInvoices = state.hostInvoices.map((candidate) =>
    candidate.id === invoice.id ? settled : candidate
  )
  insertBillingAuditEvent(state, {
    action: settlement.action,
    actorUserId: context.actorUserId,
    at,
    entityId: settled.id,
    entityType: "host_invoice",
    metadata: {
      organizationId: settled.organizationId,
      periodStart: settled.periodStart,
      previousStatus: invoice.status,
      reason: input.reason ?? null,
      stripeInvoiceId: settled.stripeInvoiceId ?? null,
      subtotalCents: settled.subtotalCents
    }
  })

  return { changed: true, invoice: settled }
}

/** The host's card was charged for this month's fees. Records only; moves nothing. */
export function markInvoicePaid(
  state: LogLoadsDatabaseState,
  input: InvoiceSettlementInput,
  at = nowIso()
): InvoiceSettlementResult {
  return settleInvoice(state, input, at, {
    action: "host_invoice_paid",
    allowedFrom: INVOICE_CAN_BE_PAID_FROM,
    refusal: "Only an issued bill can be marked paid",
    status: "paid"
  })
}

/** The fees for this month could not be collected. The amount stays on the record. */
export function markInvoiceUncollectible(
  state: LogLoadsDatabaseState,
  input: InvoiceSettlementInput,
  at = nowIso()
): InvoiceSettlementResult {
  return settleInvoice(state, input, at, {
    action: "host_invoice_uncollectible",
    allowedFrom: INVOICE_CAN_BE_UNCOLLECTIBLE_FROM,
    refusal: "Only an issued, unpaid bill can be written off",
    status: "uncollectible"
  })
}

// ── What the host reads ───────────────────────────────────────────────────────

export interface HostFeeSummaryInput {
  actorUserId?: string
  organizationId?: string
}

export interface HostFeeSummary {
  organizationId: string
  /**
   * The CURRENT rate, for quoting work that has not happened yet. It is not the
   * rate of any fee below — each of those carries its own frozen rate — and it is
   * named `current` so no surface can present it as one.
   */
  currentFeeBps: number
  /** The month now accruing. */
  currentPeriod: InvoicePeriod
  /**
   * Everything accrued and not yet on a bill, whatever month it happened in. A fee
   * from a month that was never closed is still owed, so scoping this to the
   * current period would under-report what the host owes.
   */
  accruedCents: number
  accruedEventCount: number
  /** The slice of `accruedCents` that occurred inside the current period. */
  currentPeriodAccruedCents: number
  currentPeriodEventCount: number
  /** The most recent bill by period, or null if this host has never been billed. */
  lastInvoice: HostInvoice | null
}

/**
 * What a host owes and what they were last billed.
 *
 * Reading a host's own money requires ACTIVE MEMBERSHIP of that host, which is why
 * this takes an actor rather than a bare organization id like the operating reads
 * do: an organization id alone in a client-forwarded call is a way to read any
 * host's revenue. `view_network` is the action every member role holds, so it is
 * how "a member, any member" is expressed against the role matrix.
 *
 * Totals come from `invoiceSubtotalCents`, the same function that produces the
 * bill. A summary that added the fees up its own way is a number that can disagree
 * with the invoice the host receives.
 */
export function hostFeeSummary(
  state: LogLoadsDatabaseState,
  input: HostFeeSummaryInput,
  at = nowIso()
): HostFeeSummary {
  const context = billingContext(state, input, "view_network")
  const currentPeriod = invoicePeriodFor(at)
  const accrued = feeEventsForOrganization(state, context.organizationId).filter(
    (event) => event.status === "accrued"
  )
  const currentPeriodAccrued = accrued.filter((event) => withinPeriod(event.occurredAt, currentPeriod))
  const lastInvoice =
    state.hostInvoices
      .filter((invoice) => invoice.organizationId === context.organizationId)
      .sort((left, right) => Date.parse(right.periodStart) - Date.parse(left.periodStart))[0] ?? null

  return {
    accruedCents: invoiceSubtotalCents(accrued),
    accruedEventCount: accrued.length,
    currentFeeBps: PLATFORM_FEE_BPS,
    currentPeriod,
    currentPeriodAccruedCents: invoiceSubtotalCents(currentPeriodAccrued),
    currentPeriodEventCount: currentPeriodAccrued.length,
    lastInvoice,
    organizationId: context.organizationId
  }
}
