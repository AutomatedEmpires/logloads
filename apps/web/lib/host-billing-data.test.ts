import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import {
  computePlatformFeeCents,
  hostBillingProfileSchema,
  hostInvoiceSchema,
  invoicePeriodFor,
  PLATFORM_FEE_BPS,
  platformFeeEventId,
  platformFeeEventSchema,
  type HostBillingProfile,
  type HostInvoice,
  type PlatformFeeEvent
} from "@logloads/contracts"

import {
  buildHostBillingView,
  COVERED_BILLING_STATUSES,
  feeRateLabel,
  getHostBillingView,
  INVOICE_STATE_PRESENTATION,
  PAYMENT_STATE_PRESENTATION,
  type HostBillingSource
} from "./host-billing-data"

/**
 * The read model is tested against a KNOWN ledger, not against the seeded bench.
 * The shipped fee ledger is empty on purpose — no host has ever been charged — so
 * a test that read the bench could only ever assert that nothing has happened.
 *
 * Every fixture is parsed through the row contract it would be stored under, so a
 * fixture that could not survive a read of the operating state cannot be used to
 * prove anything about what a host sees.
 */

const HOST = "33333333-3333-4333-8333-333333333331"
const OTHER_HOST = "33333333-3333-4333-8333-333333333339"
const LOAD_ONE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01"
const LOAD_TWO = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02"
const SLOT = "cccccccc-cccc-4ccc-8ccc-cccccccccc01"

/** Mid-month, so a period boundary never lands on the instant under test. */
const NOW = "2026-07-15T12:00:00.000Z"
const PERIOD = invoicePeriodFor(NOW)

interface FeeFixture {
  assignmentId: string
  driverPayCents: number
  occurredAt?: string
  feeBps?: number
  invoiceId?: string
  loadPostingId?: string
  organizationId?: string
  status?: PlatformFeeEvent["status"]
  voidReason?: string
}

function feeEvent(fixture: FeeFixture): PlatformFeeEvent {
  const feeBps = fixture.feeBps ?? PLATFORM_FEE_BPS
  const occurredAt = fixture.occurredAt ?? "2026-07-04T15:00:00.000Z"

  return platformFeeEventSchema.parse({
    assignmentId: fixture.assignmentId,
    createdAt: occurredAt,
    driverPayCents: fixture.driverPayCents,
    feeBps,
    // Computed, never typed: a fixture with a hand-written fee would be rejected
    // by the row contract, which is the point of parsing it here.
    feeCents: computePlatformFeeCents(fixture.driverPayCents, feeBps),
    id: platformFeeEventId(fixture.assignmentId),
    invoiceId: fixture.invoiceId ?? null,
    loadPostingId: fixture.loadPostingId ?? LOAD_ONE,
    occurredAt,
    organizationId: fixture.organizationId ?? HOST,
    status: fixture.status ?? "accrued",
    truckSlotId: SLOT,
    updatedAt: occurredAt,
    voidReason: fixture.voidReason ?? null
  })
}

function billingProfile(overrides: Partial<HostBillingProfile> = {}): HostBillingProfile {
  return hostBillingProfileSchema.parse({
    attachedAt: "2026-06-01T00:00:00.000Z",
    createdAt: "2026-06-01T00:00:00.000Z",
    defaultPaymentMethodId: "pm_test_host",
    id: "34343434-3434-4434-8434-3434343434f1",
    lastFailureAt: null,
    lastFailureReason: null,
    organizationId: HOST,
    paymentMethodBrand: "visa",
    paymentMethodLast4: "4242",
    status: "attached",
    stripeCustomerId: "cus_test_host",
    updatedAt: "2026-06-01T00:00:00.000Z",
    ...overrides
  })
}

