import { z } from "zod"

import {
  ApiError,
  apiErrorResponse,
  enforceApiRateLimit,
  requireAdminApiActor
} from "@/lib/api-actor"
import { buildBillingCsv } from "@/lib/billing-export"
import { readState } from "@/lib/services"

const optionalOrganizationIdSchema = z.string().uuid().optional()

export async function GET(request: Request) {
  try {
    const actor = await requireAdminApiActor()
    await enforceApiRateLimit("admin-billing-export", actor.profile.id, 10, 60_000)

    const organizationId = optionalOrganizationIdSchema.safeParse(
      new URL(request.url).searchParams.get("organizationId") ?? undefined
    )

    if (!organizationId.success) {
      throw new ApiError("organizationId must be a valid organization identifier", 400)
    }

    const csv = await readState((current) =>
      buildBillingCsv(current.state, organizationId.data)
    )
    const day = new Date().toISOString().slice(0, 10)

    return new Response(csv, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `attachment; filename="logloads-billing-${day}.csv"`,
        "Content-Type": "text/csv; charset=utf-8",
        "X-Content-Type-Options": "nosniff"
      }
    })
  } catch (error) {
    return apiErrorResponse(error)
  }
}
