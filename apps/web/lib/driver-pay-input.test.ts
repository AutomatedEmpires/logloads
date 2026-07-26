import { PLATFORM_FEE_BPS, computePlatformFeeCents } from "@logloads/contracts"
import { describe, expect, it } from "vitest"

import {
  MAX_DRIVER_PAY_CENTS,
  driverPayQuote,
  parseDriverPayCents,
  payOutlookForTruckloads
} from "./driver-pay-input"

describe("what the host typed, as cents", () => {
  it("reads whole dollars, one decimal place, and two", () => {
    expect(parseDriverPayCents("525")).toBe(52_500)
    expect(parseDriverPayCents("525.5")).toBe(52_550)
    expect(parseDriverPayCents("525.50")).toBe(52_550)
    expect(parseDriverPayCents("0.01")).toBe(1)
  })

  it("does not go through a float", () => {
    // THIS IS THE BUG THIS MODULE EXISTS FOR. In this language
    // Number("19.99") * 100 is 1998.9999999999998, so a builder that multiplied
    // would either quote a fractional pay figure or depend on a Math.round
    // nobody wrote down. The pay a driver is promised, and the base the host is
    // charged 5% of, cannot rest on that.
    expect(Number("19.99") * 100).not.toBe(1999)
    expect(parseDriverPayCents("19.99")).toBe(1999)

    // The same hazard at other magnitudes, checked against integer arithmetic
    // rather than against another float expression.
    for (const dollars of [1, 7, 19, 103, 1_234, 9_999]) {
      for (const cents of [1, 7, 29, 95, 99]) {
        const typed = `${dollars}.${String(cents).padStart(2, "0")}`

        expect(parseDriverPayCents(typed), typed).toBe(dollars * 100 + cents)
      }
    }
  })

  it("accepts money written the way hosts write it", () => {
    expect(parseDriverPayCents("$525")).toBe(52_500)
    expect(parseDriverPayCents("  $1,250.75 ")).toBe(125_075)
    expect(parseDriverPayCents("1,000,000")).toBe(100_000_000)
  })

  it("refuses a misgrouped comma rather than repairing it into a plausible amount", () => {
    // Stripping commas unconditionally reads "52,5.00" as $525.00 — an amount
    // whose author meant something else, and one that looks entirely normal on a
    // review screen. This case is the reason grouping is checked before the
    // commas come out; the two controls below are the same digits grouped right.
    expect(parseDriverPayCents("52,5.00")).toBeNull()
    expect(parseDriverPayCents("525.00")).toBe(52_500)
    expect(parseDriverPayCents("1,525.00")).toBe(152_500)
  })

  it("refuses what is not an amount, instead of coercing it", () => {
    for (const typed of ["", "   ", "abc", "-100", "1.234", ".50", "1 2", "1.2.3", "52,5.00", "1e3", "0", "0.00", "$"]) {
      expect(parseDriverPayCents(typed), typed).toBeNull()
    }
  })

  it("refuses a third decimal place rather than rounding it away", () => {
    // A host typing 525.125 is thinking in a unit this field does not have.
    // Rounding it would change the figure a driver was promised without saying so.
    expect(parseDriverPayCents("525.125")).toBeNull()
    // The negative control: two places at the same magnitude is accepted, so the
    // refusal above is about the third digit and not about the length.
    expect(parseDriverPayCents("525.12")).toBe(52_512)
  })

  it("caps a fat-fingered extra zero", () => {
    expect(parseDriverPayCents(String(MAX_DRIVER_PAY_CENTS / 100))).toBe(MAX_DRIVER_PAY_CENTS)
    expect(parseDriverPayCents(String(MAX_DRIVER_PAY_CENTS / 100 + 1))).toBeNull()
    // A cap that rejects the cap itself would be an off-by-one that costs a host
    // a posting, so the boundary is asserted from both sides.
    expect(parseDriverPayCents("999999.99")).toBe(99_999_999)
  })
})

describe("the three numbers a host is shown before publishing", () => {
  it("shows the fee as the contracts function computes it, on top of untouched pay", () => {
    const quote = driverPayQuote("525")

    expect(quote).not.toBeNull()
    expect(quote!.driverPayCents).toBe(52_500)
    // The requirement in the task, asserted directly: the builder's fee IS
    // computePlatformFeeCents of the entered amount, not a second arithmetic.
    expect(quote!.platformFeeCents).toBe(computePlatformFeeCents(52_500, PLATFORM_FEE_BPS))
    expect(quote!.platformFeeCents).toBe(2_625)
    // ON TOP: the host's total is pay PLUS the fee, and the driver's figure is
    // never reduced. A breakdown where the total equalled the pay would mean the
    // fee had been taken out of the driver's money.
    expect(quote!.hostTotalCents).toBe(52_500 + 2_625)
    expect(quote!.hostTotalCents).toBeGreaterThan(quote!.driverPayCents)
  })

  it("agrees with the fee function across the whole range a host can type", () => {
    for (const typed of ["0.01", "1", "9.99", "10.09", "525", "1250.75", "99999.99", "1000000"]) {
      const quote = driverPayQuote(typed)
      const cents = parseDriverPayCents(typed)

      expect(cents, typed).not.toBeNull()
      expect(quote!.platformFeeCents, typed).toBe(computePlatformFeeCents(cents!, PLATFORM_FEE_BPS))
      expect(quote!.hostTotalCents, typed).toBe(cents! + quote!.platformFeeCents)
    }
  })

  it("quotes nothing while the field is not yet an amount", () => {
    expect(driverPayQuote("")).toBeNull()
    expect(driverPayQuote("52.")).toBeNull()
  })
})

describe("what several truckloads come to if every one of them runs", () => {
  it("multiplies the per-truckload figures, because that is what per-truckload means", () => {
    const outlook = payOutlookForTruckloads(52_500, 6)

    expect(outlook.truckloads).toBe(6)
    expect(outlook.driverPayCents).toBe(315_000)
    expect(outlook.platformFeeCents).toBe(15_750)
    expect(outlook.hostTotalCents).toBe(330_750)
  })

  it("bills as many roundings as there are truckloads, not one on the total", () => {
    // The ledger raises one fee event per completed assignment, so a host's bill
    // is the sum of per-truckload fees. Rating the summed pay instead would show
    // 151c here and the invoice would then add up to 150c — a projection that
    // disagrees with the bill by construction.
    expect(payOutlookForTruckloads(1_009, 3).platformFeeCents).toBe(150)
    expect(computePlatformFeeCents(1_009 * 3, PLATFORM_FEE_BPS)).toBe(151)
  })

  it("keeps driver pay whole at every count", () => {
    for (const truckloads of [1, 2, 3, 7, 45]) {
      const outlook = payOutlookForTruckloads(9_999, truckloads)

      expect(outlook.driverPayCents, String(truckloads)).toBe(9_999 * truckloads)
      expect(outlook.hostTotalCents - outlook.driverPayCents, String(truckloads)).toBe(
        outlook.platformFeeCents
      )
    }
  })
})