function invoice(overrides: Partial<HostInvoice> = {}): HostInvoice {
  return hostInvoiceSchema.parse({
    createdAt: "2026-07-01T00:00:00.000Z",
    feeEventIds: [],
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb01",
    issuedAt: "2026-07-01T00:00:00.000Z",
    organizationId: HOST,
    paidAt: "2026-07-02T00:00:00.000Z",
    periodEnd: "2026-07-01T00:00:00.000Z",
    periodStart: "2026-06-01T00:00:00.000Z",
    status: "paid",
    stripeInvoiceId: "in_test_june",
    subtotalCents: 0,
    updatedAt: "2026-07-02T00:00:00.000Z",
    ...overrides
  })
}

function source(overrides: Partial<HostBillingSource> = {}): HostBillingSource {
  return {
    hostBillingProfiles: [billingProfile()],
    hostInvoices: [],
    loadPostings: [
      { id: LOAD_ONE, title: "Doug fir sawlogs — Ridge 4" },
      { id: LOAD_TWO, title: "Pulpwood — Beaver Creek" }
    ],
    platformFeeEvents: [],
    ...overrides
  }
}

describe("accrued fees, itemised by load", () => {
  it("totals a month of completed truckloads and shows all three figures on every line", () => {
    const view = buildHostBillingView(
      source({
        platformFeeEvents: [
          feeEvent({ assignmentId: "dddddddd-dddd-4ddd-8ddd-dddddddddd01", driverPayCents: 52_500 }),
          feeEvent({
            assignmentId: "dddddddd-dddd-4ddd-8ddd-dddddddddd02",
            driverPayCents: 99_999,
            loadPostingId: LOAD_TWO,
            occurredAt: "2026-07-09T18:30:00.000Z"
          })
        ]
      }),
      HOST,
      NOW
    )

    expect(view.currentPeriod.periodLabel).toBe("July 2026")
    expect(view.currentPeriod.lines).toHaveLength(2)

    // Oldest first: a statement a host reconciles against work reads forward.
    const [first, second] = view.currentPeriod.lines
    expect(first?.loadTitle).toBe("Doug fir sawlogs — Ridge 4")
    expect(first?.completedOnLabel).toBe("Jul 4, 2026")
    expect(first?.driverPayLabel).toBe("$525.00")
    expect(first?.platformFeeLabel).toBe("$26.25")
    expect(first?.hostTotalLabel).toBe("$551.25")
    expect(first?.rateLabel).toBe("5%")

    // 5% of $999.99 is 4999.95 hundredths of a cent and bills as $50.00.
    expect(second?.loadTitle).toBe("Pulpwood — Beaver Creek")
    expect(second?.driverPayLabel).toBe("$999.99")
    expect(second?.platformFeeLabel).toBe("$50.00")
    expect(second?.hostTotalLabel).toBe("$1,049.99")

    // $26.25 + $50.00 in fees, on top of $1,524.99 the host owes its drivers.
    expect(view.currentPeriod.totals).toMatchObject({
      driverPayCents: 152_499,
      hostTotalCents: 160_124,
      platformFeeCents: 7_625,
      truckloadCount: 2
    })
    expect(view.currentPeriod.totals.platformFeeLabel).toBe("$76.25")
    expect(view.currentPeriod.totals.driverPayLabel).toBe("$1,524.99")
    expect(view.currentPeriod.totals.hostTotalLabel).toBe("$1,601.24")
    expect(view.hasBillingHistory).toBe(true)
  })

  it("never reduces driver pay by the fee — the total is pay PLUS fee on every line", () => {
    const view = buildHostBillingView(
      source({
        platformFeeEvents: [
          feeEvent({ assignmentId: "dddddddd-dddd-4ddd-8ddd-dddddddddd01", driverPayCents: 52_500 }),
          feeEvent({
            assignmentId: "dddddddd-dddd-4ddd-8ddd-dddddddddd02",
            driverPayCents: 41_000,
            occurredAt: "2026-07-06T15:00:00.000Z"
          })
        ]
      }),
      HOST,
      NOW
    )

    for (const line of view.currentPeriod.lines) {
      expect(line.hostTotalCents).toBe(line.driverPayCents + line.platformFeeCents)
      expect(line.hostTotalCents).toBeGreaterThan(line.driverPayCents)
    }

    // The stated pay survives untouched: $525 stated is $525 shown, not $498.75.
    expect(view.currentPeriod.lines.map((line) => line.driverPayCents)).toEqual([52_500, 41_000])
    expect(view.currentPeriod.totals.hostTotalCents).toBe(
      view.currentPeriod.totals.driverPayCents + view.currentPeriod.totals.platformFeeCents
    )
  })

  it("sums the frozen per-load fees instead of re-rating the month's pay total", () => {
    // Two loads at $10.10 each. Each fee rounds half-up to 51c, so the month is
    // 102c. Re-rating the $20.20 aggregate gives exactly 101c — a total a cent
    // short of the two lines printed directly beneath it.
    const view = buildHostBillingView(
      source({
        platformFeeEvents: [
          feeEvent({ assignmentId: "dddddddd-dddd-4ddd-8ddd-dddddddddd01", driverPayCents: 1_010 }),
          feeEvent({
            assignmentId: "dddddddd-dddd-4ddd-8ddd-dddddddddd02",
            driverPayCents: 1_010,
            occurredAt: "2026-07-07T15:00:00.000Z"
          })
        ]
      }),
      HOST,
      NOW
    )

    expect(view.currentPeriod.totals.platformFeeCents).toBe(102)
    expect(computePlatformFeeCents(2_020, PLATFORM_FEE_BPS)).toBe(101)
    expect(view.currentPeriod.totals.platformFeeCents).not.toBe(
      computePlatformFeeCents(2_020, PLATFORM_FEE_BPS)
    )
    expect(
      view.currentPeriod.lines.reduce((sum, line) => sum + line.platformFeeCents, 0)
    ).toBe(view.currentPeriod.totals.platformFeeCents)
  })

  it("charges a historical load at the rate frozen on it, not at today's rate", () => {
    const view = buildHostBillingView(
      source({
        platformFeeEvents: [
          feeEvent({
            assignmentId: "dddddddd-dddd-4ddd-8ddd-dddddddddd01",
            driverPayCents: 100_000,
            feeBps: 300
          })
        ]
      }),
      HOST,
      NOW
    )

    expect(view.currentPeriod.lines[0]?.rateLabel).toBe("3%")
    expect(view.currentPeriod.lines[0]?.platformFeeCents).toBe(3_000)
    // The current rate would have billed $50.00 for the same haul.
    expect(computePlatformFeeCents(100_000, PLATFORM_FEE_BPS)).toBe(5_000)
  })

  it("still shows a charge whose load posting is gone", () => {
    const view = buildHostBillingView(
      source({
        loadPostings: [],
        platformFeeEvents: [
          feeEvent({ assignmentId: "dddddddd-dddd-4ddd-8ddd-dddddddddd01", driverPayCents: 52_500 })
        ]
      }),
      HOST,
      NOW
    )

    expect(view.currentPeriod.lines).toHaveLength(1)
    expect(view.currentPeriod.lines[0]?.loadTitle).toBe("Load no longer on this workspace")
    expect(view.currentPeriod.totals.platformFeeCents).toBe(2_625)
  })

  it("counts only the fees that fall inside the month being shown", () => {
    const view = buildHostBillingView(
      source({
        platformFeeEvents: [
          feeEvent({
            assignmentId: "dddddddd-dddd-4ddd-8ddd-dddddddddd01",
            driverPayCents: 10_000,
            occurredAt: PERIOD.periodStart
          }),
          feeEvent({
            assignmentId: "dddddddd-dddd-4ddd-8ddd-dddddddddd02",
            driverPayCents: 20_000,
            occurredAt: new Date(Date.parse(PERIOD.periodStart) - 1).toISOString()
          }),
          feeEvent({
            assignmentId: "dddddddd-dddd-4ddd-8ddd-dddddddddd03",
            driverPayCents: 40_000,
            occurredAt: PERIOD.periodEnd
          })
        ]
      }),
      HOST,
      NOW
    )

    // Half-open: the first instant of the month is in, the first instant of the
    // next month is not, so consecutive bills neither overlap nor drop a load.
    expect(view.currentPeriod.totals.truckloadCount).toBe(1)
    expect(view.currentPeriod.totals.driverPayCents).toBe(10_000)
    // The two out-of-period fees are still this host's history.
    expect(view.hasBillingHistory).toBe(true)
  })
})

