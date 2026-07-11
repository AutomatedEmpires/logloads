# LogLoads — Stripe Activation Runbook

Subscriptions only. No Stripe Connect, no freight-money movement (locked in
`docs/DECISIONS.md`). Checkout, billing portal, and the webhook are all wired.

## Founder gate
> **Bind the intended LogLoads Stripe account (complete KYC if not already), then
> create the two products/prices and register the webhook — or authorize an agent
> with Stripe access to do so.**

The AutomatedEmpires family already uses a **shared founder Stripe account with KYC
complete** (`acct_1SpxXpDtcwz0cxzo`, per the Sweepza activation). LogLoads can reuse it
with **logloads-namespaced** products/prices, which removes the KYC step. Do **not**
create resources in an unverified account.

## The exact product/price model the code expects
`apps/web/lib/billing-actions.ts` → `CHECKOUT_PRICING`:

| App product key | Plan | Amount | Interval | Env price id |
|---|---|---|---|---|
| `fleet_operations` | LogLoads Fleet plan | **$149.00** (`14900`) | month | `STRIPE_PRICE_FLEET` |
| `landing_operations` | LogLoads Host plan | **$249.00** (`24900`) | month | `STRIPE_PRICE_HOST` |

- If `STRIPE_PRICE_FLEET` / `STRIPE_PRICE_HOST` are set, checkout uses those Price ids.
- If unset, checkout falls back to **inline `price_data`** at the amounts above (works,
  but a dashboard-managed Price is preferred for production).
- Driver plan is **free**; Enterprise is "contact us" — neither hits Stripe.
- Checkout mode: **`subscription`**. `client_reference_id` + `metadata.organizationId`
  + `metadata.product` carry the org identity into the webhook.

## Webhook contract
- Endpoint: **`POST https://logloads.com/api/billing/webhook`**
- Verifies `stripe-signature` with `STRIPE_WEBHOOK_SECRET` (returns 503 if unset, 400 on
  bad signature).
- Consumes exactly:
  - `checkout.session.completed` → sets plan `active`, stores `stripeCustomerId` +
    `stripeSubscriptionId` on the org's entitlement.
  - `customer.subscription.updated` → maps Stripe status → plan status
    (`past_due`/`unpaid` → `past_due`, `canceled` → `cancelled`, `trialing` → `trialing`,
    else `active`).
  - `customer.subscription.deleted` → `cancelled`.
- State mapping + idempotency live in `packages/services/src/billing.ts`
  (`applyBillingUpdate`, `findEntitlementByStripeSubscription`) — unit-tested
  (`billing.test.ts`, 5 tests). Re-applying the same event is safe (upsert-by-org/product).

## Billing portal
`startBillingPortalAction` opens `stripe.billingPortal.sessions.create` for orgs with a
stored `stripeCustomerId` (active/past_due plans → "Manage billing"/"Update payment").
Trialing/cancelled without a customer → checkout. No Stripe portal configuration beyond
enabling the Customer Portal in the Stripe dashboard.

## Activation sequence (mechanical once account access exists)
1. Identify the correct Stripe account (reuse `acct_1SpxXpDtcwz0cxzo` or a dedicated one).
2. Complete KYC (already done on the shared account).
3. Create/reuse two **products**: "LogLoads Fleet plan", "LogLoads Host plan".
4. Create/reuse two recurring **prices**: $149/mo and $249/mo → note their `price_...` ids.
5. Register the **webhook** → `https://logloads.com/api/billing/webhook`, events:
   `checkout.session.completed`, `customer.subscription.updated`,
   `customer.subscription.deleted` → note the `whsec_...`.
6. Enable the **Customer Portal** in the Stripe dashboard.
7. Store in Doppler → host: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
   `STRIPE_PRICE_FLEET`, `STRIPE_PRICE_HOST`.
8. Deploy.
9. Run the controlled real purchase (below) — founder action for the real card.
10. Verify webhook → entitlement → UI, then cancel and verify state.

## Controlled real-transaction proof
- **Plan:** Fleet ($149/mo) — sign in as a fleet org, open `/fleet/billing`, click the
  plan action → Stripe Checkout.
- **Expected Stripe objects:** a `checkout.session` (livemode), a `customer`, a
  `subscription` (active), an `invoice` paid.
- **Expected app state (via `tools/verify-billing.mjs` or SQL/health):** the org's
  entitlement → `status: active`, `stripeCustomerId` + `stripeSubscriptionId` populated;
  an audit event `plan_active`.
- **Expected UI:** `/fleet/billing` shows "Active", "Manage billing", real renewal date.
- **Cleanup:** cancel from the billing portal → `customer.subscription.deleted` →
  entitlement `cancelled`; confirm the UI reflects it.

Do not execute real money without founder authorization. No further design is required
after authorization — this is a credential + click sequence.
