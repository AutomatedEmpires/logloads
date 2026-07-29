# LogLoads subscription billing v1

Status: founder-decided 2026-07-28; implementation may ship dark, but real
Network enrollment and collection remain separately gated.

## Commercial model

New Network work uses an accepted base subscription plus completed Network-load
usage. Fixed Network tiers bill monthly; the finite Pilot uses three exact
30-day installments. A billable unit is one completed physical load movement fulfilled through
LogLoads Network under one qualifying assignment. Posting, matching, requesting,
private-fleet work, cancellation before execution, and duplicate completion do
not create usage.

Driver and carrier compensation remains separate. The host pays the legally
identified carrier, owner-operator, or private-fleet payee directly under their
own transportation or employment relationship. LogLoads does not receive,
escrow, deduct from, or distribute that compensation.

| Plan | Monthly base | Included Network units | Allowance | Overage | Enrollment |
|---|---:|---:|---|---:|---|
| Dispatch Pro | $499 | 0 | none | none | software subscription |
| Network Pilot | $1,500 | 30 | pooled across the 90-day paid pilot | $150 | invitation-only |
| Network 25 | $3,000 | 25 | monthly, no rollover | $125 | sales-assisted |
| Network 50 | $5,500 | 50 | monthly, no rollover | $110 | sales-assisted |
| Network 100 | $10,000 | 100 | monthly, no rollover | $90 | sales-assisted |
| Enterprise custom | negotiated | negotiated, never unlimited | contract | contract | sales-assisted |

Network subscriptions include the core private-fleet coordination capabilities
of Dispatch Pro. Dispatch Pro remains separately available to organizations that
coordinate only their established capacity and includes no Network allowance.
New Dispatch Pro enrollment uses the same accepted
`OrganizationSubscription` lifecycle as every other tier. Carrier and fleet
Checkout may let Stripe create the customer and the signed webhook binds that
returned customer; Network, Pilot, and Enterprise Checkout remain limited to
landing-source or destination organizations with an attached host billing
customer. The older entitlement-only Dispatch Checkout action is retired, while
its webhook and portal reconciliation remain available for already-existing
legacy subscriptions.

The public Pilot shorthand remains **$1,500/mo**, but its binding provider terms
are exact: three $1,500 advance installments at activation, day 30, and day 60.
The pre-created Pilot Price recurs every 30 days inside a finite provider
schedule that ends at day 90, before any fourth base invoice can be created.
After explicit administrator authorization, the first verified paid base
invoice makes its provider period start the immutable operational, commitment,
and exact 90-day allowance anchor. Configuration, authorization, and unpaid
provider creation do not start operations. The 30 units are pooled across that
same window; Pilot overage is determined at its close. The larger Network plans use
Stripe-anniversary monthly allowance windows and 12-month commitments billed
monthly. A base commitment is owed regardless of utilization.

## Versioning and legacy preservation

The canonical billing models are:

- `legacy_percentage`
- `subscription_v1`
- `dispatch_pro`
- `enterprise_custom`

The prior 5%-of-frozen-driver-pay system is preserved as
`legacy_percentage`. Historical assignments, fee events, invoices, accepted
terms, and payment receipts are never rewritten. Legacy collection remains
available behind its existing kill switch until every legacy obligation is
settled or deliberately voided.

An organization already carrying an explicit grandfathered legacy agreement may
continue committing work under that agreement until an audited cutover is
scheduled. No onboarding, default, backfill, or ordinary administrator control
may enroll a new organization in `legacy_percentage`.

An assignment freezes, at commitment:

- `billingModel`
- `capacitySource` (`private_fleet` or `logloads_network`)
- `loadMovementId`
- commitment time and applicable plan code

One physical movement can create either one legacy percentage-fee event or one
subscription usage event, never both. Both writers check the opposing ledger
inside the same canonical-state mutation. Deterministic identities derive from
the physical movement rather than a webhook delivery or wall clock.

No existing organization is silently enrolled. An organization must hold an
explicit billing account and accepted commercial agreement effective at the
assignment's commitment time.

## Legacy dependency map

The percentage implementation remains intentionally reachable for frozen
`legacy_percentage` obligations. It is not a second option for new enrollment.

