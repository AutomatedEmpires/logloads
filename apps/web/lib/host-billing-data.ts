import "server-only"

import {
  FEE_BPS_SCALE,
  formatMoney,
  hostBillingProfileStatusSchema,
  hostChargeBreakdown,
  hostInvoiceStatusSchema,
  invoicePeriodFor,
  invoiceSubtotalCents,
  PLATFORM_FEE_BPS,
  type HostBillingProfile,
  type HostBillingProfileStatus,
  type HostInvoice,
  type HostInvoiceStatus,
  type LoadPosting,
  type PlatformFeeEvent
} from "@logloads/contracts"
import type { BadgeProps } from "@logloads/ui"

import { services } from "./services"

/**
 * Everything a host needs to answer four questions about their own money without
 * contacting anybody:
 *
 *   1. Is a card attached, and does its state stop me publishing?
 *   2. What has accrued this month, and from which loads?
 *   3. What was I last billed, was it paid, and what did it cover?
 *   4. What exactly am I charged, and is any of it taken out of driver pay?
 *
 * WHAT LOGLOADS CHARGES. A host states what a load pays a driver. LogLoads
 * charges the HOST a percentage of that stated pay, ON TOP of it, and only once a
 * truckload has completed. There is no monthly fee, no charge to post, and
 * drivers pay nothing ever.
 *
 * WHAT LOGLOADS DOES NOT DO. It never holds, escrows, routes or pays out driver
 * money. Driver pay moves host → driver directly, off-platform. Nothing in this
 * module reports a driver payment, a balance or a payout, because no such record
 * exists — the only money LogLoads collects is its own fee, billed to the host's
 * card monthly after the month it was earned in.
 *
 * WHY THE ARITHMETIC IS NOT HERE. Every figure is produced by
 * `hostChargeBreakdown` from the pay and rate FROZEN on each fee event, so this
 * read model cannot disagree with the accrual that wrote the ledger or with the
 * bill that charges it. A surface that did its own percentage would eventually
 * quote a host one number and charge another.
 */

/**
 * Badge is what renders a tone, so the tone union is taken from Badge rather than
 * retyped here — a fourth hand-written copy of the same five words is a fourth
 * chance for one of them to be wrong.
 */
export type HostBillingTone = NonNullable<BadgeProps["tone"]>

/**
 * LogLoads bills its own fee in US dollars. The fee ledger stores no currency
 * because there is only one: the figure a host states is dollars, and the card
 * charged monthly is charged in dollars. Naming it once here keeps every money
 * label on these surfaces formatted the same way.
 */
const BILLING_CURRENCY = "USD"

/**
 * `FEE_BPS_SCALE` basis points is the whole, and a whole is 100 percent, so one
 * percent is this many basis points. Derived rather than typed as `100`, so
 * changing the basis-point scale cannot leave these labels quietly announcing a
 * rate nobody charges.
 */
const BPS_PER_PERCENT = FEE_BPS_SCALE / 100

function money(amountCents: number): string {
  return formatMoney({ amountCents, currency: BILLING_CURRENCY })
}

/**
 * A rate as a percentage, for reading only.
 *
 * This is the one division in this module that is not integer arithmetic, and no
 * money passes through it: a fee in cents is only ever produced by
 * `computePlatformFeeCents` inside `hostChargeBreakdown`. 500 bps reads "5%",
 * 525 bps reads "5.25%".
 */
export function feeRateLabel(feeBps: number): string {
  return `${Number((feeBps / BPS_PER_PERCENT).toFixed(2))}%`
}

/** The current rate, worded once so no string on these surfaces hand-types it. */
const CURRENT_RATE_LABEL = feeRateLabel(PLATFORM_FEE_BPS)

/**
 * UTC, because a billing period is a UTC calendar month. A local-midnight
 * boundary would move a completed load into a different month for a reader in
 * Oregon than for the same host's bookkeeper in Maine.
 */
