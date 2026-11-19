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
  HELD_FOUNDING_OFFER_DISCLOSURE_KEYS,
  PLAN_CHECKOUT_DISCLOSURE_KEYS,
  boostCheckoutDisclosure,
  foundingOfferDisclosure,
  foundingOfferPriceCents,
  heldFoundingOfferDisclosure,
  landingBillingCycleDate,
  landingPlanCheckoutDisclosure,
  withApplicableTaxes,
  type FoundingOfferDisclosureTerms,
  type HeldFoundingOfferDisclosureTerms,
  type LandingBillingPolicyTerms
} from "./disclosures"

/** Placeholder offer terms. The real ones are the founder's (COM-1, deferred to 2026-11-24). */
const OFFER: FoundingOfferDisclosureTerms = {
  afterCancel: "cycles_resume",
  closesOn: null,
  grantLimit: 10,
  paidCycles: 6,
  percentOff: 50,
  placesLeft: 4,
  reminderDaysBefore: 14,
  stateCode: "OR"
}

/** The same placeholder offer, held by a business that has not paid a founding cycle yet. */
const HELD: HeldFoundingOfferDisclosureTerms = {
  afterCancel: "cycles_resume",
  cyclesLeft: 6,
  paidCycles: 6,
  percentOff: 50,
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

const TODAY = "2026-11-18"
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

function offerPage(planCode: LandingPlanCode, offer: Partial<FoundingOfferDisclosureTerms> = {}, today = TODAY) {
  return foundingOfferDisclosure({ offer: { ...OFFER, ...offer }, planCode, today })
}

function held(planCode: LandingPlanCode, offer: Partial<HeldFoundingOfferDisclosureTerms> = {}, startsOn = STARTS_ON) {
  return heldFoundingOfferDisclosure({ offer: { ...HELD, ...offer }, planCode, startsOn })
}

function checkout(
  planCode: LandingPlanCode,
  policy: Partial<LandingBillingPolicyTerms> = {},
  startsOn = STARTS_ON,
  foundingOffer: Partial<HeldFoundingOfferDisclosureTerms> | null = null
) {
  return landingPlanCheckoutDisclosure({
    foundingOffer: foundingOffer === null ? null : { ...HELD, ...foundingOffer },
    planCode,
    policy: { ...POLICY, ...policy },
    startsOn
  })
}

/** Every dollar amount in a line, and those followed at once by the tax words. */
const PRICE = /\$\d[\d,]*(?:\.\d{2})?/g
const TAXED_PRICE = /\$\d[\d,]*(?:\.\d{2})?(?: per month|, a one-time charge)?, plus applicable taxes/g

function untaxedPrices(line: string): number {
  return (line.match(PRICE)?.length ?? 0) - (line.match(TAXED_PRICE)?.length ?? 0)
}

afterEach(() => {
  vi.doUnmock("../../membership")
  vi.resetModules()
})

describe("founding-offer page (legal review §10 Q4)", () => {
  it("Basic $74.50 instead of $149, Pro $149.50 instead of $299, Regional $249.50 instead of $499, each plus applicable taxes", () => {
    expect(offerPage("basic").statements.price).toBe(
      "Price: the Basic plan at $74.50 per month, plus applicable taxes, instead of $149 per month, plus applicable taxes. That is 50% off."
    )
    expect(offerPage("pro").statements.price).toBe(
      "Price: the Pro plan at $149.50 per month, plus applicable taxes, instead of $299 per month, plus applicable taxes. That is 50% off."
    )
    expect(offerPage("regional").statements.price).toBe(
      "Price: the Regional plan at $249.50 per month, plus applicable taxes, instead of $499 per month, plus applicable taxes. That is 50% off."
    )
  })

  it("has its own taxes line", () => {
    const disclosure = offerPage("basic")

    expect(disclosure.statements.taxes).toBe("Prices are plus applicable taxes. Any tax is added to the charge and shown on its invoice.")
    expect(disclosure.lines.indexOf(disclosure.statements.taxes)).toBe(disclosure.lines.indexOf(disclosure.statements.price) + 1)
  })

  it.each(PLANS)("$name: the base price comes from LANDING_PLANS and the founding price matches the blueprint's", (plan) => {
    const disclosure = offerPage(plan.code)

    expect(disclosure.basePriceCents).toBe(LANDING_PLANS[plan.code].monthlyPriceCents)
    expect(disclosure.basePriceCents).toBe(plan.baseCents)
    expect(disclosure.foundingPriceCents).toBe(plan.foundingCents)
    expect(disclosure.foundingPriceCents).toBe(foundingOperatorCyclePriceCents(plan.code, 1))
    expect(foundingOfferPriceCents(plan.code, 50)).toBe(plan.foundingCents)
    expect(disclosure.paidCycles).toBe(6)
    expect(disclosure.planCode).toBe(plan.code)
  })

  it.each(PLANS)("$name: renews at the full price until cancelled, and names which charge is the first at the full price", (plan) => {
    expect(offerPage(plan.code).statements.renewal).toBe(
      `What happens next: after those 6 cycles, your ${plan.name} plan renews automatically at the full price of ${plan.base} per month, ` +
        "plus applicable taxes, each month until you cancel. Your first full-price charge is your 7th monthly charge, if each payment before it goes through."
    )
  })

  it.each(PLANS)("$name: states who qualifies, the limit, the six paid cycles and when the offer closes", (plan) => {
    const { statements } = offerPage(plan.code)

    expect(statements.qualifier).toBe(
      "Who qualifies: a landing business with a current business identity review by LogLoads and Oregon as the home state on its LogLoads account. " +
        "Each legal organization can get one founding offer, however many accounts it has."
    )
    expect(statements.limit).toBe(
      "Limit: LogLoads grants the offer to no more than 10 qualifying landing businesses whose home state is Oregon. A place is taken when " +
        "LogLoads grants the offer, not when the business subscribes. 4 of the 10 places are left."
    )
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
    expect(statements.ending).toBe("The founding price ends after your 6th paid monthly billing cycle.")
    expect(statements.closing).toBe(
      "The offer closes to new businesses when all 10 places are taken. Closing does not end the offer for a business that already has it. " +
        "It can't be transferred to another business or combined with any other discount, and it does not apply to boosts."
    )
  })

  it("words the limit as the store counts it: admin grants, matched to the business's home state", () => {
    for (const line of offerPage("basic").lines) {
      expect(line).not.toMatch(/to subscribe in|first \d+ qualifying|basin|an operation in/)
    }
  })

  it("makes no early-removal promise, because no store function revokes a redemption", () => {
    for (const line of [...offerPage("basic").lines, ...held("basic").lines, ...held("basic", { cyclesLeft: 2 }).lines]) {
      expect(line).not.toMatch(/does not qualify|under another account|also ends/)
    }
  })

  it("lists every statement once, in display order, and is never marked approved", () => {
    const disclosure = offerPage("basic")

    expect(Object.keys(disclosure.statements).sort()).toEqual([...FOUNDING_OFFER_DISCLOSURE_KEYS].sort())
    expect(disclosure.lines).toEqual(FOUNDING_OFFER_DISCLOSURE_KEYS.map((key) => disclosure.statements[key]))
    expect(disclosure.counselApproved).toBe(false)
    expect(disclosure.version).toBe(BILLING_DISCLOSURES_VERSION)
  })

  it("follows the offer's own terms, which are inputs because the founder sets them", () => {
    const disclosure = offerPage("basic", {
      afterCancel: "offer_ends",
      closesOn: "2027-03-31",
      grantLimit: 5,
      paidCycles: 3,
      percentOff: 25,
      placesLeft: 1,
      reminderDaysBefore: 7,
      stateCode: "WA"
    })

    expect(disclosure.foundingPriceCents).toBe(11_175)
    expect(disclosure.statements.price).toBe(
      "Price: the Basic plan at $111.75 per month, plus applicable taxes, instead of $149 per month, plus applicable taxes. That is 25% off."
    )
    expect(disclosure.statements.qualifier).toMatch(/ and Washington as the home state on its LogLoads account\. /)
    expect(disclosure.statements.limit).toBe(
      "Limit: LogLoads grants the offer to no more than 5 qualifying landing businesses whose home state is Washington. A place is taken when " +
        "LogLoads grants the offer, not when the business subscribes. 1 of the 5 places is left."
    )
    expect(disclosure.statements.duration).toMatch(/^How long: your first 3 paid monthly billing cycles\. /)
    expect(disclosure.statements.renewal).toMatch(/^What happens next: after those 3 cycles, /)
    expect(disclosure.statements.renewal).toMatch(/ Your first full-price charge is your 4th monthly charge, if each payment before it goes through\.$/)
    expect(disclosure.statements.ending).toBe("The founding price ends after your 3rd paid monthly billing cycle.")
    expect(disclosure.statements.reminder).toBe("Reminder: we email you 7 days before your first full-price charge, with the full price and the date.")
    expect(disclosure.statements.cancellation).toMatch(/ The founding offer ends when you cancel, and subscribing again does not bring it back\.$/)
    expect(disclosure.statements.closing).toBe(
      "The offer closes to new businesses when all 5 places are taken or on March 31, 2027, whichever comes first. Closing does not end the " +
        "offer for a business that already has it. It can't be transferred to another business or combined with any other discount, and it " +
        "does not apply to boosts."
    )
  })

  it("words a single cycle and a single place", () => {
    const disclosure = offerPage("pro", { grantLimit: 1, paidCycles: 1, percentOff: 12.5, placesLeft: 1 })

    expect(disclosure.statements.price).toBe(
      "Price: the Pro plan at $261.63 per month, plus applicable taxes, instead of $299 per month, plus applicable taxes. That is 12.5% off."
    )
    expect(disclosure.statements.limit).toBe(
      "Limit: LogLoads grants the offer to one qualifying landing business whose home state is Oregon. The place is taken when LogLoads " +
        "grants the offer, not when the business subscribes. That place is still open."
    )
    expect(disclosure.statements.duration).toMatch(/^How long: your first paid monthly billing cycle\. /)
    expect(disclosure.statements.renewal).toMatch(/^What happens next: after that cycle, /)
    expect(disclosure.statements.renewal).toMatch(/ your 2nd monthly charge, /)
    expect(disclosure.statements.ending).toBe("The founding price ends after your 1st paid monthly billing cycle.")
    expect(disclosure.statements.closing).toMatch(/^The offer closes to new businesses when its place is taken\. /)
  })

  it("refuses a closing date that has passed (the offer page on 2027-04-02, closing 2027-03-31), and shows the offer on its last day", () => {
    expect(() => offerPage("basic", { closesOn: "2027-03-31" }, "2027-04-02")).toThrow(RangeError)
    expect(() => offerPage("basic", { closesOn: "2027-03-31" }, "2027-04-01")).toThrow(RangeError)
    expect(offerPage("basic", { closesOn: "2027-03-31" }, "2027-03-31").statements.closing).toMatch(
      /^The offer closes to new businesses when all 10 places are taken or on March 31, 2027, whichever comes first\. /
    )
  })

  it("refuses terms it cannot state truthfully", () => {
    const refuses = (offer: Partial<FoundingOfferDisclosureTerms>, today = TODAY) => expect(() => offerPage("basic", offer, today)).toThrow(RangeError)

    for (const percentOff of [0, 100, -5, 33.333, Number.NaN]) refuses({ percentOff })
    for (const paidCycles of [0, 37, 1.5]) refuses({ paidCycles })
    for (const grantLimit of [0, 2.5, 10_001]) refuses({ grantLimit })
    for (const placesLeft of [0, 11]) refuses({ placesLeft })
    for (const reminderDaysBefore of [6, 22]) refuses({ reminderDaysBefore })
    for (const stateCode of ["", "or", "Oregon", "ZZ", "DC", "constructor", "__proto__"]) refuses({ stateCode })
    for (const closesOn of ["2026-11-17", "2027-02-30", "next spring"]) refuses({ closesOn })
    refuses({ afterCancel: "sometimes" as FoundingOfferDisclosureTerms["afterCancel"] })
    for (const today of ["2026-11-1", "2026-13-01", "18 November 2026", "0099-01-01"]) refuses({}, today)
    expect(() => offerPage("dispatch_pro" as LandingPlanCode)).toThrow()
  })
})

describe("a founding offer the business already holds, at checkout (#409)", () => {
  it.each(PLANS)("$name, first checkout after the grant: the founding price, then the full price from a named date", (plan) => {
    const disclosure = held(plan.code)

    expect(disclosure.basePriceCents).toBe(plan.baseCents)
    expect(disclosure.foundingPriceCents).toBe(plan.foundingCents)
    expect(disclosure.paidCycles).toBe(6)
    expect(disclosure.cyclesLeft).toBe(6)
    expect(disclosure.firstFullPriceChargeOn).toBe("2027-06-18")
    expect(disclosure.statements.held).toBe(
      "Founding offer: LogLoads has granted it to your business, and the offer closing to other businesses does not end yours. " +
        "It can't be transferred to another business or combined with any other discount, and it does not apply to boosts."
    )
    expect(disclosure.statements.price).toBe(
      `Price: the ${plan.name} plan at ${plan.founding} per month, plus applicable taxes, instead of ${plan.base} per month, plus applicable taxes. That is 50% off.`
    )
    expect(disclosure.statements.duration).toBe(
      "How long: your first 6 paid monthly billing cycles. A cycle counts only once its payment goes through, so a failed payment does not use one up."
    )
    expect(disclosure.statements.renewal).toBe(
      `What happens next: after those 6 cycles, your ${plan.name} plan renews automatically at the full price of ${plan.base} per month, ` +
        "plus applicable taxes, each month until you cancel. Your first full-price charge is on June 18, 2027, if each payment before then goes through."
    )
    expect(disclosure.statements.ending).toBe("The founding price ends after your 6th paid monthly billing cycle.")
  })

  it("6 cycles, 2 paid, a cancel, then a re-subscribe on 2027-03-10: 4 founding cycles, and full price from 2027-07-10", () => {
    const disclosure = checkout("basic", {}, "2027-03-10", { cyclesLeft: 4 })
    const offer = disclosure.foundingOffer

    expect(disclosure.firstChargeOn).toBe("2027-03-10")
    expect(landingBillingCycleDate("2027-03-10", 4)).toBe("2027-06-10")
    expect(disclosure.firstFullPriceChargeOn).toBe("2027-07-10")
    expect(offer?.cyclesLeft).toBe(4)
    expect(offer?.firstFullPriceChargeOn).toBe("2027-07-10")
    expect(offer?.statements.duration).toBe(
      "How long: your next 4 paid monthly billing cycles. You have used 2 of your 6 founding cycles, and 4 are left. A cycle counts only " +
        "once its payment goes through, so a failed payment does not use one up."
    )
    expect(offer?.statements.renewal).toBe(
      "What happens next: after those 4 cycles, your Basic plan renews automatically at the full price of $149 per month, plus applicable " +
        "taxes, each month until you cancel. Your first full-price charge is on July 10, 2027, if each payment before then goes through."
    )
    expect(offer?.statements.ending).toBe(
      "The founding price ends after your 6th founding cycle in all, which is the 4th paid monthly billing cycle from this checkout."
    )
    expect(disclosure.statements.price).toBe(
      "Price: $74.50 per month, plus applicable taxes, for the Basic plan for your next 4 paid monthly billing cycles, then $149 per month, " +
        "plus applicable taxes."
    )
    expect(disclosure.statements.renewal).toBe(
      "Your Basic plan renews automatically each month until you cancel. After your next 4 paid monthly billing cycles at the founding price, " +
        "it renews at the full price of $149 per month, plus applicable taxes. Your first full-price charge is on July 10, 2027, if each " +
        "payment before then goes through."
    )
    for (const line of disclosure.lines) {
      expect(line).not.toMatch(/September 10, 2027|first 6 paid/)
    }
  })

  it("a business granted the 10th place still gets its checkout once no place is left, with no limit line", () => {
    expect(() => offerPage("pro", { placesLeft: 0 })).toThrow(RangeError)

    const disclosure = checkout("pro", {}, STARTS_ON, { cyclesLeft: 6 })

    expect(disclosure.foundingOffer).not.toBeNull()
    expect(Object.keys(disclosure.foundingOffer?.statements ?? {})).not.toContain("limit")
    for (const line of disclosure.lines) {
      expect(line).not.toMatch(/^Limit:|places? (?:is|are) left|place is still open/)
    }
  })

  it("a held offer checks out after the closing date (2027-04-02, the offer closed 2027-03-31)", () => {
    expect(() => offerPage("regional", { closesOn: "2027-03-31" }, "2027-04-02")).toThrow(RangeError)

    const disclosure = checkout("regional", {}, "2027-04-02", { cyclesLeft: 6 })

    expect(disclosure.firstFullPriceChargeOn).toBe("2027-10-02")
    expect(disclosure.foundingOffer?.statements.renewal).toMatch(/ Your first full-price charge is on October 2, 2027, /)
    for (const line of disclosure.lines) {
      expect(line).not.toMatch(/March 31, 2027|closes when/)
    }
  })

  it("words one cycle left, and an offer of one cycle", () => {
    const last = checkout("pro", {}, STARTS_ON, { cyclesLeft: 1 })

    expect(last.firstFullPriceChargeOn).toBe("2027-01-18")
    expect(last.foundingOffer?.statements.duration).toMatch(
      /^How long: your next paid monthly billing cycle\. You have used 5 of your 6 founding cycles, and 1 is left\. /
    )
    expect(last.foundingOffer?.statements.renewal).toMatch(/^What happens next: after that cycle, .* Your first full-price charge is on January 18, 2027, /)
    expect(last.foundingOffer?.statements.ending).toBe(
      "The founding price ends after your 6th founding cycle in all, which is the 1st paid monthly billing cycle from this checkout."
    )
    expect(last.statements.price).toMatch(/ for the Pro plan for your next paid monthly billing cycle, then \$299 per month, plus applicable taxes\.$/)

    const single = held("pro", { cyclesLeft: 1, paidCycles: 1 })

    expect(single.statements.duration).toMatch(/^How long: your first paid monthly billing cycle\. A cycle counts /)
    expect(single.statements.ending).toBe("The founding price ends after your 1st paid monthly billing cycle.")
  })

  it("states the after-cancel rule and the reminder it is given", () => {
    const disclosure = held("basic", { afterCancel: "offer_ends", reminderDaysBefore: 21 })

    expect(disclosure.statements.cancellation).toBe(
      "How to cancel: online, at any time, in Billing, in no more steps than it took to subscribe. Your plan stays active until the end of the " +
        "billing cycle you paid for. The founding offer ends when you cancel, and subscribing again does not bring it back."
    )
    expect(disclosure.statements.reminder).toBe("Reminder: we email you 21 days before your first full-price charge, with the full price and the date.")
    expect(disclosure.statements.planChange).toBe(offerPage("basic").statements.planChange)
  })

  it("lists every statement once, in display order, and is never marked approved", () => {
    const disclosure = held("basic", { cyclesLeft: 3 })

    expect(Object.keys(disclosure.statements).sort()).toEqual([...HELD_FOUNDING_OFFER_DISCLOSURE_KEYS].sort())
    expect(disclosure.lines).toEqual(HELD_FOUNDING_OFFER_DISCLOSURE_KEYS.map((key) => disclosure.statements[key]))
    expect(disclosure.counselApproved).toBe(false)
    expect(disclosure.version).toBe(BILLING_DISCLOSURES_VERSION)
  })

  it("refuses held terms it cannot state truthfully", () => {
    const refuses = (offer: Partial<HeldFoundingOfferDisclosureTerms>, startsOn = STARTS_ON) => expect(() => held("basic", offer, startsOn)).toThrow(RangeError)

    for (const cyclesLeft of [0, 7, 1.5, -1]) refuses({ cyclesLeft })
    for (const paidCycles of [0, 37]) refuses({ paidCycles })
    for (const percentOff of [0, 100, 33.333]) refuses({ percentOff })
    for (const reminderDaysBefore of [6, 22]) refuses({ reminderDaysBefore })
    refuses({ afterCancel: "sometimes" as HeldFoundingOfferDisclosureTerms["afterCancel"] })
    for (const startsOn of ["2026-12-1", "2026-02-29", "next month"]) refuses({}, startsOn)
    expect(() => checkout("basic", {}, STARTS_ON, { cyclesLeft: 0 })).toThrow(RangeError)
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
    expect(disclosure.statements.price).toBe(`Price: ${plan.base} per month, plus applicable taxes, for the ${plan.name} plan.`)
    expect(disclosure.lines).toEqual(PLAN_CHECKOUT_DISCLOSURE_KEYS.map((key) => disclosure.statements[key]))
    expect(disclosure.counselApproved).toBe(false)
  })

  it.each(PLANS)("$name with the founding offer: the founding price, then the full price from a named date", (plan) => {
    const disclosure = landingPlanCheckoutDisclosure({ foundingOffer: HELD, planCode: plan.code, policy: POLICY, startsOn: STARTS_ON })

    expect(disclosure.firstChargeOn).toBe(STARTS_ON)
    expect(disclosure.firstFullPriceChargeOn).toBe("2027-06-18")
    expect(disclosure.statements.price).toBe(
      `Price: ${plan.founding} per month, plus applicable taxes, for the ${plan.name} plan for your first 6 paid monthly billing cycles, then ` +
        `${plan.base} per month, plus applicable taxes.`
    )
    expect(disclosure.statements.renewal).toBe(
      `Your ${plan.name} plan renews automatically each month until you cancel. After your first 6 paid monthly billing cycles at the founding price, ` +
        `it renews at the full price of ${plan.base} per month, plus applicable taxes. Your first full-price charge is on June 18, 2027, ` +
        "if each payment before then goes through."
    )
    expect(disclosure.foundingOffer).toEqual(held(plan.code))
  })

  it("shows the founding statements first at checkout, then the plan's, without saying anything twice", () => {
    const disclosure = landingPlanCheckoutDisclosure({ foundingOffer: HELD, planCode: "basic", policy: POLICY, startsOn: STARTS_ON })
    const offer = held("basic")

    expect(disclosure.lines).toEqual([
      ...offer.lines,
      ...PLAN_CHECKOUT_DISCLOSURE_KEYS.filter((key) => !["renewal", "price", "cancellation"].includes(key)).map((key) => disclosure.statements[key])
    ])
    expect(disclosure.lines).toContain(disclosure.statements.taxes)
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
      for (const afterCancel of ["cycles_resume", "offer_ends"] as const) {
        for (const closesOn of [null, "2027-12-31"]) {
          for (const placesLeft of [1, 4]) {
            lines.push(...offerPage(plan.code, { afterCancel, closesOn, placesLeft }).lines)
          }
        }
        for (const startsOn of [STARTS_ON, "2027-01-31"]) {
          for (const cyclesLeft of [1, 4, 6]) {
            lines.push(...held(plan.code, { afterCancel, cyclesLeft }, startsOn).lines)
            lines.push(...checkout(plan.code, {}, startsOn, { afterCancel, cyclesLeft }).lines)
          }
        }
      }
      lines.push(...checkout(plan.code).lines)
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

  it("counts prices the way the tax check needs: the wording before #409 had a founding price without the tax words", () => {
    expect(untaxedPrices("Price: the Basic plan at $74.50 per month instead of $149 per month, plus applicable taxes. That is 50% off.")).toBe(1)
    expect(untaxedPrices("Price: $149 per month for the Basic plan, plus applicable taxes.")).toBe(1)
    expect(untaxedPrices("Price: the Basic plan at $74.50 per month, plus applicable taxes, instead of $149 per month, plus applicable taxes.")).toBe(0)
    expect(untaxedPrices("Quick Boost: $99, a one-time charge, plus applicable taxes. It never renews.")).toBe(0)
  })

  it("puts the tax words right after every price, as many times as there are prices", () => {
    const priced = everyLine().filter((line) => (line.match(PRICE)?.length ?? 0) > 0)

    expect(priced.length).toBeGreaterThan(50)
    for (const line of priced) {
      expect(line.match(TAXED_PRICE)?.length ?? 0).toBe(line.match(PRICE)?.length)
      expect(line.split(BILLING_TAX_SUFFIX).length - 1).toBe(line.match(PRICE)?.length)
    }
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

    expect(repriced.foundingOfferDisclosure({ offer: OFFER, planCode: "basic", today: TODAY }).statements.price).toBe(
      "Price: the Basic plan at $50 per month, plus applicable taxes, instead of $100 per month, plus applicable taxes. That is 50% off."
    )
    expect(repriced.heldFoundingOfferDisclosure({ offer: HELD, planCode: "basic", startsOn: STARTS_ON }).statements.price).toBe(
      "Price: the Basic plan at $50 per month, plus applicable taxes, instead of $100 per month, plus applicable taxes. That is 50% off."
    )
    expect(repriced.landingPlanCheckoutDisclosure({ planCode: "basic", policy: POLICY, startsOn: STARTS_ON }).statements.price).toBe(
      "Price: $100 per month, plus applicable taxes, for the Basic plan."
    )
    expect(repriced.boostCheckoutDisclosure({ packageCode: "quick", unusedDays: "not_refunded" }).statements.price).toBe(
      "Quick Boost: $50, a one-time charge, plus applicable taxes. It never renews."
    )
  })

  it("is a dated draft for counsel, with a new version id for the #409 wording", () => {
    expect(BILLING_DISCLOSURES_VERSION).toBe("billing-disclosures-draft-2026-11-18-r2")
  })
})
