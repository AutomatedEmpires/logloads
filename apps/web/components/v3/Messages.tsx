"use client"

import type { NetworkView } from "@/lib/network"
import { AppShell, EmptyState } from "./Shells"

interface NetworkProps { network: NetworkView }

export function MessagesPage({ network, role }: NetworkProps & { role: "driver" | "fleet" | "host" }) {
  return (
    <AppShell role={role} title="Messages" kicker="Connected conversations" orgName={network.activeOrganization.name}>
      <section className="messages-layout">
        {network.messages.length === 0 ? <EmptyState title="No conversations yet." body="Messages stay connected to loads, assignments, trips, and relationships." /> : network.messages.map((message) => <article key={message.id}><strong>{message.subject}</strong><p>{message.lastMessage}</p></article>)}
      </section>
    </AppShell>
  )
}
