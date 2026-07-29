import { describe, expect, it } from "vitest"
import { z } from "zod"

import {
  computePlatformFeeCents,
  deterministicUuidV5,
  FEE_BPS_SCALE,
  hostChargeBreakdown,
  hostInvoiceStatusSchema,
  invoicePeriodFor,
  invoiceSubtotalCents,
  platformFeeEventId,
  platformFeeEventStatusSchema,
  PLATFORM_FEE_BPS,
  type PlatformFeeLedgerEntry
} from "./billing-model"
import {
  hostBillingProfileSchema,
  hostInvoiceSchema,
  platformFeeEventSchema
} from "./schemas"

const uuid = z.string().uuid()
const timestamp = "2026-07-05T18:00:00.000Z"
const ASSIGNMENT = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1"
const OTHER_ASSIGNMENT = "dddddddd-dddd-4ddd-8ddd-ddddddddddd2"

/** RFC 4122's own namespace constant, used here only as a published test vector. */
const DNS_NAMESPACE = "6ba7b810-9dad-11d1-80b4-00c04fd430c8"

describe("the platform fee rate", () => {
  it("is the founder-decided flat 5%", () => {
    expect(PLATFORM_FEE_BPS).toBe(500)
    expect(PLATFORM_FEE_BPS / FEE_BPS_SCALE).toBe(0.05)
  })
})

describe("computePlatformFeeCents", () => {
  it("charges 5% of stated driver pay when the arithmetic is exact", () => {
    // $525.00 -> $26.25. No rounding involved, so this pins the rate itself.
    expect(computePlatformFeeCents(52_500, PLATFORM_FEE_BPS)).toBe(2_625)
  })

  it("rounds a fractional cent half-up", () => {
    // 5% of $99.99 is 499.95c. Half-up bills 500c.
    expect(computePlatformFeeCents(9_999, PLATFORM_FEE_BPS)).toBe(500)
    // 5% of $0.50 is exactly 2.5c: the exact-half case, and it goes up.
    expect(computePlatformFeeCents(50, PLATFORM_FEE_BPS)).toBe(3)
  })

  it("rounds down when the discarded remainder is under half a cent", () => {
    // Negative control for the rule above: 5% of $10.01 is 50.05c, and bills 50c.
    // Without this, "always round up" would pass every other rounding test here.
    expect(computePlatformFeeCents(1_001, PLATFORM_FEE_BPS)).toBe(50)
  })

  it("agrees with the arithmetic it claims, across a wide range of pay figures", () => {
    for (let pay = 0; pay <= 20_000; pay += 1) {
      const scaled = pay * PLATFORM_FEE_BPS

      expect(computePlatformFeeCents(pay, PLATFORM_FEE_BPS)).toBe(Math.round(scaled / FEE_BPS_SCALE))
    }
  })

  it("charges nothing at a zero rate or on a zero-pay figure", () => {
    expect(computePlatformFeeCents(52_500, 0)).toBe(0)
    expect(computePlatformFeeCents(0, PLATFORM_FEE_BPS)).toBe(0)
  })

  it("refuses input it would otherwise have to invent a number for", () => {
    expect(() => computePlatformFeeCents(-1, PLATFORM_FEE_BPS)).toThrow(/non-negative/)
    expect(() => computePlatformFeeCents(52_500.5, PLATFORM_FEE_BPS)).toThrow(/whole number/)
    expect(() => computePlatformFeeCents(Number.NaN, PLATFORM_FEE_BPS)).toThrow(/whole number/)
    expect(() => computePlatformFeeCents(Number.POSITIVE_INFINITY, PLATFORM_FEE_BPS)).toThrow()
    expect(() => computePlatformFeeCents(52_500, -1)).toThrow(/feeBps/)
    expect(() => computePlatformFeeCents(52_500, 12.5)).toThrow(/feeBps/)
    expect(() => computePlatformFeeCents(52_500, FEE_BPS_SCALE + 1)).toThrow(/feeBps/)
  })

  it("refuses swapped arguments instead of billing a host 525x the load", () => {
    // (pay, bps) and not (bps, pay). The upper bound on bps is what catches it.
    expect(() => computePlatformFeeCents(PLATFORM_FEE_BPS, 52_500)).toThrow(/feeBps/)
  })

  it("charges 100% at most, so a fee can never exceed the pay it is based on", () => {
    expect(computePlatformFeeCents(52_500, FEE_BPS_SCALE)).toBe(52_500)
  })
})