function formatDay(instant: string): string {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    year: "numeric"
  }).format(new Date(instant))
}

function formatMonth(instant: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    timeZone: "UTC",
    year: "numeric"
  }).format(new Date(instant))
}

// ── One completed truckload, as a host reads it ────────────────────────────────

export interface HostFeeLineView {
  id: string
  /** The load this fee came from, so a host can recognise the work. */
  loadTitle: string
  /** When the truckload completed — the event that made it billable. */
  completedOnLabel: string
  completedAt: string
  /** What the host stated this truckload pays the driver. Never reduced. */
  driverPayLabel: string
  /** What LogLoads charges the host for it, on top. */
  platformFeeLabel: string
  /** driverPay + fee: the host's total cost of the truckload. */
  hostTotalLabel: string
  driverPayCents: number
  platformFeeCents: number
  hostTotalCents: number
  /** The rate FROZEN on this fee, not today's rate. */
  rateLabel: string
  /** Present only on a withdrawn fee, which is charged nothing. */
  voidReason: string | null
}

/**
 * A load whose posting is gone still has to show its charge.
 *
 * A fee event freezes the pay and the rate but not the title, so an archived or
 * deleted posting leaves this line unnamed. Saying so is the only honest option:
 * dropping the line would make a bill that does not add up, and inventing a name
 * would put words in the host's mouth.
 */
const UNNAMED_LOAD_TITLE = "Load no longer on this workspace"

function feeLineView(
  event: PlatformFeeEvent,
  loadTitleById: ReadonlyMap<string, string>
): HostFeeLineView {
  // The three numbers come out together, from the pay and rate frozen on this
  // event. There is deliberately no path here that subtracts a fee from pay.
  const breakdown = hostChargeBreakdown(event.driverPayCents, event.feeBps)

  return {
    completedAt: event.occurredAt,
    completedOnLabel: formatDay(event.occurredAt),
    driverPayCents: breakdown.driverPayCents,
    driverPayLabel: money(breakdown.driverPayCents),
    hostTotalCents: breakdown.hostTotalCents,
    hostTotalLabel: money(breakdown.hostTotalCents),
    id: event.id,
    loadTitle: loadTitleById.get(event.loadPostingId) ?? UNNAMED_LOAD_TITLE,
    platformFeeCents: breakdown.platformFeeCents,
    platformFeeLabel: money(breakdown.platformFeeCents),
    rateLabel: feeRateLabel(event.feeBps),
    voidReason: event.voidReason ?? null
  }
}

export interface HostFeeTotalsView {
  /** How many completed truckloads these figures cover. */
  truckloadCount: number
  /** What the host pays drivers for them, in total. LogLoads never collects it. */
  driverPayCents: number
  driverPayLabel: string
  /** What LogLoads charges the host, in total. */
  platformFeeCents: number
  platformFeeLabel: string
  hostTotalCents: number
  hostTotalLabel: string
}

/**
 * What a set of fees adds up to.
 *
 * The fee total is the SUM OF THE FROZEN PER-LOAD FEES — deliberately not the
 * rate applied to the pay total. Each fee was rounded to a whole cent when it
 * accrued, and that rounded cent is what the host is billed, so re-rating the
 * aggregate would print a total that is a cent or two away from the sum of the
 * lines directly underneath it. `invoiceSubtotalCents` is used because the rule
 * that a withdrawn fee contributes nothing lives there, not here.
 */
function totalsFor(events: readonly PlatformFeeEvent[], lines: readonly HostFeeLineView[]): HostFeeTotalsView {
  const platformFeeCents = invoiceSubtotalCents(events)
  const driverPayCents = lines.reduce((sum, line) => sum + line.driverPayCents, 0)

  return {
    driverPayCents,
    driverPayLabel: money(driverPayCents),
    hostTotalCents: driverPayCents + platformFeeCents,
    hostTotalLabel: money(driverPayCents + platformFeeCents),
    platformFeeCents,
    platformFeeLabel: money(platformFeeCents),
    truckloadCount: lines.length
  }
}

