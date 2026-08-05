import { NextResponse } from "next/server"

import { hasSessionIdentity } from "@/lib/session"

export const dynamic = "force-dynamic"

export async function GET() {
  return NextResponse.json(
    { authenticated: await hasSessionIdentity() },
    { headers: { "Cache-Control": "no-store" } }
  )
}
