# LogLoads — Stripe Activation Runbook (Current Marketplace Direction)

> **Status:** **NO LIVE V2 BILLING AUTHORIZED.** Revised 2026-11-01. This replaces the earlier
> `percentage_v1` activation instructions, which sounded current. That runbook is preserved verbatim at
> [`archive/2026-legacy-commercial/ACTIVATION_STRIPE_2026-08-01.md`](./archive/2026-legacy-commercial/ACTIVATION_STRIPE_2026-08-01.md)
> as historical evidence only. It is **prohibited** as an execution plan.
>
> Read [`DECISIONS.md`](./DECISIONS.md) (2026-11-01) and
> [`product/LOGLOADS_PRODUCT_BLUEPRINT_v1.0.md`](./product/LOGLOADS_PRODUCT_BLUEPRINT_v1.0.md) before any billing
> change.
>
> The earlier Stripe account was deleted for the fresh start. Connecting a new account in **test mode** (keys,
> account assertion, the webhook endpoint and its events) is [`INTEGRATIONS.md`](./INTEGRATIONS.md) §6; it keeps
> billing dark.

## 1. What the adopted business model sells

| Landing subscription | Monthly fee | Active landings | Team members (owner included) | Targeted invitations / cycle |
|---|---:|---:|---:|---:|
| Basic | $149 | 1 | 2 | 3 |
| Pro | $299 | 3 | 5 | 10 |
| Regional | $499 | Unlimited legitimate landings | 10 | 30 |

**Included on every plan:**

- unlimited legitimate job postings;
- unrestricted inbound hauler interest and replies;
- any genuine number of trucks requested.

Unused invitations expire at the end of the cycle; nothing rolls over. Owner-operators and fleets have **no
paid tiers**.

**Optional boosts.** A landing subscriber may buy a labelled **Sponsored** boost for one posting:

| Boost | Price |
|---|---:|
| 7 days | $99 |
| 14 days | $149 |
| 28 days | $199 |

A boost covers an approximate 100-mile radius, subject to audience safeguards, and never renews
automatically.

**Founding offer.** The first 10 qualifying landing organizations in each launched state get 50% off their
selected tier for their first 6 paid cycles: $74.50 / $149.50 / $249.50. Recognition for founding haulers is
never a paid feature.

**LogLoads never charges a percentage of hauling revenue, or per completed load, hired truck, or freight
settlement.** Hauling agreements and carrier/driver payments happen outside the platform.

The single code source for these numbers is `packages/contracts/src/membership.ts`. Do not create a second
copy.

## 2. Activation status and separation from legacy code

- The adopted prices are **commercial requirements**. They are not evidence that Stripe Products/Prices,
  checkout, webhooks, or entitlements exist for them. None exists in code at `15892b7`.
- `percentage_v1`, `legacy_percentage`, and `subscription_v1` records and provider IDs stay preserved and
  reconcilable ([`SUBSCRIPTION_BILLING_V1.md`](./SUBSCRIPTION_BILLING_V1.md)). No new enrollment under them.
- `LOGLOADS_FEE_COLLECTION`, `LOGLOADS_PERCENTAGE_ENROLLMENT`, `LOGLOADS_SUBSCRIPTION_COLLECTION`, and
  `LOGLOADS_DISPATCH_SELF_SERVE` stay closed. **Never** repurpose them, or their meaning, for Basic, Pro,
  Regional, or boosts.
- `STRIPE_PRICE_DISPATCH`, `STRIPE_PRICE_NETWORK_*`, the overage prices, and the internal $1 smoke are legacy
  catalog entries, not V2 product IDs.
- `tools/provision-stripe-catalog.mjs`, `tools/stripe-catalog.mjs`, `tools/verify-stripe-subscriptions.mjs`,
  and `tools/stripe-test-clock.mjs` operate the **historical** catalog. Do not run them with `--apply` against
  any account to create new-model products. Without `--apply`, `tools/provision-stripe-catalog.mjs` only prints
  the historical catalog and makes no provider call. A fresh account has no historical obligation to reconcile,
  so its `STRIPE_PRICE_*` variables stay unset.