// ── Whether this host can be billed at all ────────────────────────────────────

interface PaymentStatePresentation {
  /**
   * Whether this state stops the host publishing work. Enforced in
   * `assertHostCanPublish`; stated here so the host reads the same rule on the
   * billing page that the publish attempt would tell them.
   */
  blocksPublishing: boolean
  consequence: string
  /** What the host does about it. Null when there is nothing to do. */
  nextStep: string | null
  statusLabel: string
  tone: HostBillingTone
}

/**
 * What each card state means for the host, exhaustively.
 *
 * A `Record` over the schema's own status union, not an if-chain with a fallback:
 * adding a state to `hostBillingProfileStatusSchema` will not compile until
 * somebody decides whether a host in it can publish. A fallback would answer
 * "you can publish" for a state nobody has thought about yet, and the publish
 * attempt would then refuse work this page had just promised.
 */
export const PAYMENT_STATE_PRESENTATION: Record<HostBillingProfileStatus, PaymentStatePresentation> = {
  attached: {
    blocksPublishing: false,
    consequence: `You can publish work. This card is charged once a month for the LogLoads fee only — ${CURRENT_RATE_LABEL} of the driver pay you stated, on truckloads that completed.`,
    nextStep: null,
    statusLabel: "Card on file",
    tone: "success"
  },
  failed: {
    blocksPublishing: true,
    consequence:
      "The last charge to this card did not go through, so you cannot publish new work until a working card is on file. Work already on the network is unaffected, and your drivers are still paid by you exactly as agreed.",
    nextStep: "Replace the card on this workspace's billing profile, then publish.",
    statusLabel: "Card declined",
    tone: "critical"
  },
  none: {
    blocksPublishing: true,
    consequence: `You cannot publish work until a card is on file. Posting still costs nothing and there is no monthly fee — the card is what lets LogLoads bill its ${CURRENT_RATE_LABEL} after a truckload completes.`,
    nextStep: "Attach a card to this workspace's billing profile, then publish.",
    statusLabel: "No card on file",
    tone: "critical"
  }
}

export interface HostPaymentMethodView {
  status: HostBillingProfileStatus
  statusLabel: string
  tone: HostBillingTone
  /** "Visa ending 4242", or null when there is no card to describe. */
  cardLine: string | null
  consequence: string
  nextStep: string | null
  blocksPublishing: boolean
  /**
   * The card processor's own words about the decline, with the date. Kept off the
   * publishing refusal on purpose: it is information about a card, and it belongs
   * next to the card.
   */
  failureLine: string | null
}

function cardLineFor(profile: HostBillingProfile | undefined): string | null {
  if (!profile?.paymentMethodLast4) {
    return null
  }

  const brand = profile.paymentMethodBrand

  // Only a brand and four digits are ever stored, which is all a host needs to
  // recognise which card this is.
  return brand ? `${brand} ending ${profile.paymentMethodLast4}` : `Card ending ${profile.paymentMethodLast4}`
}

function paymentMethodView(profile: HostBillingProfile | undefined): HostPaymentMethodView {
  // No profile row IS a host with no card. This collection starts empty for every
  // organization, so an absent row has to read as "none" rather than as "nothing
  // to check here" — the same direction `assertHostCanPublish` fails in.
  const status = profile?.status ?? "none"
  const presentation = PAYMENT_STATE_PRESENTATION[status]

  return {
    blocksPublishing: presentation.blocksPublishing,
    cardLine: cardLineFor(profile),
    consequence: presentation.consequence,
    failureLine:
      profile?.lastFailureAt && profile.lastFailureReason
        ? `Declined ${formatDay(profile.lastFailureAt)}: ${profile.lastFailureReason}`
        : null,
    nextStep: presentation.nextStep,
    status,
    statusLabel: presentation.statusLabel,
    tone: presentation.tone
  }
}

