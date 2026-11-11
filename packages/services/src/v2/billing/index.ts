/**
 * billing (#248): plan and allowance rules (caps, invitation balance, founding offer, over-cap state; no Stripe).
 *
 * Port v3 (#244) entry module. `packages/services/src/index.ts` already re-exports it, so the task adds its pure
 * rules here (over the views in `packages/contracts/src/v2/billing/`) without touching a shared file. Nothing yet.
 */

export {}