- A signed webhook proves the event's source is authentic. It does not prove the agreement, amount,
  customer, or entitlement was authorized.
- **Guardrail conflict to resolve deliberately:** `tools/check-guardrails.mjs` bans the retired copy pattern
  `$499/mo` in `apps/web`, but Regional is $499/month. The new pricing surface needs an intentional guardrail
  update that keeps banning the retired Dispatch Pro copy ([`product/TRANSITION_PLAN.md`](./product/TRANSITION_PLAN.md)).

## 3. Before even test-mode checkout

1. Get qualified transportation and advertising legal review of paid invitations, sponsored jobs, and
   business introductions. A subscription does not settle regulatory classification.
2. Decide and publish terms for:
   - cancellation timing;
   - failed-payment grace and dunning;
   - taxes, proration, refunds, disputes, and receipts;
   - trials, if any;
   - account verification and founding-cohort rules (Blueprint §10.3, §16.2).
3. On a disposable normalized database, prove server-side landing and seat limits, entitlement periods, and
   no-rollover invitation accounting. A downgrade must never silently suspend users; excess seats and
   landings are resolved explicitly by the owner.
4. Create a **new**, versioned Stripe catalog. Link each price ID to the database's immutable plan version,
   with the correct currency and cadence.
5. Define the billing state machine:
   - states: `incomplete`, `active`, `past_due`, `canceled`;
   - events: failure, retry, scheduled change, refund, promotion, test clock.

   Never grant service because a client reached the success page.
6. Keep `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` server-only. Assert the expected account ID and
   live/test mode, as the existing code already does.
7. Implement signed webhook deduplication, ordered retries, reconciliation, and audit logs. Prove that
   concurrent requests cannot create duplicate subscriptions or charges.

## 4. Subscription and boost acceptance tests

- **Plan limits.** Basic: 1 landing, 2 seats, 3 invitations. Pro: 3 / 5 / 10. Regional: unlimited genuine
  landings, 10 seats, 30 invitations. The owner counts as a seat. Free hauler or fleet roles never become paid
  seats, including in a company that does both kinds of business.
- **Downgrades.** A downgrade that exceeds limits is refused, or scheduled and explicitly resolved. It never
  triggers arbitrary suspension.
- **Invitation allowance.**
  - The allowance resets exactly at the cycle boundary, with no rollover.
  - A failed delivery releases its credit exactly once.
  - Inquiries never debit the allowance.
- **Boosts.** A boost charges once and runs between disclosed UTC times. It promotes one eligible real job
  with a visible Sponsored label, and stops when the job becomes invalid. It promises no views or hires.
- **Free users.** Free users cannot reach paid checkout by accident. Stripe metadata alone cannot turn an
  organization into a paid subscriber.
- **Founding offer.** The founding discount is limited by launched state, verification, and first-ten
  eligibility. It applies 50% for exactly 6 paid cycles, then the full price.
- **Failure and timing paths.** Test payment failure, webhook ordering and retries, disputes and refunds,
  renewal, and test-clock shifts — in test mode only.

## 5. Production hard stop

**Without explicit, scoped founder authorization, do not:**

- create live Products or Prices;
- charge a customer;
- activate a subscription;
- sell a boost;
- issue a refund;
- send commercial invitations;
- change DNS;
- enable any payment gate.

Before launch, the founder must also have:

- environment segregation;
- reviewed SQL/RLS;
- a legal review;
- proof of the live account's identity;
- published terms;
- a tested backup and rollback;
- exact-SHA deployment evidence.

## 6. Historical reconciliation and retirement

Keep historical invoices, terms, and webhook IDs readable and auditable. Never delete or re-bill an old
obligation under the new model. Reconcile actual outstanding provider obligations before designing a
retirement path. Retirement needs zero open obligations, both in canonical state and in Stripe, plus explicit
authorization ([`product/TRANSITION_PLAN.md`](./product/TRANSITION_PLAN.md)).
