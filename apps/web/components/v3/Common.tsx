"use client"

import { useEffect, useState } from "react"
import { Badge } from "@logloads/ui"

import type { NetworkView } from "@/lib/network"
import { fitLabel, formatDateTime, formatHuman } from "@/lib/v3-shared"
import { EmptyState } from "./Shells"

export type DecisionTone = "success" | "warning" | "info" | "critical"

/**
 * A timestamp in the reader's own timezone.
 *
 * The server cannot know that timezone, which is why `formatDateTime` renders
 * UTC. That is defensible for a desk, but a driver reads times against the
 * clock in the cab: "1:00 PM UTC" is a mistake waiting to happen on an arrival
 * window. So the first paint keeps the server's UTC text — identical markup,
 * no hydration mismatch — and the browser swaps in local time on mount.
 *
 * `dateTime` carries the machine-readable instant either way, so assistive
 * technology and copy-paste get the unambiguous value.
 */
export function LocalTime({ value }: { value: string }) {
  const [text, setText] = useState(() => formatDateTime(value))

  useEffect(() => {
    const parsed = new Date(value)

    if (Number.isNaN(parsed.getTime())) {
      return
    }

    setText(
      new Intl.DateTimeFormat(undefined, {
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        month: "short",
        timeZoneName: "short"
      }).format(parsed)
    )
  }, [value])

  return <time dateTime={value}>{text}</time>
}

export function toneForNotice(severity: string): DecisionTone {
  if (severity === "critical") return "critical"
  if (severity === "watch") return "warning"
  return "info"
}

export function DecisionList({ items, title }: { items: Array<{ body: string; title: string; tone: DecisionTone }>; title: string }) {
  return (
    <article className="decision-list">
      <h2>{title}</h2>
      {items.length === 0 ? <EmptyState title="Nothing waiting." body="Your current commitments are clean." /> : items.map((item) => <div className="decision-item" key={`${title}-${item.title}`}><Badge tone={item.tone}>{item.tone === "success" ? "Ready" : item.tone === "warning" ? "Review" : item.tone === "critical" ? "Critical" : "Info"}</Badge><strong>{item.title}</strong><span>{item.body}</span></div>)}
    </article>
  )
}

export function RelationshipGrid({ network }: { network: NetworkView }) {
  return (
    <section className="relationship-grid">
      {network.privateNetwork.length === 0 ? <EmptyState title="No operating relationships yet." body="Invite trusted carriers or hosts to share work and selected availability." /> : network.privateNetwork.map((relationship) => <article key={relationship.id}><Badge tone={relationship.status === "active" ? "success" : "warning"}>{relationship.status}</Badge><h2>{relationship.partnerName}</h2><p>{relationship.notes ?? "Trusted partner relationship."}</p><span>{formatHuman(relationship.scope)}</span></article>)}
    </section>
  )
}

export function simpleOpportunityItems(network: NetworkView) {
  return network.loads.filter((load) => load.capacity.remaining > 0).slice(0, 4).map((load) => ({ title: load.title, body: `${fitLabel(load)} · ${load.payLabel}`, tone: "success" as const }))
}
