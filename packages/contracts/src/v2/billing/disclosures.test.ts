import { afterEach, describe, expect, it, vi } from "vitest"

import { formatLandingPlanPrice } from "../../marketplace-landings"
import * as membership from "../../membership"
import { BOOST_PACKAGES, FOUNDING_OPERATOR_OFFER, LANDING_PLANS, foundingOperatorCyclePriceCents, type BoostPackageCode, type LandingPlanCode } from "../../membership"
import {
  BILLING_DISCLOSURES_VERSION,
  BILLING_DISCLOSURE_FORBIDDEN_WORDS,
  BILLING_TAX_SUFFIX,
  BOOST_CHECKOUT_DISCLOSURE_KEYS,
  FOUNDING_OFFER_DISCLOSURE_KEYS,
  PLAN_CHECKOUT_DISCLOSURE_KEYS,
  boostCheckoutDisclosure,
  foundingOfferDisclosure,
  foundingOfferPriceCents,
  landingBillingCycleDate,
  landingPlanCheckoutDisclosure,
  withApplicableTaxes,
  type FoundingOfferDisclosureTerms,
  type LandingBillingPolicyTerms
} from "./disclosures"

/** Placeholder offer terms. The real ones are the founder's (COM-1, deferred to 2026-11-24). */
const OFFER: FoundingOfferDisclosureTerms = {
  afterCancel: "cycles_resume",
  closesOn: null,
  cohort: "the Willamette Valley basin",
  cohortLimit: 10,
  paidCycles: 6,
  percentOff: 50,
  placesLeft: 4,
  reminderDaysBefore: 14
}

/** The draft's proposed values (docs/legal/billing-terms-draft.md), not decided terms. */
const POLICY: LandingBillingPolicyTerms = {
  billingContact: "billing@example.test",
  graceDays: 7,
  paymentRetries: 4,
  priceChangeNoticeDays: 30,
  unpaidDataKeptDays: 90
}

const STARTS_ON = "2026-12-18"

const PLANS: ReadonlyArray<{ code: LandingPlanCode; name: string; base: string; founding: string; baseCents: number; foundingCents: number }> = [
  { base: "$149", baseCents: 14_900, code: "basic", founding: "$74.50", foundingCents: 7_450, name: "Basic" },
  { base: "$299", baseCents: 29_900, code: "pro", founding: "$149.50", foundingCents: 14_950, name: "Pro" },
  { base: "$499", baseCents: 49_900, code: "regional", founding: "$249.50", foundingCents: 24_950, name: "Regional" }
]

const BOOSTS: ReadonlyArray<{ code: BoostPackageCode; name: string; price: string; days: number }> = [
  { code: "quick", days: 7, name: "Quick Boost", price: "$99" },
  { code: "extended", days: 14, name: "Extended Boost", price: "$149" },
  { code: "campaign", days: 28, name: "Campaign Boost", price: "$199" }
]

function founding(planCode: LandingPlanCode, offer: Partial<FoundingOfferDisclosureTerms> = {}, startsOn: string | null = STARTS_ON) {
  return foundingOfferDisclosure({ offer: { ...OFFER, ...offer }, planCode, startsOn })
}

function checkout(planCode: LandingPlanCode, policy: Partial<LandingBillingPolicyTerms> = {}, startsOn = STARTS_ON) {
  return landingPlanCheckoutDisclosure({ planCode, policy: { ...POLICY, ...policy }, startsOn })
}

afterEach(() => {
  vi.doUnmock("../../membership")
  vi.resetModules()
})

