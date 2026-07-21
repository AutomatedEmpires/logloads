"use client"

import { Badge } from "@logloads/ui"
import { useState } from "react"

import type { SupportPageData } from "@/lib/support-data"
import { formatDateTime } from "@/lib/v3-shared"
import { SupportRequestForm, type SupportRequestReceipt } from "./SupportActions"
import { AppShell, EmptyState, SectionHeader } from "./Shells"

function statusTone(status: string): "success" | "warning" | "info" {
  if (status === "resolved") return "success"
  if (status === "open" || status === "in_review") return "warning"

  return "info"
}

function label(value: string): string {
  const human = value.replaceAll("_", " ")

  return human.charAt(0).toUpperCase() + human.slice(1)
}

export function SupportPage({ account, fromPath, requests, role }: SupportPageData) {
  const [visibleRequests, setVisibleRequests] = useState(requests)

  function recordSavedRequest(request: SupportRequestReceipt): void {
    setVisibleRequests((current) => [request, ...current.filter((candidate) => candidate.id !== request.id)])
  }

  return (
    <AppShell account={account} kicker="Help improve LogLoads" role={role} title="Product feedback">
      <section className="app-section support-panel support-panel--form">
        <SectionHeader
          eyebrow="Problem reports and feature requests"
          title="Tell the product team what you need"
        />
        <div className="support-boundary" role="note">
          <strong>This is not an emergency or dispatch channel.</strong>
          <p>
            Do not use this form for urgent haul changes, emergencies, safety incidents, or dispatch.
            Contact the people running the haul directly.
          </p>
          <p>Do not include passwords, access codes, gate combinations, or private contact details.</p>
        </div>
        <SupportRequestForm fromPath={fromPath} onSaved={recordSavedRequest} />
      </section>

      <section className="app-section support-panel" aria-labelledby="your-support-requests">
        <SectionHeader
          eyebrow={`${visibleRequests.length} recorded`}
          title="Your requests"
        />
        <span className="sr-only" id="your-support-requests">Your product feedback requests</span>
        {visibleRequests.length === 0 ? (
          <EmptyState
            body="Problems and feature ideas you send will appear here with their current review status."
            title="No product feedback yet."
          />
        ) : (
          <div className="support-request-list">
            {visibleRequests.map((request) => (
              <article className="support-request-card" id={`support-request-${request.id}`} key={request.id}>
                <div className="support-request-card__head">
                  <h3>{request.title}</h3>
                  <Badge tone={statusTone(request.status)}>{label(request.status)}</Badge>
                </div>
                <div className="support-request-card__badges">
                  <Badge tone="info">{request.kind === "problem" ? "Problem" : "Feature request"}</Badge>
                  <Badge tone="info">{label(request.impact)}</Badge>
                </div>
                <p className="support-request-card__details">{request.details}</p>
                <p className="support-request-card__meta">
                  Sent {formatDateTime(request.createdAt)}
                  {request.pagePath ? ` · From ${request.pagePath}` : ""}
                </p>
                {request.resolutionNote ? (
                  <div className="support-resolution">
                    <strong>{request.resolutionCode ? label(request.resolutionCode) : "Update"}</strong>
                    <p>{request.resolutionNote}</p>
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </section>
    </AppShell>
  )
}
