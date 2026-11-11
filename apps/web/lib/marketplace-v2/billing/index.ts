import "server-only"

import { z } from "zod"

import {
  MARKETPLACE_FOUNDING_OFFER_STATUSES,
  MARKETPLACE_SUBSCRIPTION_STATUSES,
  type MarketplaceFoundingOfferView,
  type MarketplacePlanAllowanceView
} from "@logloads/contracts"

import type { NormalizedFeature } from "../normalized-adapter"
import { landingAllowanceFromRow, viewerAccessRow } from "../normalized-mapping"
import { MarketplaceRefusalError, MarketplaceStoreError } from "../port"

/**
 * billing (#248, #306): the plan and allowance read model, over the normalized store. No Stripe, no billing gates.
 *
 * `planAllowance` reads `get_org_entitlement_state` (catalogued in `MARKETPLACE_FUNCTIONS`), which any active member
 * may read (the function's own check; `plan.view`). Limits stay in `LANDING_PLANS`. The read model built on it (caps,
 * invitation balance, over-cap state, plan comparison) is pure: `marketplaceBillingOverview` and
 * `marketplaceFoundingOfferSummary` in packages/services/src/v2/billing/.
 *
 * `foundingOffer` reads `promotion_redemptions` and `promotions` (01, 16) through the `founding_offer` table statement
 * (`MARKETPLACE_QUERIES`), because no stage 01–26 function returns it. Row-level security shows a redemption to the
 * business's owners only (`promotion_redemptions_read`), so anyone else is refused instead of being told there is no
 * offer. It shows a promotion only while it is open (`promotions_read`), so a closed promotion's terms come back as
 * `terms: null`.
 *
 * Port v3 (#244) entry module, wired into `normalized-adapter.ts`. Every method works, so the group is supported.
 */

/** `get_viewer_marketplace_access` found no active membership of the active business. */
const NOT_AVAILABLE = "This business is not available to your account."
/** Only owners can read a redemption (`promotion_redemptions_read`); everyone else is told so, never "no offer". */
export const FOUNDING_OFFER_OWNER_ONLY = "Only the business's owner can see its founding offer."

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

const instant = z.string().refine((value) => !Number.isNaN(Date.parse(value)))
/** `numeric(5, 2)` arrives as a JSON number; accept a numeric string too (other transports). */
const percentOff = z.union([z.number(), z.string().regex(/^\d+(\.\d+)?$/).transform(Number)]).pipe(z.number().gt(0).lte(100))

/**
 * One `promotion_redemptions` row of the founding program, left-joined to its promotion. The promotion's columns are
 * all `NULL` together when row-level security hides it (`promotions_read`: open promotions only); anything else is a
 * drift between the SQL and this adapter.
 */
const foundingOfferRowSchema = z
  .object({
    billing_cycles: z.number().int().min(1).max(36).nullable(),
    cycles_applied: z.number().int().nonnegative(),
    granted_at: instant,
    percent_off: percentOff.nullable(),
    state_code: z.string().regex(/^[A-Z]{2}$/).nullable(),
    status: z.enum(MARKETPLACE_FOUNDING_OFFER_STATUSES)
  })
  .refine((row) => (row.percent_off === null) === (row.billing_cycles === null) && (row.percent_off !== null || row.state_code === null))

/** A founding-offer row → the offer as recorded. Terms the store no longer shows stay unknown (`terms: null`). */
export function foundingOfferFromRow(row: unknown): MarketplaceFoundingOfferView {
  const parsed = foundingOfferRowSchema.safeParse(row)

  if (!parsed.success) {
    throw new MarketplaceStoreError(undefined, "22000", parsed.error)
  }

  const offer = parsed.data

  return {
    cyclesApplied: offer.cycles_applied,
    grantedAt: new Date(offer.granted_at).toISOString(),
    status: offer.status,
    terms: offer.percent_off === null || offer.billing_cycles === null
      ? null
      : { billingCycles: offer.billing_cycles, percentOff: offer.percent_off, stateCode: offer.state_code }
  }
}

export const normalizedBilling: NormalizedFeature<"billing"> = {
  methods: ({ asViewer }) => ({
    async foundingOffer(viewer) {
      return asViewer(
        viewer,
        async (calls) => {
          const [access] = await calls.call("get_viewer_marketplace_access", { p_org_id: viewer.organizationId })

          if (!access) {
            throw new MarketplaceRefusalError(NOT_AVAILABLE, "42501")
          }

          if (viewerAccessRow(access).role !== "owner") {
            throw new MarketplaceRefusalError(FOUNDING_OFFER_OWNER_ONLY, "42501")
          }

          const [row] = await calls.query("founding_offer", [viewer.organizationId])

          return row === undefined ? null : foundingOfferFromRow(row)
        },
        { readOnly: true }
      )
    },

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
  supported: true
}
