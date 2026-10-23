"use client"

import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js"
import type { Stripe } from "@stripe/stripe-js"
import { loadStripe } from "@stripe/stripe-js/pure"
import Link from "next/link"
import { useId, useMemo, useState } from "react"
import { Badge, Icon } from "@logloads/ui"

import {
  cardConfirmsPaymentMethod,
  confirmedPaymentMethodId
} from "@/lib/billing-card-confirmation"
import type {
  HostBillingView,
  HostFeeAgreementView,
  HostFeeLineView,
  HostFeeTotalsView,
  HostInvoiceView
} from "@/lib/host-billing-data"
import type { SettingsView } from "@/lib/settings-data"
import type { VerificationRecordView } from "@/lib/verification-data"
import { AppShell, SectionHeader, type ShellAccount } from "./Shells"
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
      {notice ? <p className="card-action__notice" role="status">{notice}</p> : null}
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
      <div className="card-action">
        <p className="fee-next-step" role="note">
          <Icon aria-hidden name="status.lock" size={16} />
          <strong>
            {setupUnavailableReason ??
              "Payment method setup is not available for this workspace yet."}
          </strong>
        </p>
        <p className="settings-meaning">
          No card is needed to create a workspace or prepare draft work. LogLoads
          asks for one only once the fee terms are accepted.
        </p>
      </div>
    )
  }

  return (
    <div className="card-action">
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
      {notice ? <p className="card-action__notice" role="status">{notice}</p> : null}
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

function FeeAgreementControl({
  agreement,
  rateLabel
}: {
  agreement: HostFeeAgreementView
  rateLabel: string
}) {
  const [accepted, setAccepted] = useState(false)
  const [pending, setPending] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  return (
    <div className="card-action">
      <label className="settings-meaning">
        <input
          checked={accepted}
          onChange={(event) => setAccepted(event.target.checked)}
          type="checkbox"
        />{" "}
        I am authorized to accept the <Link href="/terms">LogLoads Terms</Link> for this
        organization. I understand that each completed load carries a {rateLabel} LogLoads fee,
        added on top of the driver pay I state and billed to this organization monthly.
      </label>
      <button
        className="action-link"
        disabled={!accepted || pending}
        onClick={async () => {
          setPending(true)
          setNotice(null)

          try {
            const response = await fetch("/api/billing/fee-agreement", {
              body: JSON.stringify({
                acceptFeeTerms: true,
                termsVersion: agreement.termsVersion
              }),
              headers: { "Content-Type": "application/json" },
              method: "POST"
            })
            const result = await readJson<{ error?: string }>(response)

            if (!response.ok) {
              throw new Error(result?.error ?? "The fee terms could not be accepted.")
            }

            setNotice("Fee terms accepted. Refreshing billing…")
            window.location.reload()
          } catch (error) {
            setNotice(
              error instanceof Error ? error.message : "The fee terms could not be accepted."
            )
            setPending(false)
          }
        }}
        type="button"
      >
        {pending ? "Accepting fee terms…" : `Accept the ${rateLabel} host fee`}
      </button>
      <p className="settings-meaning">
        Accepting charges nothing. Add a payment card separately before publishing
        live work.
      </p>
      {notice ? (
        <p className="card-action__notice" role={pending ? "status" : "alert"}>
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
  const { currentPeriod, fee, feeAgreement, invoices, paymentMethod } = hostBilling

  return (
    <>
      <section className="settings-panel" aria-label="Host fee">
          <SectionHeader
            eyebrow="Host fee"
            title={`${fee.rateLabel} of stated driver pay, added on top`}
          />
          {feeAgreement.accepted ? (
            <p className="fee-alert" role="status">
              <Icon aria-hidden name="status.assigned" size={16} />
              <span>
                Fee terms accepted
                {feeAgreement.acceptedOnLabel ? ` · ${feeAgreement.acceptedOnLabel}` : ""}
              </span>
            </p>
          ) : (
            <p className="fee-next-step" role="note">
              <Icon aria-hidden name="status.lock" size={16} />
              <strong>
                {feeAgreement.canAccept
                  ? "Accept the fee terms below before publishing live work."
                  : "An owner, administrator, or billing manager must accept the fee terms before this workspace publishes live work."}
              </strong>
            </p>
          )}
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
          {feeAgreement.canAccept ? (
            <FeeAgreementControl agreement={feeAgreement} rateLabel={fee.rateLabel} />
          ) : null}
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

          <section className="settings-panel" aria-label="LogLoads fee invoices">
            <SectionHeader eyebrow="Invoices" title="Monthly LogLoads fee charges" />
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

export interface BillingPageProps {
  account: ShellAccount
  hostBilling: HostBillingView
}

/** The host's money: fee terms, card on file, this month's fees and its bills. */
export function BillingPage({ account, hostBilling }: BillingPageProps) {
  return (
    <AppShell account={account} kicker="Host economics" role="host" title="Billing">
      <div className="billing-page">
        {/* First thing on the page when it is true, because it stops the host
            working. The consequence is worded once in the read model, so this
            banner and the payment-method panel cannot disagree about it. */}
        {hostBilling.paymentMethod.blocksPublishing ? (
          <p className="billing-banner billing-banner--blocked" role="note">
            <Icon aria-hidden name="status.lock" size={18} />
            <span>
              <strong>{hostBilling.paymentMethod.statusLabel}.</strong> {hostBilling.paymentMethod.consequence}
            </span>
          </p>
        ) : null}

        <HostMoneySections hostBilling={hostBilling} />
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

      </div>
    </AppShell>
  )
}