// ── What the fee is, in plain words ───────────────────────────────────────────

export interface HostFeeExplainerView {
  rateLabel: string
  headline: string
  /** Each fact a host would otherwise have to ask about. */
  points: string[]
  /**
   * A worked example through the same function every real charge goes through, so
   * the illustration cannot drift from the arithmetic.
   */
  example: {
    driverPayLabel: string
    platformFeeLabel: string
    hostTotalLabel: string
  }
}

/** $500.00. A round figure, so the example reads as an example. */
const EXAMPLE_DRIVER_PAY_CENTS = 50_000

function feeExplainerView(): HostFeeExplainerView {
  const example = hostChargeBreakdown(EXAMPLE_DRIVER_PAY_CENTS, PLATFORM_FEE_BPS)

  return {
    example: {
      driverPayLabel: money(example.driverPayCents),
      hostTotalLabel: money(example.hostTotalCents),
      platformFeeLabel: money(example.platformFeeCents)
    },
    headline: `${CURRENT_RATE_LABEL} of the driver pay you state, charged to you on top, on completed truckloads only.`,
    points: [
      "No monthly fee, and no charge to post. A load that never gets hauled is never billed.",
      `Nothing is deducted from driver pay. The driver is paid exactly what you stated; the ${CURRENT_RATE_LABEL} is added to what you owe LogLoads.`,
      "You pay your driver directly. Driver money never passes through LogLoads, which holds no funds and settles no freight.",
      "Drivers pay nothing to use LogLoads, ever.",
      "Fees accrue as truckloads complete and are charged to the card on file once a month, after the month they were earned in."
    ],
    rateLabel: CURRENT_RATE_LABEL
  }
}

// ── The month in progress ─────────────────────────────────────────────────────

export interface HostAccrualPeriodView {
  /** "July 2026". */
  periodLabel: string
  periodStart: string
  periodEnd: string
  /** When this month stops accruing and becomes billable. */
  closesOnLabel: string
  /** One line per completed truckload, oldest first, so it reads as a statement. */
  lines: HostFeeLineView[]
  totals: HostFeeTotalsView
  /**
   * Fees withdrawn during this month. Charged nothing and excluded from the
   * totals, but shown rather than deleted: a host who was told about a fee is
   * owed the record that it was taken back.
   */
  voidedLines: HostFeeLineView[]
}

// ── Bills already raised ─────────────────────────────────────────────────────

interface InvoiceStatePresentation {
  statusLabel: string
  detail: string
  tone: HostBillingTone
  /** Whether money has actually been collected for this bill. */
  settled: boolean
}

/**
 * What each bill state tells the host, exhaustively over the invoice status
 * union. A status is a claim about the host's money; an unmapped one would make
 * that claim with nothing behind it.
 */
export const INVOICE_STATE_PRESENTATION: Record<HostInvoiceStatus, InvoiceStatePresentation> = {
  draft: {
    detail: "Still being assembled. Nothing has been charged for this month yet.",
    settled: false,
    statusLabel: "Not charged yet",
    tone: "info"
  },
  open: {
    detail: "Charged to the card on file. This shows as paid once the payment confirms.",
    settled: false,
    statusLabel: "Awaiting payment",
    tone: "warning"
  },
  paid: {
    detail: "Paid in full. Nothing is outstanding on this month.",
    settled: true,
    statusLabel: "Paid",
    tone: "success"
  },
  uncollectible: {
    detail: "This bill could not be collected from the card on file. Publishing stays blocked until a working card is attached.",
    settled: false,
    statusLabel: "Payment failed",
    tone: "critical"
  },
  void: {
    detail: "Cancelled by LogLoads. Nothing is owed on this month.",
    settled: false,
    statusLabel: "Cancelled",
    tone: "neutral"
  }
}

