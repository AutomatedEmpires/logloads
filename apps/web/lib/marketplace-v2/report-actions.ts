"use server"

import { MARKETPLACE_LISTING_REPORT_REASONS, reportListingInputSchema } from "@logloads/contracts"

import { checkRateLimit } from "../rate-limit"
import { v2FailureMessage } from "./error-log"
import { marketplaceV2Enabled } from "./flag"
import { pilotMarketplaceV2 } from "./pilot-adapter"
import { MarketplaceOperationUnavailableError } from "./port"
import { getV2SessionActor } from "./v2-session"
import type { ReportListingState } from "./report-state"

/**
 * "Report this listing" (UX-07, #130; spec §8.18). Identity is the session's; the form supplies only the listing id,
 * a reason and optional details. The answer is state for the form (`useActionState`), so the person's words stay in
 * the form when nothing could be sent. Without JavaScript the same action answers the posted page.
 */

const HOUR_MS = 60 * 60_000
/** Reports per person per hour: enough for a real problem with several listings, too few to flood the queue. */
const REPORT_RATE_LIMIT = { bucket: "marketplace-report", limit: 10 } as const

function field(formData: FormData, name: string): string {
  const value = formData.get(name)
  return typeof value === "string" ? value : ""
}

export async function reportListingAction(_previous: ReportListingState, formData: FormData): Promise<ReportListingState> {
  const reasonField = field(formData, "reason")
  const kept = {
    details: field(formData, "details").slice(0, 2000),
    // Only a known reason is echoed back into the form.
    reason: (MARKETPLACE_LISTING_REPORT_REASONS as readonly string[]).includes(reasonField) ? reasonField : ""
  }

  if (!marketplaceV2Enabled()) {
    return { ...kept, message: "This page is not available.", status: "error" }
  }

  const actor = await getV2SessionActor()

  if (!actor) {
    return { ...kept, message: "Sign in to report this listing.", status: "error" }
  }

  if (actor.workspaceSelectionInvalid || !actor.activeOrganization) {
    return { ...kept, message: "Choose a business before reporting a listing.", status: "error" }
  }

  const input = reportListingInputSchema.safeParse({ details: kept.details, jobId: field(formData, "jobId"), reason: reasonField })

  if (!input.success) {
    return { ...kept, message: input.error.issues[0]?.message ?? "Check the report and try again.", status: "error" }
  }

  const viewer = { organizationId: actor.activeOrganization.id, userId: actor.profile.id }

  try {
    await checkRateLimit(REPORT_RATE_LIMIT.bucket, viewer.userId, REPORT_RATE_LIMIT.limit, HOUR_MS)
    const receipt = await pilotMarketplaceV2.reportListing(viewer, input.data)
    return { alreadyReported: receipt.alreadyReported, reportedAt: receipt.reportedAt, status: "sent" }
  } catch (error) {
    if (error instanceof MarketplaceOperationUnavailableError) {
      return { ...kept, status: "unavailable" }
    }

    // A store refusal keeps its words; anything else is logged and answered with fixed copy and a reference (#279).
    return { ...kept, message: v2FailureMessage(error, "listing.report"), status: "error" }
  }
}
