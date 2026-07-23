"use client"

import Link from "next/link"
import { useState, useTransition } from "react"
import { Badge, Icon } from "@logloads/ui"

import { startBillingPortalAction, startCheckoutAction } from "@/lib/billing-actions"
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

export function BillingPage({
  account,
  billing,
  checkoutNotice,
  role
}: {
  account: ShellAccount
  billing: BillingView
  checkoutNotice?: CheckoutNotice | null
  role: CockpitRole
}) {
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

        {billing.plans.length === 0 ? (
          <EmptyState
            actionHref="/pricing"
            actionLabel="Compare plans"
            body={role === "fleet" ? "Dispatch Pro is $499 per month. Drivers on the account stay free." : "Hosts are included in the free launch pilot."}
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
              body={role === "fleet" ? "Dispatch Pro is $499 per month. Drivers on the account stay free." : "Hosts are included in the free launch pilot."}
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