describe("withdrawn fees", () => {
  const withdrawn = feeEvent({
    assignmentId: "dddddddd-dddd-4ddd-8ddd-dddddddddd02",
    driverPayCents: 80_000,
    occurredAt: "2026-07-08T15:00:00.000Z",
    status: "voided",
    voidReason: "Load was never hauled; slot released"
  })
  const kept = feeEvent({ assignmentId: "dddddddd-dddd-4ddd-8ddd-dddddddddd01", driverPayCents: 52_500 })

  it("charges nothing for a voided fee and keeps it out of the itemisation", () => {
    const view = buildHostBillingView(
      source({ platformFeeEvents: [kept, withdrawn] }),
      HOST,
      NOW
    )

    expect(view.currentPeriod.totals.platformFeeCents).toBe(2_625)
    expect(view.currentPeriod.totals.driverPayCents).toBe(52_500)
    expect(view.currentPeriod.totals.truckloadCount).toBe(1)
    expect(view.currentPeriod.lines.map((line) => line.id)).toEqual([kept.id])

    // Shown, not deleted: a host who was told about a fee is owed the record that
    // it was taken back, with the reason.
    expect(view.currentPeriod.voidedLines).toHaveLength(1)
    expect(view.currentPeriod.voidedLines[0]?.voidReason).toBe("Load was never hauled; slot released")
    expect(view.currentPeriod.voidedLines[0]?.platformFeeCents).toBe(4_000)
  })

  it("negative control: the same fee re-flagged as accrued does land on the total", () => {
    const reinstated = { ...withdrawn, status: "accrued" as const, voidReason: null }
    const view = buildHostBillingView(
      source({ platformFeeEvents: [kept, platformFeeEventSchema.parse(reinstated)] }),
      HOST,
      NOW
    )

    // 2_625 + 4_000 — proving the voided amount was real money that the void
    // rule excluded, not an amount that was zero all along.
    expect(view.currentPeriod.totals.platformFeeCents).toBe(6_625)
    expect(view.currentPeriod.totals.truckloadCount).toBe(2)
    expect(view.currentPeriod.voidedLines).toHaveLength(0)
  })
})

