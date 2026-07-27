import { randomUUID } from "node:crypto"

import {
  assignmentSchema,
  computePlatformFeeCents,
  invoiceSubtotalCents,
  organizationMembershipSchema,
  organizationRoleCan,
  platformFeeEventId,
  tripSchemaV2,
  ORGANIZATION_ROLES,
  PLATFORM_FEE_BPS,
  type Assignment,
  type OrganizationRole
} from "@logloads/contracts"
import { seedDatabaseState } from "@logloads/db"
import { describe, expect, it } from "vitest"

import {
  accruePlatformFee,
  hostFeeSummary,
  hostInvoiceId,
  markInvoicePaid,
  markInvoiceUncollectible,
  openAllClosedPeriodInvoices,
  openClosedPeriodInvoices,
  openInvoiceForPeriod,
  voidPlatformFee
} from "./platform-fees"

/**
 * The host whose postings the seed already carries. Every fee in this file is
 * charged to this organization, and never to a hauling one.
 */
const HOST_ORG = "33333333-3333-4333-8333-333333333331"
const OTHER_HOST_ORG = "33333333-3333-4333-8333-333333333332"
const DRIVER_USER = "22222222-2222-4222-8222-222222222222"
const HOST_STAFF_USER = "22222222-2222-4222-8222-222222222224"

const MAY_CONFIRMED = "2026-05-28T12:00:00.000Z"
const JUNE_CONFIRMED = "2026-06-20T15:00:00.000Z"
const JULY_CONFIRMED = "2026-07-10T12:00:00.000Z"
const JUNE_PERIOD_START = "2026-06-01T00:00:00.000Z"
const JUNE_PERIOD_END = "2026-07-01T00:00:00.000Z"
/** After June closed, because the fee is billed monthly in arrears. */
const BILLING_RUN = "2026-07-01T06:00:00.000Z"
const MID_JULY = "2026-07-15T09:00:00.000Z"

/**
 * The roles that do and do not hold the right to change money, DERIVED from the
 * role matrix rather than named. Hard-coding "owner" and "dispatcher" would leave
 * these tests passing against a matrix that no longer grants what they assume.
 */
const ROLE_WITH_BILLING: OrganizationRole | undefined = ORGANIZATION_ROLES.find((role) =>
  organizationRoleCan(role, "manage_billing")
)
const ROLE_WITHOUT_BILLING: OrganizationRole | undefined = ORGANIZATION_ROLES.find(
  (role) => !organizationRoleCan(role, "manage_billing") && organizationRoleCan(role, "view_network")
)

if (!ROLE_WITH_BILLING || !ROLE_WITHOUT_BILLING) {
  throw new Error("The role matrix no longer distinguishes who may change a host's money")
}

function freshState() {
  return structuredClone(seedDatabaseState)
}

type State = ReturnType<typeof freshState>

/** A member of an organization in a given role. Returns the acting user id. */
function addMember(state: State, organizationId: string, role: OrganizationRole): string {
  const userId = randomUUID()

  state.organizationMemberships.push(
    organizationMembershipSchema.parse({
      createdAt: "2026-06-01T00:00:00.000Z",
      id: randomUUID(),
      organizationId,
      role,
      status: "active",
      updatedAt: "2026-06-01T00:00:00.000Z",
      userId
    })
  )

  return userId
}

function billingMember(state: State, organizationId = HOST_ORG): string {
  return addMember(state, organizationId, ROLE_WITH_BILLING as OrganizationRole)
}

/**
 * The seeded assignments on a host's own postings, excluding cancelled work.
 * Derived from the postings so a seed change cannot leave a test billing a haul
 * that belongs to somebody else.
 */
function hostAssignments(state: State, organizationId = HOST_ORG): Assignment[] {
  const loadIds = new Set(
    state.loadPostings.filter((load) => load.companyId === organizationId).map((load) => load.id)
  )

  return state.assignments.filter(
    (assignment) =>
      loadIds.has(assignment.loadPostingId) &&
      assignment.status !== "cancelled" &&
      assignment.status !== "declined"
  )
}

/**
 * A haul that genuinely completed: the host stated what it pays the driver, the
 * driver recorded the delivery, and the host CONFIRMED it. Everything a fee needs
 * a basis for, and nothing more.
 *
 * The trip is created when the seed has none for the assignment, so the fixture
 * does not depend on which seeded assignments happen to carry a trip row.
 */
function billableHaul(
  state: State,
  options: { assignment: Assignment; driverPayCents: number | null; confirmedAt: string }
): { assignmentId: string; loadPostingId: string; tripId: string } {
  const { assignment, confirmedAt, driverPayCents } = options
  const load = state.loadPostings.find((candidate) => candidate.id === assignment.loadPostingId)

  if (!load) {
    throw new Error(`seed assignment ${assignment.id} names a posting that does not exist`)
  }

  load.driverPayCents = driverPayCents
  assignment.status = "completed"
  assignment.completedAt = confirmedAt
  assignment.driverPaymentSentAt = confirmedAt
  assignment.driverPaymentSentByUserId = HOST_STAFF_USER
  assignment.driverPaymentReceivedAt = confirmedAt
  assignment.driverPaymentReceivedByUserId = DRIVER_USER
  assignment.termsSnapshot = {
    ...assignment.termsSnapshot,
    currency: "USD",
    driverPayCents
  }

  const existing = state.tripsV2.find((trip) => trip.assignmentId === assignment.id)
  const confirmed = tripSchemaV2.parse({
    ...(existing ?? {
      createdAt: confirmedAt,
      driverProfileId: assignment.driverProfileId,
      equipmentCombinationId: null,
      id: randomUUID(),
      locationVisibility: "never_public",
      routePackId: null
    }),
    assignmentId: assignment.id,
    completedAt: confirmedAt,
    completionConfirmedAt: confirmedAt,
    completionConfirmedByUserId: HOST_STAFF_USER,
    completionStatus: "confirmed",
    completionSubmittedAt: confirmedAt,
    completionSubmittedByUserId: DRIVER_USER,
    deliveredQuantity: { ticketNumber: "T-4821", unit: "tons", value: 28 },
    loadPostingId: load.id,
    status: "completed",
    updatedAt: confirmedAt
  })

  state.tripsV2 = existing
    ? state.tripsV2.map((trip) => (trip.id === existing.id ? confirmed : trip))
    : [...state.tripsV2, confirmed]

  return { assignmentId: assignment.id, loadPostingId: load.id, tripId: confirmed.id }
}