| Responsibility | Preserved implementation | Subscription-v1 boundary |
|---|---|---|
| Frozen percentage arithmetic and identities | `packages/contracts/src/billing-model.ts` | New assignments freeze a billing model, subscription, plan, capacity source, and physical movement identity instead |
| Assignment commitment and no-dual-billing checks | `packages/services/src/assignments.ts`, `packages/services/src/loads.ts`, `packages/services/src/operating-network.ts` | The commitment-time organization agreement selects exactly one writer |
| Legacy fee accrual, voids, periods, and invoices | `packages/services/src/platform-fees.ts` | These services refuse subscription assignments; completed Network usage is written by `packages/services/src/subscription-billing.ts` |
| Canonical persistence and historical backfill | `packages/db/src/snapshot.ts`, `packages/db/src/seed-data.ts` | Missing pre-v1 billing classifications are backfilled only for already accepted historical assignments; no organization is backfilled into a paid subscription |
| Legacy host statement and collection | `apps/web/lib/host-billing-data.ts`, `apps/web/lib/billing.ts`, `apps/web/app/api/billing/invoices`, `apps/web/app/api/billing/cron`, `apps/web/app/api/billing/webhook` | Legacy rows are labeled as historical/grandfathered; subscription base and usage invoices have separate canonical identities and metadata classifiers |
| Commitment disclosure | `apps/web/components/v3/HostActions.tsx` | Percentage copy appears only when the organization and assignment are explicitly legacy; new Network work shows the accepted subscription unit rules |
| Provider controls | `LOGLOADS_HOST_COLLECTION`, legacy invoice metadata, and the existing signed webhook path | The independent `LOGLOADS_SUBSCRIPTION_COLLECTION` switch defaults off and cannot activate or retire legacy collection |
| Historical design evidence | `docs/HANDOFF-2026-07-27.md`, `docs/marketplace-implementation-spec.md`, `docs/marketplace-realignment-blueprint.md` | Each document is marked historical; this document and the newest decision-log entry govern new work |

## State migration and controlled cutover

Subscription-v1 uses the existing versioned `operating_state` JSON document; it
does not introduce a shadow SQL billing store. No relational DDL is needed for
the additive collections. `backfillStateSnapshot` is the deploy-safe data
migration and is covered by database contract tests:

1. it installs the frozen v1 plan catalog and empty subscription, usage,
   summary, adjustment, overage-invoice, and base-invoice collections when they
   are absent;
2. it classifies only already accepted historical assignments as legacy and
   derives their stable physical-movement identity from the reservation when
   available;
3. it creates explicit legacy organization accounts only from existing legacy
   evidence such as an accepted legacy assignment, fee event, or host billing
   profile;
4. it never fabricates a subscription, accepted terms, provider customer,
   payment, allowance, or usage event; and
5. it preserves every historical receipt, fee, invoice, and assignment record.

An organization cutover is a deliberate canonical mutation, not a deployment
date comparison. An administrator records the accepted plan snapshot, terms
version, authorized acceptor, operating scope, renewal behavior, and
organization effective state. New assignments may freeze that subscription
only after operational activation. Existing legacy assignments continue under
their frozen percentage terms. Provider provisioning and collection are
separate later gates, so rolling out this state shape cannot itself create a
charge.

## Usage and periods

Network usage is recorded only after the operational completion and confirmation
facts required by the product both exist. The usage writer is idempotently
attempted from either completion order and repaired by reconciliation.
Driver-payment receipt remains operational evidence but is not a subscription
revenue trigger.

Every allowance window freezes its plan snapshot, included units, overage rate,
currency, and exact half-open boundaries. Plan changes never reprice a prior
window. Late valid usage belongs to its historical window and, after provider
binding, is collected through a supplemental invoice rather than changing a
finalized amount.

Usage reversals and commercial credits are append-only adjustments. An
administrator cannot delete or directly restate historical usage or invoices.
Adjustments recorded before finalization become exact signed provider invoice
lines and are included in final-total verification. A later debit becomes an
idempotent supplemental invoice; a later credit becomes a Stripe credit note,
refunding only the portion already paid after reducing any exact outstanding
balance.

