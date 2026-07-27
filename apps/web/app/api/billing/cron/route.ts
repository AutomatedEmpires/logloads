import { timingSafeEqual } from "node:crypto"

import { openClosedPeriodInvoices } from "@logloads/services"
import { NextResponse } from "next/server"

import {
  chargeHostInvoice,
  operatingStateAccess,
  platformFeeCollectionEnabled,
  resolveStripeBilling
} from "@/lib/billing"

function authorize(request: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET?.trim()

  if (!secret) {
    return NextResponse.json(
      { error: "Billing scheduler is not configured" },
      { status: 503 }
    )
  }

  const expected = Buffer.from(`Bearer ${secret}`)
  const received = Buffer.from(request.headers.get("authorization") ?? "")

  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  return null
}

function previousUtcMonth(at: Date): { periodEnd: string; periodStart: string } {
  const periodEnd = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1))
  const periodStart = new Date(Date.UTC(periodEnd.getUTCFullYear(), periodEnd.getUTCMonth() - 1, 1))

  return {
    periodEnd: periodEnd.toISOString(),
    periodStart: periodStart.toISOString()
  }
}

export async function GET(request: Request) {
  const unauthorized = authorize(request)

  if (unauthorized) {
    return unauthorized
  }

  const now = new Date()
  const at = now.toISOString()
  const period = previousUtcMonth(now)
  const state = operatingStateAccess()
  const results = await state.mutate((draft) =>
    openClosedPeriodInvoices(draft.state, period, at)
  )
  const invoices = results.flatMap((result) =>
    result.outcome === "opened" || result.outcome === "already_open"
      ? [result.invoice]
      : []
  )

  if (!platformFeeCollectionEnabled()) {
    return NextResponse.json({
      collection: "disabled",
      invoicesOpened: results.filter((result) => result.outcome === "opened").length,
      invoicesReady: invoices.length,
      period
    })
  }

  const billing = resolveStripeBilling()

  if (!billing.ok) {
    return NextResponse.json({ error: billing.message, period }, { status: 503 })
  }

  const charges: Array<{
    invoiceId: string
    outcome: "charged" | "failed"
    status?: string
  }> = []

  for (const invoice of invoices) {
    try {
      const result = await chargeHostInvoice({
        invoiceId: invoice.id,
        port: billing.value,
        state
      })

      charges.push({
        invoiceId: invoice.id,
        outcome: result.ok ? "charged" : "failed",
        status: result.ok ? result.value.status : undefined
      })
    } catch {
      charges.push({ invoiceId: invoice.id, outcome: "failed" })
    }
  }

  const failed = charges.filter((charge) => charge.outcome === "failed")

  if (failed.length > 0) {
    console.error("LogLoads billing cron could not collect one or more invoices", {
      failedInvoiceIds: failed.map((charge) => charge.invoiceId),
      period
    })
  }

  return NextResponse.json(
    {
      charges,
      collection: "enabled",
      invoicesOpened: results.filter((result) => result.outcome === "opened").length,
      period
    },
    { status: failed.length > 0 ? 503 : 200 }
  )
}