/**
 * Another haul on a posting the host already owns.
 *
 * The seed carries two live assignments for this host, and the month-scoping test
 * needs three hauls in three different months. Cloning an existing assignment
 * keeps every reference — posting, slot, driver, rig — pointing at rows that
 * really exist, rather than inventing a haul out of loose uuids.
 */
function mintAssignmentLike(state: State, template: Assignment): Assignment {
  const minted = assignmentSchema.parse({
    ...template,
    completedAt: null,
    id: randomUUID(),
    status: "accepted"
  })

  state.assignments.push(minted)

  return minted
}

/** A single completed, billable haul on the seeded host, ready to accrue. */
function oneBillableHaul(
  state: State,
  driverPayCents: number | null = 52_500,
  confirmedAt = JUNE_CONFIRMED
) {
  const assignment = hostAssignments(state)[0]

  if (!assignment) {
    throw new Error("seed has no live assignment on a host posting")
  }

  return billableHaul(state, { assignment, confirmedAt, driverPayCents })
}

function accrualAuditEvents(state: State) {
  return state.auditEvents.filter((event) => event.action === "platform_fee_accrued")
}

describe("platform fee accrual", () => {
  it("charges the host a percentage of stated driver pay, on top, for a completed load", () => {
    const state = freshState()
    const haul = oneBillableHaul(state, 52_500)

    const result = accruePlatformFee(state, { actorUserId: HOST_STAFF_USER, assignmentId: haul.assignmentId })

    expect(result.outcome).toBe("accrued")

    if (result.outcome !== "accrued") return

    expect(result.event.feeCents).toBe(2_625)
    expect(result.event.feeBps).toBe(PLATFORM_FEE_BPS)
    // The driver's number is copied, never reduced. There is no field on this row
    // that could carry a net-of-fee figure, and this asserts the copy is faithful.
    expect(result.event.driverPayCents).toBe(52_500)
    expect(result.event.organizationId).toBe(HOST_ORG)
    expect(result.event.status).toBe("accrued")
    expect(result.event.invoiceId).toBeNull()
    expect(state.platformFeeEvents).toHaveLength(1)
  })

  it("bills the organization that POSTED the load, never the one that hauled it", () => {
    const state = freshState()
    const haul = oneBillableHaul(state)
    const load = state.loadPostings.find((candidate) => candidate.id === haul.loadPostingId)

    // Fabricate a caller who would rather the hauling side paid.
    const result = accruePlatformFee(state, {
      actorUserId: DRIVER_USER,
      assignmentId: haul.assignmentId
    })

    expect(result.outcome).toBe("accrued")
    if (result.outcome !== "accrued") return
    expect(result.event.organizationId).toBe(load?.companyId)
  })

  it("writes at most one fee per assignment however many times completion is confirmed", () => {
    const state = freshState()
    const haul = oneBillableHaul(state)

    const first = accruePlatformFee(state, { assignmentId: haul.assignmentId })
    const second = accruePlatformFee(state, { assignmentId: haul.assignmentId })
    const third = accruePlatformFee(state, { assignmentId: haul.assignmentId })

    expect(first.outcome).toBe("accrued")
    expect(second.outcome).toBe("already_accrued")
    expect(third.outcome).toBe("already_accrued")
    expect(state.platformFeeEvents).toHaveLength(1)
    expect(state.platformFeeEvents[0]?.id).toBe(platformFeeEventId(haul.assignmentId))

    if (first.outcome !== "accrued" || second.outcome !== "already_accrued") return

    expect(second.event.id).toBe(first.event.id)
    // One charge means one record of a charge. A second audit event would report a
    // billing action that never happened.
    expect(accrualAuditEvents(state)).toHaveLength(1)
  })

  it("recognises a fee that reached the ledger under some other id", () => {
    // The negative control for the assignment half of the at-most-one check. With
    // only the deterministic-id comparison, a fee written by a hand repair or an
    // import would be invisible and this load would be charged a second time.
    const state = freshState()
    const haul = oneBillableHaul(state)

    accruePlatformFee(state, { assignmentId: haul.assignmentId })

    const stored = state.platformFeeEvents[0]

    if (!stored) throw new Error("the first accrual wrote nothing")

    state.platformFeeEvents = [{ ...stored, id: randomUUID() }]

    const retry = accruePlatformFee(state, { assignmentId: haul.assignmentId })

    expect(retry.outcome).toBe("already_accrued")
    expect(state.platformFeeEvents).toHaveLength(1)
  })

  it("refuses to accrue when the load states no driver pay, rather than accruing zero", () => {
    const state = freshState()
    const haul = oneBillableHaul(state, null)

    const result = accruePlatformFee(state, { assignmentId: haul.assignmentId })

    expect(result.outcome).toBe("no_basis")
    // A refusal carries no event at all, so no caller can read it as a charge — and
    // nothing reached the ledger to be billed later.
    expect("event" in result).toBe(false)
    expect(state.platformFeeEvents).toEqual([])
    expect(accrualAuditEvents(state)).toEqual([])
  })

  it("refuses to accrue for a haul nobody has confirmed delivered", () => {
    const state = freshState()
    const assignment = hostAssignments(state)[0]

    if (!assignment) throw new Error("seed has no live assignment on a host posting")

    // Everything a fee needs EXCEPT the agreement: stated pay, a completed
    // assignment, a completed trip — but no confirmed delivery record.
    const haul = billableHaul(state, { assignment, confirmedAt: JUNE_CONFIRMED, driverPayCents: 52_500 })

    state.tripsV2 = state.tripsV2.map((trip) =>
      trip.id === haul.tripId
        ? { ...trip, completionConfirmedAt: null, completionConfirmedByUserId: null, completionStatus: "submitted" }
        : trip
    )

    const result = accruePlatformFee(state, { assignmentId: haul.assignmentId })

    expect(result.outcome).toBe("not_completed")
    expect(state.platformFeeEvents).toEqual([])
  })

  it("refuses to accrue for a cancelled assignment even when a confirmed trip exists", () => {
    const state = freshState()
    const haul = oneBillableHaul(state)
    const assignment = state.assignments.find((candidate) => candidate.id === haul.assignmentId)

    if (!assignment) throw new Error("the fixture lost its assignment")

    assignment.status = "cancelled"

    expect(accruePlatformFee(state, { assignmentId: haul.assignmentId }).outcome).toBe("not_completed")
    expect(state.platformFeeEvents).toEqual([])
  })

  it("refuses to accrue when the trip carrying the confirmation was cancelled", () => {
    const state = freshState()
    const haul = oneBillableHaul(state)

    state.tripsV2 = state.tripsV2.map((trip) =>
      trip.id === haul.tripId ? { ...trip, status: "cancelled" as const } : trip
    )

    expect(accruePlatformFee(state, { assignmentId: haul.assignmentId }).outcome).toBe("not_completed")
    expect(state.platformFeeEvents).toEqual([])
  })

  it("bills a confirmed haul whose assignment row still reads hauled", () => {
    // The positive control for the previous two: the assignment status lags the
    // trip, and refusing "hauled" would silently skip the fee on a delivery both
    // sides already agreed on.
    const state = freshState()
    const haul = oneBillableHaul(state)
    const assignment = state.assignments.find((candidate) => candidate.id === haul.assignmentId)

    if (!assignment) throw new Error("the fixture lost its assignment")

    assignment.status = "hauled"

    expect(accruePlatformFee(state, { assignmentId: haul.assignmentId }).outcome).toBe("accrued")
  })

  it("throws for an assignment that does not exist, rather than reporting a refusal", () => {
    const state = freshState()

    expect(() => accruePlatformFee(state, { assignmentId: randomUUID() })).toThrow(/was not found/)
  })

  it("freezes the stated pay, so editing the load cannot restate a charge", () => {
    const state = freshState()
    const haul = oneBillableHaul(state, 52_500)
    const billingUserId = billingMember(state)

    accruePlatformFee(state, { assignmentId: haul.assignmentId })

    const load = state.loadPostings.find((candidate) => candidate.id === haul.loadPostingId)

    if (!load) throw new Error("the fixture lost its posting")

    // The host raises what the load pays, long after it was hauled and charged.
    load.driverPayCents = 1_000_000

    const retry = accruePlatformFee(state, { assignmentId: haul.assignmentId })

    expect(retry.outcome).toBe("already_accrued")

    if (retry.outcome !== "already_accrued") return

    expect(retry.event.driverPayCents).toBe(52_500)
    expect(retry.event.feeCents).toBe(2_625)
    expect(
      hostFeeSummary(state, { actorUserId: billingUserId, organizationId: HOST_ORG }, MID_JULY).accruedCents
    ).toBe(2_625)
  })

  it("freezes the rate, so a later rate change re-rates nothing", () => {
    const state = freshState()
    const haul = oneBillableHaul(state, 52_500)

    accruePlatformFee(state, { assignmentId: haul.assignmentId, feeBps: 500 })

    const retry = accruePlatformFee(state, { assignmentId: haul.assignmentId, feeBps: 900 })

    expect(retry.outcome).toBe("already_accrued")
    if (retry.outcome !== "already_accrued") return
    expect(retry.event.feeBps).toBe(500)
    expect(retry.event.feeCents).toBe(2_625)
  })

  it("reports the charge that exists even after the load loses its stated pay", () => {
    // The at-most-one check runs BEFORE the basis check on purpose. Re-deriving
    // eligibility first would make a retry after an edit answer "no basis", which
    // reads as "nothing was ever charged" for a load that was.
    const state = freshState()
    const haul = oneBillableHaul(state, 52_500)

    accruePlatformFee(state, { assignmentId: haul.assignmentId })

    const load = state.loadPostings.find((candidate) => candidate.id === haul.loadPostingId)

    if (!load) throw new Error("the fixture lost its posting")

    load.driverPayCents = null

    expect(accruePlatformFee(state, { assignmentId: haul.assignmentId }).outcome).toBe("already_accrued")
  })

  it("stamps the fee with the instant the host confirmed the delivery", () => {
    const state = freshState()
    const haul = oneBillableHaul(state, 52_500, JUNE_CONFIRMED)

    const result = accruePlatformFee(state, { assignmentId: haul.assignmentId }, MID_JULY)

    expect(result.outcome).toBe("accrued")
    if (result.outcome !== "accrued") return
    // The write clock is mid-July; the fee belongs to June because that is when the
    // load was agreed delivered, and that is what decides which bill it lands on.
    expect(result.event.occurredAt).toBe(JUNE_CONFIRMED)
    expect(result.event.createdAt).toBe(MID_JULY)
  })

  it("accrues for whoever settled the haul, whatever billing right they hold", () => {
    // A DELIBERATE divergence from "manage_billing for anything that changes
    // money", pinned here so it cannot be changed by accident. Accrual is not a
    // discretionary money action; it is the ledger recording a completion. Gating
    // it on the billing right would not merely skip the fee when a dispatcher
    // confirms a delivery — it would make the confirmation itself throw, because
    // dispatchers and landing managers settle deliveries and hold no billing
    // right. The actor is recorded for attribution, and never consulted.
    const state = freshState()
    const settlerUserId = addMember(state, HOST_ORG, ROLE_WITHOUT_BILLING as OrganizationRole)
    const haul = oneBillableHaul(state, 52_500)

    expect(organizationRoleCan(ROLE_WITHOUT_BILLING as OrganizationRole, "manage_billing")).toBe(false)
    expect(
      accruePlatformFee(state, { actorUserId: settlerUserId, assignmentId: haul.assignmentId }).outcome
    ).toBe("accrued")
    expect(accrualAuditEvents(state)[0]?.actorUserId).toBe(settlerUserId)
  })

  it("accrues on a replay that carries no actor at all", () => {
    // A compare-and-swap retry replays the mutation with no person attached. The
    // fee still has to be recorded, and the audit event says so rather than naming
    // somebody who was not there.
    const state = freshState()
    const haul = oneBillableHaul(state, 52_500)

    expect(accruePlatformFee(state, { assignmentId: haul.assignmentId }).outcome).toBe("accrued")
    expect(accrualAuditEvents(state)[0]?.actorUserId).toBeNull()
  })

  it("records who settled the haul and what the amount was derived from", () => {
    const state = freshState()
    const haul = oneBillableHaul(state, 52_500)

    accruePlatformFee(state, { actorUserId: HOST_STAFF_USER, assignmentId: haul.assignmentId })

    const audit = accrualAuditEvents(state)[0]

    expect(audit?.actorUserId).toBe(HOST_STAFF_USER)
    expect(audit?.entityType).toBe("platform_fee_event")
    expect(audit?.metadata).toMatchObject({
      assignmentId: haul.assignmentId,
      driverPayCents: 52_500,
      feeBps: PLATFORM_FEE_BPS,
      feeCents: 2_625,
      organizationId: HOST_ORG
    })
  })
})