describe("hostChargeBreakdown", () => {
  it("shows the fee on top of driver pay, never taken out of it", () => {
    const breakdown = hostChargeBreakdown(52_500, PLATFORM_FEE_BPS)

    expect(breakdown).toEqual({
      driverPayCents: 52_500,
      hostTotalCents: 55_125,
      platformFeeCents: 2_625
    })
    // The two claims that matter, stated as arithmetic: the driver's number is
    // untouched, and the host's total is that number plus the fee.
    expect(breakdown.driverPayCents).toBe(52_500)
    expect(breakdown.hostTotalCents - breakdown.driverPayCents).toBe(breakdown.platformFeeCents)
    expect(breakdown.hostTotalCents).toBeGreaterThan(breakdown.driverPayCents)
  })

  it("never returns a net-of-fee driver figure for a surface to show", () => {
    const breakdown = hostChargeBreakdown(52_500, PLATFORM_FEE_BPS)
    const netOfFee = 52_500 - 2_625

    expect(Object.values(breakdown)).not.toContain(netOfFee)
  })

  it("leaves the total equal to the pay when no fee applies", () => {
    const breakdown = hostChargeBreakdown(52_500, 0)

    expect(breakdown.platformFeeCents).toBe(0)
    expect(breakdown.hostTotalCents).toBe(52_500)
  })

  it("uses the rate it is handed, so history is explained at its own rate", () => {
    expect(hostChargeBreakdown(52_500, 300).platformFeeCents).toBe(1_575)
  })
})

describe("invoiceSubtotalCents", () => {
  const entry = (status: PlatformFeeLedgerEntry["status"], feeCents: number): PlatformFeeLedgerEntry => ({
    feeCents,
    status
  })

  it("adds up fees that are owed", () => {
    expect(invoiceSubtotalCents([entry("accrued", 2_625), entry("invoiced", 100)])).toBe(2_725)
  })

  it("counts a voided fee as zero", () => {
    const events = [entry("accrued", 2_625), entry("voided", 5_000), entry("invoiced", 100)]

    expect(invoiceSubtotalCents(events)).toBe(2_725)
    // Negative control: the voided amount is real money that WOULD have been
    // included, so this fails the moment the void filter is dropped.
    expect(invoiceSubtotalCents(events.map((event) => entry("accrued", event.feeCents)))).toBe(7_725)
  })

  it("is zero for a host with nothing accrued", () => {
    expect(invoiceSubtotalCents([])).toBe(0)
  })

  it("has an answer for every state a fee can be in", () => {
    // Enumerated from the schema rather than spot-checked, and the membership is
    // asserted too: a new fee state fails here until somebody decides whether a
    // host owes money for it.
    expect(new Set(platformFeeEventStatusSchema.options)).toEqual(
      new Set(["accrued", "invoiced", "voided"])
    )

    for (const status of platformFeeEventStatusSchema.options) {
      expect(invoiceSubtotalCents([entry(status, 700)])).toBe(status === "voided" ? 0 : 700)
    }
  })

  it("refuses a fee amount that is not whole cents", () => {
    expect(() => invoiceSubtotalCents([entry("accrued", 26.25)])).toThrow(/whole number/)
    expect(() => invoiceSubtotalCents([entry("accrued", -1)])).toThrow(/non-negative/)
  })
})

describe("platformFeeEventId", () => {
  it("gives one assignment one id, forever", () => {
    expect(platformFeeEventId(ASSIGNMENT)).toBe(platformFeeEventId(ASSIGNMENT))
  })

  it("is the at-most-one key: different assignments never share an id", () => {
    const ids = new Set(
      [
        ASSIGNMENT,
        OTHER_ASSIGNMENT,
        "dddddddd-dddd-4ddd-8ddd-ddddddddddd3",
        "00000000-0000-4000-8000-000000000000"
      ].map(platformFeeEventId)
    )

    expect(ids.size).toBe(4)
  })

  it("produces a uuid, because every id in this system is uuid-shaped", () => {
    const id = platformFeeEventId(ASSIGNMENT)

    expect(uuid.safeParse(id).success).toBe(true)
    expect(id[14]).toBe("5") // version 5: derived, not random
    expect(["8", "9", "a", "b"]).toContain(id[19]) // RFC 4122 variant
  })

  it("treats an upper-case assignment id as the same assignment", () => {
    expect(platformFeeEventId(ASSIGNMENT.toUpperCase())).toBe(platformFeeEventId(ASSIGNMENT))
  })

  it("derives the same ids this build shipped with", () => {
    // Independently computed with node:crypto's SHA-1. These literals pin BOTH the
    // hash implementation and the frozen namespace: change either and every fee
    // that has already been billed gets a new id, so the duplicate check stops
    // recognising it and every host is charged twice.
    expect(platformFeeEventId(ASSIGNMENT)).toBe("876389db-4838-55a3-9b2f-b32ca01f3937")
    expect(platformFeeEventId(OTHER_ASSIGNMENT)).toBe("f609e682-d59b-5bbf-b597-a25d3d1bfd1c")
    expect(platformFeeEventId("00000000-0000-4000-8000-000000000000")).toBe(
      "85703b35-1547-5f1a-804a-817570baacb8"
    )
  })

  it("refuses anything that is not an assignment uuid", () => {
    expect(() => platformFeeEventId("assignment-1")).toThrow(/assignment uuid/)
    expect(() => platformFeeEventId("")).toThrow(/assignment uuid/)
  })
})