describe("founding-offer disclosure (legal review §10 Q4)", () => {
  it("Basic $74.50 instead of $149, Pro $149.50 instead of $299, Regional $249.50 instead of $499", () => {
    expect(founding("basic").statements.price).toBe("Price: the Basic plan at $74.50 per month instead of $149 per month, plus applicable taxes. That is 50% off.")
    expect(founding("pro").statements.price).toBe("Price: the Pro plan at $149.50 per month instead of $299 per month, plus applicable taxes. That is 50% off.")
    expect(founding("regional").statements.price).toBe(
      "Price: the Regional plan at $249.50 per month instead of $499 per month, plus applicable taxes. That is 50% off."
    )
  })

  it.each(PLANS)("$name: the base price comes from LANDING_PLANS and the founding price matches the blueprint's", (plan) => {
    const disclosure = founding(plan.code)

    expect(disclosure.basePriceCents).toBe(LANDING_PLANS[plan.code].monthlyPriceCents)
    expect(disclosure.basePriceCents).toBe(plan.baseCents)
    expect(disclosure.foundingPriceCents).toBe(plan.foundingCents)
    expect(disclosure.foundingPriceCents).toBe(foundingOperatorCyclePriceCents(plan.code, 1))
    expect(foundingOfferPriceCents(plan.code, 50)).toBe(plan.foundingCents)
    expect(disclosure.paidCycles).toBe(6)
    expect(disclosure.planCode).toBe(plan.code)
  })

  it.each(PLANS)("$name: renews at the full price until cancelled, and names the date of the first full-price charge", (plan) => {
    const disclosure = founding(plan.code)

    expect(disclosure.firstFullPriceChargeOn).toBe("2027-06-18")
    expect(disclosure.statements.renewal).toBe(
      `What happens next: after those 6 cycles, your ${plan.name} plan renews automatically at the full price of ${plan.base} per month, ` +
        "plus applicable taxes, each month until you cancel. Your first full-price charge is on June 18, 2027, if each payment before then goes through."
    )
  })

  it.each(PLANS)("$name: states who qualifies, the limit, the six paid cycles and what ends the offer", (plan) => {
    const { statements } = founding(plan.code)

    expect(statements.qualifier).toBe(
      "Who qualifies: a landing business with a current business identity review by LogLoads and an operation in the Willamette Valley basin. " +
        "Each legal organization can get one founding offer, however many accounts it has."
    )
    expect(statements.limit).toBe("Limit: the first 10 qualifying landing businesses to subscribe in the Willamette Valley basin. 4 of the 10 places are left.")
    expect(statements.duration).toBe(
      "How long: your first 6 paid monthly billing cycles. A cycle counts only once its payment goes through, so a failed payment does not use one up."
    )
    expect(statements.planChange).toBe(
      "If you change plans: the discount applies to the new plan's price for the cycles you have left, and the change does not use one up."
    )
    expect(statements.cancellation).toBe(
      "How to cancel: online, at any time, in Billing, in no more steps than it took to subscribe. Your plan stays active until the end of the " +
        "billing cycle you paid for. If you subscribe again later, the founding price applies to the cycles you had left."
    )
    expect(statements.reminder).toBe("Reminder: we email you 14 days before your first full-price charge, with the full price and the date.")
    expect(statements.ending).toBe(
      "The founding price ends after your 6th paid monthly billing cycle. It also ends, and the full price applies from your next charge, " +
        "if we find that your business does not qualify or already has a founding offer under another account."
    )
    expect(statements.closing).toBe(
      "The offer closes when all 10 places are taken. It can't be transferred to another business or combined with any other discount, " +
        "and it does not apply to boosts."
    )
  })

  it("lists every statement once, in display order, and is never marked approved", () => {
    const disclosure = founding("basic")

    expect(Object.keys(disclosure.statements).sort()).toEqual([...FOUNDING_OFFER_DISCLOSURE_KEYS].sort())
    expect(disclosure.lines).toEqual(FOUNDING_OFFER_DISCLOSURE_KEYS.map((key) => disclosure.statements[key]))
    expect(disclosure.counselApproved).toBe(false)
    expect(disclosure.version).toBe(BILLING_DISCLOSURES_VERSION)
  })

  it("follows the offer's own terms, which are inputs because the founder sets them", () => {
    const disclosure = founding("basic", {
      afterCancel: "offer_ends",
      closesOn: "2027-03-31",
      cohortLimit: 5,
      paidCycles: 3,
      percentOff: 25,
      placesLeft: 1,
      reminderDaysBefore: 7
    })

    expect(disclosure.foundingPriceCents).toBe(11_175)
    expect(disclosure.firstFullPriceChargeOn).toBe("2027-03-18")
    expect(disclosure.statements.price).toBe("Price: the Basic plan at $111.75 per month instead of $149 per month, plus applicable taxes. That is 25% off.")
    expect(disclosure.statements.limit).toBe("Limit: the first 5 qualifying landing businesses to subscribe in the Willamette Valley basin. 1 of the 5 places is left.")
    expect(disclosure.statements.duration).toMatch(/^How long: your first 3 paid monthly billing cycles\. /)
    expect(disclosure.statements.renewal).toMatch(/^What happens next: after those 3 cycles, /)
    expect(disclosure.statements.renewal).toMatch(/Your first full-price charge is on March 18, 2027, if each payment before then goes through\.$/)
    expect(disclosure.statements.ending).toMatch(/^The founding price ends after your 3rd paid monthly billing cycle\. /)
    expect(disclosure.statements.reminder).toBe("Reminder: we email you 7 days before your first full-price charge, with the full price and the date.")
    expect(disclosure.statements.cancellation).toMatch(/ The founding offer ends when you cancel, and subscribing again does not bring it back\.$/)
    expect(disclosure.statements.closing).toBe(
      "The offer closes when all 5 places are taken or on March 31, 2027, whichever comes first. It can't be transferred to another business " +
        "or combined with any other discount, and it does not apply to boosts."
    )
  })

  it("words a single cycle and a single place", () => {
    const disclosure = founding("pro", { cohortLimit: 1, paidCycles: 1, percentOff: 12.5, placesLeft: 1 })

    expect(disclosure.statements.price).toBe("Price: the Pro plan at $261.63 per month instead of $299 per month, plus applicable taxes. That is 12.5% off.")
    expect(disclosure.statements.limit).toBe("Limit: the first qualifying landing business to subscribe in the Willamette Valley basin. That place is still open.")
    expect(disclosure.statements.duration).toMatch(/^How long: your first paid monthly billing cycle\. /)
    expect(disclosure.statements.renewal).toMatch(/^What happens next: after that cycle, /)
    expect(disclosure.statements.ending).toMatch(/^The founding price ends after your 1st paid monthly billing cycle\. /)
    expect(disclosure.statements.closing).toMatch(/^The offer closes when its place is taken\. /)
  })

  it("names which charge is the first at the full price before a start date is known (the offer page)", () => {
    const disclosure = founding("regional", {}, null)

    expect(disclosure.firstFullPriceChargeOn).toBeNull()
    expect(disclosure.statements.renewal).toBe(
      "What happens next: after those 6 cycles, your Regional plan renews automatically at the full price of $499 per month, plus applicable taxes, " +
        "each month until you cancel. Your first full-price charge is your 7th monthly charge, if each payment before it goes through."
    )
  })

  it("refuses terms it cannot state truthfully", () => {
    const refuses = (offer: Partial<FoundingOfferDisclosureTerms>, startsOn: string | null = STARTS_ON) =>
      expect(() => founding("basic", offer, startsOn)).toThrow(RangeError)

    for (const percentOff of [0, 100, -5, 33.333, Number.NaN]) refuses({ percentOff })
    for (const paidCycles of [0, 37, 1.5]) refuses({ paidCycles })
    for (const cohortLimit of [0, 2.5]) refuses({ cohortLimit })
    for (const placesLeft of [0, 11]) refuses({ placesLeft })
    for (const reminderDaysBefore of [6, 22]) refuses({ reminderDaysBefore })
    for (const cohort of ["   ", "the guaranteed basin", "a lifetime basin", "x".repeat(81), "two\nlines"]) refuses({ cohort })
    for (const closesOn of ["2026-12-17", "2027-02-30", "next spring"]) refuses({ closesOn })
    refuses({ afterCancel: "sometimes" as FoundingOfferDisclosureTerms["afterCancel"] })
    for (const startsOn of ["2026-12-1", "2026-13-01", "2026-02-29", "0099-01-01"]) refuses({}, startsOn)
    expect(() => founding("dispatch_pro" as LandingPlanCode)).toThrow()
  })
})