describe("platform fee void", () => {
  it("keeps a voided fee out of every subtotal it could reach", () => {
    const state = freshState()
    const haul = oneBillableHaul(state, 52_500)
    const billingUserId = billingMember(state)
    const actor = { actorUserId: billingUserId, organizationId: HOST_ORG }

    accruePlatformFee(state, { assignmentId: haul.assignmentId })

    // The positive control: the amount was real before it was withdrawn.
    expect(hostFeeSummary(state, actor, MID_JULY).accruedCents).toBe(2_625)

    const result = voidPlatformFee(
      state,
      { ...actor, assignmentId: haul.assignmentId, reason: "Delivery reversed at the destination" },
      MID_JULY
    )

    expect(result.outcome).toBe("voided")
    if (result.outcome !== "voided") return
    expect(result.event.status).toBe("voided")
    expect(result.event.voidReason).toBe("Delivery reversed at the destination")
    expect(invoiceSubtotalCents([result.event])).toBe(0)
    expect(hostFeeSummary(state, actor, MID_JULY).accruedCents).toBe(0)
    expect(
      openInvoiceForPeriod(
        state,
        { ...actor, periodEnd: JUNE_PERIOD_END, periodStart: JUNE_PERIOD_START },
        BILLING_RUN
      ).outcome
    ).toBe("nothing_to_bill")
  })

  it("records one withdrawal however many times the reversal is retried", () => {
    const state = freshState()
    const haul = oneBillableHaul(state)
    const actor = { actorUserId: billingMember(state), organizationId: HOST_ORG }
    const input = { ...actor, assignmentId: haul.assignmentId, reason: "Reversed" }

    accruePlatformFee(state, { assignmentId: haul.assignmentId })

    expect(voidPlatformFee(state, input, MID_JULY).outcome).toBe("voided")
    expect(voidPlatformFee(state, input, MID_JULY).outcome).toBe("already_voided")
    expect(state.auditEvents.filter((event) => event.action === "platform_fee_voided")).toHaveLength(1)
  })

  it("refuses to void a fee the host has already been billed for", () => {
    const state = freshState()
    const haul = oneBillableHaul(state)
    const actor = { actorUserId: billingMember(state), organizationId: HOST_ORG }

    accruePlatformFee(state, { assignmentId: haul.assignmentId })
    openInvoiceForPeriod(
      state,
      { ...actor, periodEnd: JUNE_PERIOD_END, periodStart: JUNE_PERIOD_START },
      BILLING_RUN
    )

    expect(() =>
      voidPlatformFee(state, { ...actor, assignmentId: haul.assignmentId, reason: "Reversed" }, MID_JULY)
    ).toThrow(/credit note/)
  })

  it("reports that there is nothing to withdraw when nothing accrued", () => {
    const state = freshState()
    const haul = oneBillableHaul(state, null)
    const actor = { actorUserId: billingMember(state), organizationId: HOST_ORG }

    const result = voidPlatformFee(
      state,
      { ...actor, assignmentId: haul.assignmentId, reason: "Reversed" },
      MID_JULY
    )

    expect(result.outcome).toBe("no_fee")
    expect("event" in result).toBe(false)
  })

  it("requires a reason, because a withdrawn charge has to be explainable", () => {
    const state = freshState()
    const haul = oneBillableHaul(state)
    const actor = { actorUserId: billingMember(state), organizationId: HOST_ORG }

    accruePlatformFee(state, { assignmentId: haul.assignmentId })

    expect(() =>
      voidPlatformFee(state, { ...actor, assignmentId: haul.assignmentId, reason: "   " }, MID_JULY)
    ).toThrow(/why/)
  })

  it("refuses a member who does not hold the right to change money", () => {
    const state = freshState()
    const haul = oneBillableHaul(state)
    const actorUserId = addMember(state, HOST_ORG, ROLE_WITHOUT_BILLING as OrganizationRole)

    accruePlatformFee(state, { assignmentId: haul.assignmentId })

    expect(() =>
      voidPlatformFee(
        state,
        { actorUserId, assignmentId: haul.assignmentId, organizationId: HOST_ORG, reason: "Reversed" },
        MID_JULY
      )
    ).toThrow(/cannot manage billing/)
  })

  it("refuses to withdraw another organization's charge", () => {
    const state = freshState()
    const haul = oneBillableHaul(state)
    const outsiderUserId = billingMember(state, OTHER_HOST_ORG)

    accruePlatformFee(state, { assignmentId: haul.assignmentId })

    expect(() =>
      voidPlatformFee(
        state,
        {
          actorUserId: outsiderUserId,
          assignmentId: haul.assignmentId,
          organizationId: OTHER_HOST_ORG,
          reason: "Not ours to withdraw"
        },
        MID_JULY
      )
    ).toThrow(/another organization/)
  })

  it("refuses a caller who is not a member of the organization at all", () => {
    const state = freshState()
    const haul = oneBillableHaul(state)

    accruePlatformFee(state, { assignmentId: haul.assignmentId })

    expect(() =>
      voidPlatformFee(
        state,
        {
          actorUserId: randomUUID(),
          assignmentId: haul.assignmentId,
          organizationId: HOST_ORG,
          reason: "Reversed"
        },
        MID_JULY
      )
    ).toThrow(/not an active member/)
  })

  it("refuses a call that names no organization instead of defaulting to one", () => {
    const state = freshState()
    const haul = oneBillableHaul(state)

    accruePlatformFee(state, { assignmentId: haul.assignmentId })

    expect(() =>
      voidPlatformFee(state, { assignmentId: haul.assignmentId, reason: "Reversed" }, MID_JULY)
    ).toThrow(/required/)
  })
})

