import "server-only"

import { z } from "zod"

import { MARKETPLACE_SUBSCRIPTION_STATUSES, type MarketplacePlanAllowanceView } from "@logloads/contracts"

import type { NormalizedFeature } from "../normalized-adapter"
import { landingAllowanceFromRow } from "../normalized-mapping"
import { MarketplaceStoreError, unavailableMarketplaceV2Feature } from "../port"

/**
 * billing (#248): the plan and allowance read model, over the normalized store. No Stripe, no billing gates.
 *
 * `planAllowance` is mapped already: `get_org_entitlement_state` is catalogued in `MARKETPLACE_FUNCTIONS`, and any
 * active member may read it (the function's own check; `plan.view`). Limits stay in `LANDING_PLANS`. To map:
 * `foundingOffer` from `promotion_redemptions` and `promotions` (01, 03; `promotions_read`).
 *
 * Port v3 (#244) entry module, already wired into `normalized-adapter.ts`. #248 builds the rest in this folder and
 * sets `supported` once every method works.
 */

/**
 * The `get_org_entitlement_state` columns the landing allowance does not read. A drift between the SQL and this
 * adapter fails loudly, as every row parse does; its detail stays out of the message shown to people.
 */
const planStateRowSchema = z.object({
  fleet_only_members: z.number().int().nonnegative(),
  grace_ends_at: z.string().refine((value) => !Number.isNaN(Date.parse(value))).nullable(),
  landing_conflict: z.boolean(),
  seat_conflict: z.boolean(),
  subscription_status: z.enum(MARKETPLACE_SUBSCRIPTION_STATUSES).nullable()
})

/** `get_org_entitlement_state` row → the whole plan read model. */
export function planAllowanceFromRow(row: unknown): MarketplacePlanAllowanceView {
  const allowance = landingAllowanceFromRow(row)
  const parsed = planStateRowSchema.safeParse(row)

  if (!parsed.success) {
    throw new MarketplaceStoreError(undefined, "22000", parsed.error)
  }

  const state = parsed.data

  return {
    ...allowance,
    fleetOnlyMembers: state.fleet_only_members,
    graceEndsAt: state.grace_ends_at === null ? null : new Date(state.grace_ends_at).toISOString(),
    landingsOverCap: state.landing_conflict,
    seatsOverCap: state.seat_conflict,
    subscriptionStatus: state.subscription_status
  }
}

export const normalizedBilling: NormalizedFeature<"billing"> = {
  methods: ({ asViewer }) => ({
    ...unavailableMarketplaceV2Feature("billing"),

    async planAllowance(viewer) {
      const [row] = await asViewer(
        viewer,
        (calls) => calls.call("get_org_entitlement_state", { p_org_id: viewer.organizationId }),
        { readOnly: true }
      )

      if (!row) {
        throw new MarketplaceStoreError()
      }

      return planAllowanceFromRow(row)
    }
  }),
  supported: false
}
