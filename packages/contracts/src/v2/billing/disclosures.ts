/**
 * Billing disclosures (#345): what a checkout and the founding-offer page must say before a landing plan or a boost is
 * bought (legal review §10 Q4 and Q7, risk R9, gate D). A DRAFT FOR COUNSEL: every result carries
 * `counselApproved: false`, and docs/legal/billing-terms-draft.md is the text counsel reviews. Nothing here starts a
 * charge or makes anything purchasable (`MARKETPLACE_PLAN_NOT_PURCHASABLE`).
 *
 * Prices come from `LANDING_PLANS` and `BOOST_PACKAGES` (membership.ts) by code and are never typed here. Two kinds of
 * term are inputs instead of constants:
 * - the founding offer's terms, because its commercial terms stay with the founder (COM-1, deferred to 2026-11-24);
 * - the billing settings that the provider and the store must match: retries, grace days, data kept and notice days
 *   (Blueprint §16.2 leaves them open, so they are required, never defaulted).
 * The wording itself is the draft's position. Changing it means a new `BILLING_DISCLOSURES_VERSION`.
 *
 * The founding offer has two builders, because the store treats a business that has the offer differently from one
 * that does not (#409). Only a billing admin grants the offer (`admin_grant_founding_promotion`, 03_entitlements.sql),
 * before the business subscribes, so a checkout never takes up an open offer: it describes one the business holds.
 * - `foundingOfferDisclosure`: the offer page, for a business without the offer. It states the places left and the
 *   closing date, and refuses an offer that is full or has closed.
 * - `heldFoundingOfferDisclosure`: the checkout, for a business that holds the offer. The store attaches its grant
 *   whenever a subscription turns active with cycles left (`apply_subscription_cycle`,
 *   26_v2_team_seats_saved_jobs_outbox.sql), and checks neither the places nor the closing date then. So this builder
 *   takes neither, states no limit, and counts the full-price date from the cycles left.
 */

import { MARKETPLACE_VERIFICATION_SCOPE_LABELS } from "../../marketplace-v2"
import {
  BOOST_AUTO_RENEWS,
  BOOST_PACKAGES,
  BOOST_RADIUS_MILES,
  FOUNDING_OPERATOR_OFFER,
  LANDING_PLANS,
  boostPackageCodeSchema,
  landingPlanCodeSchema,
  type BoostPackage,
  type BoostPackageCode,
  type LandingPlan,
  type LandingPlanCode
} from "../../membership"

/** Stored with each acceptance, so a record shows which words the customer saw. `-r2` is the #409 wording. */
export const BILLING_DISCLOSURES_VERSION = "billing-disclosures-draft-2026-11-18-r2"

/** The tax words that sit with every price (legal review §10 Q1, item 3; the same words as /pricing). */
export const BILLING_TAX_SUFFIX = "plus applicable taxes"

/**
 * Promises no disclosure may make, because no term makes them true (legal review §10 Q4, item 10, and Q1 on "free
 * forever"). The builders refuse a text input that uses one, so a billing contact cannot slip one in.
 */
export const BILLING_DISCLOSURE_FORBIDDEN_WORDS = /\b(?:lifetime|lock(?:ed|s|-in)?|guarantee[ds]?|guaranteeing|forever|permanent(?:ly)?)\b/i

/** "$149 per month" becomes "$149 per month, plus applicable taxes". */
export function withApplicableTaxes(price: string): string {
  return `${price}, ${BILLING_TAX_SUFFIX}`
}

// ---------------------------------------------------------------------------
// Statement keys, in the order a page shows them
// ---------------------------------------------------------------------------

/** Legal review §10 Q4, items 1 to 10, on the offer page, with its own taxes line (item 3). */
export const FOUNDING_OFFER_DISCLOSURE_KEYS = [
  "qualifier",
  "limit",
  "price",
  "taxes",
  "duration",
  "renewal",
  "planChange",
  "cancellation",
  "reminder",
  "ending",
  "closing"
] as const
export type FoundingOfferDisclosureKey = (typeof FOUNDING_OFFER_DISCLOSURE_KEYS)[number]

/**
 * Legal review §10 Q4 at checkout, for a business that holds the offer. `held` answers items 1 and 9 for a business
 * that already has its place. There is no `limit` (item 2): the places left say nothing about an offer already
 * granted. The plan checkout's own `taxes` line follows these.
 */
export const HELD_FOUNDING_OFFER_DISCLOSURE_KEYS = ["held", "price", "duration", "renewal", "planChange", "cancellation", "reminder", "ending"] as const
export type HeldFoundingOfferDisclosureKey = (typeof HELD_FOUNDING_OFFER_DISCLOSURE_KEYS)[number]