The version-one adjustment workflow is deliberately scoped to Network
allowance and overage periods. A correction to a recurring base charge remains
a founder-controlled provider operation and must be reconciled manually before
commercial activation; the interface does not imply that an allowance-period
adjustment rewrites a base subscription invoice.

Each post-final adjustment freezes its provider reference, issued amount,
remaining balance, attempt history, terminal state, and paid-revenue delta.
Receivables subtract the full issued credit even when it only reduces an unpaid
balance; recognized revenue subtracts only provider-confirmed refunds. A
supplemental debit contributes only its provider-confirmed paid amount to
revenue, while any exact remaining amount stays visible as a receivable.
Mismatched retries fail closed and never rewrite settled provider facts.

Operations continue through allowance exhaustion. The product notifies the
organization at 70%, 90%, and 100%, records overage thereafter, and recommends
the lowest-cost next plan. Billing failure never rolls back completed work or
interrupts an accepted, dispatched, or in-progress movement. Only new Network
activity may be restricted after the configured grace process.

## Stripe boundary

Stripe collects recurring base charges and explicit overage or supplemental
invoices. The canonical LogLoads ledger remains authoritative for entitlement,
usage, and invoice composition. Provider metadata and deterministic idempotency
keys reconcile Stripe to that ledger.

Products and Prices are provisioned by an idempotent operator tool, never during
an ordinary customer request. Required collection is guarded by:

`LOGLOADS_SUBSCRIPTION_COLLECTION=disabled`

The default is disabled. Provider configuration, test-mode proof, and repository
deployment do not activate real collection.

New subscription money also requires the exact organization UUID in
`LOGLOADS_SUBSCRIPTION_ALLOWED_ORGANIZATION_IDS`. Empty denies all; `*` is the
explicit general-availability sentinel and is not valid for the Pilot-first
launch. Dispatch Pro self-serve additionally requires
`LOGLOADS_DISPATCH_SELF_SERVE=enabled`, so enabling one Pilot cannot
accidentally open the carrier/fleet lane. These are creation controls:
already-authorized provider obligations continue signed webhook
reconciliation if the rollout gates are later closed.

The owner-only nominal smoke path uses a hidden $1 price or invoice, an explicit
user allowlist, a separate controlled target-organization allowlist, a one-use
record, `internal_billing_test=true`, and no ordinary
entitlement or commercial revenue recognition. No live charge is automatic.

Production independently declares
`LOGLOADS_STRIPE_EXPECTED_LIVEMODE=live`; controlled test runtimes declare
`test`. Keys, signed events, invoices, customer balance, card/portal operations,
catalog verification, and the owner smoke must all remain in that declared
mode. The provider key is accepted only when `GET /v1/account` matches the server-side
`LOGLOADS_STRIPE_EXPECTED_ACCOUNT_ID`. Checkout, webhooks, card setup, legacy
collection, subscription collection, provisioning, and lifecycle verification
all fail closed on a missing or mismatched assertion without exposing account
ids. The dedicated customer portal permits payment-method updates and invoice
history only; cancellation and plan switching remain disabled so accepted
commitments can be changed only through canonical scheduled operations.

Canonical billing notifications form a transactional email outbox. Delivery is
attempted only while subscription collection and Resend configuration are both
enabled. Each attempt atomically revalidates the related billing entity,
organization, active profile email, and active `manage_billing` membership,
then claims the row before provider I/O. Pending, failed, and stale claims retry
up to five times; the stable notification ID is the Resend idempotency key.
Provider results are marked delivered or failed only by the active claim token,
and disabled or degraded delivery remains visible in the cron response without
inventing success.

## Activation gates

Code, synthetic data, Stripe test mode, and protected previews may proceed.
Real Network enrollment remains dark until all of the following are recorded:

1. founder approval for the exact Pilot organization and explicit activation
   authorization; first paid provider period establishes the operational start;
2. counsel-approved broker/authority or commodity-and-route-limited posture;
3. accepted commercial terms, tax treatment, dispute and non-renewal language;
4. LogLoads-owned provider tenancy and production environment verification;
5. exact-SHA preview, migration/backfill, webhook, test-clock, reconciliation,
   accessibility, and rollback evidence;
6. explicit change of the collection kill switch.

This pricing model is not represented as a regulatory workaround and does not
promise that every load will be filled.