export interface HostInvoiceView {
  id: string
  /** The month billed, not the month it was sent. */
  periodLabel: string
  periodStart: string
  statusLabel: string
  statusDetail: string
  tone: HostBillingTone
  settled: boolean
  /** The amount actually billed, as stored on the bill. */
  billedLabel: string
  billedCents: number
  issuedOnLabel: string | null
  paidOnLabel: string | null
  /** The truckloads this bill is made of, so it can be reconciled against work. */
  lines: HostFeeLineView[]
  totals: HostFeeTotalsView
  /**
   * Set when the itemised lines do not add up to the amount billed. Never
   * silently absent: an unexplainable total is the one thing a host cannot
   * reconcile, and it has to be visible rather than papered over with whichever
   * number happens to be handy.
   */
  reconciliationNote: string | null
}

/**
 * Why an itemised bill and its own total disagree, in the host's terms.
 *
 * BOTH DIRECTIONS ARE REAL, and they mean different things. A shortfall is a fee
 * that is missing from the itemisation — a row withheld by the storage contract,
 * for instance — so part of the amount billed is unexplained. An excess is a fee
 * listed on a bill that did not charge for it, which is a double-billing risk
 * rather than a missing line. Wording them the same way would tell the host to
 * chase the wrong thing.
 */
function reconciliationNoteFor(billedCents: number, itemisedCents: number): string | null {
  if (billedCents === itemisedCents) {
    return null
  }

  if (itemisedCents < billedCents) {
    return `The truckloads listed here account for ${money(itemisedCents)} of the ${money(billedCents)} billed. Ask support to itemise the remaining ${money(billedCents - itemisedCents)} before paying.`
  }

  return `The truckloads listed here add up to ${money(itemisedCents)}, which is more than the ${money(billedCents)} billed. Ask support to confirm which figure is right before paying.`
}

function invoiceView(
  invoice: HostInvoice,
  eventsById: ReadonlyMap<string, PlatformFeeEvent>,
  loadTitleById: ReadonlyMap<string, string>
): HostInvoiceView {
  const presentation = INVOICE_STATE_PRESENTATION[invoice.status]
  const events = invoice.feeEventIds
    .map((id) => eventsById.get(id))
    .filter(
      (event): event is PlatformFeeEvent =>
        Boolean(event) && event?.status !== "voided"
    )
  const lines = [...events]
    .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt) || left.id.localeCompare(right.id))
    .map((event) => feeLineView(event, loadTitleById))
  const totals = totalsFor(events, lines)

  return {
    billedCents: invoice.subtotalCents,
    billedLabel: money(invoice.subtotalCents),
    id: invoice.id,
    issuedOnLabel: invoice.issuedAt ? formatDay(invoice.issuedAt) : null,
    lines,
    paidOnLabel: invoice.paidAt ? formatDay(invoice.paidAt) : null,
    periodLabel: formatMonth(invoice.periodStart),
    periodStart: invoice.periodStart,
    reconciliationNote: reconciliationNoteFor(invoice.subtotalCents, totals.platformFeeCents),
    settled: presentation.settled,
    statusDetail: presentation.detail,
    statusLabel: presentation.statusLabel,
    tone: presentation.tone,
    totals
  }
}

// ── The whole surface ────────────────────────────────────────────────────────

export interface HostBillingView {
  paymentMethod: HostPaymentMethodView
  fee: HostFeeExplainerView
  currentPeriod: HostAccrualPeriodView
  /** Newest month first. */
  invoices: HostInvoiceView[]
  /** The most recent bill, which is the one a host asks about. */
  lastInvoice: HostInvoiceView | null
  /** False only when this host has never accrued a fee and never been billed. */
  hasBillingHistory: boolean
}

/**
 * The rows this read model needs. Declared as an input rather than reached for,
 * so the view can be exercised against a known ledger instead of whatever the
 * seeded bench happens to contain today.
 */