/** Legal review §10 Q7, items 1 to 9, 11 and 12. Item 10 (boosts) is `boostCheckoutDisclosure`. */
export const PLAN_CHECKOUT_DISCLOSURE_KEYS = [
  "renewal",
  "billingDay",
  "price",
  "taxes",
  "priceChange",
  "upgrade",
  "downgrade",
  "invitations",
  "failedPayment",
  "noPause",
  "cancellation",
  "refunds",
  "suspension",
  "disputes"
] as const
export type PlanCheckoutDisclosureKey = (typeof PLAN_CHECKOUT_DISCLOSURE_KEYS)[number]

/** Plan statements that a founding offer's own statements already make at checkout, so `lines` says them once. */
const FOUNDING_COVERED_KEYS: ReadonlySet<PlanCheckoutDisclosureKey> = new Set(["renewal", "price", "cancellation"])

/** Legal review §10 Q7, item 10; Blueprint §7. */
export const BOOST_CHECKOUT_DISCLOSURE_KEYS = ["price", "placement", "noPromise", "jobStops", "founding"] as const
export type BoostCheckoutDisclosureKey = (typeof BOOST_CHECKOUT_DISCLOSURE_KEYS)[number]

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/**
 * What happens to founding cycles that are left when a business cancels (legal review §10 Q4, item 8).
 * - `cycles_resume`: they apply again if the business subscribes again. The store does this today
 *   (`apply_subscription_cycle` attaches any redemption with cycles left when a subscription turns active).
 * - `offer_ends`: the offer ends at cancellation. Choosing it needs a store change first.
 */
export const FOUNDING_OFFER_AFTER_CANCEL_RULES = ["cycles_resume", "offer_ends"] as const
export type FoundingOfferAfterCancelRule = (typeof FOUNDING_OFFER_AFTER_CANCEL_RULES)[number]

/**
 * The founding offer's terms on the offer page, for a business that does not have it. All of them are the founder's to
 * set (COM-1); none has a default. Each must equal the promotion record, because the store grants the offer and counts
 * its places (`admin_grant_founding_promotion`), and the words state the store's rule.
 */
export interface FoundingOfferDisclosureTerms {
  /** Percent off the chosen plan's monthly price: more than 0, less than 100, to two decimals (`promotions.percent_off`). */
  percentOff: number
  /** Paid monthly billing cycles at the founding price, 1 to 36 (`promotions.billing_cycles`). */
  paidCycles: number
  /**
   * `promotions.state_code`: a US state's two-letter code. The store grants the offer only to a business whose
   * `organizations.home_state` is that state, wherever its landings are, so the words name the home state.
   */
  stateCode: string
  /** `promotions.max_redemptions`: the most businesses LogLoads grants the offer to. */
  grantLimit: number
  /**
   * Places still open, as the store counts them now: `grantLimit` less the redemptions that are not revoked. A grant
   * takes its place before the business subscribes. At least 1: a full offer is never shown.
   */
  placesLeft: number
  /** The last day LogLoads grants the offer (YYYY-MM-DD; `promotions.ends_at`), or `null` when only the limit closes it. */
  closesOn: string | null
  /** Days before the first full-price charge that the reminder email goes out: 7 to 21 (legal review §10 Q4, item 7). */
  reminderDaysBefore: number
  afterCancel: FoundingOfferAfterCancelRule
}

/**
 * A founding offer the business already holds, at checkout. Read the terms from its promotion and the cycles from its
 * redemption (`MarketplaceFoundingOfferSummaryView`). The places left and the closing date are not inputs: the store
 * keeps a granted business's offer after the last place is granted and after the offer closes.
 */
export interface HeldFoundingOfferDisclosureTerms {
  /** `promotions.percent_off`, as for the offer page. */
  percentOff: number
  /** `promotions.billing_cycles`: the founding cycles the offer has in all, 1 to 36. */
  paidCycles: number
  /**
   * Founding cycles still to come, 1 to `paidCycles`: `paidCycles` less `promotion_redemptions.cycles_applied`
   * (`MarketplaceFoundingOfferSummaryView.cyclesRemaining`). A business that cancelled and subscribes again has the
   * cycles it had left (`cycles_resume`, what the store does today). With none left there is no discount, so the
   * checkout has no founding offer.
   */
  cyclesLeft: number
  /** As for the offer page. */
  reminderDaysBefore: number
  afterCancel: FoundingOfferAfterCancelRule
}

/**
 * Billing settings the disclosures state. Each must equal what the provider and the store are set to, which is why
 * they are inputs. docs/legal/billing-terms-draft.md proposes values; none is decided.
 */
