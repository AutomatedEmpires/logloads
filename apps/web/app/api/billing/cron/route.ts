import { timingSafeEqual } from "node:crypto"

import {
  openAllClosedPeriodInvoices,
  reconcileMissingPlatformFees
} from "@logloads/services"
import { NextResponse } from "next/server"

import {
  chargeHostInvoice,
  listOpenHostInvoices,
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
  // Materialize every closed month represented by accrued events, not only the
  // immediately preceding month. A scheduler outage can cross several boundaries,
  // and the collection pass below can discover invoices but not raw fee events.
  const run = await state.mutate((draft) => {
    const reconciliation = reconcileMissingPlatformFees(draft.state, at)
    const invoices = openAllClosedPeriodInvoices(draft.state, at)

    return { invoices, reconciliation }
  })
  const results = run.invoices
  const reconciliationErrors = run.reconciliation.filter(
    (result) => result.outcome === "error"
  )
  const reconciliationReview = run.reconciliation.filter(
    (result) => result.outcome === "no_basis" || result.outcome === "not_completed"
  )
  const reconciliationSummary = {
    accrued: run.reconciliation.filter((result) => result.outcome === "accrued").length,
    errors: reconciliationErrors,
    requiresReview: reconciliationReview
  }

  if (reconciliationErrors.length > 0) {
    console.error("LogLoads billing cron could not reconcile one or more platform fees", {
      failures: reconciliationErrors
    })
  }

  if (reconciliationReview.length > 0) {
    console.warn("LogLoads billing cron found received assignments requiring fee review", {
      assignments: reconciliationReview
    })
  }
  // Read the complete open book after materializing every missed month.
  // Dark-launch months and scheduler outages can also leave older invoices open;
  // activation catches those up oldest-first.
  const invoices = await state.read(listOpenHostInvoices)

  if (!platformFeeCollectionEnabled()) {
    return NextResponse.json({
      collection: "disabled",
      feeReconciliation: reconciliationSummary,
      invoicesOpened: results.filter((result) => result.outcome === "opened").length,
      invoicesReady: invoices.length,
      period
    }, { status: reconciliationErrors.length > 0 ? 503 : 200 })
  }

  const billing = resolveStripeBilling()

  if (!billing.ok) {
    return NextResponse.json({ error: billing.message, period }, { status: 503 })
  }

  const charges: Array<{
    invoiceId: string
    outcome: "charged" | "failed" | "refused"
    reason?: string
    status?: string
  }> = []

  for (const invoice of invoices) {
    try {
      const result = await chargeHostInvoice({
        invoiceId: invoice.id,
        port: billing.value,
        state
      })

      charges.push(
        result.ok
          ? {
              invoiceId: invoice.id,
              outcome: "charged",
              status: result.value.status
            }
          : {
              invoiceId: invoice.id,
              outcome: result.outcome === "unavailable" ? "failed" : "refused",
              reason: result.message
            }
      )
    } catch (error) {
      charges.push({
        invoiceId: invoice.id,
        outcome: "failed",
        reason: error instanceof Error ? error.message : "Unknown billing failure"
      })
    }
  }

  const failed = charges.filter((charge) => charge.outcome === "failed")
  const refused = charges.filter((charge) => charge.outcome === "refused")

  if (failed.length > 0) {
    console.error("LogLoads billing cron could not collect one or more invoices", {
      failures: failed.map((charge) => ({
        invoiceId: charge.invoiceId,
        reason: charge.reason
      })),
      period
    })
  }

  if (refused.length > 0) {
    console.warn("LogLoads billing cron found invoices requiring operator action", {
      period,
      refusals: refused.map((charge) => ({
        invoiceId: charge.invoiceId,
        reason: charge.reason
      }))
    })
  }

  return NextResponse.json(
    {
      charges,
      collection: "enabled",
      feeReconciliation: reconciliationSummary,
      invoicesOpened: results.filter((result) => result.outcome === "opened").length,
      period
    },
    { status: failed.length > 0 || reconciliationErrors.length > 0 ? 503 : 200 }
  )
}
