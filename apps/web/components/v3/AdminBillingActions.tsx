"use client"

import { useRef, useState, useTransition, type FormEvent, type ReactNode } from "react"
import { useRouter } from "next/navigation"

import { SectionHeader } from "./Shells"

export type AdminBillingActionName =
  | "activate_subscription"
  | "authorize_pilot_enterprise_conversion"
  | "configure_subscription"
  | "reconcile_missing_usage"
  | "record_adjustment"
  | "retire_dispatch_entitlement"
  | "reverse_usage"
  | "schedule_non_renewal"
  | "schedule_plan_change"

export interface AdminBillingActionOption {
  id: string
  label: string
}

export interface AdminBillingActionsProps {
  periodSummaryOptions: AdminBillingActionOption[]
  subscriptionOptions: AdminBillingActionOption[]
  usageOptions: AdminBillingActionOption[]
}

type InternalBillingSmokeAction = "charge" | "refund"
type AdminConfigurablePlanCode =
  | "dispatch_pro"
  | "enterprise_250_plus"
  | "network_100"
  | "network_25"
  | "network_50"
  | "network_pilot"
type AdminPlanChangeTarget = Exclude<
  AdminConfigurablePlanCode,
  "network_pilot"
>

const CONFIRMATIONS = {
  activate_subscription: "AUTHORIZE_PAID_ACTIVATION",
  authorize_pilot_enterprise_conversion:
    "AUTHORIZE_PILOT_ENTERPRISE_CONVERSION",
  configure_subscription: "CONFIGURE_ACCEPTED_SUBSCRIPTION",
  reconcile_missing_usage: "RUN_MISSING_USAGE_RECONCILIATION",
  record_adjustment: "RECORD_BILLING_ADJUSTMENT",
  retire_dispatch_entitlement: "RETIRE_PAID_DISPATCH_ENTITLEMENT",
  reverse_usage: "REVERSE_NETWORK_USAGE",
  schedule_non_renewal: "SCHEDULE_NON_RENEWAL",
  schedule_plan_change: "SCHEDULE_PLAN_CHANGE"
} as const satisfies Record<AdminBillingActionName, string>

const ACTION_LABELS: Record<AdminBillingActionName, string> = {
  activate_subscription: "Authorize paid activation",
  authorize_pilot_enterprise_conversion:
    "Authorize Pilot conversion to Enterprise",
  configure_subscription: "Record accepted subscription plan",
  reconcile_missing_usage: "Reconcile missing Network usage",
  record_adjustment: "Record credit or debit",
  retire_dispatch_entitlement: "Retire overlapping Dispatch entitlement",
  reverse_usage: "Reverse one usage unit",
  schedule_non_renewal: "Schedule non-renewal",
  schedule_plan_change: "Schedule end-of-commitment plan change"
}

const RETIRED_NEW_SUBSCRIPTION_ACTIONS: ReadonlySet<AdminBillingActionName> =
  new Set([
    "activate_subscription",
    "authorize_pilot_enterprise_conversion",
    "configure_subscription",
    "schedule_plan_change"
  ])

function formString(data: FormData, name: string): string {
  const value = data.get(name)

  return typeof value === "string" ? value.trim() : ""
}

function formStringList(data: FormData, name: string): string[] {
  return formString(data, name)
    .split(/[\n,]/)
    .map((value) => value.trim())
    .filter(Boolean)
}

function formNumber(data: FormData, name: string): number {
  return Number(formString(data, name))
}

function negotiatedEnterpriseTerms(data: FormData) {
  return {
    baseMonthlyPriceCents: formNumber(
      data,
      "enterpriseBaseMonthlyPriceCents"
    ),
    commitmentMonths: formNumber(data, "enterpriseCommitmentMonths"),
    definedIntegrations: formStringList(
      data,
      "enterpriseDefinedIntegrations"
    ),
    includedNetworkLoadUnits: formNumber(
      data,
      "enterpriseIncludedNetworkLoadUnits"
    ),
    includesDispatchProCapabilities: true,
    overageUnitPriceCents: formNumber(
      data,
      "enterpriseOverageUnitPriceCents"
    ),
    stripeOveragePriceId: formString(
      data,
      "enterpriseStripeOveragePriceId"
    ),
    stripePriceId: formString(data, "enterpriseStripePriceId"),
    stripeProductId:
      formString(data, "enterpriseStripeProductId") || null,
    serviceSupportObligations: formString(
      data,
      "enterpriseServiceSupportObligations"
    )
  }
}