export interface LandingBillingPolicyTerms {
  /** Days of email notice before a price change applies, 1 to 365. */
  priceChangeNoticeDays: number
  /** Times a failed payment is tried again, 1 to 10, as the provider is set to retry. */
  paymentRetries: number
  /** Days the plan keeps working after a failed payment while retries run, 1 to 60 (`subscription_plans.past_due_grace_days`). */
  graceDays: number
  /** Days an unpaid plan's data is kept so the business can come back, 1 to 365. */
  unpaidDataKeptDays: number
  /** Where billing questions, refunds and disputes go, as a customer reads it: an email address or a page. */
  billingContact: string
}

/** What happens to a boost's unused days when its job stops early (Blueprint §7.5, §16.2). The founder decides. */
export const BOOST_UNUSED_DAYS_RULES = ["not_refunded", "refunded_pro_rata"] as const
export type BoostUnusedDaysRule = (typeof BOOST_UNUSED_DAYS_RULES)[number]

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

interface BillingDisclosureBase<K extends string> {
  version: typeof BILLING_DISCLOSURES_VERSION
  /** A literal until counsel approves a version (gate D), so a page cannot present the draft as approved terms. */
  counselApproved: false
  statements: Readonly<Record<K, string>>
  /** The statements to show, in order. */
  lines: readonly string[]
}

/** The founding offer as the offer page states it (legal review §10 Q4). */
export interface FoundingOfferDisclosure extends BillingDisclosureBase<FoundingOfferDisclosureKey> {
  planCode: LandingPlanCode
  /** The plan's own monthly price, from `LANDING_PLANS`. */
  basePriceCents: number
  /** The plan's price for a founding cycle, in integer cents rounded half up. */
  foundingPriceCents: number
  paidCycles: number
}

/** A founding offer the business holds, as the checkout states it (legal review §10 Q4; #409). */
export interface HeldFoundingOfferDisclosure extends BillingDisclosureBase<HeldFoundingOfferDisclosureKey> {
  planCode: LandingPlanCode
  basePriceCents: number
  foundingPriceCents: number
  /** The founding cycles the offer has in all. */
  paidCycles: number
  /** The founding cycles from this checkout's first charge on. */
  cyclesLeft: number
  /** The charge after the cycles left, if each payment before it goes through. */
  firstFullPriceChargeOn: string
}

/** A landing plan's checkout (legal review §10 Q7). */
export interface LandingPlanCheckoutDisclosure extends BillingDisclosureBase<PlanCheckoutDisclosureKey> {
  planCode: LandingPlanCode
  basePriceCents: number
  /** The first charge (YYYY-MM-DD). It sets the billing day. */
  firstChargeOn: string
  /** The first charge at the plan's own price: the first charge, or the one after the founding cycles left. */
  firstFullPriceChargeOn: string
  /**
   * The founding offer's statements when the business holds the offer, else `null`. `lines` then shows them first and
   * leaves out the plan's `renewal`, `price` and `cancellation`, which they already state.
   */
  foundingOffer: HeldFoundingOfferDisclosure | null
}

/** A boost's checkout (legal review §10 Q7, item 10). */
export interface BoostCheckoutDisclosure extends BillingDisclosureBase<BoostCheckoutDisclosureKey> {
  packageCode: BoostPackageCode
  /** From `BOOST_PACKAGES`. */
  priceCents: number
  durationDays: number
  /** `BOOST_RADIUS_MILES`: approximate and straight-line. */
  radiusMiles: number
}

// ---------------------------------------------------------------------------
// Validation and wording helpers
// ---------------------------------------------------------------------------

function wholeNumber(value: number, label: string, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new RangeError(`${label} must be a whole number from ${min} to ${max}`)
  }

  return value
}

function oneLine(value: string, label: string, max: number): string {
  const text = typeof value === "string" ? value.trim() : ""

  if (text.length === 0 || text.length > max || /[\r\n]/.test(text)) {
    throw new RangeError(`${label} must be one line of 1 to ${max} characters`)
  }
  if (BILLING_DISCLOSURE_FORBIDDEN_WORDS.test(text)) {
    throw new RangeError(`${label} must not promise anything lifetime, locked or guaranteed`)
  }

  return text
}

function oneOf<T extends string>(value: T, allowed: readonly T[], label: string): T {
  if (!allowed.includes(value)) {
    throw new RangeError(`${label} must be one of ${allowed.join(", ")}`)
  }

  return value
}

function checkedPercentOff(value: number): number {
  const hundredths = value * 100

  if (!Number.isFinite(value) || value <= 0 || value >= 100 || Math.abs(hundredths - Math.round(hundredths)) > 1e-6) {
    throw new RangeError("percentOff must be more than 0 and less than 100, to at most two decimals")
  }

  return Math.round(hundredths) / 100
}

