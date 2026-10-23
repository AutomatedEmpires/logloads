import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import {
  computePlatformFeeCents,
  hostInvoiceSchema,
  platformFeeEventSchema,
  PLATFORM_FEE_BPS
} from "@logloads/contracts"
import { createInMemoryDatabase } from "@logloads/db"

import {
  adminNoticeState,
  buildAdminBillingSnapshot,
  buildAdminCompletionExceptions,
  buildAdminContactInquiries,
  buildAdminFeeExceptions
} from "./admin-data"

const NOW = "2026-08-08T18:00:00.000Z"
const HOST_ACTOR = "a2222222-2222-4222-8222-222222222223"
const DRIVER_ACTOR = "b2222222-2222-4222-8222-222222222222"

function completedTripFixture() {
  const state = createInMemoryDatabase()
  const trip = state.tripsV2.find((candidate) => candidate.status === "completed")

  if (!trip) {
    throw new Error("Seed must contain a completed trip")
  }

  const assignment = state.assignments.find((candidate) => candidate.id === trip.assignmentId)
  const load = state.loadPostings.find((candidate) => candidate.id === trip.loadPostingId)
  const driver = state.driverProfiles.find((candidate) => candidate.id === trip.driverProfileId)

  if (!assignment || !load || !driver) {
    throw new Error("Completed seed trip must resolve its assignment, load, and driver")
  }

  state.tripsV2 = [trip]
  state.assignments = [assignment]
  state.loadPostings = [load]
  state.driverProfiles = [driver]
  state.organizations = state.organizations.filter((candidate) => candidate.id === load.companyId)
  state.profiles = state.profiles.filter((candidate) => candidate.id === driver.userId)

  trip.status = "completed"
  trip.updatedAt = NOW
  assignment.status = "completed"
  assignment.termsSnapshot = { currency: "USD", driverPayCents: 52_500 }
  assignment.driverPaymentSentAt = null
  assignment.driverPaymentSentByUserId = null
  assignment.driverPaymentReceivedAt = null
  assignment.driverPaymentReceivedByUserId = null
  assignment.driverPaymentReceivedAmountCents = null
  assignment.driverPaymentReceivedCurrency = null

  return { assignment, load, state, trip }
}