describe("host invoice", () => {
  /** A host with two completed, billable hauls inside June. */
  function twoJuneHauls(state: State) {
    const assignments = hostAssignments(state)

    if (assignments.length < 2) {
      throw new Error("seed has fewer than two live assignments on this host's postings")
    }

    const first = billableHaul(state, {
      assignment: assignments[0] as Assignment,
      confirmedAt: JUNE_CONFIRMED,
      driverPayCents: 52_500
    })
    const second = billableHaul(state, {
      assignment: assignments[1] as Assignment,
      confirmedAt: "2026-06-25T11:00:00.000Z",
      driverPayCents: 62_500
    })

    accruePlatformFee(state, { assignmentId: first.assignmentId })
    accruePlatformFee(state, { assignmentId: second.assignmentId })

    return { first, second }
  }

  it("bills every fee accrued in the month and marks each one invoiced", () => {
    const state = freshState()
    const actor = { actorUserId: billingMember(state), organizationId: HOST_ORG }

    twoJuneHauls(state)

    const result = openInvoiceForPeriod(
      state,
      { ...actor, periodEnd: JUNE_PERIOD_END, periodStart: JUNE_PERIOD_START },
      BILLING_RUN
    )

    expect(result.outcome).toBe("opened")
    if (result.outcome !== "opened") return

    expect(result.invoice.subtotalCents).toBe(2_625 + 3_125)
    expect(result.invoice.feeEventIds).toHaveLength(2)
    expect(result.invoice.status).toBe("open")
    expect(result.invoice.issuedAt).toBe(BILLING_RUN)
    expect(result.invoice.periodStart).toBe(JUNE_PERIOD_START)
    expect(result.invoice.periodEnd).toBe(JUNE_PERIOD_END)
    // LogLoads holds no funds and made no external call here, so it cannot claim a
    // provider object it has not created.
    expect(result.invoice.stripeInvoiceId).toBeNull()

    for (const event of state.platformFeeEvents) {
      expect(event.status).toBe("invoiced")
      expect(event.invoiceId).toBe(result.invoice.id)
    }

    expect(result.invoice.subtotalCents).toBe(
      computePlatformFeeCents(52_500, PLATFORM_FEE_BPS) + computePlatformFeeCents(62_500, PLATFORM_FEE_BPS)
    )
  })

  it("bills a host once for a month however many times the run repeats", () => {
    const state = freshState()
    const actor = { actorUserId: billingMember(state), organizationId: HOST_ORG }
    const period = { periodEnd: JUNE_PERIOD_END, periodStart: JUNE_PERIOD_START }

    twoJuneHauls(state)

    const first = openInvoiceForPeriod(state, { ...actor, ...period }, BILLING_RUN)
    const second = openInvoiceForPeriod(state, { ...actor, ...period }, BILLING_RUN)
    const third = openInvoiceForPeriod(state, { ...actor, ...period }, MID_JULY)

    expect(first.outcome).toBe("opened")
    expect(second.outcome).toBe("already_open")
    expect(third.outcome).toBe("already_open")
    expect(state.hostInvoices).toHaveLength(1)
    expect(state.auditEvents.filter((event) => event.action === "host_invoice_opened")).toHaveLength(1)

    if (first.outcome !== "opened" || second.outcome !== "already_open") return
    expect(second.invoice.id).toBe(first.invoice.id)
    expect(second.invoice.subtotalCents).toBe(first.invoice.subtotalCents)
  })

  it("lets the trusted monthly scheduler open the closed period without impersonating a host", () => {
    const state = freshState()
    const period = { periodEnd: JUNE_PERIOD_END, periodStart: JUNE_PERIOD_START }

    twoJuneHauls(state)

    const first = openClosedPeriodInvoices(state, period, BILLING_RUN)
    const second = openClosedPeriodInvoices(state, period, MID_JULY)

    expect(first).toHaveLength(1)
    expect(first[0]?.outcome).toBe("opened")
    expect(second).toHaveLength(0)
    expect(state.hostInvoices).toHaveLength(1)
    expect(
      state.auditEvents.find((event) => event.action === "host_invoice_opened")?.actorUserId
    ).toBeNull()
  })

  it("materializes every missed closed month before collecting the open backlog", () => {
    const state = freshState()

    twoJuneHauls(state)

    const june = state.platformFeeEvents[0]

    if (!june) {
      throw new Error("The fixture did not accrue a June fee")
    }

    state.platformFeeEvents.push({
      ...june,
      assignmentId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee81",
      createdAt: MAY_CONFIRMED,
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa81",
      invoiceId: null,
      occurredAt: MAY_CONFIRMED,
      status: "accrued",
      updatedAt: MAY_CONFIRMED
    })
    state.platformFeeEvents.push({
      ...june,
      assignmentId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee82",
      createdAt: JULY_CONFIRMED,
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa82",
      invoiceId: null,
      occurredAt: JULY_CONFIRMED,
      status: "accrued",
      updatedAt: JULY_CONFIRMED
    })

    const opened = openAllClosedPeriodInvoices(state, MID_JULY)

    expect(opened.flatMap((result) => "invoice" in result ? [result.invoice.periodStart] : [])).toEqual([
      "2026-05-01T00:00:00.000Z",
      JUNE_PERIOD_START
    ])
    expect(state.hostInvoices.map((invoice) => invoice.periodStart)).toEqual([
      "2026-05-01T00:00:00.000Z",
      JUNE_PERIOD_START
    ])
    expect(
      state.platformFeeEvents.find((event) => event.occurredAt === JULY_CONFIRMED)
    ).toMatchObject({ invoiceId: null, status: "accrued" })
  })

  it("mints one bill however the month boundary is spelled", () => {
    // Both spellings name the same instant. Deriving the id from the caller's text
    // rather than the canonical month start would bill this host twice for June.
    const state = freshState()
    const actor = { actorUserId: billingMember(state), organizationId: HOST_ORG }

    twoJuneHauls(state)

    const canonical = openInvoiceForPeriod(
      state,
      { ...actor, periodEnd: JUNE_PERIOD_END, periodStart: JUNE_PERIOD_START },
      BILLING_RUN
    )
    const shorthand = openInvoiceForPeriod(
      state,
      { ...actor, periodEnd: "2026-07-01T00:00:00Z", periodStart: "2026-06-01T00:00:00Z" },
      BILLING_RUN
    )

    expect(shorthand.outcome).toBe("already_open")
    expect(state.hostInvoices).toHaveLength(1)
    if (canonical.outcome !== "opened") return
    expect(canonical.invoice.id).toBe(hostInvoiceId(HOST_ORG, JUNE_PERIOD_START))
  })

  it("stores the canonical month whatever spelling the caller used", () => {
    // Isolates the id derivation from the period-match fallback in the at-most-one
    // check: the bill must be MINTED under the canonical month start, so that a
    // caller who writes the boundary a different way cannot mint a second one.
    const state = freshState()
    const actor = { actorUserId: billingMember(state), organizationId: HOST_ORG }

    twoJuneHauls(state)

    const result = openInvoiceForPeriod(
      state,
      { ...actor, periodEnd: "2026-07-01T00:00:00Z", periodStart: "2026-06-01T00:00:00Z" },
      BILLING_RUN
    )

    expect(result.outcome).toBe("opened")
    if (result.outcome !== "opened") return
    expect(result.invoice.id).toBe(hostInvoiceId(HOST_ORG, JUNE_PERIOD_START))
    expect(result.invoice.periodStart).toBe(JUNE_PERIOD_START)
    expect(result.invoice.periodEnd).toBe(JUNE_PERIOD_END)
  })

  it("refuses to bill a month that has not finished accruing", () => {
    const state = freshState()
    const actor = { actorUserId: billingMember(state), organizationId: HOST_ORG }

    twoJuneHauls(state)

    expect(() =>
      openInvoiceForPeriod(
        state,
        { ...actor, periodEnd: JUNE_PERIOD_END, periodStart: JUNE_PERIOD_START },
        "2026-06-30T23:59:59.000Z"
      )
    ).toThrow(/in arrears/)
    expect(state.hostInvoices).toEqual([])
  })

  it("refuses a period that is not one whole UTC calendar month", () => {
    const state = freshState()
    const actor = { actorUserId: billingMember(state), organizationId: HOST_ORG }

    twoJuneHauls(state)

    expect(() =>
      openInvoiceForPeriod(
        state,
        { ...actor, periodEnd: "2026-06-15T00:00:00.000Z", periodStart: JUNE_PERIOD_START },
        BILLING_RUN
      )
    ).toThrow(/one UTC calendar month/)
  })

  it("raises no bill at all when nothing accrued, because there is no minimum", () => {
    const state = freshState()
    const actor = { actorUserId: billingMember(state), organizationId: HOST_ORG }

    const result = openInvoiceForPeriod(
      state,
      { ...actor, periodEnd: JUNE_PERIOD_END, periodStart: JUNE_PERIOD_START },
      BILLING_RUN
    )

    expect(result.outcome).toBe("nothing_to_bill")
    expect("invoice" in result).toBe(false)
    expect(state.hostInvoices).toEqual([])
  })

  it("leaves fees from other months out of this month's bill", () => {
    const state = freshState()
    const actor = { actorUserId: billingMember(state), organizationId: HOST_ORG }
    const assignments = hostAssignments(state)

    if (assignments.length < 2) {
      throw new Error("seed has fewer than two live assignments on this host's postings")
    }

    // Accrued one at a time, because two of these hauls share a posting: the fee
    // freezes the pay it was raised against, so the pay has to be the stated one
    // AT THE MOMENT of each accrual, not whatever the fixture last wrote.
    const may = billableHaul(state, {
      assignment: assignments[0] as Assignment,
      confirmedAt: MAY_CONFIRMED,
      driverPayCents: 10_000
    })

    accruePlatformFee(state, { assignmentId: may.assignmentId })

    const june = billableHaul(state, {
      assignment: assignments[1] as Assignment,
      confirmedAt: JUNE_CONFIRMED,
      driverPayCents: 52_500
    })

    accruePlatformFee(state, { assignmentId: june.assignmentId })

    const july = billableHaul(state, {
      assignment: mintAssignmentLike(state, assignments[0] as Assignment),
      confirmedAt: JULY_CONFIRMED,
      driverPayCents: 20_000
    })

    accruePlatformFee(state, { assignmentId: july.assignmentId })

    const result = openInvoiceForPeriod(
      state,
      { ...actor, periodEnd: JUNE_PERIOD_END, periodStart: JUNE_PERIOD_START },
      MID_JULY
    )

    expect(result.outcome).toBe("opened")
    if (result.outcome !== "opened") return

    expect(result.invoice.subtotalCents).toBe(2_625)
    expect(result.invoice.feeEventIds).toEqual([platformFeeEventId(june.assignmentId)])

    const stillAccrued = state.platformFeeEvents.filter((event) => event.status === "accrued")

    expect(stillAccrued.map((event) => event.assignmentId).sort()).toEqual(
      [may.assignmentId, july.assignmentId].sort()
    )
  })

  it("bills only the host it was asked about", () => {
    const state = freshState()
    const actor = { actorUserId: billingMember(state), organizationId: HOST_ORG }
    const otherAssignment = hostAssignments(state, OTHER_HOST_ORG)[0]

    if (!otherAssignment) throw new Error("seed has no live assignment on the second host's postings")

    const ours = oneBillableHaul(state, 52_500)
    const theirs = billableHaul(state, {
      assignment: otherAssignment,
      confirmedAt: JUNE_CONFIRMED,
      driverPayCents: 80_000
    })

    accruePlatformFee(state, { assignmentId: ours.assignmentId })
    accruePlatformFee(state, { assignmentId: theirs.assignmentId })

    const result = openInvoiceForPeriod(
      state,
      { ...actor, periodEnd: JUNE_PERIOD_END, periodStart: JUNE_PERIOD_START },
      BILLING_RUN
    )

    expect(result.outcome).toBe("opened")
    if (result.outcome !== "opened") return
    expect(result.invoice.subtotalCents).toBe(2_625)

    const theirFee = state.platformFeeEvents.find(
      (event) => event.assignmentId === theirs.assignmentId
    )

    expect(theirFee?.status).toBe("accrued")
    expect(theirFee?.invoiceId).toBeNull()
  })

  it("refuses a member who does not hold the right to change money", () => {
    const state = freshState()
    const actorUserId = addMember(state, HOST_ORG, ROLE_WITHOUT_BILLING as OrganizationRole)

    twoJuneHauls(state)

    expect(() =>
      openInvoiceForPeriod(
        state,
        {
          actorUserId,
          organizationId: HOST_ORG,
          periodEnd: JUNE_PERIOD_END,
          periodStart: JUNE_PERIOD_START
        },
        BILLING_RUN
      )
    ).toThrow(/cannot manage billing/)
    expect(state.hostInvoices).toEqual([])
  })
})

