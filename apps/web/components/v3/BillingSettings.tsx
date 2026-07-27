"use client"

import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js"
import { loadStripe, type Stripe } from "@stripe/stripe-js"
import Link from "next/link"
import { useId, useMemo, useState, useTransition } from "react"
import { Badge, Icon } from "@logloads/ui"

import { startBillingPortalAction, startCheckoutAction } from "@/lib/billing-actions"
import type {
  HostBillingView,
  HostFeeLineView,
  HostFeeTotalsView,
  HostInvoiceView
} from "@/lib/host-billing-data"
import type { BillingView, PlanProduct, SettingsView } from "@/lib/plans"
import type { VerificationRecordView } from "@/lib/verification-data"
import { AppShell, EmptyState, SectionHeader, type ShellAccount } from "./Shells"
import { InviteMemberForm, RevokeInvitationButton } from "./TeamActions"
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

function PlanAction({ kind, label, product }: { kind: "checkout" | "portal"; label: string; product: PlanProduct }) {
  const [pending, startTransition] = useTransition()
  const [notice, setNotice] = useState<string | null>(null)

  return (
    <div className="plan-action">
      <button
        className="action-link"
        disabled={pending}
        onClick={() => {
          startTransition(async () => {
            try {
              const result = kind === "portal"
                ? await startBillingPortalAction(product)
                : await startCheckoutAction(product)

              if (result.ok && result.url) {
                window.location.assign(result.url)
                return
              }

              setNotice(result.error ?? "Billing could not be opened. Try again.")
            } catch {
              setNotice("Billing could not be opened. Check your connection and try again.")
            }
          })
        }}
        type="button"
      >
        {pending ? "Opening billing…" : label}
      </button>
      {notice ? (
        <p className="plan-action__notice" role="status">
          <Icon aria-hidden name="status.warning" size={16} />
          <span>{notice}</span>
        </p>
      ) : null}
    </div>
  )
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

async function waitForAttachedCard(): Promise<boolean> {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const response = await fetch("/api/billing/payment-method", { cache: "no-store" })
    const result = await readJson<{ card?: { status?: CardStatus } }>(response)

    if (response.ok && result?.card?.status === "attached") {
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

        setNotice("Card accepted. Confirming it with LogLoads…")

        if (await waitForAttachedCard()) {
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

function HostCardControl({ status }: { status: CardStatus }) {
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
        Card details go directly to Stripe. LogLoads stores only the card brand and last four digits.
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

/**
 * Everything a host has to be able to answer about their own money without
 * contacting anybody. Rendered from the read model only — no arithmetic happens
 * in this file, so a figure on this page cannot disagree with the bill.
 */
function HostMoneySections({ hostBilling }: { hostBilling: HostBillingView }) {
  const { currentPeriod, fee, invoices, paymentMethod } = hostBilling

  return (
    <>
      <section className="settings-panel" aria-label="What LogLoads charges you">
        <SectionHeader eyebrow="What you pay" title={`${fee.rateLabel} of driver pay, on completed loads`} />
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
        <HostCardControl status={paymentMethod.status} />
      </section>

      <section className="settings-panel" aria-label="Fees accrued this month">
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

      <section className="settings-panel" aria-label="Bills">
        <SectionHeader eyebrow="Bills" title="What you have been charged" />
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
    </>
  )
}

/**
 * `hostBilling` is required for a host and absent for a fleet, checked by the
 * compiler rather than by remembering: a host billing page that forgot to pass it
 * would render a host their fee ledger as though nothing had ever accrued, which
 * is the one thing a billing page must never say by accident.
 */
export type BillingPageProps = {
  account: ShellAccount
  billing: BillingView
  checkoutNotice?: CheckoutNotice | null
} & ({ role: "fleet"; hostBilling?: never } | { role: "host"; hostBilling: HostBillingView })

export function BillingPage({
  account,
  billing,
  checkoutNotice,
  hostBilling,
  role
}: BillingPageProps) {
  const addUsageHref = role === "fleet" ? "/fleet/trucks" : "/host/landings"
  const addUsageLabel = role === "fleet" ? "Go to trucks" : "Go to landings"
  const addUsageBody = role === "fleet"
    ? "Add your first truck and this section shows where you stand against your plan limits."
    : "Add your first landing and this section shows where you stand against your plan limits."

  return (
    <AppShell account={account} kicker="Plan features" role={role} title="Billing">
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

        {billing.plans.length === 0 ? (
          <EmptyState
            actionHref="/pricing"
            actionLabel="Compare plans"
            body={role === "fleet" ? "Dispatch Pro is $499 per month. Drivers on the account stay free." : "Hosts pay 5% of driver pay on completed loads. No monthly fee, and nothing is deducted from the driver."}
            title="No plan on this workspace yet"
          />
        ) : (
          <>
            <section className="plan-cards" aria-label="Current plan">
              {billing.plans.map((plan) => (
                <article className="plan-card" key={plan.id}>
                  <header className="plan-card__head">
                    <div>
                      <p className="eyebrow">Current plan</p>
                      <h2>{plan.name}</h2>
                      <p className="plan-card__summary">{plan.summary}</p>
                    </div>
                    <strong className="plan-card__price">{plan.priceLine}</strong>
                  </header>
                  <div className="plan-card__status">
                    <Badge tone={plan.statusTone}>{plan.statusLine}</Badge>
                    {plan.statusDetail ? <p>{plan.statusDetail}</p> : null}
                  </div>
                  <div className="plan-card__body">
                    <h3>What your plan includes</h3>
                    <ul>
                      {plan.features.map((feature) => (
                        <li key={feature}>
                          <Icon aria-hidden name="status.assigned" size={16} />
                          <span>{feature}</span>
                        </li>
                      ))}
                    </ul>
                    {plan.limitLines.length > 0 ? <p className="plan-card__limits">{plan.limitLines.join(" · ")}</p> : null}
                  </div>
                  {plan.actionLabel && plan.actionKind ? <PlanAction kind={plan.actionKind} label={plan.actionLabel} product={plan.product} /> : null}
                </article>
              ))}
            </section>

            {role === "fleet" && !billing.billingReady ? (
              <p className="billing-pending" role="note">
                <Icon aria-hidden name="status.lock" size={16} />
                <span>Dispatch Pro checkout is temporarily unavailable. Current trial access stays active.</span>
              </p>
            ) : null}

            <section className="usage-panel" aria-label="Plan usage">
              <SectionHeader eyebrow="Usage" title="Where you stand against plan limits" />
              {billing.usage.length === 0 ? (
                <EmptyState actionHref={addUsageHref} actionLabel={addUsageLabel} body={addUsageBody} title="Nothing to measure yet" />
              ) : (
                <div className="usage-list">
                  {billing.usage.map((row) => (
                    <article className="usage-row" key={row.id}>
                      <div className="usage-row__top">
                        <strong>{row.label}</strong>
                        <span className={`usage-row__detail usage-row__detail--${row.tone}`}>{row.detail}</span>
                      </div>
                      {row.percent !== null ? (
                        <div aria-label={`${row.label}: ${row.detail}`} className="usage-meter" role="img">
                          <span className={`usage-meter__fill usage-meter__fill--${row.tone}`} style={{ width: `${row.percent}%` }} />
                        </div>
                      ) : null}
                    </article>
                  ))}
                </div>
              )}
            </section>
          </>
        )}

        {/* Outside the plan branch on purpose: what a host owes LogLoads does not
            depend on carrying a plan record, so a workspace with no entitlement
            row must still be able to see its own fees and its own bills. */}
        {hostBilling ? <HostMoneySections hostBilling={hostBilling} /> : null}
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
  inviteRoleOptions: Array<{ label: string; value: string }>
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
            <ul className="team-list">
              {settings.team.map((member) => (
                <li key={member.id}>
                  <div>
                    <strong>{member.name}</strong>
                    <span>{member.roleLabel}</span>
                  </div>
                  <Badge tone={member.statusTone}>{member.statusLabel}</Badge>
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

        <section className="settings-panel" aria-label="Plan">
          <SectionHeader
            action={<Link className="action-link action-link--secondary" href={billingHref}>Open billing</Link>}
            eyebrow="Plan"
            title="Plan features"
          />
          {settings.planSummaries.length === 0 ? (
            <EmptyState
              actionHref="/pricing"
              actionLabel="Compare plans"
              body={role === "fleet" ? "Dispatch Pro is $499 per month. Drivers on the account stay free." : "Hosts pay 5% of driver pay on completed loads. No monthly fee, and nothing is deducted from the driver."}
              title="No plan on this workspace yet"
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