describe("deterministicUuidV5", () => {
  it("matches the published RFC 4122 version 5 vectors", () => {
    // The standard's own worked example. This is what proves the hand-rolled SHA-1
    // is SHA-1 and not merely self-consistent.
    expect(deterministicUuidV5(DNS_NAMESPACE, "www.example.com")).toBe(
      "2ed6657d-e927-568b-95e1-2665a8aea6a2"
    )
    expect(deterministicUuidV5(DNS_NAMESPACE, "example.com")).toBe(
      "cfbff0d1-9375-5685-968c-48ce8b15ae17"
    )
  })

  it("hashes names that span more than one block", () => {
    // 16 namespace bytes + 48 name bytes exactly fills a 64-byte block, so the
    // padding has to occupy a whole further block. Fee ids never take this path
    // today, and an implementation that got it wrong would look perfect until the
    // first longer name arrived.
    expect(deterministicUuidV5(DNS_NAMESPACE, "abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklm")).toBe(
      "e559dbfa-6ae2-5238-8fc3-55e978fdc0a9"
    )
    expect(deterministicUuidV5(DNS_NAMESPACE, "a".repeat(100))).toBe(
      "56596f37-716c-57a9-a735-2561f8608390"
    )
  })

  it("refuses a namespace that is not a uuid", () => {
    expect(() => deterministicUuidV5("platform-fees", "x")).toThrow(/uuid/)
  })
})

describe("invoicePeriodFor", () => {
  it("returns the UTC calendar month an instant falls in", () => {
    expect(invoicePeriodFor("2026-07-15T09:30:00.000Z")).toEqual({
      periodEnd: "2026-08-01T00:00:00.000Z",
      periodStart: "2026-07-01T00:00:00.000Z"
    })
  })

  it("keeps both month boundaries on the right side of the bill", () => {
    // The first instant belongs to its own month; the last one does not spill into
    // the next. These two are the whole boundary contract.
    expect(invoicePeriodFor("2026-07-01T00:00:00.000Z").periodStart).toBe("2026-07-01T00:00:00.000Z")
    expect(invoicePeriodFor("2026-07-31T23:59:59.999Z").periodEnd).toBe("2026-08-01T00:00:00.000Z")
  })

  it("rolls December into the next January", () => {
    expect(invoicePeriodFor("2026-12-31T23:59:59.999Z")).toEqual({
      periodEnd: "2027-01-01T00:00:00.000Z",
      periodStart: "2026-12-01T00:00:00.000Z"
    })
  })

  it("gives leap-year February its 29th day", () => {
    const leap = invoicePeriodFor("2028-02-29T12:00:00.000Z")
    const days = (period: { periodEnd: string; periodStart: string }): number =>
      (Date.parse(period.periodEnd) - Date.parse(period.periodStart)) / 86_400_000

    expect(leap).toEqual({
      periodEnd: "2028-03-01T00:00:00.000Z",
      periodStart: "2028-02-01T00:00:00.000Z"
    })
    expect(days(leap)).toBe(29)
    // Negative control for a hardcoded month length.
    expect(days(invoicePeriodFor("2027-02-15T12:00:00.000Z"))).toBe(28)
  })

  it("leaves no gap and no overlap between consecutive bills", () => {
    const july = invoicePeriodFor("2026-07-15T09:30:00.000Z")
    const august = invoicePeriodFor(july.periodEnd)

    expect(august.periodStart).toBe(july.periodEnd)
  })

  it("refuses an instant it cannot read", () => {
    expect(() => invoicePeriodFor("last month")).toThrow(/parsable instant/)
  })
})

/**
 * The persisted shapes live in schemas.ts with every other row contract, but they
 * are this module's invariants, so they are proved here beside the arithmetic they
 * depend on.
 */
