"use client"

import Link from "next/link"
import { Badge, Button } from "@logloads/ui"

import type { NetworkView } from "@/lib/network"
import { fitLabel, formatHuman, tripActionLabel, tripStatusLabel } from "@/lib/v3-shared"
import { EmptyState, Metric, SectionHeader, AppShell } from "./Shells"
import { DecisionPanel, LoadCard, LoadDiscovery, OperatingMap, OperationSections, RoutePackPreview } from "./LoadMap"

interface NetworkProps { network: NetworkView }

export function DriverToday({ network }: NetworkProps) {
  const activeTrip = network.trips.find((trip) => !["completed", "cancelled"].includes(trip.status))
  const activeLoad = activeTrip ? network.loads.find((load) => load.title === activeTrip.loadTitle) ?? network.loads[0] : null
  const matches = network.loads.filter((load) => load.compatibility && load.compatibility.eligibility !== "ineligible" && load.capacity.remaining > 0)

  return (
    <AppShell role="driver" title="Today" kicker="Driver cockpit" orgName={network.activeOrganization.name}>
      {activeTrip && activeLoad ? (
        <section className="driver-now">
          <p className="eyebrow">Now</p>
          <h2>{tripActionLabel(activeTrip.status)}</h2>
          <p>{activeLoad.title}</p>
          <div className="now-grid"><Metric label="Miles" value={Math.round(activeLoad.route.distanceMiles)} /><Metric label="Gate" value="5:30 AM" /><Metric label="Status" value={tripStatusLabel(activeTrip.status)} /></div>
          {activeLoad.warnings[0] ? <div className="interrupt"><span>{activeLoad.warnings[0]}</span></div> : null}
          <div className="primary-action-row"><Link className="action-link" href="/driver/trips">Open Route Pack</Link><Link className="action-link action-link--secondary" href="/driver/messages">Message dispatch</Link></div>
        </section>
      ) : (
        <section className="driver-now driver-now--clear"><p className="eyebrow">You are clear</p><h2>No active haul.</h2><p>{matches.length} loads fit your equipment today.</p><div className="primary-action-row"><Link className="action-link" href="/driver/loads">Find loads</Link><Link className="action-link action-link--secondary" href="/driver/equipment">Update availability</Link></div></section>
      )}
      <section className="app-section"><SectionHeader eyebrow="Best matches" title="Work that fits your active setup" /><div className="load-card-grid">{matches.slice(0, 3).map((load) => <LoadCard key={load.id} load={load} />)}</div></section>
    </AppShell>
  )
}

export function DriverLoads({ network }: NetworkProps) {
  return <AppShell role="driver" title="Loads" kicker="Find work" orgName={network.activeOrganization.name}><LoadDiscovery loads={network.loads} /></AppShell>
}

export function DriverMap({ network }: NetworkProps) {
  return (
    <AppShell role="driver" title="Map" kicker="Nearby work" orgName={network.activeOrganization.name}>
      <div className="map-layout"><OperatingMap loads={network.loads} selectedLoadId={network.loads[0]?.id} /><aside className="map-sheet"><h2>{network.loads[0]?.title ?? "No selected load"}</h2><p>{network.loads[0] ? "Exact access unlocks after assignment." : "No current loads in this area."}</p></aside></div>
    </AppShell>
  )
}

export function DriverTrips({ network }: NetworkProps) {
  return (
    <AppShell role="driver" title="Trips" kicker="Haul actions" orgName={network.activeOrganization.name}>
      <div className="board-list">
        {network.trips.length === 0 ? <EmptyState title="You are clear right now." body="Find work that fits your equipment or update your availability." actionHref="/driver/loads" actionLabel="Find loads" /> : null}
        {network.trips.map((trip) => <article className="trip-row" key={trip.id}><div><span>{trip.loadTitle}</span><strong>{tripActionLabel(trip.status)}</strong><p>{trip.events.slice(-1)[0]?.note ?? "Assignment record is ready."}</p></div><Badge tone={trip.status === "completed" ? "success" : trip.status === "cancelled" ? "critical" : "warning"}>{tripStatusLabel(trip.status)}</Badge>{trip.status !== "completed" && trip.status !== "cancelled" ? <Button icon="action.upload" variant="secondary">Attach proof</Button> : null}</article>)}
      </div>
    </AppShell>
  )
}

export function DriverEquipment({ network }: NetworkProps) {
  return (
    <AppShell role="driver" title="Equipment" kicker="Garage" orgName={network.activeOrganization.name}>
      <section className="equipment-setup"><SectionHeader eyebrow="Active setup" title="Matching starts with real truck and trailer details." /><div className="truck-grid">{network.trucks.map((truck) => <article className="truck-card-v3" key={truck.id}><span>{truck.unitNumber}</span><h2>{truck.driverName}</h2><p>{truck.configuration}</p><div className="fact-row"><span>{truck.payload}</span><span>{truck.region}</span><span>{truck.matchCount} matching loads</span></div><Badge tone={truck.status === "available" ? "success" : "warning"}>{truck.status}</Badge></article>)}</div><div className="guided-setup"><h2>What do you run?</h2>{['Long log', 'Short log', 'Truck and pup', 'Straight truck', 'Self-loader', 'Other'].map((item) => <button type="button" key={item}>{item}</button>)}</div></section>
    </AppShell>
  )
}

