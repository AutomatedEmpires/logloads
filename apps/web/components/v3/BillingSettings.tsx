"use client"

import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js"
import { loadStripe, type Stripe } from "@stripe/stripe-js"
import Link from "next/link"
import { useId, useMemo, useState } from "react"
import { Badge, Icon } from "@logloads/ui"

import {
  cardConfirmsPaymentMethod,
  confirmedPaymentMethodId
} from "@/lib/billing-card-confirmation"
import type {
  HostBillingView,
  HostFeeLineView,
  HostFeeTotalsView,
  HostInvoiceView
} from "@/lib/host-billing-data"
import type { BillingView, SettingsView } from "@/lib/plans"
import type { HostSubscriptionBillingView } from "@/lib/subscription-billing-data"
import type { VerificationRecordView } from "@/lib/verification-data"
import { AppShell, EmptyState, SectionHeader, type ShellAccount } from "./Shells"
import {
  InviteMemberForm,
  RevokeInvitationButton,
  TeamMemberActions,
  type TeamRoleOption
} from "./TeamActions"
import { VerificationSubmit, type VerificationTypeOption } from "./VerificationSubmit"

type CockpitRole = "fleet" | "host"

const ORG_VERIFICATION_OPTIONS: Record<CockpitRole, VerificationTypeOption[]> = {
  fleet: [
    { value: "organization", label: "Business identity", hint: "Confirms this carrier is a real, active business — approval turns on your Verified badge." },
    { value: "carrier_identifier", label: "Carrier authority", hint: "Name the public authority record a reviewer should check. Do not enter a full private credential here." },
    { value: "insurance_document", label: "Insurance", hint: "Name the insurer and evidence available. Do not enter a full policy number here." }
  ],
  host: [
    { value: "organization", label: "Business identity", hint: "Confirms this operation is a real, active business — approval turns on your Verified badge." },
    { value: "facility_control", label: "Facility control", hint: "Evidence you control the landing or mill you post from." },
    { value: "landing_authorization", label: "Landing authorization", hint: "Authorization to move wood from this landing." }
  ]
}

export interface CheckoutNotice {
  message: string
  tone: "success" | "info"
}

interface CardSetup {
  clientSecret: string
  publishableKey: string
}

type CardStatus = "attached" | "failed" | "none" | "pending"

async function readJson<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T
  } catch {
    return null
  }
}

async function waitForAttachedCard(paymentMethodId: string): Promise<boolean> {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const response = await fetch("/api/billing/payment-method", { cache: "no-store" })
    const result = await readJson<{
      card?: { paymentMethodId?: string | null; status?: CardStatus }
    }>(response)

    if (response.ok && cardConfirmsPaymentMethod(result?.card, paymentMethodId)) {
      return true
    }

    await new Promise((resolve) => window.setTimeout(resolve, 750))
  }

  return false
}

function CardSetupForm({ onAttached }: { onAttached: () => void }) {
  const stripe = useStripe()
  const elements = useElements()
  const [pending, setPending] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  return (
    <form
      className="card-setup"
      onSubmit={async (event) => {
        event.preventDefault()

        if (!stripe || !elements || pending) {
          return
        }

        setPending(true)
        setNotice(null)

        const submitted = await elements.submit()

        if (submitted.error) {
          setNotice(submitted.error.message ?? "Check the card details and try again.")
          setPending(false)
          return
        }

        const confirmed = await stripe.confirmSetup({
          elements,
          redirect: "if_required"
        })

        if (confirmed.error) {
          setNotice(confirmed.error.message ?? "Stripe could not attach this card.")
          setPending(false)
          return
        }

        const paymentMethodId = confirmedPaymentMethodId(
          confirmed.setupIntent.payment_method
        )

        if (!paymentMethodId) {
          setNotice(
            "Stripe accepted the card, but did not return the card reference LogLoads needs to confirm it. Refresh before publishing."
          )
          setPending(false)
          return
        }

        setNotice("Card accepted. Confirming it with LogLoads…")

        if (await waitForAttachedCard(paymentMethodId)) {
          onAttached()
          return
        }

        setNotice(
          "Stripe accepted the card, but LogLoads is still waiting for confirmation. Refresh in a moment before publishing."
        )
        setPending(false)
      }}
    >
      <PaymentElement options={{ layout: "tabs" }} />
      <button className="advance-button" disabled={!stripe || !elements || pending} type="submit">
        {pending ? "Attaching card…" : "Attach card"}
      </button>
      {notice ? <p className="plan-action__notice" role="status">{notice}</p> : null}
    </form>
  )
}