describe("platformFeeEventSchema", () => {
  const feeEvent = {
    assignmentId: ASSIGNMENT,
    createdAt: timestamp,
    driverPayCents: 52_500,
    feeBps: PLATFORM_FEE_BPS,
    feeCents: 2_625,
    id: platformFeeEventId(ASSIGNMENT),
    invoiceId: null,
    loadPostingId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
    occurredAt: timestamp,
    organizationId: "33333333-3333-4333-8333-333333333331",
    status: "accrued",
    truckSlotId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1",
    updatedAt: timestamp,
    voidReason: null
  }

  it("accepts an accrual whose fee matches its own frozen pay and rate", () => {
    expect(platformFeeEventSchema.safeParse(feeEvent).success).toBe(true)
  })

  it("rejects a fee that does not follow from the numbers stored beside it", () => {
    expect(platformFeeEventSchema.safeParse({ ...feeEvent, feeCents: 2_626 }).success).toBe(false)
    expect(platformFeeEventSchema.safeParse({ ...feeEvent, feeCents: 0 }).success).toBe(false)
  })

  it("rejects money that is not whole cents", () => {
    expect(platformFeeEventSchema.safeParse({ ...feeEvent, driverPayCents: 52_500.5 }).success).toBe(false)
    expect(platformFeeEventSchema.safeParse({ ...feeEvent, driverPayCents: 0 }).success).toBe(false)
    expect(platformFeeEventSchema.safeParse({ ...feeEvent, feeBps: FEE_BPS_SCALE + 1 }).success).toBe(false)
  })

  it("rejects a malformed row instead of throwing out of safeParse", () => {
    // Every stored row is validated on every read of the operating state document,
    // and zod runs refinements even after a field-level failure. A refinement that
    // threw here would turn one bad fee row into a failed read of the whole
    // database, so this is a load-bearing property and not defensive habit.
    for (const malformed of [
      { ...feeEvent, driverPayCents: 52_500.5 },
      { ...feeEvent, driverPayCents: "five hundred" },
      { ...feeEvent, feeBps: null },
      { ...feeEvent, feeCents: undefined },
      { ...feeEvent, status: "settled" },
      {},
      null
    ]) {
      expect(() => platformFeeEventSchema.safeParse(malformed)).not.toThrow()
      expect(platformFeeEventSchema.safeParse(malformed).success).toBe(false)
    }
  })

  it("holds each status to what it claims", () => {
    const invoiceId = "35353535-3535-4535-8535-353535353531"

    expect(platformFeeEventSchema.safeParse({ ...feeEvent, status: "invoiced" }).success).toBe(false)
    expect(
      platformFeeEventSchema.safeParse({ ...feeEvent, invoiceId, status: "invoiced" }).success
    ).toBe(true)
    expect(platformFeeEventSchema.safeParse({ ...feeEvent, invoiceId }).success).toBe(false)
    expect(platformFeeEventSchema.safeParse({ ...feeEvent, status: "voided" }).success).toBe(false)
    expect(
      platformFeeEventSchema.safeParse({
        ...feeEvent,
        status: "voided",
        voidReason: "Billed twice after a replay"
      }).success
    ).toBe(true)
    expect(
      platformFeeEventSchema.safeParse({ ...feeEvent, voidReason: "Billed twice" }).success
    ).toBe(false)
    // A withdrawn charge keeps the bill it was raised on.
    expect(
      platformFeeEventSchema.safeParse({
        ...feeEvent,
        invoiceId,
        status: "voided",
        voidReason: "Load never happened"
      }).success
    ).toBe(true)
  })
})