describe("admin completion and payment exception projection", () => {
  it("projects unsettled completion decisions and ignores cancellation history", () => {
    const fixture = completedTripFixture()

    fixture.trip.completionStatus = "disputed"
    fixture.trip.completionDisputeReason = "Scale ticket does not match the delivered figure."
    fixture.state.assignments.push({
      ...fixture.assignment,
      id: "ffffffff-ffff-4fff-8fff-ffffffff00ff",
      status: "cancelled",
      cancelledAt: NOW,
      cancellationReason: "Weather closure"
    })

    expect(buildAdminCompletionExceptions(fixture.state)).toEqual([
      expect.objectContaining({
        detail: "Scale ticket does not match the delivered figure.",
        kind: "completion_disputed",
        statusLabel: "Completion disputed",
        tone: "critical"
      })
    ])

    fixture.trip.completionStatus = "submitted"
    expect(buildAdminCompletionExceptions(fixture.state)[0]?.kind).toBe("completion_review")

    fixture.trip.completionStatus = "pending"
    expect(buildAdminCompletionExceptions(fixture.state)[0]?.kind).toBe("completion_missing")
  })

  it("orders contested and missing completion truth ahead of routine receipt follow-up", () => {
    const state = createInMemoryDatabase()
    const trips = state.tripsV2.filter((trip) => trip.status === "completed").slice(0, 3)

    if (trips.length !== 3) {
      throw new Error("Seed must contain three completed trips")
    }

    state.tripsV2 = trips
    state.assignments = state.assignments.filter((assignment) =>
      trips.some((trip) => trip.assignmentId === assignment.id)
    )
    trips[0]!.completionStatus = "submitted"
    trips[1]!.completionStatus = "disputed"
    trips[1]!.completionDisputeReason = "Delivered quantity is contested."
    trips[2]!.completionStatus = "confirmed"
    const thirdAssignment = state.assignments.find((assignment) => assignment.id === trips[2]!.assignmentId)

    if (!thirdAssignment) {
      throw new Error("Third completed trip must resolve its assignment")
    }

    thirdAssignment.termsSnapshot = { currency: "USD", driverPayCents: 52_500 }
    thirdAssignment.driverPaymentSentAt = null
    thirdAssignment.driverPaymentSentByUserId = null

    expect(buildAdminCompletionExceptions(state).map((row) => row.kind)).toEqual([
      "completion_disputed",
      "completion_review",
      "payment_not_sent"
    ])
  })

  it("uses frozen accepted driver pay instead of mutable posting pay", () => {
    const fixture = completedTripFixture()

    fixture.trip.completionStatus = "confirmed"
    fixture.load.driverPayCents = 99_999
    fixture.assignment.driverPaymentSentAt = NOW
    fixture.assignment.driverPaymentSentByUserId = HOST_ACTOR
    fixture.assignment.driverPaymentReceivedAt = NOW
    fixture.assignment.driverPaymentReceivedByUserId = DRIVER_ACTOR
    fixture.assignment.driverPaymentReceivedAmountCents = 52_500
    fixture.assignment.driverPaymentReceivedCurrency = "USD"

    expect(buildAdminCompletionExceptions(fixture.state)).toEqual([])

    fixture.assignment.driverPaymentReceivedAmountCents = 51_000
    expect(buildAdminCompletionExceptions(fixture.state)).toEqual([
      expect.objectContaining({
        kind: "payment_amount_mismatch",
        statusLabel: "Payment amount differs"
      })
    ])
  })

  it("keeps each side of the direct payment receipt distinct", () => {
    const fixture = completedTripFixture()

    fixture.trip.completionStatus = "confirmed"
    expect(buildAdminCompletionExceptions(fixture.state)[0]?.kind).toBe("payment_not_sent")

    fixture.assignment.driverPaymentSentAt = NOW
    fixture.assignment.driverPaymentSentByUserId = HOST_ACTOR
    expect(buildAdminCompletionExceptions(fixture.state)[0]?.kind).toBe("payment_receipt_pending")
  })

  it("titles, sorts, and timestamps pending receipts by the host sent marker", () => {
    const fixture = completedTripFixture()
    const olderSentAt = "2026-08-09T16:00:00.000Z"
    const newerSentAt = "2026-08-10T16:00:00.000Z"

    fixture.trip.completionStatus = "confirmed"
    fixture.trip.updatedAt = "2026-08-12T16:00:00.000Z"
    fixture.load.title = "Older payment marker"
    fixture.assignment.updatedAt = "2026-08-12T16:00:00.000Z"
    fixture.assignment.driverPaymentSentAt = olderSentAt
    fixture.assignment.driverPaymentSentByUserId = HOST_ACTOR

    const newerLoad = {
      ...fixture.load,
      id: "c2222222-2222-4222-8222-222222222221",
      title: "Newest payment marker"
    }
    const newerAssignment = {
      ...fixture.assignment,
      id: "c2222222-2222-4222-8222-222222222222",
      loadPostingId: newerLoad.id,
      updatedAt: "2026-08-07T16:00:00.000Z",
      driverPaymentSentAt: newerSentAt
    }
    const newerTrip = {
      ...fixture.trip,
      assignmentId: newerAssignment.id,
      id: "c2222222-2222-4222-8222-222222222223",
      loadPostingId: newerLoad.id,
      updatedAt: "2026-08-07T16:00:00.000Z"
    }

    fixture.state.loadPostings.push(newerLoad)
    fixture.state.assignments.push(newerAssignment)
    fixture.state.tripsV2.push(newerTrip)

    expect(buildAdminCompletionExceptions(fixture.state).map((row) => ({
      kind: row.kind,
      loadTitle: row.loadTitle,
      whenLabel: row.whenLabel
    }))).toEqual([
      {
        kind: "payment_receipt_pending",
        loadTitle: "Newest payment marker",
        whenLabel: "Aug 10, 4:00 PM UTC"
      },
      {
        kind: "payment_receipt_pending",
        loadTitle: "Older payment marker",
        whenLabel: "Aug 9, 4:00 PM UTC"
      }
    ])
  })

  it("titles, sorts, and timestamps payment mismatches by the driver received marker", () => {
    const fixture = completedTripFixture()
    const olderReceivedAt = "2026-08-09T17:00:00.000Z"
    const newerReceivedAt = "2026-08-10T17:00:00.000Z"

    fixture.trip.completionStatus = "confirmed"
    fixture.trip.updatedAt = "2026-08-12T17:00:00.000Z"
    fixture.load.title = "Older receipt marker"
    fixture.assignment.updatedAt = "2026-08-12T17:00:00.000Z"
    fixture.assignment.driverPaymentSentAt = "2026-08-08T17:00:00.000Z"
    fixture.assignment.driverPaymentSentByUserId = HOST_ACTOR
    fixture.assignment.driverPaymentReceivedAt = olderReceivedAt
    fixture.assignment.driverPaymentReceivedByUserId = DRIVER_ACTOR
    fixture.assignment.driverPaymentReceivedAmountCents = 51_000
    fixture.assignment.driverPaymentReceivedCurrency = "USD"

    const newerLoad = {
      ...fixture.load,
      id: "d2222222-2222-4222-8222-222222222221",
      title: "Newest receipt marker"
    }
    const newerAssignment = {
      ...fixture.assignment,
      id: "d2222222-2222-4222-8222-222222222222",
      loadPostingId: newerLoad.id,
      updatedAt: "2026-08-07T17:00:00.000Z",
      driverPaymentReceivedAt: newerReceivedAt
    }
    const newerTrip = {
      ...fixture.trip,
      assignmentId: newerAssignment.id,
      id: "d2222222-2222-4222-8222-222222222223",
      loadPostingId: newerLoad.id,
      updatedAt: "2026-08-07T17:00:00.000Z"
    }

    fixture.state.loadPostings.push(newerLoad)
    fixture.state.assignments.push(newerAssignment)
    fixture.state.tripsV2.push(newerTrip)

    expect(buildAdminCompletionExceptions(fixture.state).map((row) => ({
      kind: row.kind,
      loadTitle: row.loadTitle,
      whenLabel: row.whenLabel
    }))).toEqual([
      {
        kind: "payment_amount_mismatch",
        loadTitle: "Newest receipt marker",
        whenLabel: "Aug 10, 5:00 PM UTC"
      },
      {
        kind: "payment_amount_mismatch",
        loadTitle: "Older receipt marker",
        whenLabel: "Aug 9, 5:00 PM UTC"
      }
    ])
  })

  it("keeps a confirmed trip open when its frozen payment terms are missing", () => {
    const fixture = completedTripFixture()

    fixture.trip.completionStatus = "confirmed"
    fixture.assignment.termsSnapshot = {}
    fixture.assignment.driverPaymentSentAt = NOW
    fixture.assignment.driverPaymentSentByUserId = HOST_ACTOR
    fixture.assignment.driverPaymentReceivedAt = NOW
    fixture.assignment.driverPaymentReceivedByUserId = DRIVER_ACTOR

    expect(buildAdminCompletionExceptions(fixture.state)).toEqual([
      expect.objectContaining({
        kind: "payment_record_missing",
        statusLabel: "Frozen payment terms missing",
        tone: "critical"
      })
    ])
  })
})