interface CalendarDate {
  year: number
  month: number
  day: number
}

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function calendarDate(value: string, label: string): CalendarDate {
  const match = typeof value === "string" ? CALENDAR_DATE.exec(value) : null

  if (match) {
    const date = { day: Number(match[3]), month: Number(match[2]), year: Number(match[1]) }

    if (date.year >= 1970 && date.month >= 1 && date.month <= 12 && date.day >= 1 && date.day <= daysInMonth(date.year, date.month)) {
      return date
    }
  }

  throw new RangeError(`${label} must be a calendar date written YYYY-MM-DD`)
}

const twoDigits = (value: number) => String(value).padStart(2, "0")

function isoDate(date: CalendarDate): string {
  return `${date.year}-${twoDigits(date.month)}-${twoDigits(date.day)}`
}

const SPOKEN_DATE = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "long", timeZone: "UTC", year: "numeric" })

/** "2027-06-18" is "June 18, 2027". */
function spokenDate(date: CalendarDate): string {
  return SPOKEN_DATE.format(Date.UTC(date.year, date.month - 1, date.day))
}

function ordinal(value: number): string {
  const lastTwo = value % 100
  const suffix = lastTwo >= 11 && lastTwo <= 13 ? "th" : (["th", "st", "nd", "rd"][value % 10] ?? "th")

  return `${value}${suffix}`
}

function count(value: number, one: string, many: string): string {
  return `${value} ${value === 1 ? one : many}`
}

const WHOLE_DOLLARS = new Intl.NumberFormat("en-US", { currency: "USD", maximumFractionDigits: 0, minimumFractionDigits: 0, style: "currency" })
const DOLLARS_AND_CENTS = new Intl.NumberFormat("en-US", { currency: "USD", style: "currency" })

/** The public plan cards' rule (`formatLandingPlanPrice`): whole-dollar prices drop the cents. */
function dollars(cents: number): string {
  return cents % 100 === 0 ? WHOLE_DOLLARS.format(cents / 100) : DOLLARS_AND_CENTS.format(cents / 100)
}

function perMonth(cents: number): string {
  return `${dollars(cents)} per month`
}

function planOf(code: LandingPlanCode): LandingPlan {
  return LANDING_PLANS[landingPlanCodeSchema.parse(code)]
}

function boostOf(code: BoostPackageCode): BoostPackage {
  return BOOST_PACKAGES[boostPackageCodeSchema.parse(code)]
}

function linesOf<K extends string>(keys: readonly K[], statements: Readonly<Record<K, string>>): string[] {
  return keys.map((key) => statements[key])
}

/** The 50 states by the two-letter code that `promotions.state_code` and `organizations.home_state` store. */
const US_STATE_NAMES: ReadonlyMap<string, string> = new Map(
  Object.entries({
    AK: "Alaska", AL: "Alabama", AR: "Arkansas", AZ: "Arizona", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware",
    FL: "Florida", GA: "Georgia", HI: "Hawaii", IA: "Iowa", ID: "Idaho", IL: "Illinois", IN: "Indiana", KS: "Kansas", KY: "Kentucky",
    LA: "Louisiana", MA: "Massachusetts", MD: "Maryland", ME: "Maine", MI: "Michigan", MN: "Minnesota", MO: "Missouri", MS: "Mississippi",
    MT: "Montana", NC: "North Carolina", ND: "North Dakota", NE: "Nebraska", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico",
    NV: "Nevada", NY: "New York", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
    SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VA: "Virginia", VT: "Vermont", WA: "Washington", WI: "Wisconsin",
    WV: "West Virginia", WY: "Wyoming"
  })
)

function stateName(code: string): string {
  const name = typeof code === "string" ? US_STATE_NAMES.get(code) : undefined

  if (name === undefined) {
    throw new RangeError("stateCode must be a US state's two-letter code, as promotions.state_code stores it")
  }

  return name
}

// ---------------------------------------------------------------------------
// Dates and prices
// ---------------------------------------------------------------------------

/**
 * The date of a paid monthly billing cycle, counted from the first charge (cycle 1). Each cycle falls on the first
 * charge's day of the month, or on the last day of a shorter month, and is counted from the first charge, never
 * from the cycle before (a 31st start bills on Feb 28 and then on Mar 31). It assumes every cycle is paid: an unpaid
 * renewal does not count toward the founding cycles (F5), so the date of a later paid cycle moves.
 */
export function landingBillingCycleDate(startsOn: string, paidCycleNumber: number): string {
  wholeNumber(paidCycleNumber, "paidCycleNumber", 1, 1_200)
  const start = calendarDate(startsOn, "startsOn")
  const monthIndex = start.month - 1 + (paidCycleNumber - 1)
  const year = start.year + Math.floor(monthIndex / 12)
  const month = (monthIndex % 12) + 1

  return isoDate({ day: Math.min(start.day, daysInMonth(year, month)), month, year })
}

