# LogLoads — Stripe Activation Runbook

Subscriptions only. No Stripe Connect, no freight-money movement (locked in
`docs/DECISIONS.md`). Checkout, billing portal, and the webhook are all wired.

## Founder gate
> **Bind the intended LogLoads Stripe account (complete KYC if not already), then
> create the Dispatch Pro product/price and register the webhook — or authorize an agent
> with Stripe access to do so.**

The connected Stripe tool currently opens an account branded `explore&earn`; that is
not an acceptable LogLoads billing identity. Switch to or create the intended verified
LogLoads/shared-founder account before creating catalog objects. Do **not** create
LogLoads resources in an unrelated or unverified account.

## The exact product/price model the code expects
`apps/web/lib/billing-actions.ts` → `CHECKOUT_PRICING`:

| App product key | Plan | Amount | Interval | Env price id |
|---|---|---|---|---|
| `fleet_operations` | LogLoads Dispatch Pro | **$499.00** (`49900`) | month | `STRIPE_PRICE_DISPATCH` |

- Checkout requires `STRIPE_PRICE_DISPATCH`; if it is unset, Checkout fails closed.
- There is no inline amount fallback and no purchasable Host subscription.
- Driver plan is **free**; Enterprise is "contact us" — neither hits Stripe.
- Hosts are free during the launch pilot. The proposed 5% model is inactive and
  cannot collect fees or move freight money.
- Checkout mode: **`subscription`**. `client_reference_id` + `metadata.organizationId`
  + `metadata.product` carry the org identity into the webhook.

## Webhook contract
- Endpoint: **`POST https://logloads.com/api/billing/webhook`**
- Verifies `stripe-signature` with `STRIPE_WEBHOOK_SECRET` (returns 503 if unset, 400 on
  bad signature).
- Consumes exactly:
  - `checkout.session.completed` → sets plan `active`, stores `stripeCustomerId` +
    `stripeSubscriptionId` on the org's entitlement.
  - `customer.subscription.created` / `customer.subscription.updated` → maps Stripe status → plan status
    (`past_due`/`unpaid` → `past_due`, `canceled` → `cancelled`, `trialing` → `trialing`,
    else `active`).
  - `customer.subscription.deleted` → `cancelled`.
- State mapping + Stripe-event-id deduplication live in `packages/services/src/billing.ts`
  (`applyBillingUpdate`, `findEntitlementByStripeSubscription`) — unit-tested
  (`billing.test.ts`, 6 tests). Re-applying the same event is safe (event-id deduplication
  plus upsert-by-org/product).

## Billing portal
`startBillingPortalAction` opens `stripe.billingPortal.sessions.create` for orgs with a
stored `stripeCustomerId` (active/past_due plans → "Manage billing"/"Update payment").
Trialing/cancelled without a customer → checkout. No Stripe portal configuration beyond
enabling the Customer Portal in the Stripe dashboard.

## Activation sequence (mechanical once account access exists)
1. Identify the correct verified Stripe account and confirm its public business identity is appropriate for LogLoads.
2. Complete KYC if the selected account still requires it.
3. Create/reuse one **product**: "LogLoads Dispatch Pro".
4. Create/reuse one recurring **price** at exactly $499/month → note its `price_...` id.
5. Register the **webhook** → `https://logloads.com/api/billing/webhook`, events:
   `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`,
   `customer.subscription.deleted` → note the `whsec_...`.
6. Enable the **Customer Portal** in the Stripe dashboard.
7. Store in Doppler → host: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
   `STRIPE_PRICE_DISPATCH`.
8. Deploy.
9. Run the controlled real purchase (below) — founder action for the real card.
10. Verify webhook → entitlement → UI, then cancel and verify state.

## Controlled real-transaction proof
- **Plan:** Dispatch Pro ($499/mo) — sign in as a fleet org, open `/fleet/billing`, click the
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