describe("nothing has accrued yet", () => {
  it("reports an empty month with zero totals and no invented figures", () => {
    const view = buildHostBillingView(source(), HOST, NOW)

    expect(view.hasBillingHistory).toBe(false)
    expect(view.currentPeriod.lines).toEqual([])
    expect(view.currentPeriod.voidedLines).toEqual([])
    expect(view.currentPeriod.totals).toMatchObject({
      driverPayCents: 0,
      hostTotalCents: 0,
      platformFeeCents: 0,
      truckloadCount: 0
    })
    expect(view.currentPeriod.totals.platformFeeLabel).toBe("$0.00")
    expect(view.invoices).toEqual([])
    expect(view.lastInvoice).toBeNull()
    expect(view.currentPeriod.periodLabel).toBe("July 2026")
    expect(view.currentPeriod.closesOnLabel).toBe("Aug 1, 2026")
  })

  it("negative control: a quiet month with an earlier bill is not an empty history", () => {
    const view = buildHostBillingView(
      source({ hostInvoices: [invoice({ subtotalCents: 4_100 })] }),
      HOST,
      NOW
    )

    expect(view.currentPeriod.lines).toEqual([])
    expect(view.hasBillingHistory).toBe(true)
    expect(view.lastInvoice?.billedLabel).toBe("$41.00")
  })
})