/**
 * A founding cycle's price in integer cents: `price × (100 − percentOff) / 100`, rounded half up with the percentage
 * exact to two decimals. The same arithmetic as `marketplaceFoundingOfferSummary` (packages/services/src/v2/billing).
 */
export function foundingOfferPriceCents(planCode: LandingPlanCode, percentOff: number): number {
  const keptBasisPoints = 10_000 - Math.round(checkedPercentOff(percentOff) * 100)

  return Math.floor((planOf(planCode).monthlyPriceCents * keptBasisPoints + 5_000) / 10_000)
}

// ---------------------------------------------------------------------------
// Founding offer (legal review §10 Q4)
// ---------------------------------------------------------------------------

/** The terms both founding builders state: the discount, the cycles, the reminder and the rule after cancelling. */
function checkedCycleTerms(offer: Pick<FoundingOfferDisclosureTerms, "afterCancel" | "paidCycles" | "percentOff" | "reminderDaysBefore">) {
  if (FOUNDING_OPERATOR_OFFER.discountsBoosts) {
    throw new Error("The founding offer now discounts boosts. Word that rule before using these disclosures.")
  }

  return {
    afterCancel: oneOf(offer.afterCancel, FOUNDING_OFFER_AFTER_CANCEL_RULES, "afterCancel"),
    paidCycles: wholeNumber(offer.paidCycles, "paidCycles", 1, 36),
    percentOff: checkedPercentOff(offer.percentOff),
    reminderDaysBefore: wholeNumber(offer.reminderDaysBefore, "reminderDaysBefore", 7, 21)
  }
}

type CycleTerms = ReturnType<typeof checkedCycleTerms>

const QUALIFYING_REVIEW = `${MARKETPLACE_VERIFICATION_SCOPE_LABELS.business_identity.toLowerCase()} review by LogLoads`

const CYCLE_COUNTS = "A cycle counts only once its payment goes through, so a failed payment does not use one up."

const NO_TRANSFER = "It can't be transferred to another business or combined with any other discount, and it does not apply to boosts."

/** The taxes line of the offer page and the plan checkout. */
const TAXES = `Prices are ${BILLING_TAX_SUFFIX}. Any tax is added to the charge and shown on its invoice.`

/** "6 paid monthly billing cycles", or "paid monthly billing cycle" for one, after "your first" or "your next". */
function paidMonthlyCycles(cycles: number): string {
  return cycles === 1 ? "paid monthly billing cycle" : `${cycles} paid monthly billing cycles`
}

/** The founding cycles a checkout's charges start with: "first 6 paid ..." on a first checkout, "next 4 paid ..." after some are used. */
function cyclesFromCheckout(paidCycles: number, cyclesLeft: number): string {
  return `${cyclesLeft === paidCycles ? "first" : "next"} ${paidMonthlyCycles(cyclesLeft)}`
}

/** The statements both founding builders share: `price`, `planChange`, `cancellation`, `reminder` and `renewal`. */
function foundingStatements(plan: LandingPlan, foundingPriceCents: number, terms: CycleTerms, cyclesBeforeFullPrice: number, firstFullPrice: string) {
  const fullPrice = withApplicableTaxes(perMonth(plan.monthlyPriceCents))
  const afterCancel =
    terms.afterCancel === "cycles_resume"
      ? "If you subscribe again later, the founding price applies to the cycles you had left."
      : "The founding offer ends when you cancel, and subscribing again does not bring it back."

  return {
    cancellation:
      "How to cancel: online, at any time, in Billing, in no more steps than it took to subscribe. Your plan stays active until the end of the " +
      `billing cycle you paid for. ${afterCancel}`,
    planChange:
      "If you change plans: the discount applies to the new plan's price for the cycles you have left, and the change does not use one up.",
    price: `Price: the ${plan.name} plan at ${withApplicableTaxes(perMonth(foundingPriceCents))}, instead of ${fullPrice}. That is ${terms.percentOff}% off.`,
    reminder: `Reminder: we email you ${terms.reminderDaysBefore} days before your first full-price charge, with the full price and the date.`,
    renewal:
      `What happens next: after ${cyclesBeforeFullPrice === 1 ? "that cycle" : `those ${cyclesBeforeFullPrice} cycles`}, your ${plan.name} plan ` +
      `renews automatically at the full price of ${fullPrice}, each month until you cancel. ${firstFullPrice}`
  }
}

export interface FoundingOfferDisclosureInput {
  planCode: LandingPlanCode
  /** The day the page is shown (YYYY-MM-DD). A closing date before it is refused: the offer has closed. */
  today: string
  offer: FoundingOfferDisclosureTerms
}

