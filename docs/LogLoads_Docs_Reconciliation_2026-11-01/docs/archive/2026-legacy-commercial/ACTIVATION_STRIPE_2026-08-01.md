# LogLoads — Stripe activation runbook

Current authority is the founder's 2026-08-01 `percentage_v1` decision. Stripe
may collect only the host's separate LogLoads platform-fee invoice and reconcile
provider obligations accepted under an earlier commercial decision. LogLoads
does not receive or distribute driver/carrier compensation and never uses
Connect, destination charges, transfers, or application fees.

Repository implementation, provider catalog provisioning, and test-mode proof
do not authorize real enrollment or collection.

## Current `percentage_v1` hard gates

Real percentage-v1 enrollment and platform-fee collection require all of:

1. the intended LogLoads-owned Stripe account and public business identity;
2. accepted terms stating that the host owes LogLoads 5% of host-stated driver
   pay after completion, on top of and separate from full direct driver pay;
3. a dated counsel-approved Network operating posture and tax treatment;
4. an explicit `percentage_v1` agreement for the exact organization, with no
   monthly minimum and no posting charge;
5. exact fee arithmetic, completion idempotency, monthly invoice, webhook,
   retry, credit/void, reconciliation, and rollback proof in test mode;
6. exact-SHA protected-preview evidence and independent review;
7. explicit activation of `LOGLOADS_PERCENTAGE_ENROLLMENT` plus the exact
   organization id in `LOGLOADS_PERCENTAGE_ALLOWED_ORGANIZATION_IDS` for the
   counsel-cleared pilot only, with its private sorted-scope SHA-256 assertion in
   `LOGLOADS_PERCENTAGE_EXPECTED_ORGANIZATION_SCOPE_SHA256`;
8. founder authorization for the exact live canary and controlled charge/refund;
9. explicit activation of the sole current collection switch,
   `LOGLOADS_FEE_COLLECTION`.

Both current gates default to `disabled`, and the percentage organization
allowlist defaults blank. Enrollment permits only the exact allowlisted host to
accept the current agreement; it does not authorize a Stripe charge. Collection
permits provider collection only for an already valid obligation; it does not
enroll a host. The subscription-era switches
`LOGLOADS_SUBSCRIPTION_COLLECTION` and `LOGLOADS_DISPATCH_SELF_SERVE` must remain
`disabled`; they may reconcile a previously accepted provider obligation but
must not create a new subscription customer, Checkout, plan, usage event, or
charge. No catalog Price, allowlist, deployment, or provider object substitutes
for the current fee gate.

## Historical subscription gates — do not activate

The following list is retained only to interpret and reconcile an obligation
accepted while the 2026-07-28 subscription-v1 decision governed:

1. the intended LogLoads-owned Stripe account and public business identity;
2. accepted commercial terms, tax treatment, renewal/non-renewal language, and
   a counsel-approved Network operating posture;
3. a deliberately selected Pilot organization and explicit administrator
   activation authorization;
4. idempotently provisioned Products and Prices whose metadata matches the
   committed manifest;
5. signed webhook, test-clock, anniversary, overage, supplemental-invoice,
   failure/retry, cancellation, reconciliation, and rollback proof;
6. exact-SHA protected-preview evidence and independent review;
7. explicit activation of `LOGLOADS_SUBSCRIPTION_COLLECTION`;
8. `LOGLOADS_SUBSCRIPTION_ALLOWED_ORGANIZATION_IDS` containing only the exact
   founder-approved Pilot organization UUID;
9. `LOGLOADS_DISPATCH_SELF_SERVE=disabled` for the Pilot-first launch.

The historical switch remains `disabled`. Never place `enabled` in a general
example, preview, test, local environment, or new production enrollment.

Under the superseded contract, an enabled collection switch with an empty
organization allowlist permitted no new money, and Dispatch Pro self-serve had
its own exact gate. Under the current decision the allowlist remains empty, the
`*` sentinel is invalid, and neither historical gate may be enabled. Closing
those gates does not suppress signed reconciliation for a Checkout obligation
that was accepted while the historical decision governed.

## Historical subscription catalog

| Plan | Monthly base | Allowance | Overage | Enrollment |
|---|---:|---:|---:|---|
| Dispatch Pro | $499 | no Network units | none | software |
| Network Pilot | $1,500 | 30 pooled over exact 90 days | $150 | invitation-only |
| Network 25 | $3,000 | 25/month | $125 | sales-assisted |
| Network 50 | $5,500 | 50/month | $110 | sales-assisted |
| Network 100 | $10,000 | 100/month | $90 | sales-assisted |
| Enterprise custom | negotiated | negotiated, never unlimited | negotiated | sales-assisted |
| Internal billing test | $1 | none | none | owner-only, no entitlement or revenue recognition |