/**
 * Pure payload construction is exported so every browser control can be tested
 * without simulating a provider or weakening the server-side Zod boundary.
 */
export function buildAdminBillingActionPayload(
  action: AdminBillingActionName,
  data: FormData,
  adjustmentIdempotencyKey?: string
): Record<string, unknown> {
  switch (action) {
    case "configure_subscription": {
      const planCode = formString(data, "planCode")
      const base = {
        acceptedAt: formString(data, "acceptedAt"),
        acceptedByUserId: formString(data, "acceptedByUserId"),
        acceptedTermsVersion: formString(data, "acceptedTermsVersion"),
        action,
        confirm: CONFIRMATIONS[action],
        organizationId: formString(data, "organizationId"),
        overageMilestoneIntervalUnits: formNumber(
          data,
          "overageMilestoneIntervalUnits"
        ),
        paymentGraceDays: formNumber(data, "paymentGraceDays"),
        planCode
      }

      if (planCode === "dispatch_pro") {
        return base
      }

      if (planCode === "enterprise_250_plus") {
        return {
          ...base,
          negotiatedTerms: negotiatedEnterpriseTerms(data),
          operatingMarketIds: formStringList(data, "operatingMarketIds")
        }
      }

      return {
        ...base,
        operatingMarketIds: formStringList(data, "operatingMarketIds")
      }
    }
    case "activate_subscription":
      return {
        action,
        confirm: CONFIRMATIONS[action],
        organizationId: formString(data, "organizationId"),
        subscriptionId: formString(data, "subscriptionId")
      }
    case "authorize_pilot_enterprise_conversion":
      return {
        acceptedAt: formString(data, "acceptedAt"),
        acceptedByUserId: formString(data, "acceptedByUserId"),
        acceptedTermsVersion: formString(
          data,
          "acceptedTermsVersion"
        ),
        action,
        confirm: CONFIRMATIONS[action],
        negotiatedTerms: negotiatedEnterpriseTerms(data),
        operatingMarketIds: formStringList(
          data,
          "operatingMarketIds"
        ),
        sourceSubscriptionId: formString(
          data,
          "sourceSubscriptionId"
        )
      }
    case "schedule_plan_change": {
      const nextPlanCode = formString(data, "nextPlanCode")
      const base = {
        action,
        confirm: CONFIRMATIONS[action],
        effectiveAt: formString(data, "effectiveAt"),
        nextPlanCode,
        subscriptionId: formString(data, "subscriptionId")
      }

      if (nextPlanCode === "dispatch_pro") {
        return base
      }

      if (nextPlanCode === "enterprise_250_plus") {
        return {
          ...base,
          negotiatedTerms: negotiatedEnterpriseTerms(data),
          nextOperatingMarketIds: formStringList(
            data,
            "nextOperatingMarketIds"
          )
        }
      }

      return {
        ...base,
        nextOperatingMarketIds: formStringList(
          data,
          "nextOperatingMarketIds"
        )
      }
    }
    case "schedule_non_renewal":
      return {
        action,
        confirm: CONFIRMATIONS[action],
        effectiveAt: formString(data, "effectiveAt"),
        subscriptionId: formString(data, "subscriptionId")
      }
    case "record_adjustment":
      return {
        action,
        adjustmentType: formString(data, "adjustmentType"),
        amountCents: Number(formString(data, "amountCents")),
        billingPeriodSummaryId: formString(data, "billingPeriodSummaryId"),
        confirm: CONFIRMATIONS[action],
        idempotencyKey: adjustmentIdempotencyKey ?? "",
        invoiceId: formString(data, "invoiceId") || null,
        reason: formString(data, "reason")
      }
    case "reverse_usage":
      return {
        action,
        confirm: CONFIRMATIONS[action],
        reason: formString(data, "reason"),
        usageEventId: formString(data, "usageEventId")
      }
    case "retire_dispatch_entitlement":
      return {
        action,
        confirm: CONFIRMATIONS[action],
        entitlementId: formString(data, "entitlementId"),
        organizationId: formString(data, "organizationId"),
        providerCancellationReference: formString(
          data,
          "providerCancellationReference"
        )
      }
    case "reconcile_missing_usage":
      return {
        action,
        confirm: CONFIRMATIONS[action]
      }
  }
}

