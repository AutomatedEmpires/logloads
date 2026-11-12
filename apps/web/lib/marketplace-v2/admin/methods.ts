/**
 * admin (#255): the port methods over the normalized store, for LogLoads staff (§7, §8.7).
 *
 * Every method runs through `asAccount`: as the session's person for NO business, so an organization role never
 * counts, and the business acted on is the input's, which the store checks. Each method first reads the person's own
 * staff row (`admin_roles`) in the same transaction and applies the exact role rule (`marketplaceAdminAuthorize`,
 * the same role sets as the SQL), so a refused person reaches no admin function. Each SQL function then checks the
 * role again (`is_platform_admin`) and writes the audit row with the stated reason; the private reads write it before
 * they read. That is why every write and private read runs in a read-write transaction.
 *
 * Inputs are parsed at the boundary with the SQL's own bounds (packages/contracts/src/v2/admin), so a person sees a
 * plain reason instead of the store's generic error for bad input. A verification decision's audit reason names its
 * documents or rejection code (`verificationAuditReason`): with the row's actor and time it is the review record.
 */

import {
  marketplaceAdminFoundingBadgeInputSchema,
  marketplaceAdminFoundingPromotionInputSchema,
  marketplaceAdminModerationInputSchema,
  marketplaceAdminPrivateReadInputSchema,
  marketplaceAdminReleaseInputSchema,
  marketplaceAdminReportFiltersSchema,
  marketplaceAdminReportResolutionInputSchema,
  marketplaceAdminVerificationInputSchema,
  type MarketplaceAdminAction
} from "@logloads/contracts"
import { marketplaceAdminAuthorize, verificationAuditReason } from "@logloads/services"
import type { ZodError, ZodType, ZodTypeDef } from "zod"

import type { NormalizedFeatureContext } from "../normalized-adapter"
import { translateStoreError, type MarketplaceCalls } from "../normalized-db"
import { MarketplaceRefusalError, type MarketplaceAdminPort, type MarketplaceV2Account } from "../port"
import {
  adminAccessFromRows,
  adminLandingPrivateFromRows,
  adminQueueFromRows,
  adminReportFromRow,
  adminThreadMessageFromRow,
  adminVerificationFromRow,
  badgeNumberFromValues,
  redemptionIdFromValues
} from "./mapping"
import { adminStatement, type AdminStatementName } from "./statements"

/** Plain words for store refusals whose own message is written for engineers, by SQLSTATE. */
type Rewording = Readonly<Partial<Record<string, string>>>

const PROMOTION_REWORDING: Rewording = { "23505": "This business already has a founding offer." }
const BADGE_REWORDING: Rewording = { P0002: "This business has no hauler profile, so it can't get a founding hauler badge." }

function firstIssue(error: ZodError): string {
  return error.issues[0]?.message ?? "Check the form and try again."
}

function parseInput<T>(schema: ZodType<T, ZodTypeDef, unknown>, input: unknown): T {
  const parsed = schema.safeParse(input)

  if (!parsed.success) {
    throw new MarketplaceRefusalError(firstIssue(parsed.error), "22023")
  }

  return parsed.data
}

function sqlState(error: unknown): string | null {
  const code = (error as { code?: unknown } | null)?.code

  return typeof code === "string" ? code : null
}

async function statement(calls: MarketplaceCalls, name: AdminStatementName, values: readonly (string | null)[]): Promise<unknown[]> {
  const bound = adminStatement(name, values)

  // Not catalogued yet (./statements.ts): `./index.ts` withholds every method until it is.
  return calls.query(name as never, bound.values as never)
}

/** The person's staff roles must allow `action`; refused before anything else runs. */
async function requireRole(calls: MarketplaceCalls, action: MarketplaceAdminAction): Promise<void> {
  const decision = marketplaceAdminAuthorize(adminAccessFromRows(await statement(calls, "admin_roles", [])), action)

  if (!decision.ok) {
    throw new MarketplaceRefusalError(decision.message, "42501")
  }
}

/** One transaction as the person for no business, with the role check first. */
async function asStaff<T>(
  context: NormalizedFeatureContext,
  account: MarketplaceV2Account,
  action: MarketplaceAdminAction,
  readOnly: boolean,
  work: (calls: MarketplaceCalls) => Promise<T>,
  rewording: Rewording = {}
): Promise<T> {
  try {
    return await context.asAccount(
      account,
      async (calls) => {
        await requireRole(calls, action)
        return work(calls)
      },
      { readOnly }
    )
  } catch (error) {
    const plain = error instanceof MarketplaceRefusalError ? undefined : rewording[sqlState(error) ?? ""]

    throw plain === undefined ? translateStoreError(error) : new MarketplaceRefusalError(plain, sqlState(error))
  }
}