function HostCardControl({
  setupAllowed,
  setupUnavailableReason,
  status
}: {
  setupAllowed: boolean
  setupUnavailableReason: string | null
  status: CardStatus
}) {
  const [setup, setSetup] = useState<CardSetup | null>(null)
  const [pending, setPending] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const stripe = useMemo<PromiseLike<Stripe | null> | null>(
    () => setup ? loadStripe(setup.publishableKey) : null,
    [setup]
  )

  if (setup && stripe) {
    return (
      <Elements options={{ clientSecret: setup.clientSecret }} stripe={stripe}>
        <CardSetupForm onAttached={() => window.location.reload()} />
      </Elements>
    )
  }

  if (!setupAllowed) {
    return (
      <div className="plan-action">
        <p className="fee-next-step" role="note">
          <Icon aria-hidden name="status.lock" size={16} />
          <strong>
            {setupUnavailableReason ??
              "Payment method setup is not available for this workspace yet."}
          </strong>
        </p>
        <p className="settings-meaning">
          No card is needed to create a workspace or prepare draft work. LogLoads
          will never ask for one before the applicable billing agreement is in force.
        </p>
      </div>
    )
  }

  return (
    <div className="plan-action">
      <button
        className="action-link"
        disabled={pending}
        onClick={async () => {
          setPending(true)
          setNotice(null)

          try {
            const response = await fetch("/api/billing/payment-method", { method: "POST" })
            const result = await readJson<{ error?: string; setup?: CardSetup }>(response)

            if (!response.ok || !result?.setup) {
              throw new Error(result?.error ?? "Card setup is unavailable right now.")
            }

            setSetup(result.setup)
          } catch (error) {
            setNotice(error instanceof Error ? error.message : "Card setup is unavailable right now.")
          } finally {
            setPending(false)
          }
        }}
        type="button"
      >
        {pending
          ? "Opening secure card form…"
          : status === "attached"
            ? "Replace card"
            : "Add card"}
      </button>
      <p className="settings-meaning">
        Card details go directly to Stripe. LogLoads stores Stripe&apos;s opaque card reference,
        brand, and last four digits — never the card number.
      </p>
      {notice ? <p className="plan-action__notice" role="status">{notice}</p> : null}
    </div>
  )
}

/**
 * The three numbers, always together: what the driver is paid, what LogLoads
 * charges the host on top of it, and what the load therefore costs the host.
 *
 * One component rather than three ad-hoc paragraphs, because the fee is only
 * honest alongside the pay it is calculated from. Shown apart, "$76.25 in fees"
 * invites the reading that it came out of somebody's pay — and it did not: the
 * driver is paid exactly what the host stated, and the fee is added to what the
 * host owes LogLoads.
 */
function FeeFigures({ label, totals }: { label: string; totals: HostFeeTotalsView }) {
  return (
    <dl aria-label={label} className="fee-figures">
      <div>
        <dt>Driver pay you stated</dt>
        <dd>
          {totals.driverPayLabel}
          <span>Paid by you, directly to the driver</span>
        </dd>
      </div>
      <div>
        <dt>LogLoads fee, on top</dt>
        <dd>
          + {totals.platformFeeLabel}
          <span>Not deducted from driver pay</span>
        </dd>
      </div>
      <div className="fee-figures__total">
        <dt>Your total cost</dt>
        <dd>
          {totals.hostTotalLabel}
          <span>
            {totals.truckloadCount} completed truckload{totals.truckloadCount === 1 ? "" : "s"}
          </span>
        </dd>
      </div>
    </dl>
  )
}

/**
 * The itemisation a host reconciles a bill against: one row per completed
 * truckload, with the load it came from and the day it completed.
 *
 * A total with no lines under it is the difference between a bill a host trusts
 * and a support ticket, so the fee column carries the rate FROZEN on each fee
 * rather than today's rate — a bill from a month at a different rate has to
 * still explain itself.
 *
 * The table is scrollable inside its own wrapper on a narrow screen instead of
 * collapsing: on a phone, a money row that reflows loses which figure belongs to
 * which column.
 */
