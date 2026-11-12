import {
  PERCENTAGE_FEE_RETIRED_CODE,
  PERCENTAGE_FEE_RETIRED_MESSAGE
} from "@logloads/contracts"
import { NextResponse } from "next/server"

import { apiErrorResponse, requireApiActor } from "@/lib/api-actor"

/**
 * The retired percentage-agreement endpoint.
 *
 * It used to record a host's acceptance of the 5% completed-load agreement.
 * The fee is retired, so every signed-in caller gets one typed refusal: 410
 * Gone with a stable `code`. The handler takes no request, so no body, fee,
 * terms version or content type can reach it, and it never opens the
 * operating state. `LOGLOADS_PERCENTAGE_ENROLLMENT` is not consulted, so
 * enabling it cannot reopen acceptance. Agreements accepted before the
 * retirement are unaffected and stay readable in Billing.
 */
export async function POST() {
  try {
    // Kept so the endpoint answers anonymous callers exactly as before.
    await requireApiActor()

    return NextResponse.json(
      {
        code: PERCENTAGE_FEE_RETIRED_CODE,
        error: PERCENTAGE_FEE_RETIRED_MESSAGE
      },
      { headers: { "Cache-Control": "private, no-store" }, status: 410 }
    )
  } catch (error) {
    return apiErrorResponse(error)
  }
}
