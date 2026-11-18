import { ImageResponse } from "next/og"
import { notFound } from "next/navigation"

import { toPublicJobView } from "@logloads/contracts"

import { marketplaceV2Enabled } from "@/lib/marketplace-v2/flag"

import { SHARE_CLOSED_BODY, SHARE_CLOSED_TITLE, shareFacts } from "../facts"
import { resolveShare } from "../load"

export const runtime = "nodejs"
export const alt = "A LogLoads job"
export const size = { width: 1200, height: 630 }
export const contentType = "image/png"

const frame = {
  background: "#103d2c",
  color: "#ffffff",
  display: "flex",
  flexDirection: "column" as const,
  height: "100%",
  justifyContent: "space-between" as const,
  padding: "72px",
  width: "100%"
}

/**
 * The preview a text or Facebook unfurls (1200 × 630). An open job shows pay, basis, trailer, distance and the
 * confirmation date. A closed basin shows the area notice only. Neither card has contact details or a quality claim.
 */
export default async function ShareCardImage({ params }: { params: Promise<{ jobId: string }> }) {
  if (!marketplaceV2Enabled()) notFound()

  const { jobId } = await params
  const resolved = await resolveShare(jobId)

  if (resolved.kind === "missing") notFound()

  if (resolved.kind === "closed") {
    return new ImageResponse(
      (
        <div style={frame}>
          <div style={{ fontSize: 32 }}>LogLoads</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            <div style={{ fontSize: 72 }}>{SHARE_CLOSED_TITLE}</div>
            <div style={{ color: "#d9bc8c", fontSize: 32 }}>{SHARE_CLOSED_BODY}</div>
          </div>
          <div />
        </div>
      ),
      { ...size }
    )
  }

  const facts = shareFacts(toPublicJobView(resolved.job), new Date().toISOString())

  return new ImageResponse(
    (
      <div style={frame}>
        <div style={{ alignItems: "center", display: "flex", fontSize: 32, justifyContent: "space-between" }}>
          <div>LogLoads</div>
          {facts.sponsored ? (
            <div style={{ background: "#d9bc8c", color: "#16201c", fontSize: 28, padding: "8px 16px" }}>Sponsored</div>
          ) : (
            <div />
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ color: "#d9bc8c", fontSize: 36 }}>{facts.cardTitle}</div>
          <div style={{ alignItems: "baseline", display: "flex", gap: 20 }}>
            <div style={{ fontSize: 84, fontWeight: 700 }}>{facts.payAmount}</div>
            {facts.payBasis ? <div style={{ fontSize: 40 }}>{facts.payBasis}</div> : null}
          </div>
          <div style={{ fontSize: 36 }}>
            {facts.equipment} · {facts.distance}
          </div>
        </div>
        <div style={{ color: "#d9bc8c", fontSize: 32 }}>{facts.cardFreshness}</div>
      </div>
    ),
    { ...size }
  )
}
