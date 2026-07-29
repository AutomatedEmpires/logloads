import "server-only"

import {
  formatMoney,
  subscriptionPlanQuoteFingerprint,
  type BillingAdjustment,
  type BillingPeriodSummary,
  type NetworkOverageInvoice,
  type NetworkUsageEvent,
  type OrganizationBillingAccount,
  type OrganizationSubscription,
  type SubscriptionBaseInvoice,
  type SubscriptionPlanDefinition
} from "@logloads/contracts"
import type { BadgeProps } from "@logloads/ui"
import { PILOT_CONVERSION_GRACE_DAYS } from "@logloads/services"

import { services } from "./services"
import { subscriptionNewMoneyAllowed } from "./subscription-stripe"

const BILLING_CURRENCY = "USD"
const DAY_MS = 86_400_000
const MONTHLY_NORMALIZATION_DAYS = 30

export type SubscriptionBillingTone = NonNullable<BadgeProps["tone"]>

export interface SubscriptionBillingSource {
  billingAdjustments: readonly BillingAdjustment[]
  billingPlanDefinitions: readonly SubscriptionPlanDefinition[]
  organizationBillingAccounts: readonly OrganizationBillingAccount[]
  organizationSubscriptions: readonly OrganizationSubscription[]
  billingPeriodSummaries: readonly BillingPeriodSummary[]
  networkUsageEvents: readonly NetworkUsageEvent[]
  networkOverageInvoices: readonly NetworkOverageInvoice[]
  subscriptionBaseInvoices: readonly SubscriptionBaseInvoice[]
}

interface StatusPresentation {
  detail: string
  label: string
  tone: SubscriptionBillingTone
}

export const SUBSCRIPTION_STATUS_PRESENTATION = {
  pending: {
    detail: "Commercial terms are recorded, but operational activation has not begun.",
    label: "Pending activation",
    tone: "info"
  },
  incomplete: {
    detail: "Enrollment is incomplete. Network access does not activate until payment setup and the accepted agreement reconcile.",
    label: "Enrollment incomplete",
    tone: "warning"
  },
  active: {
    detail: "The accepted plan is active for new Network commitments.",
    label: "Active",
    tone: "success"
  },
  past_due: {
    detail: "A base or usage payment is past due. Existing work continues; new Network commitments may be restricted only after the recorded grace process.",
    label: "Payment past due",
    tone: "critical"
  },
  non_renewing: {
    detail: "The plan remains available through its recorded term and will not renew automatically.",
    label: "Non-renewing",
    tone: "warning"
  },
  cancelled: {
    detail: "This subscription is cancelled. Historical usage and invoices remain available.",
    label: "Cancelled",
    tone: "neutral"
  },
  expired: {
    detail: "The accepted operating term has ended. Historical usage and invoices remain available.",
    label: "Term ended",
    tone: "neutral"
  },
  comped: {
    detail: "This access was explicitly granted without ordinary base collection. Usage remains auditable.",
    label: "Complimentary",
    tone: "info"
  }
} satisfies Record<OrganizationSubscription["status"], StatusPresentation>

export const SUBSCRIPTION_PAYMENT_PRESENTATION = {
  none: {
    detail: "No provider-confirmed payment state is recorded.",
    label: "Not configured",
    tone: "warning"
  },
  current: {
    detail: "The canonical subscription record is current with its reconciled provider events.",
    label: "Current",
    tone: "success"
  },
  requires_payment_method: {
    detail: "A usable payment method is required before paid Network activation.",
    label: "Payment method required",
    tone: "critical"
  },
  failed: {
    detail: "The last collection attempt failed and needs billing-manager attention.",
    label: "Payment failed",
    tone: "critical"
  },
  past_due: {
    detail: "Payment remains outstanding after its due date.",
    label: "Past due",
    tone: "critical"
  },
  uncollectible: {
    detail: "The provider marked an amount uncollectible. The canonical invoice remains preserved for reconciliation.",
    label: "Uncollectible",
    tone: "critical"
  }
} satisfies Record<OrganizationSubscription["paymentState"], StatusPresentation>

export interface HostSubscriptionAllowanceView {
  closesOnLabel: string
  detail: string
  forecastOverageUnits: number
  forecastUnits: number
  includedUnits: number
  overageAmountLabel: string
  overageUnits: number
  percent: number
  periodLabel: string
  remainingUnits: number
  summaryStatus: BillingPeriodSummary["status"]
  usedUnits: number
}