/**
 * What the offer page must state to a business that does not have the offer (legal review §10 Q4). The limit is
 * worded as the store counts it: grants by a billing admin, to businesses whose home state is the promotion's state.
 * It refuses an offer with no place left or a closing date already passed.
 */
export function foundingOfferDisclosure(input: FoundingOfferDisclosureInput): FoundingOfferDisclosure {
  const plan = planOf(input.planCode)
  const today = calendarDate(input.today, "today")
  const terms = checkedCycleTerms(input.offer)
  const grantLimit = wholeNumber(input.offer.grantLimit, "grantLimit", 1, 10_000)
  const placesLeft = wholeNumber(input.offer.placesLeft, "placesLeft", 1, grantLimit)
  const state = stateName(input.offer.stateCode)
  const closesOn = input.offer.closesOn === null ? null : calendarDate(input.offer.closesOn, "closesOn")

  if (closesOn !== null && isoDate(closesOn) < isoDate(today)) {
    throw new RangeError("closesOn is before today, so the offer has already closed")
  }

  const foundingPriceCents = foundingOfferPriceCents(plan.code, terms.percentOff)
  const single = grantLimit === 1
  const closes = single ? "its place is taken" : `all ${grantLimit} places are taken`
  const closesBy = closesOn === null ? "" : ` or on ${spokenDate(closesOn)}, whichever comes first`
  const shared = foundingStatements(
    plan,
    foundingPriceCents,
    terms,
    terms.paidCycles,
    `Your first full-price charge is your ${ordinal(terms.paidCycles + 1)} monthly charge, if each payment before it goes through.`
  )

  const statements: Record<FoundingOfferDisclosureKey, string> = {
    ...shared,
    closing: `The offer closes to new businesses when ${closes}${closesBy}. Closing does not end the offer for a business that already has it. ${NO_TRANSFER}`,
    duration: `How long: your first ${paidMonthlyCycles(terms.paidCycles)}. ${CYCLE_COUNTS}`,
    ending: `The founding price ends after your ${ordinal(terms.paidCycles)} paid monthly billing cycle.`,
    limit: single
      ? `Limit: LogLoads grants the offer to one qualifying landing business whose home state is ${state}. The place is taken when LogLoads ` +
        "grants the offer, not when the business subscribes. That place is still open."
      : `Limit: LogLoads grants the offer to no more than ${grantLimit} qualifying landing businesses whose home state is ${state}. A place is ` +
        `taken when LogLoads grants the offer, not when the business subscribes. ${placesLeft} of the ${grantLimit} places ` +
        `${placesLeft === 1 ? "is" : "are"} left.`,
    qualifier:
      `Who qualifies: a landing business with a current ${QUALIFYING_REVIEW} and ${state} as the home state on its LogLoads account. ` +
      "Each legal organization can get one founding offer, however many accounts it has.",
    taxes: TAXES
  }

  return {
    basePriceCents: plan.monthlyPriceCents,
    counselApproved: false,
    foundingPriceCents,
    lines: linesOf(FOUNDING_OFFER_DISCLOSURE_KEYS, statements),
    paidCycles: terms.paidCycles,
    planCode: plan.code,
    statements,
    version: BILLING_DISCLOSURES_VERSION
  }
}

export interface HeldFoundingOfferDisclosureInput {
  planCode: LandingPlanCode
  /** This checkout's first charge (YYYY-MM-DD): the first of the cycles left. */
  startsOn: string
  offer: HeldFoundingOfferDisclosureTerms
}

/**
 * What the checkout must state about a founding offer the business holds (legal review §10 Q4; #409). It never checks
 * the places left or the closing date, because the store checks neither when it attaches the grant, and it counts the
 * first full-price charge from the cycles left: 4 left from 2027-03-10 is full price from 2027-07-10.
 */
