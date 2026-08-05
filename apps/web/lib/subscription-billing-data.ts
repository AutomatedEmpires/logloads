import "server-only"

import {
  formatMoney,
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

import { services } from "./services"

const BILLING_CURRENCY = "USD"

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
    detail: "Commercial terms were recorded, but activation was not completed before new subscription enrollment closed.",
    label: "Pending activation",
    tone: "info"
  },
  incomplete: {
    detail: "Enrollment was incomplete when new subscription enrollment closed. The record remains for reconciliation only.",
    label: "Enrollment incomplete",
    tone: "warning"
  },
  active: {
    detail: "Active was the last recorded provider status. It does not authorize new Network commitments.",
    label: "Active",
    tone: "success"
  },
  past_due: {
    detail: "A preserved base or usage obligation is past due and may require reconciliation.",
    label: "Payment past due",
    tone: "critical"
  },
  non_renewing: {
    detail: "The preserved agreement was marked non-renewing.",
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
    detail: "This record was explicitly granted without ordinary base collection. Historical usage remains auditable.",
    label: "Complimentary",
    tone: "info"
  }
} satisfies Record<OrganizationSubscription["status"], StatusPresentation>

export const SUBSCRIPTION_PAYMENT_PRESENTATION = {
  none: {
    detail: "No provider-confirmed payment state was recorded for this preserved obligation.",
    label: "Recorded not configured",
    tone: "warning"
  },
  current: {
    detail: "Current was the last provider-confirmed payment state for this preserved obligation.",
    label: "Recorded current",
    tone: "success"
  },
  requires_payment_method: {
    detail: "The preserved provider record requires a usable payment method for reconciliation.",
    label: "Recorded payment method required",
    tone: "critical"
  },
  failed: {
    detail: "The last recorded collection attempt failed and needs billing-manager attention.",
    label: "Recorded payment failed",
    tone: "critical"
  },
  past_due: {
    detail: "The preserved provider record shows an amount outstanding after its due date.",
    label: "Recorded past due",
    tone: "critical"
  },
  uncollectible: {
    detail: "The provider marked an amount uncollectible. The canonical invoice remains preserved for reconciliation.",
    label: "Recorded uncollectible",
    tone: "critical"
  }
} satisfies Record<OrganizationSubscription["paymentState"], StatusPresentation>