export function buildInternalBillingSmokePayload(
  action: InternalBillingSmokeAction,
  data: FormData
): Record<string, unknown> {
  if (action === "charge") {
    return {
      action,
      confirm: formString(data, "confirm"),
      organizationId: formString(data, "organizationId")
    }
  }

  return {
    action,
    confirm: formString(data, "confirm")
  }
}

async function postJson(
  path: string,
  payload: Record<string, unknown>
): Promise<{ message?: string; outcome?: string }> {
  const response = await fetch(path, {
    body: JSON.stringify(payload),
    headers: { "Content-Type": "application/json" },
    method: "POST"
  })
  const text = await response.text()
  let result: { error?: string; message?: string; outcome?: string } = {}

  if (text) {
    try {
      result = JSON.parse(text) as {
        error?: string
        message?: string
        outcome?: string
      }
    } catch {
      throw new Error("The billing service returned an unreadable response.")
    }
  }

  if (!response.ok) {
    if (result.outcome === "already_charged") {
      throw new Error(
        "The founder $1 verification charge is already recorded. Use the refund control if needed."
      )
    }

    throw new Error(result.error ?? "The billing action could not be saved.")
  }

  return result
}

function BillingTextField({
  defaultValue,
  label,
  list,
  max,
  maxLength,
  min,
  name,
  pattern,
  placeholder,
  required = true,
  title,
  type = "text"
}: {
  defaultValue?: number | string
  label: string
  list?: string
  max?: number
  maxLength?: number
  min?: number
  name: string
  pattern?: string
  placeholder?: string
  required?: boolean
  title?: string
  type?: "number" | "text"
}) {
  return (
    <label>
      {label}
      <input
        autoComplete="off"
        defaultValue={defaultValue}
        list={list}
        max={max}
        maxLength={maxLength}
        min={min}
        name={name}
        pattern={pattern}
        placeholder={placeholder}
        required={required}
        title={title}
        type={type}
      />
    </label>
  )
}

function BillingReasonField({ label = "Audited reason" }: { label?: string }) {
  return (
    <label>
      {label}
      <textarea maxLength={500} minLength={8} name="reason" required rows={3} />
    </label>
  )
}

function OperatingMarketIdsField({
  name,
  pilot
}: {
  name: "nextOperatingMarketIds" | "operatingMarketIds"
  pilot: boolean
}) {
  return (
    <>
      <label>
        Active organization-owned landing UUIDs (comma-separated)
        <textarea
          maxLength={3_000}
          name={name}
          placeholder="11111111-1111-4111-8111-111111111111"
          required
          rows={2}
        />
      </label>
      <span className="admin-row__when">
        {pilot
          ? "Network Pilot requires exactly one active landing owned by this organization."
          : "Enter between 1 and 25 active landing UUIDs owned by this organization."}
      </span>
    </>
  )
}