export interface HostSubscriptionInvoiceView {
  amountLabel: string
  issuedOnLabel: string | null
  quantity: number
  status: NetworkOverageInvoice["status"]
  statusLabel: string
}

export interface HostSubscriptionBaseInvoiceView {
  amountDueLabel: string
  amountRemainingLabel: string
  dueOnLabel: string | null
  hostedInvoiceUrl: string | null
  status: SubscriptionBaseInvoice["status"]
  statusLabel: string
}

export type PilotConversionPlanCode =
  | "network_25"
  | "network_50"
  | "network_100"
export type PilotConversionTargetPlanCode =
  | PilotConversionPlanCode
  | "enterprise_250_plus"

export interface PilotConversionPlanView {
  allowanceLabel: string
  basePriceLabel: string
  commitmentLabel: string
  name: string
  overageLabel: string
  planCode: PilotConversionPlanCode
  quoteFingerprint: string
}

export interface PilotConversionView {
  graceEndsOnLabel: string
  options: PilotConversionPlanView[]
  sourceSubscriptionId: string
  target: {
    canOpenPortal: boolean
    canStartCheckout: boolean
    planCode: PilotConversionTargetPlanCode
    planName: string
    statusLabel: string
    subscriptionId: string
  } | null
}

export interface HostSubscriptionBillingView {
  activationDetail: string
  activationLabel: string
  activationTone: SubscriptionBillingTone
  allowance: HostSubscriptionAllowanceView | null
  basePriceLabel: string
  billingModel: OrganizationBillingAccount["billingModel"]
  collectionEnabled: boolean
  collectionLabel: string
  commitmentLabel: string | null
  includesDispatchProCapabilities: boolean
  integrityNotices: string[]
  latestBaseInvoice: HostSubscriptionBaseInvoiceView | null
  latestOverageInvoice: HostSubscriptionInvoiceView | null
  networkAllowanceLabel: string
  overageRateLabel: string
  outstandingAmountLabel: string
  outstandingInvoiceCount: number
  paymentDetail: string | null
  paymentLabel: string | null
  paymentTone: SubscriptionBillingTone | null
  pendingPlanLabel: string | null
  pilotConversion: PilotConversionView | null
  planCode: OrganizationSubscription["planCode"] | null
  planName: string
  canOpenPortal: boolean
  canStartCheckout: boolean
  recommendation: string | null
  renewalLabel: string | null
  sectionLabel: string
  statusDetail: string
  statusLabel: string
  statusTone: SubscriptionBillingTone
  subscriptionId: string | null
}

function money(amountCents: number): string {
  return formatMoney({ amountCents, currency: BILLING_CURRENCY })
}

function formatDay(instant: string): string {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    year: "numeric"
  }).format(new Date(instant))
}

function formatPeriod(start: string, end: string): string {
  return `${formatDay(start)} – ${formatDay(end)}`
}