export function heldFoundingOfferDisclosure(input: HeldFoundingOfferDisclosureInput): HeldFoundingOfferDisclosure {
  const plan = planOf(input.planCode)
  const start = calendarDate(input.startsOn, "startsOn")
  const terms = checkedCycleTerms(input.offer)
  const cyclesLeft = wholeNumber(input.offer.cyclesLeft, "cyclesLeft", 1, terms.paidCycles)
  const used = terms.paidCycles - cyclesLeft
  const foundingPriceCents = foundingOfferPriceCents(plan.code, terms.percentOff)
  const firstFullPriceChargeOn = landingBillingCycleDate(isoDate(start), cyclesLeft + 1)
  const fullOn = spokenDate(calendarDate(firstFullPriceChargeOn, "firstFullPriceChargeOn"))
  const shared = foundingStatements(
    plan,
    foundingPriceCents,
    terms,
    cyclesLeft,
    `Your first full-price charge is on ${fullOn}, if each payment before then goes through.`
  )

  const statements: Record<HeldFoundingOfferDisclosureKey, string> = {
    ...shared,
    duration:
      used === 0
        ? `How long: your first ${paidMonthlyCycles(cyclesLeft)}. ${CYCLE_COUNTS}`
        : `How long: your next ${paidMonthlyCycles(cyclesLeft)}. You have used ${used} of your ${terms.paidCycles} founding cycles, and ` +
          `${cyclesLeft} ${cyclesLeft === 1 ? "is" : "are"} left. ${CYCLE_COUNTS}`,
    ending:
      used === 0
        ? `The founding price ends after your ${ordinal(terms.paidCycles)} paid monthly billing cycle.`
        : `The founding price ends after your ${ordinal(terms.paidCycles)} founding cycle in all, which is the ${ordinal(cyclesLeft)} paid ` +
          "monthly billing cycle from this checkout.",
    held: `Founding offer: LogLoads has granted it to your business, and the offer closing to other businesses does not end yours. ${NO_TRANSFER}`
  }

  return {
    basePriceCents: plan.monthlyPriceCents,
    counselApproved: false,
    cyclesLeft,
    firstFullPriceChargeOn,
    foundingPriceCents,
    lines: linesOf(HELD_FOUNDING_OFFER_DISCLOSURE_KEYS, statements),
    paidCycles: terms.paidCycles,
    planCode: plan.code,
    statements,
    version: BILLING_DISCLOSURES_VERSION
  }
}

// ---------------------------------------------------------------------------
// Plan checkout (legal review §10 Q7)
// ---------------------------------------------------------------------------

export interface LandingPlanCheckoutDisclosureInput {
  planCode: LandingPlanCode
  /** The first charge (YYYY-MM-DD). It sets the billing day. */
  startsOn: string
  policy: LandingBillingPolicyTerms
  /** The founding offer the business holds, with the cycles it has left; `null` or absent when it has none left. */
  foundingOffer?: HeldFoundingOfferDisclosureTerms | null
}

/** What a plan checkout must state before payment details are taken (legal review §10 Q7, items 1 to 9, 11 and 12). */
export function landingPlanCheckoutDisclosure(input: LandingPlanCheckoutDisclosureInput): LandingPlanCheckoutDisclosure {
  const plan = planOf(input.planCode)
  const start = calendarDate(input.startsOn, "startsOn")
  const startsOn = isoDate(start)
  const policy = {
    billingContact: oneLine(input.policy.billingContact, "billingContact", 120),
    graceDays: wholeNumber(input.policy.graceDays, "graceDays", 1, 60),
    paymentRetries: wholeNumber(input.policy.paymentRetries, "paymentRetries", 1, 10),
    priceChangeNoticeDays: wholeNumber(input.policy.priceChangeNoticeDays, "priceChangeNoticeDays", 1, 365),
    unpaidDataKeptDays: wholeNumber(input.policy.unpaidDataKeptDays, "unpaidDataKeptDays", 1, 365)
  }
  const foundingOffer = input.foundingOffer ? heldFoundingOfferDisclosure({ offer: input.foundingOffer, planCode: plan.code, startsOn }) : null
  const base = withApplicableTaxes(perMonth(plan.monthlyPriceCents))
  const grace = count(policy.graceDays, "day", "days")

  let renewal = `Your ${plan.name} plan renews automatically at ${base}, each month until you cancel. Your first charge is on ${spokenDate(start)}.`
  let price = `Price: ${base}, for the ${plan.name} plan.`
  let firstFullPriceChargeOn = startsOn

  if (foundingOffer !== null) {
    const cycles = cyclesFromCheckout(foundingOffer.paidCycles, foundingOffer.cyclesLeft)
    const fullOn = calendarDate(foundingOffer.firstFullPriceChargeOn, "firstFullPriceChargeOn")

    firstFullPriceChargeOn = isoDate(fullOn)
    renewal =
      `Your ${plan.name} plan renews automatically each month until you cancel. After your ${cycles} at the founding price, it renews ` +
      `at the full price of ${base}. Your first full-price charge is on ${spokenDate(fullOn)}, if each payment before then goes through.`
    price = `Price: ${withApplicableTaxes(perMonth(foundingOffer.foundingPriceCents))}, for the ${plan.name} plan for your ${cycles}, then ${base}.`
  }

  const statements: Record<PlanCheckoutDisclosureKey, string> = {
    billingDay:
      start.day > 28
        ? `You are billed on the ${ordinal(start.day)} of each month, or on the last day of a shorter month.`
        : `You are billed on the ${ordinal(start.day)} of each month.`,
    cancellation:
      "You can cancel online at any time in Billing, in no more steps than it took to subscribe. Your plan stays active until the end of the " +
      "billing cycle you paid for, and then it stops renewing.",
    disputes:
      `If a charge looks wrong, contact us first at ${policy.billingContact}. If you dispute it with your card issuer instead, the disputed ` +
      "billing cycle counts as unpaid until the dispute is closed.",
    downgrade:
      "Downgrading takes effect at your next renewal, with no refund for the current billing cycle. If you then have more active landings or " +
      "team members than the new plan allows, nothing is deleted and nobody is removed. Until you are back within the plan, you can't start a " +
      "landing, publish a job or send an invitation, and while you have too many team members you can't add one.",
    failedPayment:
      `If a payment fails, we try it again ${policy.paymentRetries === 1 ? "once" : `up to ${policy.paymentRetries} times`} within ${grace}, ` +
      `and your plan keeps working meanwhile. If it still hasn't gone through after ${grace}, your plan stops: your jobs are unpublished, ` +
      `not deleted, and we keep your data for ${count(policy.unpaidDataKeptDays, "day", "days")}. Paying restores the plan, and you can then ` +
      "reactivate your landings and publish your jobs again.",
    invitations:
      "Targeted invitations belong to the billing cycle. A plan change moves this cycle's allowance to the new plan's number, and invitations " +
      "you already sent still count. Unused invitations don't roll over.",
    noPause: "LogLoads doesn't offer pausing a plan. To stop paying, cancel.",
    price,
    priceChange:
      `If the price changes, we email you at least ${count(policy.priceChangeNoticeDays, "day", "days")} before the new price applies, ` +
      "and you can cancel before then.",
    refunds:
      "We don't refund part of a billing cycle unless the law requires it. If we charged you by mistake, we refund that charge. " +
      `Ask about a refund at ${policy.billingContact}.`,
    renewal,
    suspension: "If we suspend your account for breaking the Terms, your plan stops renewing and no refund is due for the current billing cycle.",
    taxes: TAXES,
    upgrade:
      "Upgrading takes effect at once. You pay a prorated charge for the rest of the current billing cycle, and you see the amount before you confirm."
  }

  const lines =
    foundingOffer === null
      ? linesOf(PLAN_CHECKOUT_DISCLOSURE_KEYS, statements)
      : [...foundingOffer.lines, ...linesOf(PLAN_CHECKOUT_DISCLOSURE_KEYS.filter((key) => !FOUNDING_COVERED_KEYS.has(key)), statements)]

  return {
    basePriceCents: plan.monthlyPriceCents,
    counselApproved: false,
    firstChargeOn: startsOn,
    firstFullPriceChargeOn,
    foundingOffer,
    lines,
    planCode: plan.code,
    statements,
    version: BILLING_DISCLOSURES_VERSION
  }
}