function EnterpriseNegotiatedTermsFields() {
  return (
    <>
      <BillingTextField
        label="Negotiated monthly base in whole cents"
        max={1_000_000_000}
        min={1}
        name="enterpriseBaseMonthlyPriceCents"
        type="number"
      />
      <BillingTextField
        label="Negotiated commitment in months"
        max={60}
        min={12}
        name="enterpriseCommitmentMonths"
        type="number"
      />
      <BillingTextField
        label="Included Network loads"
        max={1_000_000}
        min={250}
        name="enterpriseIncludedNetworkLoadUnits"
        type="number"
      />
      <BillingTextField
        label="Overage per Network load in whole cents"
        max={1_000_000_000}
        min={1}
        name="enterpriseOverageUnitPriceCents"
        type="number"
      />
      <label>
        Defined integrations (comma-separated or one per line)
        <textarea
          maxLength={3_000}
          name="enterpriseDefinedIntegrations"
          placeholder="Dispatch ERP feed&#10;Scale ticket export"
          rows={3}
        />
      </label>
      <label>
        Accepted service and support obligations
        <textarea
          maxLength={4_000}
          minLength={1}
          name="enterpriseServiceSupportObligations"
          required
          rows={5}
        />
      </label>
      <BillingTextField
        label="Pre-created Stripe base Price ID"
        maxLength={200}
        name="enterpriseStripePriceId"
        pattern="price_[A-Za-z0-9]+"
        placeholder="price_..."
        title="Use a pre-created Stripe Price ID beginning with price_"
      />
      <BillingTextField
        label="Distinct pre-created Stripe overage Price ID"
        maxLength={200}
        name="enterpriseStripeOveragePriceId"
        pattern="price_[A-Za-z0-9]+"
        placeholder="price_..."
        title="Use a distinct pre-created Stripe Price ID beginning with price_"
      />
      <BillingTextField
        label="Stripe Product ID (optional)"
        maxLength={200}
        name="enterpriseStripeProductId"
        pattern="prod_[A-Za-z0-9]+"
        placeholder="prod_..."
        required={false}
        title="When supplied, use a Stripe Product ID beginning with prod_"
      />
      <span className="admin-row__when">
        Enterprise always includes Dispatch Pro capabilities. Freeze the exact 12–60 month
        commitment, integration list, and service/support obligations the customer accepted.
        These values remain in the admin-only agreement view and are never added to analytics.
        This control never creates Stripe objects or charges money.
      </span>
    </>
  )
}

function BillingActionForm({
  action,
  children,
  confirmPrompt,
  description,
  disabled,
  onSubmit,
  tone = "primary"
}: {
  action: AdminBillingActionName
  children?: ReactNode
  confirmPrompt: string
  description: string
  disabled: boolean
  onSubmit: (action: AdminBillingActionName, event: FormEvent<HTMLFormElement>) => void
  tone?: "danger" | "primary"
}) {
  if (RETIRED_NEW_SUBSCRIPTION_ACTIONS.has(action)) {
    return null
  }

  const confirmationId = `billing-confirm-${action}`

  return (
    <details className="admin-row">
      <summary className="admin-row__head">
        <strong>{ACTION_LABELS[action]}</strong>
      </summary>
      <div className="admin-row__main">
        <p className="admin-row__body">{description}</p>
        <form
          className="admin-resolution-form"
          onSubmit={(event) => onSubmit(action, event)}
        >
          {children}
          <label htmlFor={confirmationId}>
            <input
              id={confirmationId}
              name="deliberateConfirmation"
              required
              type="checkbox"
            />{" "}
            I reviewed the canonical IDs and understand this action is audited.
          </label>
          <button
            className={`admin-btn admin-btn--${tone}`}
            disabled={disabled}
            type="submit"
          >
            {disabled ? "Saving…" : ACTION_LABELS[action]}
          </button>
          <span className="admin-row__when">{confirmPrompt}</span>
        </form>
      </div>
    </details>
  )
}

function BillingOptionList({
  id,
  options
}: {
  id: string
  options: AdminBillingActionOption[]
}) {
  return (
    <datalist id={id}>
      {options.map((option) => (
        <option key={option.id} value={option.id}>
          {option.label}
        </option>
      ))}
    </datalist>
  )
}