export interface HostBillingSource {
  hostBillingProfiles: readonly HostBillingProfile[]
  platformFeeEvents: readonly PlatformFeeEvent[]
  hostInvoices: readonly HostInvoice[]
  loadPostings: readonly Pick<LoadPosting, "id" | "title">[]
}

export function buildHostBillingView(
  source: HostBillingSource,
  organizationId: string,
  instant: string
): HostBillingView {
  // Every collection is filtered to this organization before anything is summed.
  // A fee belonging to another host must never reach this host's total, and
  // scoping once here is what makes that true of every figure below.
  const ownEvents = source.platformFeeEvents.filter((event) => event.organizationId === organizationId)
  const ownInvoices = source.hostInvoices.filter((invoice) => invoice.organizationId === organizationId)
  const profile = source.hostBillingProfiles.find((entry) => entry.organizationId === organizationId)

  const loadTitleById = new Map(source.loadPostings.map((posting) => [posting.id, posting.title]))
  const eventsById = new Map(ownEvents.map((event) => [event.id, event]))

  const period = invoicePeriodFor(instant)
  const inPeriod = ownEvents.filter(
    (event) =>
      Date.parse(event.occurredAt) >= Date.parse(period.periodStart) &&
      Date.parse(event.occurredAt) < Date.parse(period.periodEnd)
  )
  // A withdrawn fee is charged nothing, so it is kept out of the billable set
  // rather than subtracted from it. `invoiceSubtotalCents` holds the same rule for
  // the money; this split is what keeps it out of the itemisation too.
  const billableInPeriod = inPeriod.filter((event) => event.status !== "voided")
  const voidedInPeriod = inPeriod.filter((event) => event.status === "voided")

  const periodLines = [...billableInPeriod]
    .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt) || left.id.localeCompare(right.id))
    .map((event) => feeLineView(event, loadTitleById))

  const invoices = [...ownInvoices]
    .sort((left, right) => right.periodStart.localeCompare(left.periodStart) || right.id.localeCompare(left.id))
    .map((invoice) => invoiceView(invoice, eventsById, loadTitleById))

  return {
    currentPeriod: {
      closesOnLabel: formatDay(period.periodEnd),
      lines: periodLines,
      periodEnd: period.periodEnd,
      periodLabel: formatMonth(period.periodStart),
      periodStart: period.periodStart,
      totals: totalsFor(billableInPeriod, periodLines),
      voidedLines: [...voidedInPeriod]
        .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt) || left.id.localeCompare(right.id))
        .map((event) => feeLineView(event, loadTitleById))
    },
    fee: feeExplainerView(),
    // History is any fee LogLoads ever raised on this host, in any month, plus any
    // bill. A month with nothing in it is not an empty history — last month's bill
    // still has to be findable on the first of the month.
    hasBillingHistory: ownEvents.length > 0 || ownInvoices.length > 0,
    invoices,
    lastInvoice: invoices[0] ?? null,
    paymentMethod: paymentMethodView(profile)
  }
}

/**
 * Server helper: the live billing picture for one host organization. Never call
 * from a client component.
 *
 * Reads the in-memory state synchronously, like every other cockpit read helper,
 * so it must be called AFTER the request has awaited its cockpit context — that
 * await is what refreshes the operating-state document. Calling it first would
 * show a host last request's ledger.
 */
export function getHostBillingView(organizationId: string): HostBillingView {
  return buildHostBillingView(services.state, organizationId, new Date().toISOString())
}

/**
 * The status values these surfaces claim to cover, taken from the schemas rather
 * than listed by hand. Exported for the test that proves the two presentation
 * records above stay exhaustive at runtime as well as at compile time.
 */
export const COVERED_BILLING_STATUSES = {
  invoice: hostInvoiceStatusSchema.options,
  paymentMethod: hostBillingProfileStatusSchema.options
} as const
