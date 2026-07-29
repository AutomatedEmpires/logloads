# LogLoads — Stripe activation runbook

Stripe is used for LogLoads software and Network subscription charges only.
LogLoads does not receive or distribute driver/carrier compensation and never
uses Connect, destination charges, transfers, or application fees.

Repository implementation, provider catalog provisioning, and test-mode proof
do not authorize real enrollment or collection.

## Hard gates

Real Network collection requires all of:

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

The switch defaults to `disabled`. Never place `enabled` in a general example,
preview, test, or local environment.

An enabled collection switch with an empty organization allowlist still permits
no new money. The `*` allowlist sentinel is a separate, deliberate GA cutover.
Dispatch Pro self-serve has its own exact gate and does not inherit Network
Pilot approval. Once an authorized Checkout obligation exists, later rollout
gate changes do not suppress its signed payment or lifecycle reconciliation.

## Canonical catalog

| Plan | Monthly base | Allowance | Overage | Enrollment |
|---|---:|---:|---:|---|
| Dispatch Pro | $499 | no Network units | none | software |
| Network Pilot | $1,500 | 30 pooled over exact 90 days | $150 | invitation-only |
| Network 25 | $3,000 | 25/month | $125 | sales-assisted |
| Network 50 | $5,500 | 50/month | $110 | sales-assisted |
| Network 100 | $10,000 | 100/month | $90 | sales-assisted |
| Enterprise custom | negotiated | negotiated, never unlimited | negotiated | sales-assisted |
| Internal billing test | $1 | none | none | owner-only, no entitlement or revenue recognition |

The recurring base is billed in advance. Network 25/50/100 allowance windows
follow the Stripe subscription anniversary. The public Pilot shorthand remains
$1,500/mo, but its provider contract is exactly three $1,500 advance installments:
at the first paid provider period start, day 30, and day 60. Its pre-created Price recurs every 30 days
inside a finite schedule ending at day 90, so no fourth Pilot base invoice can
exist. The first verified paid base invoice after explicit authorization makes
that provider period start the one canonical operational, commitment, and
pooled-allowance anchor. Agreement configuration, authorization, and an
unpaid Checkout session do not start that clock.
Overage is billed in arrears through one explicit invoice line or a
supplemental invoice for valid late usage.

New Dispatch Pro enrollment also begins from an explicitly accepted canonical
subscription. Carrier and fleet Checkout may create a Stripe customer when no
canonical customer is bound; the signed Checkout webhook must bind the returned
customer and subscription before the first paid base webhook activates
operations. The preserved entitlement-only Checkout action cannot create new
subscriptions. Existing legacy Dispatch subscriptions keep webhook and portal
reconciliation.

Products and Prices are provisioned by the repository operator tool. Ordinary
requests never create catalog objects. Stable metadata includes:

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
- Dispatch Pro and each Network recurring Price id;
- each Network overage Price id;
- hidden internal-test Price id;
- collection switch, exact organization canary allowlist, and independent
  Dispatch Pro self-serve gate;
- the restricted portal configuration (payment method and invoice history
  enabled; self-service cancellation and plan switching disabled);
- internal-smoke switch plus separate owner and target-organization allowlists.
- Resend API key and verified From identity before billing-notification email
  delivery is activated; otherwise canonical notifications remain queued.

Never print or pipe environment values to stdout. Verify names, scopes, age, and
presence using provider metadata only.

## Test-mode proof

Use an isolated test customer and a Stripe test clock. Verify:

1. SetupIntent and default payment method;
2. Checkout/subscription creation with the exact catalog price;
3. base invoice paid in advance;
4. prior explicit administrator authorization, then signed webhook and
   canonical paid-anchor binding;
5. anniversary period boundaries;
6. zero and nonzero overage;
7. duplicate and out-of-order events;
8. failed payment, retry, grace, and recovery;
9. period-end plan change without proration;
10. Pilot finite schedule: exactly $1,500 at activation/day 30/day 60, no day-90
    fourth invoice, exact 90-day 30-unit pooled allowance, and conversion;
11. late usage through a supplemental invoice;
12. post-final debit outstanding/paid state and credit-note split between
    receivable reduction and actual refund;
13. billing-email claim, retry, authorization revocation, and five-attempt
    exhaustion;
14. cancellation/non-renewal;
15. provider/local mismatch detection;
16. internal-test exclusion from entitlement, MRR, and ARR.
17. runtime mode mismatch refusal for secret key, publishable key, signed event,
    legacy invoice, subscription invoice, portal/card operation, and smoke;
18. canary isolation: allowed Pilot succeeds, a non-allowlisted organization
    creates no provider object, Dispatch remains independently dark, and
    disabling rollout gates after Checkout does not discard signed settlement.

Test clocks are asynchronous. Advance only supported intervals, wait for the
clock to return to a ready state, and verify webhook/local convergence rather
than treating the API response as completion.

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

## Activation and rollback

After every gate passes:

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