describe("the card on file, and what its state costs the host", () => {
  it("blocks publishing when there is no billing profile at all", () => {
    const view = buildHostBillingView(source({ hostBillingProfiles: [] }), HOST, NOW)

    expect(view.paymentMethod.status).toBe("none")
    expect(view.paymentMethod.blocksPublishing).toBe(true)
    expect(view.paymentMethod.cardLine).toBeNull()
    expect(view.paymentMethod.consequence).toMatch(/cannot publish/i)
    expect(view.paymentMethod.nextStep).toMatch(/attach a card/i)
    // A host with no card is not charged for having no card.
    expect(view.paymentMethod.consequence).toMatch(/no monthly fee/i)
  })

  it("blocks publishing on a declined card and shows what the processor said", () => {
    const view = buildHostBillingView(
      source({
        hostBillingProfiles: [
          billingProfile({
            lastFailureAt: "2026-07-03T09:00:00.000Z",
            lastFailureReason: "card_declined: insufficient funds",
            status: "failed"
          })
        ]
      }),
      HOST,
      NOW
    )

    expect(view.paymentMethod.status).toBe("failed")
    expect(view.paymentMethod.blocksPublishing).toBe(true)
    expect(view.paymentMethod.consequence).toMatch(/cannot publish/i)
    expect(view.paymentMethod.failureLine).toBe("Declined Jul 3, 2026: card_declined: insufficient funds")
    // A declined card does not touch work already on the network, and never
    // touches what a driver is owed.
    expect(view.paymentMethod.consequence).toMatch(/already on the network/i)
    expect(view.paymentMethod.consequence).toMatch(/paid by you/i)
  })

  it("lets an attached card publish, and names the card without storing one", () => {
    const view = buildHostBillingView(source(), HOST, NOW)

    expect(view.paymentMethod.status).toBe("attached")
    expect(view.paymentMethod.blocksPublishing).toBe(false)
    expect(view.paymentMethod.nextStep).toBeNull()
    expect(view.paymentMethod.cardLine).toBe("visa ending 4242")
    expect(view.paymentMethod.failureLine).toBeNull()
  })

  it("covers every card state the schema allows, and exactly one of them publishes", () => {
    expect(Object.keys(PAYMENT_STATE_PRESENTATION).sort()).toEqual(
      [...COVERED_BILLING_STATUSES.paymentMethod].sort()
    )

    // The negative control on the gate itself: if a future state defaulted to
    // "publishing is fine", this count changes and this test fails.
    const publishable = Object.entries(PAYMENT_STATE_PRESENTATION).filter(
      ([, presentation]) => !presentation.blocksPublishing
    )
    expect(publishable.map(([status]) => status)).toEqual(["attached"])

    // A blocked state has to tell the host what to do about it.
    for (const [status, presentation] of Object.entries(PAYMENT_STATE_PRESENTATION)) {
      if (presentation.blocksPublishing) {
        expect(presentation.nextStep, `${status} must name a next step`).toBeTruthy()
      }
    }
  })
})