describe("host invoice settlement", () => {
  function openJuneInvoice(state: State, actorUserId: string) {
    const haul = oneBillableHaul(state, 52_500)

    accruePlatformFee(state, { assignmentId: haul.assignmentId })

    const result = openInvoiceForPeriod(
      state,
      {
        actorUserId,
        organizationId: HOST_ORG,
        periodEnd: JUNE_PERIOD_END,
        periodStart: JUNE_PERIOD_START
      },
      BILLING_RUN
    )

    if (result.outcome !== "opened") {
      throw new Error(`the fixture failed to open a bill: ${result.outcome}`)
    }

    return result.invoice
  }

  it("marks a bill paid once, however many times the provider notifies", () => {
    const state = freshState()
    const actorUserId = billingMember(state)
    const invoice = openJuneInvoice(state, actorUserId)
    const input = {
      actorUserId,
      invoiceId: invoice.id,
      organizationId: HOST_ORG,
      stripeInvoiceId: "in_test_june"
    }

    const first = markInvoicePaid(state, input, MID_JULY)
    const second = markInvoicePaid(state, input, MID_JULY)

    expect(first.changed).toBe(true)
    expect(first.invoice.status).toBe("paid")
    expect(first.invoice.paidAt).toBe(MID_JULY)
    expect(first.invoice.stripeInvoiceId).toBe("in_test_june")
    expect(second.changed).toBe(false)
    expect(state.auditEvents.filter((event) => event.action === "host_invoice_paid")).toHaveLength(1)
  })

  it("refuses to write off a bill that was paid", () => {
    const state = freshState()
    const actorUserId = billingMember(state)
    const invoice = openJuneInvoice(state, actorUserId)

    markInvoicePaid(state, { actorUserId, invoiceId: invoice.id, organizationId: HOST_ORG }, MID_JULY)

    expect(() =>
      markInvoiceUncollectible(
        state,
        { actorUserId, invoiceId: invoice.id, organizationId: HOST_ORG },
        MID_JULY
      )
    ).toThrow(/unpaid/)
    expect(state.hostInvoices[0]?.status).toBe("paid")
  })

  it("writes off an uncollected bill without erasing what was owed", () => {
    const state = freshState()
    const actorUserId = billingMember(state)
    const invoice = openJuneInvoice(state, actorUserId)

    const result = markInvoiceUncollectible(
      state,
      { actorUserId, invoiceId: invoice.id, organizationId: HOST_ORG, reason: "Card declined twice" },
      MID_JULY
    )

    expect(result.changed).toBe(true)
    expect(result.invoice.status).toBe("uncollectible")
    expect(result.invoice.subtotalCents).toBe(invoice.subtotalCents)
    expect(result.invoice.paidAt).toBeNull()
    expect(
      state.auditEvents.find((event) => event.action === "host_invoice_uncollectible")?.metadata.reason
    ).toBe("Card declined twice")
  })

  it("accepts a late payment on a bill that was written off", () => {
    const state = freshState()
    const actorUserId = billingMember(state)
    const invoice = openJuneInvoice(state, actorUserId)

    markInvoiceUncollectible(
      state,
      { actorUserId, invoiceId: invoice.id, organizationId: HOST_ORG },
      MID_JULY
    )

    const paid = markInvoicePaid(
      state,
      { actorUserId, invoiceId: invoice.id, organizationId: HOST_ORG },
      "2026-08-01T00:00:00.000Z"
    )

    expect(paid.changed).toBe(true)
    expect(paid.invoice.status).toBe("paid")
  })

  it("refuses to settle another organization's bill", () => {
    const state = freshState()
    const invoice = openJuneInvoice(state, billingMember(state))
    const outsiderUserId = billingMember(state, OTHER_HOST_ORG)

    expect(() =>
      markInvoicePaid(
        state,
        { actorUserId: outsiderUserId, invoiceId: invoice.id, organizationId: OTHER_HOST_ORG },
        MID_JULY
      )
    ).toThrow(/another organization/)
  })

  it("refuses a member who does not hold the right to change money", () => {
    const state = freshState()
    const invoice = openJuneInvoice(state, billingMember(state))
    const actorUserId = addMember(state, HOST_ORG, ROLE_WITHOUT_BILLING as OrganizationRole)

    expect(() =>
      markInvoicePaid(state, { actorUserId, invoiceId: invoice.id, organizationId: HOST_ORG }, MID_JULY)
    ).toThrow(/cannot manage billing/)
  })
})