describe("admin notice state", () => {
  it("does not call a future notice active or resolvable", () => {
    const now = Date.parse(NOW)

    expect(adminNoticeState("2026-08-09T18:00:00.000Z", null, now)).toBe("scheduled")
    expect(adminNoticeState(NOW, null, now)).toBe("active")
    expect(
      adminNoticeState("2026-08-07T17:00:00.000Z", NOW, now)
    ).toBe("ended")
  })
})

describe("admin-only contact inquiry archive", () => {
  it("keeps only inquiries visible to the active platform administrator", () => {
    const state = createInMemoryDatabase()
    const base = state.notifications[0]

    if (!base) {
      throw new Error("Seed must contain a notification")
    }

    const mine = {
      ...base,
      body: "From: Avery Woods <avery@example.com>\n\nInterested in host onboarding.",
      id: "12121212-1212-4212-8212-1212121212a1",
      readAt: null,
      relatedEntityType: "contact_inquiry",
      title: "Contact inquiry from Avery Woods",
      userId: HOST_ACTOR
    }
    const someoneElses = {
      ...mine,
      id: "12121212-1212-4212-8212-1212121212a2",
      userId: DRIVER_ACTOR
    }

    expect(
      buildAdminContactInquiries(
        { notifications: [someoneElses, mine] },
        { isPlatformAdmin: true, profileId: HOST_ACTOR }
      )
    ).toEqual([
      expect.objectContaining({
        body: expect.stringContaining("avery@example.com"),
        id: mine.id,
        read: false
      })
    ])
    expect(
      buildAdminContactInquiries(
        { notifications: [mine] },
        { isPlatformAdmin: false, profileId: HOST_ACTOR }
      )
    ).toEqual([])
  })
})