describe("plan checkout disclosure (legal review §10 Q7)", () => {
  it.each(PLANS)("$name: renews at the full price from the first charge, plus applicable taxes", (plan) => {
    const disclosure = checkout(plan.code)

    expect(disclosure.basePriceCents).toBe(LANDING_PLANS[plan.code].monthlyPriceCents)
    expect(disclosure.firstChargeOn).toBe(STARTS_ON)
    expect(disclosure.firstFullPriceChargeOn).toBe(STARTS_ON)
    expect(disclosure.foundingOffer).toBeNull()
    expect(disclosure.statements.renewal).toBe(
      `Your ${plan.name} plan renews automatically at ${plan.base} per month, plus applicable taxes, each month until you cancel. ` +
        "Your first charge is on December 18, 2026."
    )
    expect(disclosure.statements.price).toBe(`Price: ${plan.base} per month for the ${plan.name} plan, plus applicable taxes.`)
    expect(disclosure.lines).toEqual(PLAN_CHECKOUT_DISCLOSURE_KEYS.map((key) => disclosure.statements[key]))
    expect(disclosure.counselApproved).toBe(false)
  })

  it.each(PLANS)("$name with the founding offer: the founding price, then the full price from a named date", (plan) => {
    const disclosure = landingPlanCheckoutDisclosure({ foundingOffer: OFFER, planCode: plan.code, policy: POLICY, startsOn: STARTS_ON })

    expect(disclosure.firstChargeOn).toBe(STARTS_ON)
    expect(disclosure.firstFullPriceChargeOn).toBe("2027-06-18")
    expect(disclosure.statements.price).toBe(
      `Price: ${plan.founding} per month for the ${plan.name} plan for your first 6 paid monthly billing cycles, then ${plan.base} per month, plus applicable taxes.`
    )
    expect(disclosure.statements.renewal).toBe(
      `Your ${plan.name} plan renews automatically each month until you cancel. After your first 6 paid monthly billing cycles at the founding price, ` +
        `it renews at the full price of ${plan.base} per month, plus applicable taxes. Your first full-price charge is on June 18, 2027, ` +
        "if each payment before then goes through."
    )
    expect(disclosure.foundingOffer).toEqual(founding(plan.code))
  })

  it("shows the founding statements first at checkout, then the plan's, without saying anything twice", () => {
    const disclosure = landingPlanCheckoutDisclosure({ foundingOffer: OFFER, planCode: "basic", policy: POLICY, startsOn: STARTS_ON })
    const offer = founding("basic")

    expect(disclosure.lines).toEqual([
      ...offer.lines,
      ...PLAN_CHECKOUT_DISCLOSURE_KEYS.filter((key) => !["renewal", "price", "cancellation"].includes(key)).map((key) => disclosure.statements[key])
    ])
    expect(new Set(disclosure.lines).size).toBe(disclosure.lines.length)
  })

  it("states every Q7 term, with the numbers from the policy inputs", () => {
    const { statements } = checkout("basic")

    expect(statements.billingDay).toBe("You are billed on the 18th of each month.")
    expect(statements.taxes).toBe("Prices are plus applicable taxes. Any tax is added to the charge and shown on its invoice.")
    expect(statements.priceChange).toBe("If the price changes, we email you at least 30 days before the new price applies, and you can cancel before then.")
    expect(statements.upgrade).toBe(
      "Upgrading takes effect at once. You pay a prorated charge for the rest of the current billing cycle, and you see the amount before you confirm."
    )
    expect(statements.downgrade).toBe(
      "Downgrading takes effect at your next renewal, with no refund for the current billing cycle. If you then have more active landings or team " +
        "members than the new plan allows, nothing is deleted and nobody is removed. Until you are back within the plan, you can't start a landing, " +
        "publish a job or send an invitation, and while you have too many team members you can't add one."
    )
    expect(statements.invitations).toBe(
      "Targeted invitations belong to the billing cycle. A plan change moves this cycle's allowance to the new plan's number, and invitations " +
        "you already sent still count. Unused invitations don't roll over."
    )
    expect(statements.failedPayment).toBe(
      "If a payment fails, we try it again up to 4 times within 7 days, and your plan keeps working meanwhile. If it still hasn't gone through " +
        "after 7 days, your plan stops: your jobs are unpublished, not deleted, and we keep your data for 90 days. Paying restores the plan, " +
        "and you can then reactivate your landings and publish your jobs again."
    )
    expect(statements.noPause).toBe("LogLoads doesn't offer pausing a plan. To stop paying, cancel.")
    expect(statements.cancellation).toBe(
      "You can cancel online at any time in Billing, in no more steps than it took to subscribe. Your plan stays active until the end of the " +
        "billing cycle you paid for, and then it stops renewing."
    )
    expect(statements.refunds).toBe(
      "We don't refund part of a billing cycle unless the law requires it. If we charged you by mistake, we refund that charge. " +
        "Ask about a refund at billing@example.test."
    )
    expect(statements.suspension).toBe(
      "If we suspend your account for breaking the Terms, your plan stops renewing and no refund is due for the current billing cycle."
    )
    expect(statements.disputes).toBe(
      "If a charge looks wrong, contact us first at billing@example.test. If you dispute it with your card issuer instead, the disputed " +
        "billing cycle counts as unpaid until the dispute is closed."
    )
  })

  it("words other policy values, including one retry and one day", () => {
    const { statements } = checkout("pro", { graceDays: 1, paymentRetries: 1, priceChangeNoticeDays: 45, unpaidDataKeptDays: 30 })

    expect(statements.failedPayment).toMatch(/^If a payment fails, we try it again once within 1 day, and your plan keeps working meanwhile\. /)
    expect(statements.failedPayment).toMatch(/ after 1 day, your plan stops: .* we keep your data for 30 days\. /)
    expect(statements.priceChange).toMatch(/ at least 45 days before /)
  })

  it("bills on the first charge's day of the month, or the last day of a shorter month", () => {
    const billingDay = (startsOn: string) => checkout("basic", {}, startsOn).statements.billingDay

    expect(billingDay("2027-01-31")).toBe("You are billed on the 31st of each month, or on the last day of a shorter month.")
    expect(billingDay("2027-03-29")).toBe("You are billed on the 29th of each month, or on the last day of a shorter month.")
    expect(billingDay("2027-01-28")).toBe("You are billed on the 28th of each month.")
    expect(["01", "02", "03", "04", "11", "12", "13", "21", "22", "23"].map((day) => billingDay(`2027-01-${day}`).split(" ")[5])).toEqual([
      "1st",
      "2nd",
      "3rd",
      "4th",
      "11th",
      "12th",
      "13th",
      "21st",
      "22nd",
      "23rd"
    ])
  })

  it("refuses policy values it cannot state", () => {
    const refuses = (policy: Partial<LandingBillingPolicyTerms>) => expect(() => checkout("basic", policy)).toThrow(RangeError)

    for (const graceDays of [0, 61, 7.5]) refuses({ graceDays })
    for (const paymentRetries of [0, 11]) refuses({ paymentRetries })
    for (const unpaidDataKeptDays of [0, 366]) refuses({ unpaidDataKeptDays })
    for (const priceChangeNoticeDays of [0, 366]) refuses({ priceChangeNoticeDays })
    for (const billingContact of ["", "  ", "a guaranteed reply", "line\nbreak"]) refuses({ billingContact })
    expect(() => checkout("basic", {}, "18 December 2026")).toThrow(RangeError)
  })
})