/** The twelve admin methods. Tests call this directly; the entry module withholds it until the catalogues have the names. */
export function adminMethods(context: NormalizedFeatureContext): MarketplaceAdminPort {
  return {
    async adminAccess(account) {
      try {
        return await context.asAccount(account, async (calls) => adminAccessFromRows(await statement(calls, "admin_roles", [])), { readOnly: true })
      } catch (error) {
        throw translateStoreError(error)
      }
    },

    async adminQueue(account) {
      return asStaff(context, account, "queue", true, async (calls) =>
        adminQueueFromRows(await calls.call("admin_queue_counts" as never, {} as never))
      )
    },

    async adminVerificationQueue(account) {
      return asStaff(context, account, "verificationQueue", true, async (calls) =>
        (await statement(calls, "admin_verification_queue", [])).map(adminVerificationFromRow)
      )
    },

    async adminSetVerification(account, input) {
      const decision = parseInput(marketplaceAdminVerificationInputSchema, input)

      await asStaff(context, account, "setVerification", false, (calls) =>
        calls.call("admin_set_org_verification", {
          p_org_id: decision.organizationId,
          p_reason: verificationAuditReason(decision),
          p_status: decision.status
        })
      )
    },

    async adminReports(account, filters) {
      const query = parseInput(marketplaceAdminReportFiltersSchema, filters)

      return asStaff(context, account, "reports", true, async (calls) =>
        (await statement(calls, "admin_reports", [query.status, query.target])).map(adminReportFromRow)
      )
    },

    async adminResolveReport(account, input) {
      const resolution = parseInput(marketplaceAdminReportResolutionInputSchema, input)

      // A resolved report keeps its outcome; the same outcome again changes nothing and writes no audit row (33).
      await asStaff(context, account, "resolveReport", false, (calls) =>
        calls.call("admin_resolve_report", { p_reason: resolution.resolutionNote, p_report_id: resolution.reportId, p_status: resolution.status })
      )
    },

    async adminModerateJob(account, input) {
      const moderation = parseInput(marketplaceAdminModerationInputSchema, input)

      await asStaff(context, account, "moderateJob", false, (calls) =>
        calls.call("admin_moderate_job_posting", { p_job_id: moderation.jobId, p_reason: moderation.reason, p_status: moderation.status })
      )
    },

    async adminReleaseJobHold(account, input) {
      const release = parseInput(marketplaceAdminReleaseInputSchema, input)

      await asStaff(context, account, "releaseJobHold", false, (calls) =>
        calls.call("admin_release_job_moderation_hold", { p_job_id: release.jobId, p_reason: release.reason })
      )
    },

    async adminGrantFoundingPromotion(account, input) {
      const grant = parseInput(marketplaceAdminFoundingPromotionInputSchema, input)

      return asStaff(
        context,
        account,
        "grantFoundingPromotion",
        false,
        async (calls) => ({
          redemptionId: redemptionIdFromValues(
            await calls.call("admin_grant_founding_promotion", { p_org_id: grant.organizationId, p_promotion_code: grant.promotionCode, p_reason: grant.reason })
          )
        }),
        PROMOTION_REWORDING
      )
    },

    async adminGrantFoundingHaulerBadge(account, input) {
      const grant = parseInput(marketplaceAdminFoundingBadgeInputSchema, input)

      // A business that already has a badge gets its number back, unaudited again (03).
      return asStaff(
        context,
        account,
        "grantFoundingHaulerBadge",
        false,
        async (calls) => ({
          badgeNumber: badgeNumberFromValues(await calls.call("admin_grant_founding_hauler_badge", { p_org_id: grant.organizationId, p_reason: grant.reason }))
        }),
        BADGE_REWORDING
      )
    },

    async adminReadLandingPrivate(account, input) {
      const read = parseInput(marketplaceAdminPrivateReadInputSchema, input)

      return asStaff(context, account, "readLandingPrivate", false, async (calls) =>
        adminLandingPrivateFromRows(await calls.call("admin_read_landing_private", { p_landing_id: read.targetId, p_reason: read.reason }), read.targetId)
      )
    },

    async adminReadInquiryThread(account, input) {
      const read = parseInput(marketplaceAdminPrivateReadInputSchema, input)

      return asStaff(context, account, "readInquiryThread", false, async (calls) =>
        (await calls.call("admin_read_interest_thread", { p_interest_id: read.targetId, p_reason: read.reason })).map(adminThreadMessageFromRow)
      )
    }
  }
}
