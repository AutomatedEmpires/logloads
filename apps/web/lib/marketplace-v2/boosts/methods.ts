/**
 * boosts (#254): the port methods over the normalized store. Both read; nothing here can buy, start or renew a boost.
 *
 * Every read goes through `asViewer`, so it runs as the session's person, and the active business is the only
 * organization id that reaches a statement. A job id from the request is used only after `get_marketplace_job` shows
 * it is the active business's own job: the store's functions check the person's role in the JOB's business, which for
 * a person in several businesses need not be the one they act for.
 *
 * The audience is the store's own counts (`estimate_boost_audience`) and its truck count from fresh availability for
 * the job's equipment (`count_boost_audience_trucks`), with the app's one freshness threshold
 * (`HAULER_AVAILABILITY_FRESH_DAYS`) passed in, so a report the app shows as "Not recently confirmed" is never counted.
 * Both functions are SECURITY DEFINER and return counts only, never who is counted.
 */

import { HAULER_AVAILABILITY_FRESH_DAYS, marketplaceBoostJobIdSchema, marketplaceBoostPackageCodeSchema } from "@logloads/contracts"
import type { ZodError, ZodType, ZodTypeDef } from "zod"

import type { NormalizedFeatureContext } from "../normalized-adapter"
import { translateStoreError, type MarketplaceCalls } from "../normalized-db"
import { MarketplaceRefusalError, type MarketplaceBoostsPort, type MarketplaceV2Viewer } from "../port"
import { audienceFromRows, boostFromRow, jobPosterFromRow } from "./mapping"
import { boostStatement, type BoostStatementName } from "./statements"

const JOB_NOT_FOUND = "Choose one of your business's jobs."
const JOB_NOT_ALLOWED = "Your role can't see the boost audience for this job."

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

/** One read-only transaction as the session's person, for the viewer's active business. */
async function read<T>(context: NormalizedFeatureContext, viewer: MarketplaceV2Viewer, work: (calls: MarketplaceCalls) => Promise<T>): Promise<T> {
  try {
    return await context.asViewer(viewer, work, { readOnly: true })
  } catch (error) {
    throw translateStoreError(error)
  }
}

async function statement(calls: MarketplaceCalls, name: BoostStatementName, values: readonly (string | null)[]): Promise<unknown[]> {
  const bound = boostStatement(name, values)

  // Not catalogued yet (./statements.ts): `./index.ts` withholds every method until it is.
  return calls.query(name as never, bound.values as never)
}

/** The job must be one the store shows the person and that the ACTIVE business posted. */
async function requireOwnJob(calls: MarketplaceCalls, viewer: MarketplaceV2Viewer, jobId: string): Promise<void> {
  const [row] = await calls.call("get_marketplace_job", { p_job_id: jobId })

  if (row === undefined || jobPosterFromRow(row) !== viewer.organizationId.toLowerCase()) {
    throw new MarketplaceRefusalError(JOB_NOT_FOUND, "P0002")
  }
}

/** A role or landing-scope refusal from a count function, said plainly. */
function jobRefusal(error: unknown): unknown {
  return error instanceof MarketplaceRefusalError && error.code === "42501" ? new MarketplaceRefusalError(JOB_NOT_ALLOWED, "42501") : error
}

/** The two boosts methods. Tests call this directly; the entry module withholds both until the catalogues hold them. */
export function boostMethods(context: NormalizedFeatureContext): MarketplaceBoostsPort {
  return {
    async boostAudience(viewer, jobId, packageCode) {
      const id = parseInput(marketplaceBoostJobIdSchema, jobId)
      const code = parseInput(marketplaceBoostPackageCodeSchema, packageCode)

      const counts = await read(context, viewer, async (calls) => {
        await requireOwnJob(calls, viewer, id)

        const estimate = await calls.call("estimate_boost_audience", { p_job_id: id, p_product_code: code })
        const trucks = await calls.call(
          "count_boost_audience_trucks" as never,
          { p_fresh_days: HAULER_AVAILABILITY_FRESH_DAYS, p_job_id: id, p_product_code: code } as never
        )

        return { estimate, trucks }
      }).catch((error: unknown) => {
        throw jobRefusal(error)
      })

      return audienceFromRows(id, code, counts.estimate, counts.trucks)
    },

    async listJobBoosts(viewer, jobId) {
      const id = jobId === null ? null : parseInput(marketplaceBoostJobIdSchema, jobId)
      const rows = await read(context, viewer, (calls) => statement(calls, "boost_list", [viewer.organizationId, id]))

      return rows.map((row) => boostFromRow(row, viewer.organizationId))
    }
  }
}