The historical recurring base was billed in advance. Network 25/50/100 allowance
windows followed the Stripe subscription anniversary. The historical public
Pilot shorthand was $1,500/mo, but its provider contract was exactly three
$1,500 advance installments:
at the first paid provider period start, day 30, and day 60. Its pre-created Price recurs every 30 days
inside a finite schedule ending at day 90, so no fourth Pilot base invoice can
exist. The first verified paid base invoice after explicit authorization makes
that provider period start the one canonical operational, commitment, and
pooled-allowance anchor. Agreement configuration, authorization, and an
unpaid Checkout session do not start that clock.
Overage is billed in arrears through one explicit invoice line or a
supplemental invoice for valid late usage.

Historical Dispatch Pro enrollment also began from an explicitly accepted
canonical subscription. Carrier and fleet Checkout could create a Stripe customer when no
canonical customer is bound; the signed Checkout webhook must bind the returned
customer and subscription before the first paid base webhook activates
operations. The preserved entitlement-only Checkout action cannot create new
subscriptions. Existing legacy Dispatch subscriptions keep webhook and portal
reconciliation.

Historical Products and Prices were provisioned by the repository operator
tool. Ordinary requests did not create catalog objects. Stable metadata
included:

- `logloads_plan_code`
- `billing_model`
- `included_network_loads`
- `allowance_cadence`
- `overage_unit_amount`
- `internal_billing_test`

## Webhook contract

Endpoint:

`POST https://logloads.com/api/billing/webhook`

The route reads the raw request body, verifies `stripe-signature`, deduplicates
by Stripe event id, resolves same-second ordering by `(created, event_id)`, and
returns a retryable error when a money event cannot be reconciled.

Metadata classifiers are exclusive:

- `hostInvoiceId` — legacy percentage invoice
- `organizationSubscriptionId` — subscription base lifecycle
- `billingPeriodSummaryId` — overage/supplemental invoice
- `internal_billing_test=true` — nominal owner smoke

An event naming more than one class is unresolved. A valid signature proves
the sender, not the correctness of local metadata: customer, currency, amount,
price, livemode, plan, and local store-once binding must still agree.

Unknown, `incomplete`, `incomplete_expired`, or `paused` subscription states do
not grant active entitlement.

## Required environment

The exact names and scopes live in `.env.example` and
`ops/production-env-contract.json`. At minimum:

- Stripe server key and signed-webhook secret;
- `LOGLOADS_STRIPE_EXPECTED_LIVEMODE=live` in Production (`test` only in
  controlled non-production runtimes), with every key and signed event required
  to agree;
- `LOGLOADS_STRIPE_EXPECTED_ACCOUNT_ID`, verified against Stripe's account
  endpoint without printing either account id;
- `LOGLOADS_PERCENTAGE_ENROLLMENT=disabled` and a blank
  `LOGLOADS_PERCENTAGE_ALLOWED_ORGANIZATION_IDS` and
  `LOGLOADS_PERCENTAGE_EXPECTED_ORGANIZATION_SCOPE_SHA256` until an exact
  counsel-cleared pilot activation;
- the historical Dispatch Pro and Network Price ids only when a preserved
  accepted obligation actually requires reconciliation;
- hidden internal-test Price id;
- the separate current collection switch and historical Dispatch Pro safety
  gate;
- the restricted portal configuration (payment method and invoice history
  enabled; self-service cancellation and plan switching disabled);
- internal-smoke switch plus separate owner and target-organization allowlists.
- Resend API key and verified From identity before billing-notification email
  delivery is activated; otherwise canonical notifications remain queued.
- `LOGLOADS_FEE_COLLECTION=disabled` until the current percentage-v1 hard gates
  pass; it is the only switch that may later authorize current commercial
  collection.

Keep `LOGLOADS_SUBSCRIPTION_COLLECTION=disabled`, keep
`LOGLOADS_DISPATCH_SELF_SERVE=disabled`, and leave the historical subscription
organization allowlist empty for new activity.

Every hosted smoke must explicitly assert both collection and enrollment. A
dark release uses `SMOKE_EXPECT_FEE_COLLECTION=disabled` and
`SMOKE_EXPECT_PERCENTAGE_ENROLLMENT=disabled`, which also requires an empty,
valid enrollment scope. An enabled pilot configures the private expected SHA-256
fingerprint through
`LOGLOADS_PERCENTAGE_EXPECTED_ORGANIZATION_SCOPE_SHA256`. Health exposes only
`scopeVerified: true` after that assertion matches; it never publishes the
fingerprint, organization count, or organization ids.

