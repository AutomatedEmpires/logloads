# LogLoads — Stripe Activation Runbook (Current Marketplace Direction)

> **Status:** **NO LIVE V2 BILLING AUTHORIZED.** This document replaces the previously current-sounding `percentage_v1` activation instructions. That original is preserved verbatim in [`archive/2026-legacy-commercial/ACTIVATION_STRIPE_2026-08-01.md`](./archive/2026-legacy-commercial/ACTIVATION_STRIPE_2026-08-01.md). Read `docs/DECISIONS.md` (2026-11-01) and the approved product blueprint before any billing change.

## 1. What the adopted business model actually sells

| Landing subscription | Monthly fee | Active landings | Paid landing team seats (owner included) | Targeted invitations / cycle |
|---|---:|---:|---:|---:|
| Basic | $149 | 1 | 2 | 3 |
| Pro | $299 | 3 | 5 | 10 |
| Regional | $499 | Unlimited legitimate landings | 10 | 30 |

Every subscription supports unlimited legitimate job advertisements, unrestricted incoming hauler inquiries/replies, and any genuine quantity of trucks requested. Unused invitations expire; no rollover. Free individual haulers and multi-truck fleets have **no paid account tiers**. A landing subscriber may optionally purchase a labeled one-posting boost: **7 days/$99**, **14 days/$149**, **28 days/$199**, targeting an approximate 100-mile radius subject to accurate visibility and audience safeguards. No automatic renewal for a boost.

The founding **landing** offer is 50% off the selected monthly tier for its first six paid cycles for the first ten qualified paying landing organizations per launched state, subject to eligibility and transparent renewal. Founding-hauler recognition never becomes a paid feature.

**LogLoads never charges a percentage of hauling revenue, per completed load, per hired truck or for freight settlement.** Real hauling agreements and carrier/driver payments happen outside the platform.

## 2. Activation status and separation from legacy code

- The adopted prices are **commercial requirements**, not evidence of already-created Stripe Products/Prices, successful checkout, webhook handling or customer access.
- Existing `percentage_v1`, `legacy_percentage`, and `subscription_v1` financial records and provider event IDs may need preservation and reconciliation. No new enrollment under these superseded models is allowed.
- Keep historical `LOGLOADS_FEE_COLLECTION`, `LOGLOADS_PERCENTAGE_ENROLLMENT`, `LOGLOADS_SUBSCRIPTION_COLLECTION` and `LOGLOADS_DISPATCH_SELF_SERVE` closed to new activity. Preserve their protections and record interpretation until a separately approved retirement; **do not reuse their meaning for V2 paid membership without a reviewed implementation**.
- The old `STRIPE_PRICE_DISPATCH`, `STRIPE_PRICE_NETWORK_*`, overage and internal billing-smoke entries are legacy, not V2 Basic/Pro/Regional product IDs.
- A successfully signed Stripe webhook proves source authenticity, not that the corresponding agreement, amount, customer, invoice or entitlement is authorized.

## 3. Before even test-mode checkout

1. Review qualified transportation/advertising legal posture for paid recruitment invitations, sponsored jobs and business introduction; do not assume subscriptions settle regulatory classification.
2. Decide/publish cancellation effective dates, failed-payment grace/dunning, taxes, proration, refunds, disputes, receipts, trial policy if any, account verification and founder-cohort rules.
3. Prove server-side per-plan landing/seat limits, subscription status/entitlement periods and no-rollover invitation accounting in a disposable normalized database. Prevent silent user suspension on downgrade; require explicit owner resolution of excess paid seats.
4. Establish a versioned Stripe catalog and exact price IDs with correct currency, recurring cadence, product metadata and an approved linkage to the database's immutable plan version.
5. Decide billing-state machine for `incomplete`, `active`, `past_due`, `canceled`, payment failure, retry, scheduled change, refunds, promotions and trial/test clocks. Never grant service based solely on client success-page navigation.
6. Maintain server-only `STRIPE_SECRET_KEY` and verified `STRIPE_WEBHOOK_SECRET`. Assert the intended Stripe account, live/test mode and event environment; never combine another venture's account or secrets.
7. Implement signed webhook dedupe, orderly retries, cancellation/reconciliation and invoice+entitlement audit logs. Prove that two simultaneous requests cannot create duplicate subscriptions or charges.

## 4. Subscription and boost acceptance tests

- Basic 1 landing/2 seats/3 invitations; Pro 3/5/10; Regional unrestricted genuine active landing count/10/30. Pending invited humans count only if the approved seat rule says they do, with owner included. Free hauler/fleet-only roles do not become silently paid seats in dual-capability companies.
- Downgrade exceeding seats or landings refuses or schedules an explicitly resolved transition, not an arbitrary newest-first suspension.
- Allowance resets precisely at billing-cycle boundaries, with no balance rollover; targeted invitation delivery failures refund or release reserved credits exactly once. Normal inquiries never debit quotas.
- A boost charges once, starts and ends at disclosed UTC times, promotes one eligible real job with visible Sponsored labeling, and stops when invalid/paused without promising views or hires.
- Free users cannot accidentally encounter paid checkout; Stripe metadata cannot change their organization into a paid landing subscriber without a valid approved purchase.
- Founder offer is properly limited by launched state, identity verification and first-ten eligibility; applies 50% for exactly six paid cycles then full tier amount unless canceled under terms.
- Test payment method failure, webhook ordering/retries, disputes/refunds, renewal and test-clock time shifts without altering production providers.

## 5. Production hard stop

**Do not create live Products/Prices for sale, charge a customer, activate a subscription, place an ad, run a paid boost, issue refunds, enable outbound commercial invitations, update DNS or enable payment gates without explicit, scoped founder authorization.** Gate any launch on production/preview environment segregation, independently reviewed SQL/RLS, qualified legal review, live-account identity proof, published customer terms, tested backup/rollback and exact-SHA deployment evidence.

## 6. Historic reconciliation and retirement

Keep retained historical invoices/terms/webhook IDs readable and auditable. Never silently delete or rebill an old obligation using the new membership model. Reconcile actual outstanding provider obligations before designing an archival or retirement path. The preserved earlier activation runbook is **historical evidence only** and is prohibited as an execution plan for new percentage or Dispatch Pro enrollment.