describe("billing cycle dates", () => {
  it("counts paid cycles in calendar months from the first charge, held to the last day of a shorter month", () => {
    expect(landingBillingCycleDate("2026-12-18", 1)).toBe("2026-12-18")
    expect(landingBillingCycleDate("2026-12-18", 2)).toBe("2027-01-18")
    expect(landingBillingCycleDate("2026-12-18", 7)).toBe("2027-06-18")
    expect(landingBillingCycleDate("2027-01-31", 2)).toBe("2027-02-28")
    expect(landingBillingCycleDate("2027-01-31", 3)).toBe("2027-03-31")
    expect(landingBillingCycleDate("2028-01-31", 2)).toBe("2028-02-29")
    expect(landingBillingCycleDate("2026-08-31", 7)).toBe("2027-02-28")
    expect(landingBillingCycleDate("2026-12-18", 25)).toBe("2028-12-18")
    expect(() => landingBillingCycleDate("2026-12-18", 0)).toThrow(RangeError)
    expect(() => landingBillingCycleDate("2026-12-18", 1.5)).toThrow(RangeError)
  })
})

describe("boost checkout disclosure (legal review §10 Q7, item 10)", () => {
  it.each(BOOSTS)("$name: a one-time $price, plus applicable taxes, for $days consecutive days", (boost) => {
    const disclosure = boostCheckoutDisclosure({ packageCode: boost.code, unusedDays: "not_refunded" })

    expect(disclosure.priceCents).toBe(BOOST_PACKAGES[boost.code].priceCents)
    expect(disclosure.durationDays).toBe(boost.days)
    expect(disclosure.radiusMiles).toBe(100)
    expect(disclosure.statements.price).toBe(`${boost.name}: ${boost.price}, a one-time charge, plus applicable taxes. It never renews.`)
    expect(disclosure.statements.placement).toBe(
      `It shows one job as Sponsored to haulers within about 100 miles of the job's public landing area, for ${boost.days} consecutive days ` +
        "from the moment your payment goes through."
    )
    expect(disclosure.statements.noPromise).toBe(
      "A boost buys placement only. It does not promise views, inquiries, trucks or hires, and it adds no targeted invitations."
    )
    expect(disclosure.statements.jobStops).toBe(
      "If the job is paused, filled or removed, the boost ends early and does not restart. Unused days are not refunded."
    )
    expect(disclosure.statements.founding).toBe("The founding offer does not discount boosts.")
    expect(disclosure.lines).toEqual(BOOST_CHECKOUT_DISCLOSURE_KEYS.map((key) => disclosure.statements[key]))
    expect(disclosure.counselApproved).toBe(false)
  })

  it("states the unused-days rule it is given, and refuses others", () => {
    expect(boostCheckoutDisclosure({ packageCode: "extended", unusedDays: "refunded_pro_rata" }).statements.jobStops).toBe(
      "If the job is paused, filled or removed, the boost ends early and does not restart. We refund the unused days, pro rata."
    )
    expect(() => boostCheckoutDisclosure({ packageCode: "extended", unusedDays: "credited" as "not_refunded" })).toThrow(RangeError)
    expect(() => boostCheckoutDisclosure({ packageCode: "mega" as BoostPackageCode, unusedDays: "not_refunded" })).toThrow()
  })

  it("rests on the blueprint rule that founding offers do not discount boosts (§8.1)", () => {
    expect(FOUNDING_OPERATOR_OFFER.discountsBoosts).toBe(false)
  })
})