describe("bills already raised", () => {
  const june = feeEvent({
    assignmentId: "dddddddd-dddd-4ddd-8ddd-ddddddddde01",
    driverPayCents: 52_500,
    invoiceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb01",
    occurredAt: "2026-06-11T15:00:00.000Z",
    status: "invoiced"
  })
  const alsoJune = feeEvent({
    assignmentId: "dddddddd-dddd-4ddd-8ddd-ddddddddde02",
    driverPayCents: 41_000,
    invoiceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb01",
    loadPostingId: LOAD_TWO,
    occurredAt: "2026-06-19T15:00:00.000Z",
    status: "invoiced"
  })

  it("itemises what the last bill covered and reconciles it against the amount billed", () => {
    const view = buildHostBillingView(
      source({
        hostInvoices: [invoice({ feeEventIds: [june.id, alsoJune.id], subtotalCents: 4_675 })],
        platformFeeEvents: [june, alsoJune]
      }),
      HOST,
      NOW
    )

    const last = view.lastInvoice
    expect(last?.periodLabel).toBe("June 2026")
    expect(last?.statusLabel).toBe("Paid")
    expect(last?.settled).toBe(true)
    expect(last?.billedLabel).toBe("$46.75")
    expect(last?.paidOnLabel).toBe("Jul 2, 2026")
    expect(last?.lines.map((line) => line.loadTitle)).toEqual([
      "Doug fir sawlogs — Ridge 4",
      "Pulpwood — Beaver Creek"
    ])
    expect(last?.lines.map((line) => line.platformFeeLabel)).toEqual(["$26.25", "$20.50"])
    // 2_625 + 2_050 == the 4_675 stored on the bill.
    expect(last?.totals.platformFeeCents).toBe(last?.billedCents)
    expect(last?.reconciliationNote).toBeNull()

    // An invoiced fee is still real money: it stays in the ledger and is not
    // quietly zeroed once it lands on a bill.
    expect(last?.totals.driverPayCents).toBe(93_500)
  })

  it("says so when the listed truckloads do not add up to the amount billed", () => {
    // The second fee is missing from runtime state — the row contract withholds a
    // fee whose amount disagrees with its own frozen inputs, and that is exactly
    // when a bill stops being explainable.
    const view = buildHostBillingView(
      source({
        hostInvoices: [invoice({ feeEventIds: [june.id, alsoJune.id], subtotalCents: 4_675 })],
        platformFeeEvents: [june]
      }),
      HOST,
      NOW
    )

    const last = view.lastInvoice
    expect(last?.lines).toHaveLength(1)
    expect(last?.billedLabel).toBe("$46.75")
    // The billed figure is never quietly restated to match what can be shown.
    expect(last?.billedCents).toBe(4_675)
    expect(last?.reconciliationNote).toMatch(/\$26\.25 of the \$46\.75 billed/)
    expect(last?.reconciliationNote).toMatch(/\$20\.50/)
  })

  it("keeps a withdrawn invoice row out of the billable lines and totals", () => {
    const withdrawn = feeEvent({
      assignmentId: "dddddddd-dddd-4ddd-8ddd-ddddddddde03",
      driverPayCents: 41_000,
      invoiceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb01",
      loadPostingId: LOAD_TWO,
      occurredAt: "2026-06-19T15:00:00.000Z",
      status: "voided",
      voidReason: "Load was cancelled after the bill was raised"
    })
    const view = buildHostBillingView(
      source({
        hostInvoices: [invoice({ feeEventIds: [june.id, withdrawn.id], subtotalCents: 2_625 })],
        platformFeeEvents: [june, withdrawn]
      }),
      HOST,
      NOW
    )

    expect(view.lastInvoice?.lines.map((line) => line.platformFeeCents)).toEqual([2_625])
    expect(view.lastInvoice?.totals.driverPayCents).toBe(52_500)
    expect(view.lastInvoice?.totals.platformFeeCents).toBe(2_625)
    expect(view.lastInvoice?.reconciliationNote).toBeNull()
  })

  it("words the opposite direction differently: listed fees exceeding the amount billed", () => {
    // A fee listed on a bill that did not charge for it is a double-billing risk,
    // not a missing line, so it must not be reported as something to itemise.
    const view = buildHostBillingView(
      source({
        hostInvoices: [invoice({ feeEventIds: [june.id, alsoJune.id], subtotalCents: 2_625 })],
        platformFeeEvents: [june, alsoJune]
      }),
      HOST,
      NOW
    )

    expect(view.lastInvoice?.billedCents).toBe(2_625)
    expect(view.lastInvoice?.totals.platformFeeCents).toBe(4_675)
    expect(view.lastInvoice?.reconciliationNote).toMatch(
      /add up to \$46\.75, which is more than the \$26\.25 billed/
    )
    expect(view.lastInvoice?.reconciliationNote).not.toMatch(/itemise the remaining/)
  })

  it("orders bills newest month first so the last one asked about is the first shown", () => {
    const view = buildHostBillingView(
      source({
        hostInvoices: [
          invoice({
            feeEventIds: [],
            id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb02",
            periodEnd: "2026-06-01T00:00:00.000Z",
            periodStart: "2026-05-01T00:00:00.000Z",
            subtotalCents: 1_000
          }),
          invoice({ subtotalCents: 4_675 })
        ]
      }),
      HOST,
      NOW
    )

    expect(view.invoices.map((entry) => entry.periodLabel)).toEqual(["June 2026", "May 2026"])
    expect(view.lastInvoice?.periodLabel).toBe("June 2026")
  })

  it("covers every bill state the schema allows", () => {
    expect(Object.keys(INVOICE_STATE_PRESENTATION).sort()).toEqual(
      [...COVERED_BILLING_STATUSES.invoice].sort()
    )

    // Only a paid bill may claim money was collected.
    const settled = Object.entries(INVOICE_STATE_PRESENTATION).filter(([, entry]) => entry.settled)
    expect(settled.map(([status]) => status)).toEqual(["paid"])
  })
})