export function DriverNetwork({ network }: NetworkProps) {
  return <AppShell role="driver" title="Network" kicker="Trusted work" orgName={network.activeOrganization.name}><RelationshipGrid network={network} /></AppShell>
}

export function RelationshipGrid({ network }: NetworkProps) {
  return (
    <section className="relationship-grid">
      {network.privateNetwork.length === 0 ? <EmptyState title="No operating relationships yet." body="Invite trusted carriers or hosts to share work and selected availability." /> : network.privateNetwork.map((relationship) => <article key={relationship.id}><Badge tone={relationship.status === "active" ? "success" : "warning"}>{relationship.status}</Badge><h2>{relationship.partnerName}</h2><p>{relationship.notes ?? "Trusted partner relationship."}</p><span>{formatHuman(relationship.scope)}</span></article>)}
    </section>
  )
}

export function MessagesPage({ network, role }: NetworkProps & { role: "driver" | "fleet" | "host" }) {
  return (
    <AppShell role={role} title="Messages" kicker="Connected conversations" orgName={network.activeOrganization.name}>
      <section className="messages-layout">
        {network.messages.length === 0 ? <EmptyState title="No conversations yet." body="Messages stay connected to loads, assignments, trips, and relationships." /> : network.messages.map((message) => <article key={message.id}><strong>{message.subject}</strong><p>{message.lastMessage}</p><div className="quick-replies">{['Running late', 'At entrance', 'Waiting', 'Loaded', 'Need directions', 'Road issue', 'Call me'].map((reply) => <button type="button" key={reply}>{reply}</button>)}</div></article>)}
      </section>
    </AppShell>
  )
}

export function DriverProfile({ network }: NetworkProps) {
  return (
    <AppShell role="driver" title="Me" kicker="Profile" orgName={network.activeOrganization.name}>
      <section className="profile-panel"><h2>{network.currentDriver?.name ?? "Your profile"}</h2><p>Availability, equipment, contact preferences, and organization membership.</p><div className="choice-grid"><Link href="/driver/equipment"><strong>Equipment</strong><span>Truck, trailer, and active combination</span></Link><Link href="/driver/loads"><strong>Availability</strong><span>Available now, tomorrow, this week, or unavailable</span></Link><Link href="/driver/messages"><strong>Communication</strong><span>Fast messages and phone escalation preferences</span></Link></div></section>
    </AppShell>
  )
}

export function FitWorkList({ network }: NetworkProps) {
  return <div className="load-card-grid">{network.loads.filter((load) => load.capacity.remaining > 0).slice(0, 4).map((load) => <LoadCard key={load.id} load={load} />)}</div>
}

export function simpleOpportunityItems(network: NetworkView) {
  return network.loads.filter((load) => load.capacity.remaining > 0).slice(0, 4).map((load) => ({ title: load.title, body: `${fitLabel(load)} · ${load.payLabel}`, tone: "success" as const }))
}


export function DriverLoadDetail({ loadId, network }: NetworkProps & { loadId: string }) {
  const load = network.loads.find((item) => item.id === loadId)

  return (
    <AppShell role="driver" title="Load detail" kicker="Request decision" orgName={network.activeOrganization.name}>
      {!load ? (
        <EmptyState title="Load not found." body="This load may no longer be visible to your organization." actionHref="/driver/loads" actionLabel="Back to loads" />
      ) : (
        <main className="detail-layout detail-layout--app">
          <div className="detail-main">
            <Link className="back-link" href="/driver/loads">Back to loads</Link>
            <p className="eyebrow">{load.landing.city} to {load.destination.name}</p>
            <h1>{load.title}</h1>
            <p className="lead">{load.scheduleLabel} · {load.payLabel} · {load.capacity.remaining} loads open</p>
            <DecisionPanel load={load} />
            <RoutePackPreview load={load} />
            <OperationSections load={load} />
          </div>
          <aside className="sticky-action">
            <Badge tone={load.capacity.remaining > 0 ? "success" : "warning"}>{load.capacity.remaining > 0 ? "Capacity open" : "All loads assigned"}</Badge>
            <strong>{load.capacity.remaining > 0 ? "Request 1 load" : "Join waitlist"}</strong>
            <p>Exact access unlocks after assignment.</p>
            <Link className="action-link" href="/driver/trips">Request capacity</Link>
          </aside>
        </main>
      )}
    </AppShell>
  )
}