export function AdminBillingActions({
  periodSummaryOptions,
  subscriptionOptions,
  usageOptions
}: AdminBillingActionsProps) {
  const router = useRouter()
  const adjustmentIdempotencyKey = useRef<string | null>(null)
  const [configurationPlanCode, setConfigurationPlanCode] =
    useState<AdminConfigurablePlanCode>("network_pilot")
  const [planChangeTarget, setPlanChangeTarget] =
    useState<AdminPlanChangeTarget>("network_25")
  const [pendingAction, setPendingAction] =
    useState<AdminBillingActionName | null>(null)
  const [pendingSmokeAction, setPendingSmokeAction] =
    useState<InternalBillingSmokeAction | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState("")
  const [refreshing, startRefresh] = useTransition()
  const disabled =
    Boolean(pendingAction) || Boolean(pendingSmokeAction) || refreshing

  function submit(
    action: AdminBillingActionName,
    event: FormEvent<HTMLFormElement>
  ): void {
    event.preventDefault()

    if (
      !window.confirm(
        `${ACTION_LABELS[action]}\n\nThis writes audited canonical billing state. Continue?`
      )
    ) {
      return
    }

    const form = event.currentTarget
    const data = new FormData(form)
    let idempotencyKey: string | undefined

    if (action === "record_adjustment") {
      adjustmentIdempotencyKey.current ??= crypto.randomUUID()
      idempotencyKey = adjustmentIdempotencyKey.current
    }

    const payload = buildAdminBillingActionPayload(action, data, idempotencyKey)

    setPendingAction(action)
    setError(null)
    setSuccess("")

    void postJson("/api/admin/billing/actions", payload)
      .then((result) => {
        if (action === "record_adjustment") {
          adjustmentIdempotencyKey.current = null
        }
        if (action === "configure_subscription") {
          setConfigurationPlanCode("network_pilot")
        }
        if (action === "schedule_plan_change") {
          setPlanChangeTarget("network_25")
        }
        form.reset()
        setSuccess(result.message ?? `${ACTION_LABELS[action]} completed.`)
        startRefresh(() => router.refresh())
      })
      .catch((caught: unknown) => {
        setError(
          caught instanceof Error
            ? caught.message
            : "The billing action could not be saved."
        )
      })
      .finally(() => setPendingAction(null))
  }

  function submitInternalSmoke(
    action: InternalBillingSmokeAction,
    event: FormEvent<HTMLFormElement>
  ): void {
    event.preventDefault()

    const consequence =
      action === "charge"
        ? "This will charge exactly $1 through the live configured Stripe account."
        : "This will refund the prior $1 verification charge through the live configured Stripe account."

    if (!window.confirm(`${consequence}\n\nContinue with live-provider money?`)) {
      return
    }

    const form = event.currentTarget
    const payload = buildInternalBillingSmokePayload(
      action,
      new FormData(form)
    )

    setPendingSmokeAction(action)
    setError(null)
    setSuccess("")

    void postJson("/api/billing/internal-smoke", payload)
      .then((result) => {
        form.reset()
        setSuccess(
          result.outcome === "already_refunded"
            ? "The founder $1 verification refund was already recorded."
            : action === "charge"
            ? "The live-provider $1 verification charge completed."
            : "The live-provider $1 verification refund completed."
        )
        startRefresh(() => router.refresh())
      })
      .catch((caught: unknown) => {
        setError(
          caught instanceof Error
            ? caught.message
            : "The internal billing verification could not be completed."
        )
      })
      .finally(() => setPendingSmokeAction(null))
  }

  return (
    <>
      <section className="app-section admin-panel">
        <SectionHeader
          eyebrow="Historical subscriptions"
          title="New subscription writes are closed"
        />
        <p className="admin-panel__intro">
          Subscription configuration, activation, conversion, and plan-change
          controls are closed. Existing provider-bound records remain available
          for non-renewal, adjustment, reversal, entitlement retirement, usage
          reconciliation, audit, and signed webhook processing. Current hosts
          activate the 5% completed-load agreement from their own Billing page.
        </p>
      </section>

      <section className="app-section admin-panel">
        <SectionHeader
          eyebrow="Historical reconciliation"
          title="Preserved obligation controls"
        />
        <p className="admin-panel__intro">
          These controls reconcile or terminate obligations already accepted; they
          cannot create a new subscription or expand a plan. They do not charge
          Stripe immediately or rewrite accepted work. Use the CSV export when you
          need a full canonical identifier.
        </p>
        <BillingOptionList id="admin-billing-subscriptions" options={subscriptionOptions} />
        <BillingOptionList id="admin-billing-summaries" options={periodSummaryOptions} />
        <BillingOptionList id="admin-billing-usage" options={usageOptions} />
        <div className="admin-rows">
        <BillingActionForm
          action="configure_subscription"
          confirmPrompt="Records a customer-accepted plan in configured-dark state; it does not activate billing."
          description="Record an accepted Dispatch Pro, Pilot, fixed Network, or negotiated Enterprise 250+ agreement. The customer terms acceptor must be an active billing manager for the organization."
          disabled={disabled}
          onSubmit={submit}
        >
          <BillingTextField label="Organization UUID" name="organizationId" />
          <BillingTextField label="Customer terms-acceptor user UUID" name="acceptedByUserId" />
          <label>
            Accepted plan
            <select
              className="admin-select"
              name="planCode"
              onChange={(event) =>
                setConfigurationPlanCode(
                  event.currentTarget.value as AdminConfigurablePlanCode
                )
              }
              required
              value={configurationPlanCode}
            >
              <option value="dispatch_pro">Dispatch Pro</option>
              <option value="network_pilot">Network Pilot</option>
              <option value="network_25">Network 25</option>
              <option value="network_50">Network 50</option>
              <option value="network_100">Network 100</option>
              <option value="enterprise_250_plus">Enterprise 250+</option>
            </select>
          </label>
          <BillingTextField
            label="Accepted terms version"
            maxLength={120}
            name="acceptedTermsVersion"
            placeholder="subscription-v1-2026-07-28"
          />
          <BillingTextField
            label="Acceptance time (ISO 8601)"
            name="acceptedAt"
            placeholder="2026-07-28T18:00:00.000Z"
          />
          {configurationPlanCode === "dispatch_pro" ? (
            <span className="admin-row__when">
              Dispatch Pro has no Network operating-market scope and uses its fixed catalog terms.
            </span>
          ) : (
            <OperatingMarketIdsField
              name="operatingMarketIds"
              pilot={configurationPlanCode === "network_pilot"}
            />
          )}
          {configurationPlanCode === "enterprise_250_plus" ? (
            <EnterpriseNegotiatedTermsFields />
          ) : null}
          <BillingTextField
            defaultValue={7}
            label="Payment grace in days"
            max={30}
            min={0}
            name="paymentGraceDays"
            type="number"
          />
          <BillingTextField
            defaultValue={10}
            label="Network overage notification milestone (units)"
            max={1_000}
            min={1}
            name="overageMilestoneIntervalUnits"
            type="number"
          />
          <span className="admin-row__when">
            Payment grace is frozen from 0–30 days. Overage milestones are frozen from 1–1000
            units and apply when the agreement has Network usage.
          </span>
        </BillingActionForm>

        <BillingActionForm
          action="activate_subscription"
          confirmPrompt="This authorizes the accepted agreement for Checkout. Operational activation still requires the first verified paid provider invoice."
          description="Authorize a configured agreement to begin provider enrollment. This does not mark the subscription active or start its operating term."
          disabled={disabled}
          onSubmit={submit}
        >
          <BillingTextField label="Organization UUID" name="organizationId" />
          <BillingTextField
            label="Subscription UUID"
            list="admin-billing-subscriptions"
            name="subscriptionId"
          />
        </BillingActionForm>

        <BillingActionForm
          action="authorize_pilot_enterprise_conversion"
          confirmPrompt="Available only during the active 14-day post-Pilot conversion window. This freezes the negotiated agreement and authorizes a fresh target; provider Checkout and first verified payment remain separate."
          description="Record customer acceptance of a negotiated Enterprise 250+ agreement after the finite Pilot term. The source Pilot remains historical, and the billing-account pointer changes only after the fresh target's first verified paid period."
          disabled={disabled}
          onSubmit={submit}
        >
          <BillingTextField
            label="Source Pilot subscription UUID"
            list="admin-billing-subscriptions"
            name="sourceSubscriptionId"
          />
          <BillingTextField
            label="Customer terms-acceptor user UUID"
            name="acceptedByUserId"
          />
          <BillingTextField
            label="Accepted Enterprise terms version"
            maxLength={120}
            name="acceptedTermsVersion"
            placeholder="enterprise-agreement-2026-07-28"
          />
          <BillingTextField
            label="Acceptance time inside Pilot grace (ISO 8601)"
            name="acceptedAt"
            placeholder="2026-11-09T18:00:00.000Z"
          />
          <OperatingMarketIdsField
            name="operatingMarketIds"
            pilot={false}
          />
          <EnterpriseNegotiatedTermsFields />
        </BillingActionForm>

        <BillingActionForm
          action="schedule_plan_change"
          confirmPrompt="The service refuses an effective time before the frozen commitment ends."
          description="Schedule a fixed Dispatch or Network target, or freeze a negotiated Enterprise 250+ target, at or after the current commitment boundary."
          disabled={disabled}
          onSubmit={submit}
        >
          <BillingTextField
            label="Subscription UUID"
            list="admin-billing-subscriptions"
            name="subscriptionId"
          />
          <label>
            Next plan
            <select
              className="admin-select"
              name="nextPlanCode"
              onChange={(event) =>
                setPlanChangeTarget(
                  event.currentTarget.value as AdminPlanChangeTarget
                )
              }
              required
              value={planChangeTarget}
            >
              <option value="dispatch_pro">Dispatch Pro</option>
              <option value="network_25">Network 25</option>
              <option value="network_50">Network 50</option>
              <option value="network_100">Network 100</option>
              <option value="enterprise_250_plus">Enterprise 250+</option>
            </select>
          </label>
          <BillingTextField
            label="Effective time (ISO 8601)"
            name="effectiveAt"
            placeholder="2027-07-28T00:00:00.000Z"
          />
          {planChangeTarget === "dispatch_pro" ? (
            <span className="admin-row__when">
              Dispatch Pro clears Network operating-market scope and uses its fixed catalog terms.
            </span>
          ) : (
            <OperatingMarketIdsField
              name="nextOperatingMarketIds"
              pilot={false}
            />
          )}
          {planChangeTarget === "enterprise_250_plus" ? (
            <EnterpriseNegotiatedTermsFields />
          ) : null}
        </BillingActionForm>

        <BillingActionForm
          action="schedule_non_renewal"
          confirmPrompt="No immediate cancellation occurs; the frozen commitment remains authoritative."
          description="Record that the agreement will not renew after its commitment boundary."
          disabled={disabled}
          onSubmit={submit}
          tone="danger"
        >
          <BillingTextField
            label="Subscription UUID"
            list="admin-billing-subscriptions"
            name="subscriptionId"
          />
          <BillingTextField
            label="Effective time (ISO 8601)"
            name="effectiveAt"
            placeholder="2027-07-28T00:00:00.000Z"
          />
        </BillingActionForm>

        <BillingActionForm
          action="record_adjustment"
          confirmPrompt="This append-only adjustment will settle through Stripe when collection runs. A post-final credit can reduce an open balance and refund a paid balance; a post-final debit can create a supplemental charge."
          description="Record an audited service credit or manual debit against one allowance period. A stable browser idempotency key protects both local and provider retries."
          disabled={disabled}
          onSubmit={submit}
          tone="danger"
        >
          <BillingTextField
            label="Allowance-period summary UUID"
            list="admin-billing-summaries"
            name="billingPeriodSummaryId"
          />
          <label>
            Adjustment type
            <select className="admin-select" name="adjustmentType" required>
              <option value="service_credit">Service credit</option>
              <option value="manual_debit">Manual debit</option>
            </select>
          </label>
          <BillingTextField
            label="Amount in whole cents"
            min={1}
            name="amountCents"
            type="number"
          />
          <BillingTextField
            label="Overage invoice UUID (optional)"
            name="invoiceId"
            required={false}
          />
          <BillingReasonField />
        </BillingActionForm>

        <BillingActionForm
          action="reverse_usage"
          confirmPrompt="Exactly one physical Network usage unit is reversed and an audited adjustment is appended."
          description="Reverse a mistaken completed-Network usage row. The original row remains readable."
          disabled={disabled}
          onSubmit={submit}
          tone="danger"
        >
          <BillingTextField
            label="Usage-event UUID"
            list="admin-billing-usage"
            name="usageEventId"
          />
          <BillingReasonField label="Reason for reversal" />
        </BillingActionForm>

        <BillingActionForm
          action="retire_dispatch_entitlement"
          confirmPrompt="This only records provider cancellation evidence; it never calls the provider."
          description="Retire an independently paid Dispatch entitlement before activating a Network plan that already includes Dispatch capabilities."
          disabled={disabled}
          onSubmit={submit}
          tone="danger"
        >
          <BillingTextField label="Organization UUID" name="organizationId" />
          <BillingTextField label="Dispatch entitlement UUID" name="entitlementId" />
          <BillingTextField
            label="Provider cancellation evidence"
            maxLength={200}
            name="providerCancellationReference"
            placeholder="Cancellation request or provider event reference"
          />
        </BillingActionForm>

        <BillingActionForm
          action="reconcile_missing_usage"
          confirmPrompt="Scans committed Network assignments and records only service-proven missing usage."
          description="Run provider-neutral missing-usage reconciliation across canonical operating state."
          disabled={disabled}
          onSubmit={submit}
        />
        </div>
      </section>

      <section className="app-section admin-panel">
        <SectionHeader
          eyebrow="Owner allowlist · live provider money"
          title="Internal $1 billing verification"
        />
        <p className="admin-panel__intro">
          These two controls are the only actions on this page that call Stripe. The server still
          requires an active platform admin, the exact founder user allowlist, the explicit
          production gate, and the pre-provisioned hidden $1 Price. Nothing runs automatically.
        </p>
        <div className="admin-rows">
          <details className="admin-row">
            <summary className="admin-row__head">
              <strong>Charge exactly $1 through Stripe</strong>
            </summary>
            <div className="admin-row__main">
              <p className="admin-row__body">
                Creates and collects the single founder verification invoice for a canonical Stripe
                customer. This is a real-money provider action.
              </p>
              <form
                className="admin-resolution-form"
                onSubmit={(event) => submitInternalSmoke("charge", event)}
              >
                <BillingTextField label="Organization UUID" name="organizationId" />
                <BillingTextField
                  label="Type CHARGE_ONE_DOLLAR"
                  name="confirm"
                  pattern="CHARGE_ONE_DOLLAR"
                  placeholder="CHARGE_ONE_DOLLAR"
                  title="Type CHARGE_ONE_DOLLAR exactly"
                />
                <label>
                  <input name="deliberateConfirmation" required type="checkbox" /> I understand this
                  charges exactly $1 in the live configured Stripe account.
                </label>
                <button
                  className="admin-btn admin-btn--danger"
                  disabled={disabled}
                  type="submit"
                >
                  {pendingSmokeAction === "charge" ? "Charging…" : "Charge live $1"}
                </button>
              </form>
            </div>
          </details>

          <details className="admin-row">
            <summary className="admin-row__head">
              <strong>Refund the $1 verification charge</strong>
            </summary>
            <div className="admin-row__main">
              <p className="admin-row__body">
                Refunds the founder verification invoice recorded by the charge action. This is a
                real-money provider action.
              </p>
              <form
                className="admin-resolution-form"
                onSubmit={(event) => submitInternalSmoke("refund", event)}
              >
                <BillingTextField
                  label="Type REFUND_ONE_DOLLAR"
                  name="confirm"
                  pattern="REFUND_ONE_DOLLAR"
                  placeholder="REFUND_ONE_DOLLAR"
                  title="Type REFUND_ONE_DOLLAR exactly"
                />
                <label>
                  <input name="deliberateConfirmation" required type="checkbox" /> I understand this
                  issues a live Stripe refund for the prior $1 verification charge.
                </label>
                <button
                  className="admin-btn admin-btn--danger"
                  disabled={disabled}
                  type="submit"
                >
                  {pendingSmokeAction === "refund" ? "Refunding…" : "Refund live $1"}
                </button>
              </form>
            </div>
          </details>
        </div>
      </section>

      <p className="admin-decision__error" role={error ? "alert" : undefined}>
        {error ?? ""}
      </p>
      <p aria-live="polite" className="admin-decision__success">
        {success}
      </p>
    </>
  )
}