export interface HostSubscriptionAllowanceView {
  closesOnLabel: string
  detail: string
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
  planCode: OrganizationSubscription["planCode"] | null
  planName: string
  canOpenPortal: boolean
  recordMode: "historical"
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

function historicalSubscriptionPriority(
  source: SubscriptionBillingSource,
  subscription: OrganizationSubscription
): number {
  const summaryIds = new Set(
    source.billingPeriodSummaries
      .filter((summary) => summary.subscriptionId === subscription.id)
      .map((summary) => summary.id)
  )
  const hasOutstandingBase = source.subscriptionBaseInvoices.some(
    (invoice) =>
      invoice.subscriptionId === subscription.id &&
      invoice.amountRemainingCents > 0 &&
      invoice.status !== "paid" &&
      invoice.status !== "void"
  )
  const hasOutstandingUsage = source.networkOverageInvoices.some(
    (invoice) =>
      summaryIds.has(invoice.billingPeriodSummaryId) &&
      (invoice.providerAmountRemainingCents ?? invoice.amountDueCents) > 0 &&
      invoice.status !== "paid" &&
      invoice.status !== "void"
  )

  return (
    (subscription.stripeSubscriptionId ? 1_000 : 0) +
    (hasOutstandingBase || hasOutstandingUsage ? 500 : 0) +
    (subscription.stripeCustomerId ? 100 : 0) +
    (["active", "past_due", "non_renewing"].includes(subscription.status)
      ? 10
      : 0)
  )
}

function preferredHistoricalSubscription(
  source: SubscriptionBillingSource,
  subscriptions: readonly OrganizationSubscription[]
): OrganizationSubscription | null {
  return [...subscriptions].sort((left, right) => {
    const priorityDifference =
      historicalSubscriptionPriority(source, right) -
      historicalSubscriptionPriority(source, left)

    return priorityDifference || Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
  })[0] ?? null
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

function allowanceView(
  summary: BillingPeriodSummary
): HostSubscriptionAllowanceView {
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
    case "percentage_active":
      return {
        detail: "The current 5% completed-load agreement is accepted for this organization.",
        label: "Current 5% agreement active",
        tone: "success"
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
    detail: "The preserved Dispatch Pro provider record requires a usable payment method for reconciliation."
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
    return `Recorded agreement would renew after ${formatDay(boundary)}`
  }

  if (
    subscription.renewalBehavior === "non_renewing" ||
    subscription.cancelAtPeriodEnd
  ) {
    return `Recorded agreement does not renew after ${formatDay(boundary)}`
  }

  return `Recorded manual renewal review by ${formatDay(boundary)}`
}

export function buildHostSubscriptionBillingView(
  source: SubscriptionBillingSource,
  organizationId: string,
  now = new Date(),
  collectionEnabled = false
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
    linkedSubscription?.organizationId === organizationId &&
    subscriptionIsInternal(linkedSubscription)
  ) {
    return null
  }

  const linkedCommercialSubscription =
    linkedSubscription?.organizationId === organizationId &&
    !subscriptionIsInternal(linkedSubscription)
      ? linkedSubscription
      : null
  // A terminal subscription remains an immutable provider/audit record after
  // the billing account migrates to percentage_v1 and drops its live pointer.
  // Locate that history by tenant instead of making account.subscriptionId the
  // only way a host can still see invoices and portal details they may need.
  const historicalCommercialSubscription = preferredHistoricalSubscription(
    source,
    source.organizationSubscriptions.filter(
      (candidate) =>
        candidate.organizationId === organizationId &&
        !subscriptionIsInternal(candidate)
    )
  )
  const subscription =
    linkedCommercialSubscription ?? historicalCommercialSubscription

  if (!subscription) {
    return null
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
  const linkedToCurrentAccount = linkedCommercialSubscription?.id === subscription.id
  const activation = linkedToCurrentAccount
    ? activationPresentation(account.activationState, subscription.billingModel)
    : {
        detail: "This subscription is separate from the current organization billing model and remains available only for historical reconciliation.",
        label: "Historical record preserved",
        tone: "neutral"
      } satisfies StatusPresentation
  const status = statusPresentation(subscription)
  const payment = paymentPresentation(subscription)
  const plan =
    source.billingPlanDefinitions.find(
      (candidate) =>
        candidate.code === subscription.planCode &&
        candidate.version === subscription.planSnapshot.version
    ) ?? subscription.planSnapshot
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
      "The recorded account and subscription states disagree. Contact support for historical reconciliation."
    )
  }

  return {
    activationDetail: linkedToCurrentAccount
      ? `The recorded account state was ${activation.label.toLowerCase()}. It does not authorize new work, enrollment, conversion, or tier changes.`
      : activation.detail,
    activationLabel: linkedToCurrentAccount
      ? `Recorded ${activation.label.toLowerCase()}`
      : activation.label,
    activationTone: "neutral",
    allowance: currentSummary ? allowanceView(currentSummary) : null,
    basePriceLabel:
      subscription.baseMonthlyPriceSnapshotCents === null
        ? "Contract-defined"
        : `${money(subscription.baseMonthlyPriceSnapshotCents)}/month`,
    billingModel: subscription.billingModel,
    collectionEnabled,
    collectionLabel:
      collectionEnabled && subscription.stripeSubscriptionId
        ? "Existing provider reconciliation remains enabled for this recorded obligation. New enrollment and plan changes are closed."
        : "New subscription enrollment and collection are closed. This record remains available only for historical reconciliation.",
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
      ? `Recorded ${source.billingPlanDefinitions.find((candidate) => candidate.code === subscription.pendingPlanCode)?.displayName ?? subscription.pendingPlanCode} scheduled${subscription.pendingPlanEffectiveAt ? ` for ${formatDay(subscription.pendingPlanEffectiveAt)}` : ""}`
      : null,
    planCode: subscription.planCode,
    planName: `${plan.displayName} — historical`,
    canOpenPortal: Boolean(
      subscription.stripeCustomerId && subscription.stripeSubscriptionId
    ),
    recordMode: "historical",
    renewalLabel: renewalLabel(subscription),
    sectionLabel: dispatchSoftware
      ? "Historical Dispatch Pro record"
      : "Historical Network subscription",
    statusDetail: `${status.label} was the last recorded subscription status. This record does not authorize new work, enrollment, conversion, or tier changes.`,
    statusLabel: `Recorded ${status.label.toLowerCase()}`,
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
    process.env.LOGLOADS_SUBSCRIPTION_COLLECTION === "enabled"
  )
}