describe("host fee attention", () => {
  function feeFixture(invoiceStatus: "open" | "paid" | "uncollectible", driverPayCents = 52_500) {
    const state = createInMemoryDatabase()
    const organization = state.organizations.find((candidate) => candidate.type === "landing_source")
    const assignment = state.assignments[0]
    const load = assignment
      ? state.loadPostings.find((candidate) => candidate.id === assignment.loadPostingId)
      : undefined

    if (!organization || !assignment || !load) {
      throw new Error("Seed must contain a host, assignment, and load")
    }

    const invoiceId = "70000000-0000-4000-8000-000000000011"
    const event = platformFeeEventSchema.parse({
      assignmentId: assignment.id,
      createdAt: NOW,
      driverPayCents,
      feeBps: PLATFORM_FEE_BPS,
      feeCents: computePlatformFeeCents(driverPayCents, PLATFORM_FEE_BPS),
      id: "60000000-0000-4000-8000-000000000011",
      invoiceId,
      loadMovementId: assignment.loadMovementId ?? assignment.id,
      loadPostingId: load.id,
      occurredAt: NOW,
      organizationId: organization.id,
      status: "invoiced",
      truckSlotId: assignment.truckSlotId,
      updatedAt: NOW,
      voidReason: null
    })
    const invoice = hostInvoiceSchema.parse({
      createdAt: NOW,
      feeEventIds: [event.id],
      id: invoiceId,
      issuedAt: NOW,
      organizationId: organization.id,
      paidAt: invoiceStatus === "paid" ? NOW : null,
      periodEnd: "2026-09-01T00:00:00.000Z",
      periodStart: "2026-08-01T00:00:00.000Z",
      status: invoiceStatus,
      stripeInvoiceId: invoiceStatus === "paid" ? "in_test_current" : null,
      subtotalCents: event.feeCents,
      updatedAt: NOW,
      voidedAt: null
    })

    return { event, invoice, organization, state }
  }

  it("treats normal open monthly-arrears state as clear and uncollectible as an exception", () => {
    const open = feeFixture("open")

    expect(open.invoice.subtotalCents).toBe(1_050)
    expect(buildAdminFeeExceptions({
      hostInvoices: [open.invoice],
      organizations: [open.organization],
      platformFeeEvents: [open.event]
    })).toEqual([])

    const accrued = platformFeeEventSchema.parse({
      ...open.event,
      invoiceId: null,
      status: "accrued"
    })
    expect(buildAdminFeeExceptions({
      hostInvoices: [],
      organizations: [open.organization],
      platformFeeEvents: [accrued]
    })).toEqual([])

    const failed = feeFixture("uncollectible")
    expect(buildAdminFeeExceptions({
      hostInvoices: [failed.invoice],
      organizations: [failed.organization],
      platformFeeEvents: [failed.event]
    })).toEqual([
      expect.objectContaining({
        severity: "critical",
        title: "Host invoice is uncollectible"
      })
    ])
  })

  it("warns about an open bill below Stripe's card minimum, and not about one at the minimum", () => {
    // $20.00 of driver pay is a 40 cent fee.
    const small = feeFixture("open", 2_000)

    expect(small.invoice.subtotalCents).toBe(40)
    expect(buildAdminFeeExceptions({
      hostInvoices: [small.invoice],
      organizations: [small.organization],
      platformFeeEvents: [small.event]
    })).toEqual([
      expect.objectContaining({
        detail: expect.stringContaining("$0.50 minimum card charge"),
        id: `invoice:${small.invoice.id}:below-card-minimum`,
        severity: "warning",
        title: "Invoice is below the card minimum"
      })
    ])

    // Negative control: $25.00 of driver pay is a 50 cent fee, which Stripe accepts.
    const minimum = feeFixture("open", 2_500)

    expect(minimum.invoice.subtotalCents).toBe(50)
    expect(buildAdminFeeExceptions({
      hostInvoices: [minimum.invoice],
      organizations: [minimum.organization],
      platformFeeEvents: [minimum.event]
    })).toEqual([])
  })

  it("flags missing, foreign, unfrozen, and arithmetically wrong invoice lines", () => {
    const fixture = feeFixture("open")
    const otherOrganization = fixture.state.organizations.find(
      (candidate) => candidate.id !== fixture.organization.id
    )

    if (!otherOrganization) {
      throw new Error("Seed must contain a second operating organization")
    }

    const foreignLine = platformFeeEventSchema.parse({
      ...fixture.event,
      id: "60000000-0000-4000-8000-000000000012",
      invoiceId: null,
      organizationId: otherOrganization.id,
      status: "accrued"
    })
    const corruptInvoice = hostInvoiceSchema.parse({
      ...fixture.invoice,
      feeEventIds: [
        fixture.event.id,
        foreignLine.id,
        "60000000-0000-4000-8000-000000000013"
      ],
      subtotalCents: 1
    })
    const titles = buildAdminFeeExceptions({
      hostInvoices: [corruptInvoice],
      organizations: [fixture.organization, otherOrganization],
      platformFeeEvents: [fixture.event, foreignLine]
    }).map((exception) => exception.title)

    expect(titles).toEqual(expect.arrayContaining([
      "Invoice has missing fee lines",
      "Invoice crosses organizations",
      "Invoice has unfrozen fee lines",
      "Invoice subtotal disagrees"
    ]))
    // A one-cent subtotal is wrong arithmetic, not a small bill.
    expect(titles).not.toContain("Invoice is below the card minimum")
  })

  it("detects an invoice that points at an accrued fee without a reverse link", () => {
    const fixture = feeFixture("open")
    const accrued = platformFeeEventSchema.parse({
      ...fixture.event,
      invoiceId: null,
      status: "accrued"
    })
    const oneWayInvoice = hostInvoiceSchema.parse({
      ...fixture.invoice,
      feeEventIds: [accrued.id],
      subtotalCents: accrued.feeCents
    })

    expect(buildAdminFeeExceptions({
      hostInvoices: [oneWayInvoice],
      organizations: [fixture.organization],
      platformFeeEvents: [accrued]
    })).toEqual([
      expect.objectContaining({
        severity: "critical",
        title: "Invoice has unfrozen fee lines"
      })
    ])

    fixture.state.platformFeeEvents = [accrued]
    fixture.state.hostInvoices = [oneWayInvoice]

    const snapshot = buildAdminBillingSnapshot(fixture.state)

    expect(snapshot.invoiceCount).toBe(1)
    expect(snapshot.exceptions.map((exception) => exception.title)).toEqual([
      "Invoice has unfrozen fee lines"
    ])
  })
})