describe("host fee summary", () => {
  it("reports what has accrued, the month accruing, and the last bill", () => {
    const state = freshState()
    const actorUserId = billingMember(state)
    const actor = { actorUserId, organizationId: HOST_ORG }
    const haul = oneBillableHaul(state, 52_500, JULY_CONFIRMED)

    accruePlatformFee(state, { assignmentId: haul.assignmentId })

    const summary = hostFeeSummary(state, actor, MID_JULY)

    expect(summary.organizationId).toBe(HOST_ORG)
    expect(summary.accruedCents).toBe(2_625)
    expect(summary.accruedEventCount).toBe(1)
    expect(summary.currentPeriodAccruedCents).toBe(2_625)
    expect(summary.currentPeriodEventCount).toBe(1)
    expect(summary.currentPeriod).toEqual({
      periodEnd: "2026-08-01T00:00:00.000Z",
      periodStart: "2026-07-01T00:00:00.000Z"
    })
    expect(summary.currentFeeBps).toBe(PLATFORM_FEE_BPS)
    expect(summary.lastInvoice).toBeNull()
  })

  it("still counts a fee from a month that was never billed", () => {
    // The negative control against scoping "what you owe" to the current period: an
    // unbilled fee from June is still owed in July, and reporting only the current
    // month would under-state the host's balance.
    const state = freshState()
    const actor = { actorUserId: billingMember(state), organizationId: HOST_ORG }
    const haul = oneBillableHaul(state, 52_500, JUNE_CONFIRMED)

    accruePlatformFee(state, { assignmentId: haul.assignmentId })

    const summary = hostFeeSummary(state, actor, MID_JULY)

    expect(summary.accruedCents).toBe(2_625)
    expect(summary.currentPeriodAccruedCents).toBe(0)
    expect(summary.currentPeriodEventCount).toBe(0)
  })

  it("drops a fee out of the accrued total once it is on a bill", () => {
    const state = freshState()
    const actorUserId = billingMember(state)
    const actor = { actorUserId, organizationId: HOST_ORG }
    const haul = oneBillableHaul(state, 52_500, JUNE_CONFIRMED)

    accruePlatformFee(state, { assignmentId: haul.assignmentId })
    openInvoiceForPeriod(
      state,
      { ...actor, periodEnd: JUNE_PERIOD_END, periodStart: JUNE_PERIOD_START },
      BILLING_RUN
    )

    const summary = hostFeeSummary(state, actor, MID_JULY)

    expect(summary.accruedCents).toBe(0)
    expect(summary.accruedEventCount).toBe(0)
    expect(summary.lastInvoice?.subtotalCents).toBe(2_625)
    expect(summary.lastInvoice?.periodStart).toBe(JUNE_PERIOD_START)
  })

  it("reports the most recent bill by the month it covers", () => {
    const state = freshState()
    const actorUserId = billingMember(state)
    const actor = { actorUserId, organizationId: HOST_ORG }
    const assignments = hostAssignments(state)

    if (assignments.length < 2) {
      throw new Error("seed has fewer than two live assignments on this host's postings")
    }

    const may = billableHaul(state, {
      assignment: assignments[0] as Assignment,
      confirmedAt: MAY_CONFIRMED,
      driverPayCents: 10_000
    })
    const june = billableHaul(state, {
      assignment: assignments[1] as Assignment,
      confirmedAt: JUNE_CONFIRMED,
      driverPayCents: 52_500
    })

    accruePlatformFee(state, { assignmentId: may.assignmentId })
    accruePlatformFee(state, { assignmentId: june.assignmentId })
    openInvoiceForPeriod(
      state,
      { ...actor, periodEnd: JUNE_PERIOD_END, periodStart: JUNE_PERIOD_START },
      BILLING_RUN
    )
    openInvoiceForPeriod(
      state,
      { ...actor, periodEnd: JUNE_PERIOD_START, periodStart: "2026-05-01T00:00:00.000Z" },
      BILLING_RUN
    )

    expect(state.hostInvoices).toHaveLength(2)
    expect(hostFeeSummary(state, actor, MID_JULY).lastInvoice?.periodStart).toBe(JUNE_PERIOD_START)
  })

  it("reads only the organization the caller belongs to", () => {
    const state = freshState()
    const haul = oneBillableHaul(state)

    accruePlatformFee(state, { assignmentId: haul.assignmentId })

    expect(() =>
      hostFeeSummary(state, { actorUserId: randomUUID(), organizationId: HOST_ORG }, MID_JULY)
    ).toThrow(/not an active member/)
  })

  it("is readable by a member who holds no billing right", () => {
    // Reading your own organization's fees is membership, not a money change. A
    // dispatcher has to be able to see what a completed load will cost the host.
    const state = freshState()
    const actorUserId = addMember(state, HOST_ORG, ROLE_WITHOUT_BILLING as OrganizationRole)
    const haul = oneBillableHaul(state, 52_500)

    accruePlatformFee(state, { assignmentId: haul.assignmentId })

    expect(hostFeeSummary(state, { actorUserId, organizationId: HOST_ORG }, MID_JULY).accruedCents).toBe(
      2_625
    )
  })
})
