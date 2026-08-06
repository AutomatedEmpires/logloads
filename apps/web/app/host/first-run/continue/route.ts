import type { NextRequest } from "next/server"

import { continueFirstRunRequest } from "@/lib/first-run-continuation-route"

export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  return continueFirstRunRequest(request, "host")
}