describe("hostInvoiceSchema", () => {
  const invoice = {
    createdAt: timestamp,
    feeEventIds: [platformFeeEventId(ASSIGNMENT)],
    id: "35353535-3535-4535-8535-353535353531",
    issuedAt: null,
    organizationId: "33333333-3333-4333-8333-333333333331",
    paidAt: null,
    periodEnd: "2026-08-01T00:00:00.000Z",
    periodStart: "2026-07-01T00:00:00.000Z",
    status: "draft",
    stripeInvoiceId: null,
    subtotalCents: 2_625,
    updatedAt: timestamp,
    voidedAt: null
  }

  it("accepts a draft bill for one whole UTC month", () => {
    expect(hostInvoiceSchema.safeParse(invoice).success).toBe(true)
  })

  it("rejects a period that is not a UTC calendar month", () => {
    expect(hostInvoiceSchema.safeParse({ ...invoice, periodStart: "2026-07-15T00:00:00.000Z" }).success).toBe(false)
    expect(hostInvoiceSchema.safeParse({ ...invoice, periodEnd: "2026-07-31T23:59:59.999Z" }).success).toBe(false)
    expect(hostInvoiceSchema.safeParse({ ...invoice, periodEnd: "2026-09-01T00:00:00.000Z" }).success).toBe(false)
  })

  it("accepts the same boundary written another way, because it is the same instant", () => {
    expect(hostInvoiceSchema.safeParse({ ...invoice, periodStart: "2026-07-01T00:00:00Z" }).success).toBe(true)
  })

  it("rejects a fee counted twice on one bill", () => {
    expect(
      hostInvoiceSchema.safeParse({
        ...invoice,
        feeEventIds: [platformFeeEventId(ASSIGNMENT), platformFeeEventId(ASSIGNMENT)]
      }).success
    ).toBe(false)
  })

  it("requires the timestamps each status claims", () => {
    for (const status of hostInvoiceStatusSchema.options) {
      const bare = hostInvoiceSchema.safeParse({ ...invoice, status })

      expect(bare.success, `${status} without timestamps`).toBe(status === "draft")
    }

    expect(hostInvoiceSchema.safeParse({ ...invoice, issuedAt: timestamp, status: "open" }).success).toBe(true)
    expect(hostInvoiceSchema.safeParse({ ...invoice, issuedAt: timestamp, status: "paid" }).success).toBe(false)
    expect(
      hostInvoiceSchema.safeParse({
        ...invoice,
        issuedAt: timestamp,
        paidAt: timestamp,
        status: "paid"
      }).success
    ).toBe(true)
    expect(hostInvoiceSchema.safeParse({ ...invoice, status: "void", voidedAt: timestamp }).success).toBe(true)
  })

  it("rejects a malformed bill instead of throwing out of safeParse", () => {
    for (const malformed of [
      { ...invoice, periodStart: "some time in July" },
      { ...invoice, periodStart: null },
      { ...invoice, feeEventIds: 3 },
      { ...invoice, status: "posted" },
      {},
      null
    ]) {
      expect(() => hostInvoiceSchema.safeParse(malformed)).not.toThrow()
      expect(hostInvoiceSchema.safeParse(malformed).success).toBe(false)
    }
  })
})

describe("hostBillingProfileSchema", () => {
  const profile = {
    attachedAt: timestamp,
    createdAt: timestamp,
    defaultPaymentMethodId: "pm_seed_northpine",
    id: "34343434-3434-4434-8434-343434343431",
    lastFailureAt: null,
    lastFailureReason: null,
    organizationId: "33333333-3333-4333-8333-333333333331",
    paymentMethodBrand: "visa",
    paymentMethodLast4: "4242",
    status: "attached",
    stripeCustomerId: "cus_seed_northpine",
    updatedAt: timestamp
  }

  it("accepts a host with a card on file", () => {
    expect(hostBillingProfileSchema.safeParse(profile).success).toBe(true)
  })

  it("refuses to store anything longer than the last four digits", () => {
    // The gate that keeps a card number out of the operating state document.
    expect(hostBillingProfileSchema.safeParse({ ...profile, paymentMethodLast4: "4242424242424242" }).success).toBe(false)
    expect(hostBillingProfileSchema.safeParse({ ...profile, paymentMethodLast4: "424" }).success).toBe(false)
    expect(hostBillingProfileSchema.safeParse({ ...profile, paymentMethodLast4: "42x2" }).success).toBe(false)
  })

  it("will not let 'attached' mean less than an attached card", () => {
    // This status is what gates publishing, so an empty version of it would let a
    // host post work that can never be billed.
    expect(hostBillingProfileSchema.safeParse({ ...profile, defaultPaymentMethodId: null }).success).toBe(false)
    expect(hostBillingProfileSchema.safeParse({ ...profile, stripeCustomerId: null }).success).toBe(false)
    expect(hostBillingProfileSchema.safeParse({ ...profile, attachedAt: null }).success).toBe(false)
  })

  it("accepts a host who has not attached a card yet", () => {
    expect(
      hostBillingProfileSchema.safeParse({
        ...profile,
        attachedAt: null,
        defaultPaymentMethodId: null,
        paymentMethodBrand: null,
        paymentMethodLast4: null,
        status: "none"
      }).success
    ).toBe(true)
  })

  it("refuses a profile that says no card while naming one", () => {
    expect(hostBillingProfileSchema.safeParse({ ...profile, attachedAt: null, status: "none" }).success).toBe(false)
  })

  it("requires a failure to say what went wrong", () => {
    expect(hostBillingProfileSchema.safeParse({ ...profile, status: "failed" }).success).toBe(false)
    expect(
      hostBillingProfileSchema.safeParse({
        ...profile,
        lastFailureAt: timestamp,
        lastFailureReason: "card_declined",
        status: "failed"
      }).success
    ).toBe(true)
  })
})