describe("tenancy", () => {
  it("never lets another host's fees, bills or card reach this host's figures", () => {
    const view = buildHostBillingView(
      source({
        hostBillingProfiles: [
          billingProfile({
            id: "34343434-3434-4434-8434-3434343434f2",
            organizationId: OTHER_HOST,
            paymentMethodLast4: "9999"
          })
        ],
        hostInvoices: [
          invoice({ organizationId: OTHER_HOST, subtotalCents: 999_999 })
        ],
        platformFeeEvents: [
          feeEvent({
            assignmentId: "dddddddd-dddd-4ddd-8ddd-dddddddddd01",
            driverPayCents: 52_500,
            organizationId: OTHER_HOST
          })
        ]
      }),
      HOST,
      NOW
    )

    expect(view.currentPeriod.lines).toEqual([])
    expect(view.currentPeriod.totals.platformFeeCents).toBe(0)
    expect(view.invoices).toEqual([])
    expect(view.hasBillingHistory).toBe(false)
    // The other host's card must not become this host's licence to publish.
    expect(view.paymentMethod.status).toBe("none")
    expect(view.paymentMethod.blocksPublishing).toBe(true)
  })
})

describe("what exactly the host is charged", () => {
  it("explains the fee with a worked example produced by the billing arithmetic", () => {
    const view = buildHostBillingView(source(), HOST, NOW)

    expect(view.fee.rateLabel).toBe("5%")
    expect(view.fee.example).toEqual({
      driverPayLabel: "$500.00",
      hostTotalLabel: "$525.00",
      platformFeeLabel: "$25.00"
    })
    expect(view.fee.headline).toMatch(/on top/i)
    expect(view.fee.headline).toMatch(/completed/i)

    const points = view.fee.points.join(" ")
    // The four claims a host must not have to ask about.
    expect(points).toMatch(/no monthly fee/i)
    expect(points).toMatch(/nothing is deducted from driver pay/i)
    expect(points).toMatch(/holds no funds and settles no freight/i)
    expect(points).toMatch(/drivers pay nothing/i)
  })

  it("derives the rate label from the rate rather than from a typed string", () => {
    expect(feeRateLabel(PLATFORM_FEE_BPS)).toBe("5%")
    expect(feeRateLabel(0)).toBe("0%")
    expect(feeRateLabel(250)).toBe("2.5%")
    expect(feeRateLabel(525)).toBe("5.25%")
    expect(feeRateLabel(10_000)).toBe("100%")
  })
})

describe("the live wiring", () => {
  it("reads the real operating state for a seeded host: card attached, ledger empty", () => {
    // The seeded bench gives every host that posts a load an attached card, since
    // publishing requires one. Nothing has ever been billed, so this is also the
    // proof that the empty ledger is presented as empty rather than as unknown.
    const view = getHostBillingView("33333333-3333-4333-8333-333333333332")

    expect(view.paymentMethod.status).toBe("attached")
    expect(view.paymentMethod.blocksPublishing).toBe(false)
    expect(view.paymentMethod.cardLine).toMatch(/ending \d{4}$/)
    expect(view.hasBillingHistory).toBe(false)
    expect(view.currentPeriod.totals.platformFeeCents).toBe(0)
    expect(view.fee.rateLabel).toBe("5%")
  })
})
