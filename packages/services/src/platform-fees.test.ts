import { randomUUID } from "node:crypto"

import {
  assignmentSchema,
  computePlatformFeeCents,
  billingPeriodSummaryId,
  invoiceSubtotalCents,
  LEGACY_PERCENTAGE_ELIGIBLE_CURRENCY,
  organizationMembershipSchema,
  organizationRoleCan,
  networkUsageEventId,
  networkUsageEventSchema,
  percentageFeeEventId,
  platformFeeEventId,
  platformFeeEventSchema,
  tripSchemaV2,
  userSchema,
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
  reconcileMissingPlatformFees,
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

/** A stored historical fee row. This does not go through accrual. */
function storeHistoricalFee(state: State, assignmentId: string) {
  const assignment = state.assignments.find((candidate) => candidate.id === assignmentId)

  if (!assignment?.termsSnapshot.driverPayCents) {
    throw new Error(`Assignment ${assignmentId} has no frozen driver pay to preserve`)
  }

  const movementId = assignment.loadMovementId ?? assignment.id
  const occurredAt = assignment.completedAt ?? "2026-06-20T15:00:00.000Z"
  const driverPayCents = assignment.termsSnapshot.driverPayCents
  const billingModel = assignment.billingModel === "percentage_v1"
    ? "percentage_v1"
    : "legacy_percentage"
  const event = platformFeeEventSchema.parse({
    assignmentId,
    billingModel,
    createdAt: occurredAt,
    driverPayCents,
    feeBps: PLATFORM_FEE_BPS,
    feeCents: computePlatformFeeCents(driverPayCents, PLATFORM_FEE_BPS),
    id: billingModel === "percentage_v1"
      ? percentageFeeEventId(movementId)
      : platformFeeEventId(assignmentId),
    invoiceId: null,
    loadMovementId: movementId,
    loadPostingId: assignment.loadPostingId,
    occurredAt,
    organizationId: state.loadPostings.find((posting) => posting.id === assignment.loadPostingId)?.companyId ?? HOST_ORG,
    status: "accrued",
    truckSlotId: assignment.truckSlotId,
    updatedAt: occurredAt,
    voidReason: null
  })

  state.platformFeeEvents.push(event)
  return event
}

function addActiveUser(state: State, organizationId: string): string {
  const userId = randomUUID()

  state.profiles.push(
    userSchema.parse({
      clerkUserId: `clerk-platform-fee-${userId}`,
      companyId: organizationId,
      createdAt: "2026-06-01T00:00:00.000Z",
      email: `${userId}@example.com`,
      fullName: "Platform fee boundary member",
      id: userId,
      isActive: true,
      phone: "555-0100",
      role: "driver",
      updatedAt: "2026-06-01T00:00:00.000Z",
      verificationStatus: "pending"
    })
  )

  return userId
}

/** A member of an organization in a given role. Returns the acting user id. */
function addMember(state: State, organizationId: string, role: OrganizationRole): string {
  const userId = addActiveUser(state, organizationId)

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
  assignment.driverPaymentReceivedAmountCents = driverPayCents
  assignment.driverPaymentReceivedAt = confirmedAt
  assignment.driverPaymentReceivedByUserId = DRIVER_USER
  assignment.driverPaymentReceivedCurrency =
    driverPayCents === null
      ? null
      : LEGACY_PERCENTAGE_ELIGIBLE_CURRENCY
  assignment.termsSnapshot = {
    ...assignment.termsSnapshot,
    currency: LEGACY_PERCENTAGE_ELIGIBLE_CURRENCY,
    driverPayCents,
    hostFee: {
      collectionState: "accrues_monthly_in_arrears",
      feeCents: null,
      providerCollectionState: "feature_gated",
      proposedRateBps: PLATFORM_FEE_BPS,
      rateBps: PLATFORM_FEE_BPS
    }
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
    loadMovementId: randomUUID(),
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

describe("retired percentage fee accrual", () => {
  it("records no new fee for a completed haul", () => {
    const state = freshState()
    const haul = oneBillableHaul(state, 52_500)
    const before = state.platformFeeEvents.length

    expect(accruePlatformFee(state, { assignmentId: haul.assignmentId })).toMatchObject({
      assignmentId: haul.assignmentId,
      outcome: "no_basis",
      reason: "The completed-load percentage fee is retired. No new fee was recorded."
    })
    expect(state.platformFeeEvents).toHaveLength(before)
  })
})

describe("platform fee void", () => {
  it("keeps a voided fee out of every subtotal it could reach", () => {
    const state = freshState()
    const haul = oneBillableHaul(state, 52_500)
    const billingUserId = billingMember(state)
    const actor = { actorUserId: billingUserId, organizationId: HOST_ORG }

    storeHistoricalFee(state, haul.assignmentId)

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

    storeHistoricalFee(state, haul.assignmentId)

    expect(voidPlatformFee(state, input, MID_JULY).outcome).toBe("voided")
    expect(voidPlatformFee(state, input, MID_JULY).outcome).toBe("already_voided")
    expect(state.auditEvents.filter((event) => event.action === "platform_fee_voided")).toHaveLength(1)
  })

  it("treats a withdrawn movement as final instead of reporting it as accrued again", () => {
    const state = freshState()
    const haul = oneBillableHaul(state)
    const actor = { actorUserId: billingMember(state), organizationId: HOST_ORG }

    storeHistoricalFee(state, haul.assignmentId)
    voidPlatformFee(
      state,
      { ...actor, assignmentId: haul.assignmentId, reason: "Delivery reversed" },
      MID_JULY
    )

    const repeated = accruePlatformFee(state, {
      assignmentId: haul.assignmentId
    })

    expect(repeated.outcome).toBe("already_voided")
    expect(repeated).toMatchObject({
      event: { assignmentId: haul.assignmentId, status: "voided" }
    })
    expect(state.platformFeeEvents).toHaveLength(1)
    expect(accrualAuditEvents(state)).toHaveLength(0)
    expect(reconcileMissingPlatformFees(state, MID_JULY)).toEqual([])
  })

  it("refuses to void a fee the host has already been billed for", () => {
    const state = freshState()
    const haul = oneBillableHaul(state)
    const actor = { actorUserId: billingMember(state), organizationId: HOST_ORG }

    storeHistoricalFee(state, haul.assignmentId)
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

    storeHistoricalFee(state, haul.assignmentId)

    expect(() =>
      voidPlatformFee(state, { ...actor, assignmentId: haul.assignmentId, reason: "   " }, MID_JULY)
    ).toThrow(/why/)
  })

  it("refuses a member who does not hold the right to change money", () => {
    const state = freshState()
    const haul = oneBillableHaul(state)
    const actorUserId = addMember(state, HOST_ORG, ROLE_WITHOUT_BILLING as OrganizationRole)

    storeHistoricalFee(state, haul.assignmentId)

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

    storeHistoricalFee(state, haul.assignmentId)

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
    const nonmemberUserId = addActiveUser(state, HOST_ORG)

    storeHistoricalFee(state, haul.assignmentId)

    expect(() =>
      voidPlatformFee(
        state,
        {
          actorUserId: nonmemberUserId,
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

    storeHistoricalFee(state, haul.assignmentId)

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

    storeHistoricalFee(state, first.assignmentId)
    storeHistoricalFee(state, second.assignmentId)

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
    const notifications = state.notifications.filter(
      (notification) =>
        notification.relatedEntityType === "host_invoice" &&
        notification.relatedEntityId === result.invoice.id
    )
    expect(notifications.length).toBeGreaterThan(0)
    expect(notifications.every((notification) =>
      notification.emailDeliveryState === "pending"
    )).toBe(true)
    expect(notifications[0]?.title).toMatch(/platform fee invoice ready/i)
    expect(notifications[0]?.body).toContain("$57.50")
    expect(notifications[0]?.body).toMatch(/driver pay.*never reduced/i)
  })

  it("blocks invoicing when one physical movement has duplicate active fee claims", () => {
    const state = freshState()
    const actor = { actorUserId: billingMember(state), organizationId: HOST_ORG }
    const haul = oneBillableHaul(state, 52_500)
    expect(storeHistoricalFee(state, haul.assignmentId).status).toBe("accrued")
    const fee = state.platformFeeEvents[0]!
    state.platformFeeEvents.push({ ...fee, id: randomUUID() })

    expect(() =>
      openInvoiceForPeriod(
        state,
        {
          ...actor,
          periodEnd: JUNE_PERIOD_END,
          periodStart: JUNE_PERIOD_START
        },
        BILLING_RUN
      )
    ).toThrow(/active platform-fee claims.*blocked for review/i)
    expect(state.hostInvoices).toHaveLength(0)
  })

  it("blocks invoicing when a movement has both a percentage fee and Network usage", () => {
    const state = freshState()
    const actor = { actorUserId: billingMember(state), organizationId: HOST_ORG }
    const haul = oneBillableHaul(state, 52_500)
    const assignment = state.assignments.find(
      (candidate) => candidate.id === haul.assignmentId
    )!
    expect(storeHistoricalFee(state, haul.assignmentId).status).toBe("accrued")
    const movementId = assignment.loadMovementId ?? assignment.id
    const subscriptionId = "57575757-5757-4757-8757-575757575757"
    state.networkUsageEvents.push(networkUsageEventSchema.parse({
      assignmentId: assignment.id,
      auditMetadata: {},
      billingModel: "subscription_v1",
      billingPeriodSummaryId: billingPeriodSummaryId(
        subscriptionId,
        JUNE_PERIOD_START
      ),
      capacitySource: "logloads_network",
      completionAt: JUNE_CONFIRMED,
      createdAt: JUNE_CONFIRMED,
      id: networkUsageEventId(movementId),
      invoiceId: null,
      loadMovementId: movementId,
      loadPostingId: assignment.loadPostingId,
      organizationId: HOST_ORG,
      planCode: "network_25",
      reversalAdjustmentId: null,
      status: "recorded",
      subscriptionId,
      unitCount: 1,
      updatedAt: JUNE_CONFIRMED
    }))

    expect(() =>
      openInvoiceForPeriod(
        state,
        {
          ...actor,
          periodEnd: JUNE_PERIOD_END,
          periodStart: JUNE_PERIOD_START
        },
        BILLING_RUN
      )
    ).toThrow(/both a platform fee and Network usage.*blocked for review/i)
    expect(state.hostInvoices).toHaveLength(0)
  })

  it("blocks invoicing when a stored fee is cross-wired to another host", () => {
    const state = freshState()
    const haul = oneBillableHaul(state, 52_500)
    expect(storeHistoricalFee(state, haul.assignmentId).status).toBe("accrued")
    state.platformFeeEvents[0]!.organizationId = OTHER_HOST_ORG
    const actor = {
      actorUserId: billingMember(state, OTHER_HOST_ORG),
      organizationId: OTHER_HOST_ORG
    }

    expect(() =>
      openInvoiceForPeriod(
        state,
        {
          ...actor,
          periodEnd: JUNE_PERIOD_END,
          periodStart: JUNE_PERIOD_START
        },
        BILLING_RUN
      )
    ).toThrow(/cross-wired.*invoice opening is blocked for review/i)
    expect(state.hostInvoices).toHaveLength(0)
  })

  it("bills a host once for a month however many times the run repeats", () => {
    const state = freshState()
    const actor = { actorUserId: billingMember(state), organizationId: HOST_ORG }
    const period = { periodEnd: JUNE_PERIOD_END, periodStart: JUNE_PERIOD_START }

    twoJuneHauls(state)

    const first = openInvoiceForPeriod(state, { ...actor, ...period }, BILLING_RUN)
    const notificationCountAfterFirst = state.notifications.filter(
      (notification) => notification.relatedEntityType === "host_invoice"
    ).length
    const second = openInvoiceForPeriod(state, { ...actor, ...period }, BILLING_RUN)
    const third = openInvoiceForPeriod(state, { ...actor, ...period }, MID_JULY)

    expect(first.outcome).toBe("opened")
    expect(second.outcome).toBe("already_open")
    expect(third.outcome).toBe("already_open")
    expect(state.hostInvoices).toHaveLength(1)
    expect(state.auditEvents.filter((event) => event.action === "host_invoice_opened")).toHaveLength(1)
    const invoiceNotifications = state.notifications.filter(
      (notification) => notification.relatedEntityType === "host_invoice"
    )
    expect(invoiceNotifications).toHaveLength(notificationCountAfterFirst)

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

  it("blocks only the host with an ambiguous ledger while invoicing a clean host", () => {
    const state = freshState()
    const blockedAssignment = hostAssignments(state, HOST_ORG)[0]
    const cleanAssignment = hostAssignments(state, OTHER_HOST_ORG)[0]

    if (!blockedAssignment || !cleanAssignment) {
      throw new Error("The seed needs one billable assignment for each host")
    }

    const blockedHaul = billableHaul(state, {
      assignment: blockedAssignment,
      confirmedAt: JUNE_CONFIRMED,
      driverPayCents: 52_500
    })
    const cleanHaul = billableHaul(state, {
      assignment: cleanAssignment,
      confirmedAt: JUNE_CONFIRMED,
      driverPayCents: 62_500
    })
    const blockedFee = { event: storeHistoricalFee(state, blockedHaul.assignmentId), outcome: "accrued" as const }
    const cleanFee = { event: storeHistoricalFee(state, cleanHaul.assignmentId), outcome: "accrued" as const }

    state.platformFeeEvents = state.platformFeeEvents.map((event) =>
      event.id === blockedFee.event.id
        ? { ...event, driverPayCents: event.driverPayCents + 1 }
        : event
    )

    const results = openAllClosedPeriodInvoices(state, BILLING_RUN)

    expect(results).toEqual([
      expect.objectContaining({
        organizationId: HOST_ORG,
        outcome: "blocked_for_review",
        reason: expect.stringMatching(/frozen terms.*blocked for review/i)
      }),
      expect.objectContaining({
        invoice: expect.objectContaining({ organizationId: OTHER_HOST_ORG }),
        outcome: "opened"
      })
    ])
    expect(
      state.hostInvoices.filter((invoice) => invoice.organizationId === HOST_ORG)
    ).toHaveLength(0)
    expect(
      state.hostInvoices.filter(
        (invoice) => invoice.organizationId === OTHER_HOST_ORG
      )
    ).toHaveLength(1)
    expect(
      state.platformFeeEvents.find((event) => event.id === blockedFee.event.id)
    ).toMatchObject({ invoiceId: null, status: "accrued" })
    expect(
      state.platformFeeEvents.find((event) => event.id === cleanFee.event.id)
    ).toMatchObject({ status: "invoiced" })
  })

  it("materializes every missed closed month before collecting the open backlog", () => {
    const state = freshState()

    twoJuneHauls(state)

    const june = state.platformFeeEvents[0]

    if (!june) {
      throw new Error("The fixture did not accrue a June fee")
    }
    const template = state.assignments.find(
      (assignment) => assignment.id === june.assignmentId
    )
    if (!template) {
      throw new Error("The June fee no longer resolves to its assignment")
    }
    const mayAssignment = mintAssignmentLike(state, template)
    const julyAssignment = mintAssignmentLike(state, template)

    state.platformFeeEvents.push({
      ...june,
      assignmentId: mayAssignment.id,
      createdAt: MAY_CONFIRMED,
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa81",
      invoiceId: null,
      loadMovementId: mayAssignment.loadMovementId ?? mayAssignment.id,
      occurredAt: MAY_CONFIRMED,
      status: "accrued",
      updatedAt: MAY_CONFIRMED
    })
    state.platformFeeEvents.push({
      ...june,
      assignmentId: julyAssignment.id,
      createdAt: JULY_CONFIRMED,
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa82",
      invoiceId: null,
      loadMovementId: julyAssignment.loadMovementId ?? julyAssignment.id,
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

  it("opens one deterministic supplemental bill for a fee repaired after monthly close", () => {
    const state = freshState()
    const { second } = twoJuneHauls(state)
    const lateFee = state.platformFeeEvents.find(
      (event) => event.assignmentId === second.assignmentId
    )

    if (!lateFee) {
      throw new Error("The fixture did not accrue the fee that will be repaired late")
    }

    // The first close cannot see the missing fee. Binding its resulting bill to a
    // provider invoice proves recovery does not rewrite an amount Stripe may
    // already have finalized.
    state.platformFeeEvents = state.platformFeeEvents.filter(
      (event) => event.id !== lateFee.id
    )
    const first = openClosedPeriodInvoices(
      state,
      { periodEnd: JUNE_PERIOD_END, periodStart: JUNE_PERIOD_START },
      BILLING_RUN
    )

    expect(first).toHaveLength(1)
    expect(first[0]?.outcome).toBe("opened")
    const primary = state.hostInvoices[0]

    if (!primary) {
      throw new Error("The first monthly close did not open its primary bill")
    }

    state.hostInvoices[0] = {
      ...primary,
      stripeInvoiceId: "in_primary_already_finalized"
    }
    state.platformFeeEvents.push(lateFee)

    const recovered = openAllClosedPeriodInvoices(state, MID_JULY)
    const supplemental = state.hostInvoices.find(
      (invoice) => invoice.id !== primary.id
    )

    expect(recovered).toHaveLength(1)
    expect(recovered[0]?.outcome).toBe("opened")
    expect(state.hostInvoices).toHaveLength(2)
    expect(state.hostInvoices.find((invoice) => invoice.id === primary.id)).toMatchObject({
      feeEventIds: primary.feeEventIds,
      stripeInvoiceId: "in_primary_already_finalized",
      subtotalCents: primary.subtotalCents
    })
    expect(supplemental).toMatchObject({
      feeEventIds: [lateFee.id],
      organizationId: HOST_ORG,
      periodEnd: JUNE_PERIOD_END,
      periodStart: JUNE_PERIOD_START,
      status: "open",
      stripeInvoiceId: null,
      subtotalCents: lateFee.feeCents
    })
    expect(
      state.platformFeeEvents.find((event) => event.id === lateFee.id)
    ).toMatchObject({
      invoiceId: supplemental?.id,
      status: "invoiced"
    })

    const repeated = openAllClosedPeriodInvoices(state, MID_JULY)

    expect(repeated).toEqual([])
    expect(state.hostInvoices).toHaveLength(2)
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

    storeHistoricalFee(state, may.assignmentId)

    const june = billableHaul(state, {
      assignment: assignments[1] as Assignment,
      confirmedAt: JUNE_CONFIRMED,
      driverPayCents: 52_500
    })

    storeHistoricalFee(state, june.assignmentId)

    const july = billableHaul(state, {
      assignment: mintAssignmentLike(state, assignments[0] as Assignment),
      confirmedAt: JULY_CONFIRMED,
      driverPayCents: 20_000
    })

    storeHistoricalFee(state, july.assignmentId)

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

    storeHistoricalFee(state, ours.assignmentId)
    storeHistoricalFee(state, theirs.assignmentId)

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

    storeHistoricalFee(state, haul.assignmentId)

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

    storeHistoricalFee(state, haul.assignmentId)

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

    storeHistoricalFee(state, haul.assignmentId)

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

    storeHistoricalFee(state, haul.assignmentId)
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

    storeHistoricalFee(state, may.assignmentId)
    storeHistoricalFee(state, june.assignmentId)
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
    const nonmemberUserId = addActiveUser(state, HOST_ORG)

    storeHistoricalFee(state, haul.assignmentId)

    expect(() =>
      hostFeeSummary(state, { actorUserId: nonmemberUserId, organizationId: HOST_ORG }, MID_JULY)
    ).toThrow(/not an active member/)
  })

  it("is readable by a member who holds no billing right", () => {
    // Reading your own organization's fees is membership, not a money change. A
    // dispatcher has to be able to see what a completed load will cost the host.
    const state = freshState()
    const actorUserId = addMember(state, HOST_ORG, ROLE_WITHOUT_BILLING as OrganizationRole)
    const haul = oneBillableHaul(state, 52_500)

    storeHistoricalFee(state, haul.assignmentId)

    expect(hostFeeSummary(state, { actorUserId, organizationId: HOST_ORG }, MID_JULY).accruedCents).toBe(
      2_625
    )
  })
})