function latestByUpdatedAt<T extends { updatedAt: string }>(rows: readonly T[]): T | null {
  return [...rows].sort(
    (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
  )[0] ?? null
}

function planIsInternal(
  planCode: OrganizationSubscription["planCode"],
  planSnapshot?: SubscriptionPlanDefinition
): boolean {
  return planCode === "internal_billing_test" || Boolean(planSnapshot?.internalBillingTest)
}

function subscriptionIsInternal(
  subscription: OrganizationSubscription
): boolean {
  return (
    subscription.internalBillingTest ||
    planIsInternal(subscription.planCode, subscription.planSnapshot)
  )
}

function summaryIsInternal(summary: BillingPeriodSummary): boolean {
  return (
    summary.internalBillingTest ||
    planIsInternal(summary.planCode, summary.planSnapshot)
  )
}

function usageEventIsInternal(event: NetworkUsageEvent): boolean {
  return event.internalBillingTest || planIsInternal(event.planCode)
}

function overageInvoiceIsInternal(invoice: NetworkOverageInvoice): boolean {
  return invoice.internalBillingTest || planIsInternal(invoice.planCode)
}

function baseInvoiceIsInternal(invoice: SubscriptionBaseInvoice): boolean {
  return invoice.internalBillingTest || planIsInternal(invoice.planCode)
}

function summaryAt(
  summaries: readonly BillingPeriodSummary[],
  nowMs: number
): { current: BillingPeriodSummary | null; overlapping: number } {
  const matching = summaries.filter(
    (summary) =>
      Date.parse(summary.periodStart) <= nowMs && nowMs < Date.parse(summary.periodEnd)
  )

  if (matching.length > 0) {
    return {
      current: latestByUpdatedAt(matching),
      overlapping: matching.length
    }
  }

  return {
    current:
      [...summaries].sort(
        (left, right) => Date.parse(right.periodEnd) - Date.parse(left.periodEnd)
      )[0] ?? null,
    overlapping: 0
  }
}

function forecastUnits(summary: BillingPeriodSummary, nowMs: number): number {
  const startMs = Date.parse(summary.periodStart)
  const endMs = Date.parse(summary.periodEnd)

  if (nowMs <= startMs || summary.usedUnits === 0) {
    return summary.usedUnits
  }

  if (nowMs >= endMs || summary.status !== "open") {
    return summary.usedUnits
  }

  const elapsedMs = Math.max(DAY_MS, nowMs - startMs)
  const projected = Math.ceil(summary.usedUnits * ((endMs - startMs) / elapsedMs))

  return Math.max(summary.usedUnits, projected)
}

function allowanceView(
  summary: BillingPeriodSummary,
  nowMs: number
): HostSubscriptionAllowanceView {
  const projectedUnits = forecastUnits(summary, nowMs)
  const forecastOverageUnits = Math.max(0, projectedUnits - summary.includedUnits)
  const remainingUnits = Math.max(0, summary.includedUnits - summary.usedUnits)
  const percent =
    summary.includedUnits === 0
      ? summary.usedUnits > 0
        ? 100
        : 0
      : Math.min(100, Math.round((summary.usedUnits / summary.includedUnits) * 100))
  const detail =
    summary.overageUnits > 0
      ? `${summary.usedUnits} completed · ${summary.overageUnits} in overage`
      : `${summary.usedUnits} completed · ${remainingUnits} included remaining`

  return {
    closesOnLabel: formatDay(summary.periodEnd),
    detail,
    forecastOverageUnits,
    forecastUnits: projectedUnits,
    includedUnits: summary.includedUnits,
    overageAmountLabel: money(summary.overageAmountCents),
    overageUnits: summary.overageUnits,
    percent,
    periodLabel: formatPeriod(summary.periodStart, summary.periodEnd),
    remainingUnits,
    summaryStatus: summary.status,
    usedUnits: summary.usedUnits
  }
}

function activationPresentation(
  state: OrganizationBillingAccount["activationState"],
  billingModel?: OrganizationBillingAccount["billingModel"]
): StatusPresentation {
  switch (state) {
    case "unenrolled":
      return {
        detail: "No paid operating agreement has been accepted for this organization.",
        label: "Not enrolled",
        tone: "neutral"
      }
    case "legacy":
      return {
        detail: "This organization remains on its explicit grandfathered percentage agreement. No subscription enrollment is recorded.",
        label: "Grandfathered legacy",
        tone: "neutral"
      }
    case "configured_dark":
      return {
        detail:
          "Commercial infrastructure is configured, but subscription enrollment and collection remain deliberately dark.",
        label: "Configured, not activated",
        tone: "info"
      }
    case "active":
      return {
        detail: "This organization is operationally activated under its accepted agreement.",
        label: "Operationally active",
        tone: "success"
      }
    case "suspended":
      return {
        detail:
          billingModel === "dispatch_pro"
            ? "Dispatch Pro software access is suspended. Historical operations remain visible."
            : "New Network commitments are suspended. Existing and historical operations remain visible.",
        label: "Suspended",
        tone: "critical"
      }
  }

  return {
    detail: "The stored activation state is not recognized. Reconcile it before collection.",
    label: "Unknown activation state",
    tone: "critical"
  }
}

function statusPresentation(
  subscription: OrganizationSubscription
): StatusPresentation {
  const base = SUBSCRIPTION_STATUS_PRESENTATION[subscription.status]

  if (subscription.billingModel !== "dispatch_pro") {
    return base
  }

  const details = {
    active:
      "Dispatch Pro software is active for established private-fleet operations. It does not include LogLoads Network capacity.",
    cancelled:
      "This Dispatch Pro subscription is cancelled. Historical software activity and invoices remain available.",
    comped:
      "Dispatch Pro software access was explicitly granted without ordinary base collection.",
    expired:
      "The accepted Dispatch Pro operating term has ended. Historical software activity and invoices remain available.",
    incomplete:
      "Enrollment is incomplete. Dispatch Pro software does not activate until payment setup and the accepted agreement reconcile.",
    non_renewing:
      "Dispatch Pro software remains available through its recorded term and will not renew automatically.",
    past_due:
      "A Dispatch Pro payment is past due. Access follows the recorded payment-grace process.",
    pending:
      "Dispatch Pro software terms are recorded, but operational activation has not begun."
  } satisfies Record<OrganizationSubscription["status"], string>

  return {
    ...base,
    detail: details[subscription.status]
  }
}

function paymentPresentation(
  subscription: OrganizationSubscription
): StatusPresentation {
  const base = SUBSCRIPTION_PAYMENT_PRESENTATION[subscription.paymentState]

  if (
    subscription.billingModel !== "dispatch_pro" ||
    subscription.paymentState !== "requires_payment_method"
  ) {
    return base
  }

  return {
    ...base,
    detail: "A usable payment method is required before paid Dispatch Pro activation."
  }
}

function latestInvoiceView(
  invoices: readonly NetworkOverageInvoice[]
): HostSubscriptionInvoiceView | null {
  const invoice = latestByUpdatedAt(invoices)

  if (!invoice) {
    return null
  }

  const statusLabels = {
    draft: "Draft",
    open: "Outstanding",
    paid: "Paid",
    uncollectible: "Uncollectible",
    void: "Voided"
  } satisfies Record<NetworkOverageInvoice["status"], string>

  return {
    amountLabel: money(invoice.amountDueCents),
    issuedOnLabel: invoice.issuedAt ? formatDay(invoice.issuedAt) : null,
    quantity: invoice.quantity,
    status: invoice.status,
    statusLabel: statusLabels[invoice.status]
  }
}

function latestBaseInvoiceView(
  invoices: readonly SubscriptionBaseInvoice[]
): HostSubscriptionBaseInvoiceView | null {
  const invoice = latestByUpdatedAt(invoices)

  if (!invoice) {
    return null
  }

  const statusLabels = {
    draft: "Draft",
    open: invoice.amountRemainingCents > 0 ? "Outstanding" : "Open",
    paid: "Paid",
    uncollectible: "Uncollectible",
    void: "Voided"
  } satisfies Record<SubscriptionBaseInvoice["status"], string>

  return {
    amountDueLabel: money(invoice.amountDueCents),
    amountRemainingLabel: money(invoice.amountRemainingCents),
    dueOnLabel: invoice.dueAt ? formatDay(invoice.dueAt) : null,
    hostedInvoiceUrl: invoice.hostedInvoiceUrl,
    status: invoice.status,
    statusLabel: statusLabels[invoice.status]
  }
}

function normalizedMonthlyForecast(
  subscription: OrganizationSubscription,
  summary: BillingPeriodSummary,
  projectedUnits: number
): number {
  if (subscription.planSnapshot.allowancePeriod !== "commitment") {
    return projectedUnits
  }

  const windowDays = Math.max(
    1,
    Math.round(
      (Date.parse(summary.periodEnd) - Date.parse(summary.periodStart)) / DAY_MS
    )
  )

  return Math.ceil(projectedUnits * (MONTHLY_NORMALIZATION_DAYS / windowDays))
}

function recommendationFor(
  subscription: OrganizationSubscription,
  summary: BillingPeriodSummary | null,
  plans: readonly SubscriptionPlanDefinition[],
  nowMs: number
): string | null {
  if (!summary || summary.usedUnits === 0 || subscription.planSnapshot.internalBillingTest) {
    return null
  }

  const projected = forecastUnits(summary, nowMs)
  const monthlyUnits = normalizedMonthlyForecast(subscription, summary, projected)

  if (monthlyUnits >= 250) {
    return `Your current pace is about ${monthlyUnits} completed Network movements per month. Review an Enterprise 250+ agreement before the next term.`
  }

  const candidates = plans
    .filter(
      (plan) =>
        plan.active &&
        ["network_25", "network_50", "network_100"].includes(plan.code) &&
        plan.baseMonthlyPriceCents !== null &&
        plan.includedNetworkLoadUnits !== null &&
        plan.overageUnitPriceCents !== null
    )
    .map((plan) => ({
      plan,
      projectedCostCents:
        plan.baseMonthlyPriceCents! +
        Math.max(0, monthlyUnits - plan.includedNetworkLoadUnits!) *
          plan.overageUnitPriceCents!
    }))
    .sort(
      (left, right) =>
        left.projectedCostCents - right.projectedCostCents ||
        left.plan.includedNetworkLoadUnits! - right.plan.includedNetworkLoadUnits!
    )

  const lowest = candidates[0]

  if (!lowest) {
    return null
  }

  if (lowest.plan.code === subscription.planCode) {
    return `At the current pace of about ${monthlyUnits} completed Network movements per month, ${lowest.plan.displayName} remains the lowest modeled monthly cost.`
  }

  return `At the current pace of about ${monthlyUnits} completed Network movements per month, ${lowest.plan.displayName} is the lowest modeled tier at ${money(lowest.projectedCostCents)} before taxes or contract-specific terms.`
}

function commitmentLabel(subscription: OrganizationSubscription): string | null {
  if (!subscription.commitmentStart || !subscription.commitmentEnd) {
    return null
  }

  const months = subscription.planSnapshot.commitmentMonths
  const base = subscription.baseMonthlyPriceSnapshotCents
  const minimum =
    months !== null && base !== null ? ` · ${money(months * base)} minimum base` : ""

  return `${formatPeriod(subscription.commitmentStart, subscription.commitmentEnd)}${minimum}`
}

function renewalLabel(subscription: OrganizationSubscription): string | null {
  const boundary = subscription.commitmentEnd ?? subscription.currentPeriodEnd

  if (!boundary) {
    return null
  }

  if (subscription.renewalBehavior === "automatic" && !subscription.cancelAtPeriodEnd) {
    return `Renews under the accepted agreement after ${formatDay(boundary)}`
  }

  if (
    subscription.renewalBehavior === "non_renewing" ||
    subscription.cancelAtPeriodEnd
  ) {
    return `Does not renew after ${formatDay(boundary)}`
  }

  return `Manual renewal review by ${formatDay(boundary)}`
}

function configuredWithoutSubscription(
  account: OrganizationBillingAccount,
  collectionEnabled: boolean,
  newEnrollmentAllowed: boolean,
  duplicateAccountCount: number
): HostSubscriptionBillingView {
  const activation = activationPresentation(
    account.activationState,
    account.billingModel
  )

  return {
    activationDetail: activation.detail,
    activationLabel: activation.label,
    activationTone: activation.tone,
    allowance: null,
    basePriceLabel: "Not accepted",
    billingModel: account.billingModel,
    collectionEnabled,
    collectionLabel: collectionEnabled
      ? newEnrollmentAllowed
        ? "Enrollment is enabled for this canary organization."
        : "Enrollment is not enabled for this organization; contact LogLoads for launch access."
      : "Network collection is disabled in this environment.",
    commitmentLabel: null,
    includesDispatchProCapabilities: false,
    integrityNotices:
      duplicateAccountCount > 1
        ? ["More than one billing account exists for this organization. Reconcile before enrollment."]
        : [],
    latestBaseInvoice: null,
    latestOverageInvoice: null,
    networkAllowanceLabel: "Not accepted",
    overageRateLabel: "Not accepted",
    outstandingAmountLabel: "$0.00",
    outstandingInvoiceCount: 0,
    paymentDetail: null,
    paymentLabel: null,
    paymentTone: null,
    pendingPlanLabel: null,
    pilotConversion: null,
    planCode: null,
    planName: "Network enrollment",
    canOpenPortal: false,
    canStartCheckout: false,
    recommendation: null,
    renewalLabel: null,
    sectionLabel:
      account.billingModel === "dispatch_pro"
        ? "Dispatch software enrollment"
        : "Network enrollment",
    statusDetail: "No accepted subscription snapshot is attached to this billing account.",
    statusLabel: "Not enrolled",
    statusTone: "neutral",
    subscriptionId: null
  }
}

export function buildHostSubscriptionBillingView(
  source: SubscriptionBillingSource,
  organizationId: string,
  now = new Date(),
  collectionEnabled = false,
  newEnrollmentAllowed = collectionEnabled
): HostSubscriptionBillingView | null {
  const accounts = source.organizationBillingAccounts.filter(
    (account) => account.organizationId === organizationId
  )
  const account = latestByUpdatedAt(accounts)

  if (!account) {
    return null
  }

  const linkedSubscription =
    account.subscriptionId === null
      ? null
      : source.organizationSubscriptions.find(
          (candidate) => candidate.id === account.subscriptionId
        ) ?? null

  if (
    linkedSubscription &&
    linkedSubscription.organizationId === organizationId &&
    subscriptionIsInternal(linkedSubscription)
  ) {
    return null
  }

  const subscription =
    linkedSubscription?.organizationId === organizationId
      ? linkedSubscription
      : null

  if (!subscription) {
    return configuredWithoutSubscription(
      account,
      collectionEnabled,
      newEnrollmentAllowed,
      accounts.length
    )
  }

  const nowMs = now.getTime()
  const internalUsageSummaryIds = new Set(
    source.networkUsageEvents
      .filter(usageEventIsInternal)
      .map((event) => event.billingPeriodSummaryId)
  )
  const summaries = source.billingPeriodSummaries.filter(
    (summary) =>
      summary.organizationId === organizationId &&
      summary.subscriptionId === subscription.id &&
      !summaryIsInternal(summary) &&
      !internalUsageSummaryIds.has(summary.id)
  )
  const selectedSummary = summaryAt(summaries, nowMs)
  const currentSummary = selectedSummary.current
  const activeUsageCount = currentSummary
    ? source.networkUsageEvents.filter(
        (event) =>
          event.organizationId === organizationId &&
          event.billingPeriodSummaryId === currentSummary.id &&
          !usageEventIsInternal(event) &&
          event.status !== "reversed"
      ).length
    : 0
  const integrityNotices: string[] = []

  if (accounts.length > 1) {
    integrityNotices.push(
      "More than one billing account exists for this organization. Reconcile before collection."
    )
  }

  if (selectedSummary.overlapping > 1) {
    integrityNotices.push(
      "More than one allowance window covers the current instant. Reconcile periods before collection."
    )
  }

  if (currentSummary && currentSummary.usedUnits !== activeUsageCount) {
    integrityNotices.push(
      `The allowance summary records ${currentSummary.usedUnits} active units while its usage ledger contains ${activeUsageCount}. Reconcile before invoicing.`
    )
  }

  const dispatchSoftware = subscription.billingModel === "dispatch_pro"
  const activation = activationPresentation(
    account.activationState,
    subscription.billingModel
  )
  const status = statusPresentation(subscription)
  const payment = paymentPresentation(subscription)
  const plan =
    source.billingPlanDefinitions.find(
      (candidate) =>
        candidate.code === subscription.planCode &&
        candidate.version === subscription.planSnapshot.version
    ) ?? subscription.planSnapshot
  const pilotGraceEndsAt =
    subscription.planCode === "network_pilot" &&
    subscription.commitmentEnd
      ? subscription.conversionGraceEndsAt ??
        new Date(
          Date.parse(subscription.commitmentEnd) +
            PILOT_CONVERSION_GRACE_DAYS * DAY_MS
        ).toISOString()
      : null
  const pilotConversionTarget =
    subscription.planCode === "network_pilot"
      ? source.organizationSubscriptions.find(
          (candidate) =>
            candidate.organizationId === organizationId &&
            candidate.convertedFromSubscriptionId === subscription.id
        ) ?? null
      : null
  const pilotConversionActive = Boolean(
    subscription.planCode === "network_pilot" &&
      subscription.operationalActivatedAt &&
      !subscription.operationalExpiredAt &&
      subscription.status !== "cancelled" &&
      subscription.commitmentEnd &&
      pilotGraceEndsAt &&
      nowMs >= Date.parse(subscription.commitmentEnd) &&
      nowMs < Date.parse(pilotGraceEndsAt)
  )
  const pilotConversion: PilotConversionView | null =
    pilotConversionActive && pilotGraceEndsAt
      ? {
          graceEndsOnLabel: formatDay(pilotGraceEndsAt),
          options: pilotConversionTarget
            ? []
            : (
                [
                  "network_25",
                  "network_50",
                  "network_100"
                ] as const
              ).flatMap((planCode) => {
                const definition = [...source.billingPlanDefinitions]
                  .filter(
                    (candidate) =>
                      candidate.active &&
                      candidate.code === planCode &&
                      Date.parse(candidate.effectiveAt) <= nowMs
                  )
                  .sort(
                    (left, right) =>
                      right.version - left.version
                  )[0]

                return definition &&
                  definition.baseMonthlyPriceCents !== null &&
                  definition.includedNetworkLoadUnits !== null &&
                  definition.overageUnitPriceCents !== null &&
                  definition.commitmentMonths !== null
                  ? [
                      {
                        allowanceLabel: `${definition.includedNetworkLoadUnits} completed Network movements per month`,
                        basePriceLabel: `${money(definition.baseMonthlyPriceCents)}/month`,
                        commitmentLabel: `${definition.commitmentMonths}-month minimum commitment`,
                        name: definition.displayName,
                        overageLabel: `${money(definition.overageUnitPriceCents)} per completed movement over allowance`,
                        planCode,
                        quoteFingerprint:
                          subscriptionPlanQuoteFingerprint(
                            definition
                          )
                      }
                    ]
                  : []
              }),
          sourceSubscriptionId: subscription.id,
          target: pilotConversionTarget &&
            (
              pilotConversionTarget.planCode === "network_25" ||
              pilotConversionTarget.planCode === "network_50" ||
              pilotConversionTarget.planCode === "network_100" ||
              pilotConversionTarget.planCode ===
                "enterprise_250_plus"
            )
            ? {
                canOpenPortal: Boolean(
                  pilotConversionTarget.stripeCustomerId &&
                  pilotConversionTarget.stripeSubscriptionId
                ),
                canStartCheckout:
                  newEnrollmentAllowed &&
                  Boolean(
                    pilotConversionTarget.activationAuthorizedAt
                  ) &&
                  !pilotConversionTarget.stripeSubscriptionId &&
                  (
                    pilotConversionTarget.status === "pending" ||
                    pilotConversionTarget.status === "incomplete"
                  ),
                planCode: pilotConversionTarget.planCode,
                planName:
                  pilotConversionTarget.planSnapshot.displayName,
                statusLabel:
                  SUBSCRIPTION_STATUS_PRESENTATION[
                    pilotConversionTarget.status
                  ].label,
                subscriptionId: pilotConversionTarget.id
              }
            : null
        }
      : null
  const invoices = source.networkOverageInvoices.filter(
    (invoice) =>
      invoice.organizationId === organizationId &&
      summaries.some(
        (summary) => summary.id === invoice.billingPeriodSummaryId
      ) &&
      !overageInvoiceIsInternal(invoice)
  )
  const baseInvoices = source.subscriptionBaseInvoices.filter(
    (invoice) =>
      invoice.organizationId === organizationId &&
      invoice.subscriptionId === subscription.id &&
      !baseInvoiceIsInternal(invoice)
  )
  const outstandingBaseInvoices = baseInvoices.filter(
    (invoice) =>
      invoice.amountRemainingCents > 0 &&
      invoice.status !== "void" &&
      invoice.status !== "paid"
  )
  const outstandingUsageInvoices = invoices.filter((invoice) => {
    const amountRemainingCents =
      invoice.providerAmountRemainingCents ?? invoice.amountDueCents

    return (
      amountRemainingCents > 0 &&
      (invoice.status === "open" || invoice.status === "uncollectible")
    )
  })
  const outstandingUsageByInvoiceId = new Map(
    outstandingUsageInvoices.map((invoice) => [
      invoice.id,
      invoice.providerAmountRemainingCents ?? invoice.amountDueCents
    ])
  )
  const summaryIds = new Set(summaries.map((summary) => summary.id))
  const adjustments = source.billingAdjustments.filter(
    (adjustment) =>
      adjustment.organizationId === organizationId &&
      summaryIds.has(adjustment.billingPeriodSummaryId)
  )

  for (const adjustment of adjustments) {
    if (
      adjustment.settlementIntent !== "credit_note" ||
      adjustment.providerSettlementState !== "settled" ||
      adjustment.providerSettlementAmountCents === null ||
      !adjustment.invoiceId ||
      (
        invoices.find((invoice) => invoice.id === adjustment.invoiceId)
          ?.providerAmountRemainingCents ?? null
      ) !== null
    ) {
      continue
    }

    const outstanding = outstandingUsageByInvoiceId.get(
      adjustment.invoiceId
    )

    if (outstanding !== undefined) {
      outstandingUsageByInvoiceId.set(
        adjustment.invoiceId,
        Math.max(
          0,
          outstanding - adjustment.providerSettlementAmountCents
        )
      )
    }
  }

  const outstandingUsageAmounts = [...outstandingUsageByInvoiceId.values()]
    .filter((amountCents) => amountCents > 0)
  const outstandingSupplementalAdjustments = adjustments.filter(
    (adjustment) =>
      adjustment.settlementIntent === "supplemental_debit" &&
      Boolean(adjustment.providerReference) &&
      adjustment.providerSettlementRemainingCents !== null &&
      adjustment.providerSettlementRemainingCents > 0 &&
      adjustment.providerSettlementState !== "settled"
  )
  const outstandingAmountCents =
    outstandingBaseInvoices.reduce(
      (total, invoice) => total + invoice.amountRemainingCents,
      0
    ) +
    outstandingUsageAmounts.reduce(
      (total, amountCents) => total + amountCents,
      0
    ) +
    outstandingSupplementalAdjustments.reduce(
      (total, adjustment) =>
        total + (adjustment.providerSettlementRemainingCents ?? 0),
      0
    )

  if (
    adjustments.some(
      (adjustment) =>
        adjustment.providerSettlementState === "failed"
    )
  ) {
    integrityNotices.push(
      "A provider billing adjustment needs operator reconciliation."
    )
  }

  if (
    account.activationState === "active" &&
    !["active", "past_due", "non_renewing", "comped"].includes(subscription.status)
  ) {
    integrityNotices.push(
      "The billing account is operationally active but its subscription does not grant active access."
    )
  }

  return {
    activationDetail: activation.detail,
    activationLabel: activation.label,
    activationTone: activation.tone,
    allowance: currentSummary ? allowanceView(currentSummary, nowMs) : null,
    basePriceLabel:
      subscription.baseMonthlyPriceSnapshotCents === null
        ? "Contract-defined"
        : `${money(subscription.baseMonthlyPriceSnapshotCents)}/month`,
    billingModel: account.billingModel,
    collectionEnabled,
    collectionLabel: collectionEnabled
      ? newEnrollmentAllowed
        ? "Enrollment and collection are enabled for this canary organization."
        : subscription.stripeSubscriptionId
          ? "Existing subscription reconciliation remains enabled; new enrollment is not enabled for this organization."
          : "Enrollment is not enabled for this organization; contact LogLoads for launch access."
      : dispatchSoftware
        ? "Dispatch Pro collection is disabled in this environment."
        : "Network collection is disabled in this environment.",
    commitmentLabel: commitmentLabel(subscription),
    includesDispatchProCapabilities:
      subscription.includesDispatchProCapabilitiesSnapshot,
    integrityNotices,
    latestBaseInvoice: latestBaseInvoiceView(baseInvoices),
    latestOverageInvoice: latestInvoiceView(invoices),
    networkAllowanceLabel: dispatchSoftware
      ? "0 completed Network movements — Dispatch Pro includes no Network allowance"
      : subscription.includedAllowanceSnapshot === null
        ? "Contract-defined"
        : `${subscription.includedAllowanceSnapshot} completed Network movements`,
    overageRateLabel:
      dispatchSoftware
        ? "No Network overage"
        : subscription.overageRateSnapshotCents === null
        ? "Contract-defined"
        : `${money(subscription.overageRateSnapshotCents)} per completed movement`,
    outstandingAmountLabel: money(outstandingAmountCents),
    outstandingInvoiceCount:
      outstandingBaseInvoices.length +
      outstandingUsageAmounts.length +
      outstandingSupplementalAdjustments.length,
    paymentDetail: payment.detail,
    paymentLabel: payment.label,
    paymentTone: payment.tone,
    pendingPlanLabel: subscription.pendingPlanCode
      ? `${source.billingPlanDefinitions.find((candidate) => candidate.code === subscription.pendingPlanCode)?.displayName ?? subscription.pendingPlanCode} scheduled${subscription.pendingPlanEffectiveAt ? ` for ${formatDay(subscription.pendingPlanEffectiveAt)}` : ""}`
      : null,
    pilotConversion,
    planCode: subscription.planCode,
    planName: plan.displayName,
    canOpenPortal: Boolean(
      subscription.stripeCustomerId && subscription.stripeSubscriptionId
    ),
    canStartCheckout:
      newEnrollmentAllowed &&
      Boolean(subscription.activationAuthorizedAt) &&
      !subscription.stripeSubscriptionId &&
      (subscription.status === "pending" ||
        subscription.status === "incomplete"),
    recommendation: recommendationFor(
      subscription,
      currentSummary,
      source.billingPlanDefinitions,
      nowMs
    ),
    renewalLabel: renewalLabel(subscription),
    sectionLabel: dispatchSoftware
      ? "Dispatch software subscription"
      : "Network subscription",
    statusDetail: status.detail,
    statusLabel: status.label,
    statusTone: status.tone,
    subscriptionId: subscription.id
  }
}

export function getHostSubscriptionBillingView(
  organizationId: string,
  now = new Date()
): HostSubscriptionBillingView | null {
  return buildHostSubscriptionBillingView(
    services.state,
    organizationId,
    now,
    process.env.LOGLOADS_SUBSCRIPTION_COLLECTION === "enabled",
    subscriptionNewMoneyAllowed(
      organizationId,
      services.state.organizationBillingAccounts.find(
        (account) => account.organizationId === organizationId
      )?.billingModel === "dispatch_pro"
        ? "dispatch_pro"
        : "subscription_v1",
      process.env
    )
  )
}