function FeeTable({ caption, lines, totals }: { caption: string; lines: HostFeeLineView[]; totals: HostFeeTotalsView }) {
  // The scroll container is focusable so the columns are reachable without a
  // pointer, and it takes its name from the table's own caption so focusing it
  // announces which figures are inside rather than nothing at all.
  const captionId = useId()

  return (
    <div aria-labelledby={captionId} className="money-table-wrap" role="region" tabIndex={0}>
      <table className="money-table">
        <caption className="sr-only" id={captionId}>
          {caption}
        </caption>
        <thead>
          <tr>
            <th scope="col">Load</th>
            <th scope="col">Completed</th>
            <th scope="col">Driver pay</th>
            <th scope="col">LogLoads fee</th>
            <th scope="col">Your total</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.id}>
              <th scope="row">{line.loadTitle}</th>
              <td>{line.completedOnLabel}</td>
              <td>{line.driverPayLabel}</td>
              <td>
                {line.platformFeeLabel}
                <span className="money-table__rate">{line.rateLabel} of driver pay</span>
              </td>
              <td>{line.hostTotalLabel}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">
              {totals.truckloadCount} truckload{totals.truckloadCount === 1 ? "" : "s"}
            </th>
            <td />
            <td>{totals.driverPayLabel}</td>
            <td>{totals.platformFeeLabel}</td>
            <td>{totals.hostTotalLabel}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

function InvoiceCard({ invoice }: { invoice: HostInvoiceView }) {
  return (
    <article className="invoice-row">
      <div className="invoice-row__head">
        <div>
          <strong>{invoice.periodLabel}</strong>
          <span>
            {invoice.issuedOnLabel ? `Billed ${invoice.issuedOnLabel}` : "Not billed yet"}
            {invoice.paidOnLabel ? ` · Paid ${invoice.paidOnLabel}` : ""}
          </span>
        </div>
        <div className="invoice-row__amount">
          <Badge tone={invoice.tone}>{invoice.statusLabel}</Badge>
          <strong>{invoice.billedLabel}</strong>
        </div>
      </div>
      <p className="invoice-row__detail">{invoice.statusDetail}</p>
      {invoice.reconciliationNote ? (
        <p className="fee-alert" role="note">
          <Icon aria-hidden name="status.warning" size={16} />
          <span>{invoice.reconciliationNote}</span>
        </p>
      ) : null}
      {invoice.lines.length > 0 ? (
        <details className="fee-disclosure">
          <summary>
            What this bill covered ({invoice.lines.length} truckload{invoice.lines.length === 1 ? "" : "s"})
          </summary>
          <FeeTable
            caption={`Truckloads billed for ${invoice.periodLabel}`}
            lines={invoice.lines}
            totals={invoice.totals}
          />
        </details>
      ) : null}
    </article>
  )
}

function OrganizationSubscriptionSections({
  subscription
}: {
  subscription: HostSubscriptionBillingView
}) {
  return (
    <>
      <section
        aria-label={subscription.sectionLabel}
        className="settings-panel subscription-overview"
      >
        <header className="subscription-overview__header">
          <div>
            <p className="eyebrow">{subscription.sectionLabel}</p>
            <h2>{subscription.planName}</h2>
            <div className="pay-state">
              <Badge tone={subscription.statusTone}>
                {subscription.statusLabel}
              </Badge>
              <Badge tone={subscription.activationTone}>
                {subscription.activationLabel}
              </Badge>
            </div>
          </div>
          <div className="subscription-overview__price">
            <span>Recorded base price</span>
            <strong>{subscription.basePriceLabel}</strong>
            <small>{subscription.networkAllowanceLabel}</small>
          </div>
        </header>

        <p className="subscription-overview__summary">
          {subscription.statusDetail}
        </p>
        <div
          className={`subscription-overview__activation subscription-overview__activation--${subscription.activationTone}`}
        >
          <Icon
            aria-hidden
            name={
              subscription.activationTone === "success"
                ? "status.assigned"
                : "status.lock"
            }
            size={20}
          />
          <div>
            <strong>{subscription.activationLabel}</strong>
            <p>{subscription.activationDetail}</p>
          </div>
        </div>

        <div className="subscription-overview__body">
          <dl className="subscription-overview__facts">
            <div>
              <dt>Recorded overage</dt>
              <dd>{subscription.overageRateLabel}</dd>
            </div>
            <div>
              <dt>Recorded capabilities</dt>
              <dd>
                {subscription.includesDispatchProCapabilities
                  ? "The preserved snapshot included dispatch capabilities"
                  : "Defined by the preserved agreement"}
              </dd>
            </div>
            <div>
              <dt>Provider reconciliation</dt>
              <dd>{subscription.collectionLabel}</dd>
            </div>
            {subscription.commitmentLabel ? (
              <div>
                <dt>Recorded term</dt>
                <dd>{subscription.commitmentLabel}</dd>
              </div>
            ) : null}
            {subscription.renewalLabel ? (
              <div>
                <dt>Recorded renewal</dt>
                <dd>{subscription.renewalLabel}</dd>
              </div>
            ) : null}
            {subscription.pendingPlanLabel ? (
              <div>
                <dt>Recorded schedule</dt>
                <dd>{subscription.pendingPlanLabel}</dd>
              </div>
            ) : null}
            {subscription.paymentLabel ? (
              <div>
                <dt>Recorded payment state</dt>
                <dd>
                  <Badge tone={subscription.paymentTone ?? "neutral"}>
                    {subscription.paymentLabel}
                  </Badge>
                </dd>
              </div>
            ) : null}
          </dl>

          <aside className="subscription-overview__balance">
            <span>Outstanding balance</span>
            <strong>{subscription.outstandingAmountLabel}</strong>
            <small>
              Across {subscription.outstandingInvoiceCount} invoice
              {subscription.outstandingInvoiceCount === 1 ? "" : "s"}
            </small>
          </aside>
        </div>

        {subscription.paymentDetail ? (
          <p className="subscription-overview__note">
            <Icon aria-hidden name="load.pay" size={18} />
            <span>{subscription.paymentDetail}</span>
          </p>
        ) : null}
        {subscription.latestBaseInvoice ? (
          <article className="subscription-invoice-preview">
            <div>
              <span>Latest base invoice</span>
              <strong>{subscription.latestBaseInvoice.amountDueLabel}</strong>
            </div>
            <p>
              {subscription.latestBaseInvoice.statusLabel} ·{" "}
              {subscription.latestBaseInvoice.amountRemainingLabel} remaining
              {subscription.latestBaseInvoice.dueOnLabel
                ? ` · due ${subscription.latestBaseInvoice.dueOnLabel}`
                : ""}
            </p>
            {subscription.latestBaseInvoice.hostedInvoiceUrl ? (
              <a
                className="text-link"
                href={subscription.latestBaseInvoice.hostedInvoiceUrl}
                rel="noreferrer"
                target="_blank"
              >
                View invoice
              </a>
            ) : null}
          </article>
        ) : null}
        {subscription.integrityNotices.map((notice) => (
          <p className="fee-alert" key={notice} role="alert">
            <Icon aria-hidden name="status.warning" size={16} />
            <span>{notice}</span>
          </p>
        ))}
        {subscription.subscriptionId && subscription.canOpenPortal ? (
          <SubscriptionBillingAction
            kind="portal"
            subscriptionId={subscription.subscriptionId}
          />
        ) : null}
      </section>

      {subscription.allowance ? (
        <section
          aria-label="Recorded Network usage"
          className="usage-panel usage-panel--network"
        >
          <SectionHeader
            eyebrow="Historical usage"
            title={subscription.allowance.periodLabel}
          />
          <article className="subscription-allowance">
            <div className="subscription-allowance__headline">
              <div>
                <span>Completed in this recorded period</span>
                <strong>
                  {subscription.allowance.usedUnits}
                  <small> / {subscription.allowance.includedUnits}</small>
                </strong>
              </div>
              <span
                className={`usage-row__detail usage-row__detail--${
                  subscription.allowance.overageUnits > 0
                    ? "critical"
                    : subscription.allowance.percent >= 90
                      ? "warning"
                      : "success"
                }`}
              >
                {subscription.allowance.detail}
              </span>
            </div>
            <div
              aria-label={`Completed Network movements: ${subscription.allowance.detail}`}
              className="usage-meter"
              role="img"
            >
              <span
                className={`usage-meter__fill usage-meter__fill--${
                  subscription.allowance.overageUnits > 0
                    ? "critical"
                    : subscription.allowance.percent >= 90
                      ? "warning"
                      : "success"
                }`}
                style={{ width: `${subscription.allowance.percent}%` }}
              />
            </div>
          </article>
          <dl className="subscription-usage-grid">
            <div>
              <dt>Recorded included remainder</dt>
              <dd>{subscription.allowance.remainingUnits}</dd>
            </div>
            <div>
              <dt>Recorded overage</dt>
              <dd>
                {subscription.allowance.overageUnits} units ·{" "}
                {subscription.allowance.overageAmountLabel}
              </dd>
            </div>
            <div>
              <dt>Recorded window end</dt>
              <dd>{subscription.allowance.closesOnLabel}</dd>
            </div>
          </dl>
          {subscription.latestOverageInvoice ? (
            <article className="subscription-invoice-preview">
              <div>
                <span>Latest usage invoice</span>
                <strong>
                  {subscription.latestOverageInvoice.amountLabel}
                </strong>
              </div>
              <p>
                {subscription.latestOverageInvoice.quantity} units ·{" "}
                {subscription.latestOverageInvoice.statusLabel}
                {subscription.latestOverageInvoice.issuedOnLabel
                  ? ` · issued ${subscription.latestOverageInvoice.issuedOnLabel}`
                  : ""}
              </p>
            </article>
          ) : null}
        </section>
      ) : null}
    </>
  )
}

function SubscriptionBillingAction({
  subscriptionId
}: {
  kind: "portal"
  subscriptionId: string
}) {
  const [pending, setPending] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  return (
    <div className="plan-action">
      <button
        className="action-link"
        disabled={pending}
        onClick={async () => {
          setPending(true)
          setNotice(null)

          try {
            const response = await fetch("/api/billing/subscription-portal", {
              body: JSON.stringify({ organizationSubscriptionId: subscriptionId }),
              headers: { "Content-Type": "application/json" },
              method: "POST"
            })
            const result = await readJson<{ error?: string; url?: string }>(
              response
            )

            if (!response.ok || !result?.url) {
              throw new Error(
                result?.error ??
                  "Subscription billing is unavailable right now."
              )
            }

            window.location.assign(result.url)
          } catch (error) {
            setNotice(
              error instanceof Error
                ? error.message
                : "Subscription billing is unavailable right now."
            )
          } finally {
            setPending(false)
          }
        }}
        type="button"
      >
        {pending ? "Opening secure billing…" : "Manage payment details"}
      </button>
      <p className="settings-meaning">
        Payment details and provider invoice history open in the controlled
        Stripe billing portal. New enrollment, plan changes, and restarts are
        closed; this control cannot alter the preserved subscription record.
      </p>
      {notice ? (
        <p className="plan-action__notice" role="alert">
          <Icon aria-hidden name="status.warning" size={16} />
          <span>{notice}</span>
        </p>
      ) : null}
    </div>
  )
}

function PercentageAgreementControl() {
  const [accepted, setAccepted] = useState(false)
  const [pending, setPending] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  return (
    <div className="plan-action">
      <label className="settings-meaning">
        <input
          checked={accepted}
          onChange={(event) => setAccepted(event.target.checked)}
          type="checkbox"
        />{" "}
        I am authorized to accept the current <Link href="/terms">LogLoads Terms</Link>. I
        understand that each completed load carries a 5% LogLoads fee added on top
        of the driver pay I state; there is no posting fee, subscription, monthly
        minimum, tier, allowance, or overage charge.
      </label>
      <button
        className="action-link"
        disabled={!accepted || pending}
        onClick={async () => {
          setPending(true)
          setNotice(null)

          try {
            const response = await fetch("/api/billing/percentage-agreement", {
              body: JSON.stringify({ acceptPercentageTerms: true }),
              headers: { "Content-Type": "application/json" },
              method: "POST"
            })
            const result = await readJson<{ error?: string }>(response)

            if (!response.ok) {
              throw new Error(
                result?.error ?? "The percentage agreement could not be accepted."
              )
            }

            setNotice("Agreement accepted. Refreshing billing…")
            window.location.reload()
          } catch (error) {
            setNotice(
              error instanceof Error
                ? error.message
                : "The percentage agreement could not be accepted."
            )
            setPending(false)
          }
        }}
        type="button"
      >
        {pending ? "Accepting agreement…" : "Accept 5% host agreement"}
      </button>
      <p className="settings-meaning">
        Acceptance does not charge a card. Add a payment method separately before
        publishing live work.
      </p>
      {notice ? (
        <p className="plan-action__notice" role={pending ? "status" : "alert"}>
          <Icon aria-hidden name={pending ? "status.assigned" : "status.warning"} size={16} />
          <span>{notice}</span>
        </p>
      ) : null}
    </div>
  )
}

/**
 * Everything a host has to be able to answer about their own money without
 * contacting anybody. Rendered from the read model only — no arithmetic happens
 * in this file, so a figure on this page cannot disagree with the bill.
 */
function HostMoneySections({ hostBilling }: { hostBilling: HostBillingView }) {
  const { currentPeriod, fee, invoices, paymentMethod, percentageAgreement } = hostBilling
  const hasPercentageActivity =
    currentPeriod.lines.length > 0 ||
    currentPeriod.voidedLines.length > 0 ||
    invoices.length > 0

  return (
    <>
      <section className="settings-panel" aria-label="Current host pricing">
          <SectionHeader
            eyebrow="Host pricing"
            title={`${fee.rateLabel} of stated driver pay, added on top`}
          />
          {percentageAgreement.state === "active" ? (
            <p className="fee-alert" role="status">
              <Icon aria-hidden name="status.assigned" size={16} />
              <span>
                Current percentage agreement active
                {percentageAgreement.acceptedOnLabel
                  ? ` · accepted ${percentageAgreement.acceptedOnLabel}`
                  : ""}
              </span>
            </p>
          ) : percentageAgreement.state === "legacy" ? (
            <p className="fee-alert" role="note">
              <Icon aria-hidden name="ops.notice" size={16} />
              <span>
                {percentageAgreement.canAccept
                  ? "Previously committed percentage terms remain readable and collectible and will not be rewritten. Accept the current agreement below to use percentage_v1 for new work."
                  : "Previously committed percentage terms remain readable and collectible and will not be rewritten. Current agreement enrollment is not open for this workspace."}
              </span>
            </p>
          ) : percentageAgreement.state === "historical_subscription" ? (
            <p className="fee-alert" role="note">
              <Icon aria-hidden name="ops.notice" size={16} />
              <span>
                {percentageAgreement.canAccept
                  ? "This workspace's terminal subscription remains preserved as history. Accept the current percentage agreement below to activate percentage_v1 for new work; the old record will not be rewritten."
                  : "This workspace's historical subscription remains preserved as history. Current percentage enrollment requires both a terminal record and inclusion in the controlled rollout."}
              </span>
            </p>
          ) : null}
          <p className="fee-headline">{fee.headline}</p>
          {/* Named as an example in visible text, not only in the label: three
              money figures with no lead-in read as this host's own money. */}
          <p className="fee-example-lead">
            For example, one truckload where you state the driver is paid {fee.example.driverPayLabel}:
          </p>
          <dl aria-label={`Example: a ${fee.example.driverPayLabel} truckload`} className="fee-figures">
            <div>
              <dt>You state the driver is paid</dt>
              <dd>
                {fee.example.driverPayLabel}
                <span>The driver receives exactly this</span>
              </dd>
            </div>
            <div>
              <dt>LogLoads fee, on top</dt>
              <dd>
                + {fee.example.platformFeeLabel}
                <span>{fee.rateLabel} of the pay you stated</span>
              </dd>
            </div>
            <div className="fee-figures__total">
              <dt>Your total cost</dt>
              <dd>
                {fee.example.hostTotalLabel}
                <span>Once the truckload completes</span>
              </dd>
            </div>
          </dl>
          <ul className="fee-points">
            {fee.points.map((point) => (
              <li key={point}>
                <Icon aria-hidden name="status.assigned" size={16} />
                <span>{point}</span>
              </li>
            ))}
          </ul>
          {percentageAgreement.canAccept ? <PercentageAgreementControl /> : null}
        </section>

      <section className="settings-panel" aria-label="Payment method">
        <SectionHeader eyebrow="Payment method" title="The card LogLoads bills" />
        <div className="pay-state">
          <Badge tone={paymentMethod.tone}>{paymentMethod.statusLabel}</Badge>
          {paymentMethod.cardLine ? <span className="pay-state__card">{paymentMethod.cardLine}</span> : null}
        </div>
        <p className="settings-meaning">{paymentMethod.consequence}</p>
        {paymentMethod.failureLine ? (
          <p className="fee-alert" role="note">
            <Icon aria-hidden name="status.warning" size={16} />
            <span>{paymentMethod.failureLine}</span>
          </p>
        ) : null}
        {paymentMethod.nextStep ? (
          <p className="fee-next-step">
            <Icon aria-hidden name="status.lock" size={16} />
            <strong>{paymentMethod.nextStep}</strong>
          </p>
        ) : null}
        <HostCardControl
          setupAllowed={paymentMethod.setupAllowed}
          setupUnavailableReason={paymentMethod.setupUnavailableReason}
          status={paymentMethod.status}
        />
      </section>

      <section className="settings-panel" aria-label="Platform fees accrued this month">
            <SectionHeader
              eyebrow="This month"
              title={
                currentPeriod.lines.length === 0
                  ? `${currentPeriod.periodLabel} — nothing accrued yet`
                  : `${currentPeriod.periodLabel} — ${currentPeriod.totals.platformFeeLabel} in LogLoads fees`
              }
            />
            {currentPeriod.lines.length === 0 ? (
              <p className="settings-meaning">
                Nothing has accrued in {currentPeriod.periodLabel}. A LogLoads fee appears here the first time
                a truckload completes — posting work costs nothing, and a load that is never hauled is never
                billed.
              </p>
            ) : (
              <>
                <FeeFigures label={`${currentPeriod.periodLabel} totals`} totals={currentPeriod.totals} />
                <FeeTable
                  caption={`Completed truckloads that accrued a LogLoads fee in ${currentPeriod.periodLabel}`}
                  lines={currentPeriod.lines}
                  totals={currentPeriod.totals}
                />
                <p className="settings-meaning">
                  Nothing is charged until {currentPeriod.periodLabel} closes on {currentPeriod.closesOnLabel}.
                  LogLoads then bills the card on file for its own fee only. Driver pay is not part of that
                  charge — you pay your drivers directly.
                </p>
              </>
            )}
            {currentPeriod.voidedLines.length > 0 ? (
              <details className="fee-disclosure">
                <summary>
                  Fees withdrawn this month ({currentPeriod.voidedLines.length}) — you are charged nothing for
                  these
                </summary>
                <ul className="fee-voided">
                  {currentPeriod.voidedLines.map((line) => (
                    <li key={line.id}>
                      <strong>{line.loadTitle}</strong>
                      <span>
                        {line.completedOnLabel} · {line.platformFeeLabel} withdrawn
                        {line.voidReason ? ` · ${line.voidReason}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </section>

          <section className="settings-panel" aria-label="Platform fee invoices">
            <SectionHeader eyebrow="Invoices" title="Monthly platform-fee charges" />
            {invoices.length === 0 ? (
              <p className="settings-meaning">
                No bill has been raised yet. Your first one covers {currentPeriod.periodLabel} and is charged
                after it closes on {currentPeriod.closesOnLabel}.
              </p>
            ) : (
              <div className="invoice-list">
                {invoices.map((invoice) => (
                  <InvoiceCard invoice={invoice} key={invoice.id} />
                ))}
              </div>
            )}
          </section>
      {!hasPercentageActivity ? (
        <p className="settings-meaning">
          Your billing history begins after the first completed load under an
          accepted percentage agreement.
        </p>
      ) : null}
    </>
  )
}

/**
 * The current percentage ledger remains host-only. Historical subscription
 * records can appear in either operating cockpit when an accepted provider
 * obligation exists. The discriminated props keep a fleet from ever receiving
 * the host's percentage statement.
 */
export type BillingPageProps = {
  account: ShellAccount
  billing: BillingView
  checkoutNotice?: CheckoutNotice | null
} & (
  | {
      role: "fleet"
      hostBilling?: never
      hostSubscriptionBilling: HostSubscriptionBillingView | null
    }
  | {
      role: "host"
      hostBilling: HostBillingView
      hostSubscriptionBilling: HostSubscriptionBillingView | null
    }
)

export function BillingPage({
  account,
  billing,
  checkoutNotice,
  hostBilling,
  hostSubscriptionBilling,
  role
}: BillingPageProps) {
  const hasCanonicalSubscription = Boolean(
    hostSubscriptionBilling?.subscriptionId
  )
  const capabilityPlans = role === "fleet"
    ? [
        ...billing.plans.filter((plan) => plan.recordMode === "current"),
        ...(hasCanonicalSubscription
          ? []
          : billing.plans.filter((plan) => plan.recordMode === "historical"))
      ]
    : []
  const addUsageHref = role === "fleet" ? "/fleet/trucks" : "/host/landings"
  const addUsageLabel = role === "fleet" ? "Go to trucks" : "Go to landings"
  const addUsageBody = role === "fleet"
    ? "Add your first truck and this section shows the equipment configured for this account."
    : "Add your first landing and this section shows the operating locations configured for this account."
  const workspaceUsageBody = role === "fleet"
    ? "This tracks trucks configured in your workspace. It is separate from completed Network movement usage."
    : "This tracks landing locations configured in your workspace. It is separate from completed-load platform fees."

  return (
    <AppShell
      account={account}
      kicker={role === "host" ? "Host economics" : "Access & billing history"}
      role={role}
      title="Billing"
    >
      <div className="billing-page">
        {checkoutNotice ? (
          <p className={`billing-banner billing-banner--${checkoutNotice.tone}`} role="status">
            <Icon aria-hidden name={checkoutNotice.tone === "success" ? "status.assigned" : "ops.notice"} size={18} />
            <span>{checkoutNotice.message}</span>
          </p>
        ) : null}

        {/* First thing on the page when it is true, because it stops the host
            working. The consequence is worded once in the read model, so this
            banner and the payment-method panel cannot disagree about it. */}
        {hostBilling?.paymentMethod.blocksPublishing ? (
          <p className="billing-banner billing-banner--blocked" role="note">
            <Icon aria-hidden name="status.lock" size={18} />
            <span>
              <strong>{hostBilling.paymentMethod.statusLabel}.</strong> {hostBilling.paymentMethod.consequence}
            </span>
          </p>
        ) : null}

        {hostBilling ? <HostMoneySections hostBilling={hostBilling} /> : null}

        {hostSubscriptionBilling?.subscriptionId ? (
          <p className="billing-banner billing-banner--info" role="note">
            <Icon aria-hidden name="ops.notice" size={18} />
            <span>
              Historical subscription record. New subscription enrollment, plan
              conversion, tier changes, and overage enrollment are closed. Portal
              access remains available only for payment details and provider invoice
              history tied to an existing obligation.
            </span>
          </p>
        ) : null}

        {hasCanonicalSubscription && hostSubscriptionBilling ? (
          <OrganizationSubscriptionSections
            subscription={hostSubscriptionBilling}
          />
        ) : null}

        {role === "fleet" ? (
          capabilityPlans.length === 0 ? (
            hostSubscriptionBilling ? null : (
              <EmptyState
                actionHref="/pricing"
                actionLabel="View pricing"
                body="Fleet dispatch is free. Refresh this page or contact support if the included access record is missing."
                title="Fleet Free access is unavailable"
              />
            )
          ) : (
            <section
              aria-label="Access and billing history"
              className="plan-cards"
              id="billing-plan"
            >
              {capabilityPlans.map((plan) => (
                <article className="plan-card plan-card--current" key={plan.id}>
                  <header className="plan-card__head">
                    <div>
                      <p className="eyebrow">
                        {plan.recordMode === "current"
                          ? "Current access"
                          : "Historical record"}
                      </p>
                      <h2>{plan.name}</h2>
                      <p className="plan-card__summary">{plan.summary}</p>
                    </div>
                    <strong className="plan-card__price">
                      {plan.priceLine}
                    </strong>
                  </header>
                  <div className="plan-card__status">
                    <Badge tone={plan.statusTone}>{plan.statusLine}</Badge>
                    {plan.statusDetail ? <p>{plan.statusDetail}</p> : null}
                  </div>
                  <div className="plan-card__body">
                    <h3>
                      {plan.recordMode === "current"
                        ? "What Fleet Free includes"
                        : "What this record included"}
                    </h3>
                    <ul>
                      {plan.features.map((feature) => (
                        <li key={feature}>
                          <Icon
                            aria-hidden
                            name="status.assigned"
                            size={16}
                          />
                          <span>{feature}</span>
                        </li>
                      ))}
                    </ul>
                    {plan.limitLines.length > 0 ? (
                      <p className="plan-card__limits">
                        {plan.limitLines.join(" · ")}
                      </p>
                    ) : null}
                  </div>
                </article>
              ))}
            </section>
          )
        ) : null}

        {!hasCanonicalSubscription && hostSubscriptionBilling ? (
          <OrganizationSubscriptionSections
            subscription={hostSubscriptionBilling}
          />
        ) : null}

        <section
          aria-label="Workspace capacity"
          className="usage-panel usage-panel--workspace"
          id="billing-workspace-usage"
        >
          <SectionHeader
            eyebrow="Operational setup"
            title="Workspace capacity"
          />
          <p className="usage-panel__intro">{workspaceUsageBody}</p>
          {billing.usage.length === 0 ? (
            <EmptyState
              actionHref={addUsageHref}
              actionLabel={addUsageLabel}
              body={addUsageBody}
              title="Nothing to measure yet"
            />
          ) : (
            <div className="usage-list">
              {billing.usage.map((row) => (
                <article className="usage-row" key={row.id}>
                  <div className="usage-row__top">
                    <strong>{row.label}</strong>
                    <span
                      className={`usage-row__detail usage-row__detail--${row.tone}`}
                    >
                      {row.detail}
                    </span>
                  </div>
                  {row.percent !== null ? (
                    <div
                      aria-label={`${row.label}: ${row.detail}`}
                      className="usage-meter"
                      role="img"
                    >
                      <span
                        className={`usage-meter__fill usage-meter__fill--${row.tone}`}
                        style={{ width: `${row.percent}%` }}
                      />
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          )}
        </section>

      </div>
    </AppShell>
  )
}

export function SettingsPage({
  account,
  canManageMembers,
  inviteRoleOptions,
  role,
  settings,
  verifications
}: {
  account: ShellAccount
  canManageMembers: boolean
  inviteRoleOptions: TeamRoleOption[]
  role: CockpitRole
  settings: SettingsView
  verifications: VerificationRecordView[]
}) {
  const billingHref = role === "fleet" ? "/fleet/billing" : "/host/billing"

  return (
    <AppShell account={account} kicker="Organization" role={role} title="Workspace overview">
      <div className="settings-stack">
        <section className="settings-panel" aria-label="Organization identity">
          <SectionHeader eyebrow="Organization" title={settings.identity.name} />
          <dl className="identity-grid">
            <div>
              <dt>Legal name</dt>
              <dd>{settings.identity.legalName}</dd>
            </div>
            <div>
              <dt>Primary region</dt>
              <dd>{settings.identity.region}</dd>
            </div>
            <div>
              <dt>Workspace type</dt>
              <dd>{settings.identity.typeLabel}</dd>
            </div>
            <div>
              <dt>Verification</dt>
              <dd>
                <Badge tone={settings.identity.verificationTone}>{settings.identity.verificationLabel}</Badge>
              </dd>
            </div>
          </dl>
          <p className="settings-meaning">{settings.identity.verificationMeaning}</p>
        </section>

        <section className="settings-panel" aria-label="Verification">
          <SectionHeader eyebrow="Trust" title="Verify this workspace" />
          <VerificationSubmit options={ORG_VERIFICATION_OPTIONS[role]} records={verifications} subjectType="organization" />
        </section>

        <section className="settings-panel" aria-label="Team">
          <SectionHeader eyebrow="Team" title="Who works in this workspace" />
          {settings.team.length > 0 ? (
            <ul className="team-list team-list--roster">
              {settings.team.map((member) => (
                <li className="team-member" key={member.id}>
                  <div className="team-member__identity">
                    <strong>{member.name}</strong>
                    <span>
                      {member.roleLabel} · {member.activeOrUpcomingAssignmentCount} active or upcoming assignment{member.activeOrUpcomingAssignmentCount === 1 ? "" : "s"}
                    </span>
                  </div>
                  <div className="team-member__state">
                    {member.isSelf ? <span className="team-member__self">You</span> : null}
                    <Badge tone={member.statusTone}>{member.statusLabel}</Badge>
                  </div>
                  {canManageMembers && !member.isSelf ? (
                    <TeamMemberActions
                      activeOrUpcomingAssignmentCount={member.activeOrUpcomingAssignmentCount}
                      key={`${member.id}:${member.role}:${member.status}`}
                      memberName={member.name}
                      memberUserId={member.userId}
                      role={member.role}
                      roleLabel={member.roleLabel}
                      roleOptions={inviteRoleOptions}
                      status={member.status}
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
          {settings.pendingInvitations.length > 0 ? (
            <div className="invite-panel" role="group" aria-label="Waiting invitations">
              <ul className="team-list">
                {settings.pendingInvitations.map((invitation) => (
                  <li key={invitation.id}>
                    <div>
                      <strong>{invitation.invitedEmail}</strong>
                      <span>
                        {invitation.roleLabel} · appears at their sign-in · open until{" "}
                        {new Date(invitation.expiresAt).toLocaleDateString()}
                      </span>
                    </div>
                    {canManageMembers ? <RevokeInvitationButton invitationId={invitation.id} /> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {canManageMembers ? (
            <InviteMemberForm roleOptions={inviteRoleOptions} />
          ) : (
            <p className="settings-meaning">
              Ask a workspace owner or administrator to change who works here.
            </p>
          )}
        </section>

        <section className="settings-panel settings-panel--muted" aria-label="Notifications">
          <SectionHeader eyebrow="Notifications" title="How updates reach you" />
          <div className="notify-line">
            <Icon aria-hidden name="nav.messages" size={20} />
            <div>
              <strong>Delivery: in-app only</strong>
              <p>
                Assignment, trip, and message updates appear in your workspace as they happen. In-app notifications are
                the operating record. Email delivery is not enabled for operational alerts.
              </p>
            </div>
          </div>
        </section>

        <section className="settings-panel" aria-label="Access and billing history">
          <SectionHeader
            action={<Link className="action-link action-link--secondary" href={billingHref}>Open billing</Link>}
            eyebrow="Access"
            title="Access & billing history"
          />
          {settings.planSummaries.length === 0 ? (
            <EmptyState
              actionHref={billingHref}
              actionLabel="Open billing"
              body={role === "fleet" ? "Fleet Free includes dispatch, drivers, equipment, and private partner work without a subscription." : "Review and accept the current 5% completed-load agreement in Billing before publishing live work. There is no subscription, monthly minimum, tier, allowance, or posting fee."}
              title="No billing record on this workspace yet"
            />
          ) : (
            <ul className="plan-summary-list">
              {settings.planSummaries.map((plan) => (
                <li key={plan.id}>
                  <div>
                    <strong>{plan.name}</strong>
                    <span>{plan.priceLine}</span>
                  </div>
                  <Badge tone={plan.statusTone}>{plan.statusLine}</Badge>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </AppShell>
  )
}