describe("every disclosure", () => {
  function everyLine(): string[] {
    const lines: string[] = []

    for (const plan of PLANS) {
      for (const startsOn of [STARTS_ON, "2027-01-31", null]) {
        for (const afterCancel of ["cycles_resume", "offer_ends"] as const) {
          for (const closesOn of [null, "2027-12-31"]) {
            lines.push(...founding(plan.code, { afterCancel, closesOn }, startsOn).lines)
          }
        }
      }
      lines.push(...checkout(plan.code).lines)
      lines.push(...landingPlanCheckoutDisclosure({ foundingOffer: OFFER, planCode: plan.code, policy: POLICY, startsOn: "2027-01-31" }).lines)
    }

    for (const boost of BOOSTS) {
      for (const unusedDays of ["not_refunded", "refunded_pro_rata"] as const) {
        lines.push(...boostCheckoutDisclosure({ packageCode: boost.code, unusedDays }).lines)
      }
    }

    return lines
  }

  it("never says lifetime, locked or guaranteed", () => {
    const lines = everyLine()

    expect(lines.length).toBeGreaterThan(100)
    for (const line of lines) {
      expect(line).not.toMatch(/lifetime|locked|guarantee/i)
      expect(BILLING_DISCLOSURE_FORBIDDEN_WORDS.test(line)).toBe(false)
      expect(line).not.toMatch(/undefined|NaN|null|\[object/)
    }
  })

  it("forbids the promise words, and only those", () => {
    for (const promise of ["a lifetime price", "Locked in", "a price lock", "lock-in pricing", "guaranteed", "we guarantee it", "free forever", "permanently"]) {
      expect(BILLING_DISCLOSURE_FORBIDDEN_WORDS.test(promise)).toBe(true)
    }
    for (const plain of ["blocked", "a clock", "unlocked"]) {
      expect(BILLING_DISCLOSURE_FORBIDDEN_WORDS.test(plain)).toBe(false)
    }
  })

  it("puts the tax words with every price", () => {
    const priced = everyLine().filter((line) => /\$\d/.test(line))

    expect(priced.length).toBeGreaterThan(0)
    for (const line of priced) expect(line).toContain(BILLING_TAX_SUFFIX)
    expect(withApplicableTaxes("$149 per month")).toBe("$149 per month, plus applicable taxes")
  })

  it("writes monthly prices the way the public plan cards do", () => {
    for (const plan of PLANS) {
      expect(checkout(plan.code).statements.price).toContain(formatLandingPlanPrice(LANDING_PLANS[plan.code]))
    }
  })

  it("reads every price from LANDING_PLANS and BOOST_PACKAGES, never from its own copy", async () => {
    vi.resetModules()
    vi.doMock("../../membership", async (importOriginal) => {
      const actual = await importOriginal<typeof membership>()

      return {
        ...actual,
        BOOST_PACKAGES: { ...actual.BOOST_PACKAGES, quick: { ...actual.BOOST_PACKAGES.quick, priceCents: 5_000 } },
        LANDING_PLANS: { ...actual.LANDING_PLANS, basic: { ...actual.LANDING_PLANS.basic, monthlyPriceCents: 10_000 } }
      }
    })
    const repriced = await import("./disclosures")

    expect(repriced.foundingOfferDisclosure({ offer: OFFER, planCode: "basic", startsOn: STARTS_ON }).statements.price).toBe(
      "Price: the Basic plan at $50 per month instead of $100 per month, plus applicable taxes. That is 50% off."
    )
    expect(repriced.landingPlanCheckoutDisclosure({ planCode: "basic", policy: POLICY, startsOn: STARTS_ON }).statements.price).toBe(
      "Price: $100 per month for the Basic plan, plus applicable taxes."
    )
    expect(repriced.boostCheckoutDisclosure({ packageCode: "quick", unusedDays: "not_refunded" }).statements.price).toBe(
      "Quick Boost: $50, a one-time charge, plus applicable taxes. It never renews."
    )
  })

  it("is a dated draft for counsel", () => {
    expect(BILLING_DISCLOSURES_VERSION).toBe("billing-disclosures-draft-2026-11-18")
  })
})