// ---------------------------------------------------------------------------
// Boost checkout (legal review §10 Q7, item 10; Blueprint §7)
// ---------------------------------------------------------------------------

export interface BoostCheckoutDisclosureInput {
  packageCode: BoostPackageCode
  unusedDays: BoostUnusedDaysRule
}

/** What a boost checkout must state before payment details are taken. */
export function boostCheckoutDisclosure(input: BoostCheckoutDisclosureInput): BoostCheckoutDisclosure {
  const boost = boostOf(input.packageCode)
  const unusedDays = oneOf(input.unusedDays, BOOST_UNUSED_DAYS_RULES, "unusedDays")

  if (BOOST_AUTO_RENEWS || FOUNDING_OPERATOR_OFFER.discountsBoosts) {
    throw new Error("A boost now renews or takes the founding discount. Word that rule before using these disclosures.")
  }

  const statements: Record<BoostCheckoutDisclosureKey, string> = {
    founding: "The founding offer does not discount boosts.",
    jobStops:
      "If the job is paused, filled or removed, the boost ends early and does not restart. " +
      (unusedDays === "not_refunded" ? "Unused days are not refunded." : "We refund the unused days, pro rata."),
    noPromise: "A boost buys placement only. It does not promise views, inquiries, trucks or hires, and it adds no targeted invitations.",
    placement:
      `It shows one job as Sponsored to haulers within about ${BOOST_RADIUS_MILES} miles of the job's public landing area, ` +
      `for ${boost.durationDays} consecutive days from the moment your payment goes through.`,
    price: `${boost.name}: ${withApplicableTaxes(`${dollars(boost.priceCents)}, a one-time charge`)}. It never renews.`
  }

  return {
    counselApproved: false,
    durationDays: boost.durationDays,
    lines: linesOf(BOOST_CHECKOUT_DISCLOSURE_KEYS, statements),
    packageCode: boost.code,
    priceCents: boost.priceCents,
    radiusMiles: BOOST_RADIUS_MILES,
    statements,
    version: BILLING_DISCLOSURES_VERSION
  }
}