Never print or pipe environment values to stdout. Verify names, scopes, age, and
presence using provider metadata only.

## Test-mode proof

Use an isolated Stripe test customer and an isolated LogLoads host organization.
Do not create Checkout Sessions, subscriptions, schedules, subscription Items,
or catalog Prices for this proof. Verify the current `percentage_v1` path in
this order:

1. the expected test-mode Stripe account, then a SetupIntent and default payment
   method bound only to the intended host;
2. test-only activation of `LOGLOADS_PERCENTAGE_ENROLLMENT` for the exact
   isolated organization, then acceptance of the current percentage agreement
   by an authorized host billing actor, with the frozen 500-basis-point USD
   monthly-in-arrears terms;
3. a published load and accepted assignment carrying the exact host-stated
   driver pay, while the driver's direct-pay obligation remains unchanged;
4. a billable delivery followed by host confirmation, producing exactly one
   platform fee equal to 5% of the frozen stated pay;
5. idempotent completion redelivery, no fee for a valid zero/no-delivery close,
   and a fee for a positive-pay short-load completion;
6. one closed monthly period and one itemized canonical invoice whose fee rows,
   assignment/load bindings, currency, frozen pay, fee rate, and subtotal all
   reconcile exactly;
7. fail-closed behavior while `LOGLOADS_FEE_COLLECTION=disabled`, then an
   explicitly enabled test-only run that creates and charges only that canonical
   host invoice;
8. provider customer, payment method, account, livemode, currency, amount, and
   local invoice metadata checks before any Stripe charge call;
9. signed invoice success events, duplicate delivery, and out-of-order delivery,
   with one store-once provider binding and one canonical settlement;
10. payment failure, retry, payment-method replacement, and recovery without a
    duplicate charge or rewritten fee history;
11. draft/open invoice void behavior and settled-invoice credit or refund
    behavior, preserving the original receivable and audited correction;
12. reconciliation refusal for duplicate fee claims, cross-organization links,
    wrong-month rows, altered frozen terms, amount drift, or provider/local
    mismatch;
13. billing-email claim, retry, authorization revocation, and bounded exhaustion;
14. runtime-mode mismatch refusal for the secret key, publishable key, signed
    event, account identity, payment-method operation, invoice charge, and smoke;
15. collection-switch rollback: disabling `LOGLOADS_FEE_COLLECTION` prevents all
    new provider charges while canonical fee and invoice history stays readable;
16. internal owner-smoke exclusion from commercial fees and business metrics.

Stripe webhook processing is asynchronous. Verify signed webhook/local
convergence rather than treating a provider API response as settlement. The
subscription-era test matrix is historical evidence only and belongs under the
do-not-execute sections below.

## Owner-only live smoke

The live smoke is a one-off $1 invoice, not a subscription. It requires:

- an authenticated platform owner on the explicit allowlist;
- a controlled internal billing organization on its separate explicit
  allowlist;
- the separate smoke switch;
- an unused one-redemption canonical record;
- `internal_billing_test=true` metadata;
- signed webhook receipt and canonical paid state;
- cancellation/refund or credit-note reversal proof;
- exclusion from entitlement and business metrics.

No repository command automatically performs this charge. The founder must
authorize the exact run while authenticated in the intended LogLoads Stripe
account.

## Historical subscription activation and rollback — do not execute for new work

The old sequence below is preserved for audit and incident reconstruction. It is
not an authorized path to new enrollment:

1. enroll only the approved Pilot organization;
2. accept the immutable plan/terms snapshot;
3. explicitly authorize activation as an administrator;
4. enable collection only for this controlled activation, after confirming no
   other organization is activation-authorized;
5. create Checkout against the pre-provisioned 30-day Pilot Price;
6. verify the first base invoice is paid; its provider period start must become
   the canonical operational, commitment, and allowance start, and that same
   webhook must create and bind the finite 90-day schedule before the
   subscription becomes operationally ready;
7. manually review the base charges at activation/day 30/day 60, confirm no
   fourth charge at day 90, and review the Pilot allowance close.

If provider and canonical state diverge, disable new collection, preserve
operational work, capture provider-safe identifiers, reconcile against the
canonical ledger, and correct with audited adjustments or credit notes. Never
delete or restate historical usage or invoices.
