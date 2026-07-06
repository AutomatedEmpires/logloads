"use client"

import { Badge } from "@logloads/ui"

import type { NetworkView } from "@/lib/network"
import { tripStatusLabel } from "@/lib/v3-shared"
import { DecisionList, RelationshipGrid, simpleOpportunityItems } from "./Common"
import { LoadDiscovery } from "./LoadMap"
import { AppShell, Metric } from "./Shells"

interface NetworkProps { network: NetworkView }

export function FleetCommand({ network }: NetworkProps) {
  const needsAttention = network.loads.filter((load) => load.warnings.length > 0 || load.capacity.remaining === 0).slice(0, 4)
  const available = network.trucks.filter((truck) => ["available", "tentative"].includes(truck.status)).length
  const moving = network.trips.filter((trip) => !["completed", "cancelled"].includes(trip.status)).length

  return (
    <AppShell role="fleet" title="Command" kicker="Fleet operations" orgName={network.activeOrganization.name}>
      <section className="command-grid"><Metric label="Available trucks" value={available} /><Metric label="Moving now" value={moving} /><Metric label="Matching opportunities" value={network.loads.filter((load) => load.capacity.remaining > 0).length} /><Metric label="Needs attention" value={needsAttention.length} /></section>
      <section className="decision-grid"><DecisionList title="Needs attention" items={needsAttention.map((load) => ({ title: load.title, body: load.warnings[0] ?? "All loads are currently assigned.", tone: load.warnings[0] ? "warning" : "info" }))} /><DecisionList title="Unassigned work" items={network.loads.filter((load) => load.assignments.some((assignment) => assignment.status === "requested")).map((load) => ({ title: load.title, body: `${load.capacity.remaining} loads still open`, tone: "warning" }))} /><DecisionList title="Matching opportunities" items={simpleOpportunityItems(network)} /></section>
    </AppShell>
  )
}

export function FleetDispatch({ network }: NetworkProps) {
  const activeTripDriverIds = new Set(
    network.trips.filter((trip) => !["completed", "cancelled"].includes(trip.status)).map((trip) => trip.driverProfileId)
  )
  const lanes = [
    { title: "Available", trucks: network.trucks.filter((truck) => truck.status === "available" && !(truck.driverProfileId && activeTripDriverIds.has(truck.driverProfileId))) },
    { title: "Committed", trucks: network.trucks.filter((truck) => (truck.status === "committed" || truck.status === "tentative") && !(truck.driverProfileId && activeTripDriverIds.has(truck.driverProfileId))) },
    { title: "Moving", trucks: network.trucks.filter((truck) => truck.driverProfileId && activeTripDriverIds.has(truck.driverProfileId)) },
    { title: "Exception", trucks: network.trucks.filter((truck) => truck.status === "maintenance" || truck.status === "limited") }
  ]

  return <AppShell role="fleet" title="Dispatch" kicker="Assign capacity" orgName={network.activeOrganization.name}><section className="dispatch-board">{lanes.map((lane) => <article key={lane.title}><h2>{lane.title}</h2>{lane.trucks.length === 0 ? <p className="muted">No trucks in this lane.</p> : lane.trucks.map((truck) => <div className="dispatch-card" key={`${lane.title}-${truck.id}`}><strong>{truck.unitNumber}</strong><span>{truck.driverName}</span><span>{truck.payload} · {truck.region}</span><Badge tone={truck.status === "available" ? "success" : "warning"}>{truck.status}</Badge></div>)}</article>)}</section></AppShell>
}

export function FleetTrucks({ network }: NetworkProps) {
  return <AppShell role="fleet" title="Trucks" kicker="Fleet garage" orgName={network.activeOrganization.name}><div className="truck-grid">{network.trucks.map((truck) => <article className="truck-card-v3" key={truck.id}><span>{truck.unitNumber}</span><h2>{truck.driverName}</h2><p>{truck.configuration}</p><div className="fact-row"><span>{truck.payload}</span><span>{truck.matchCount} matches</span></div></article>)}</div></AppShell>
}

export function FleetDrivers({ network }: NetworkProps) {
  const drivers = [...new Set(network.trucks.map((truck) => truck.driverName))]
  return <AppShell role="fleet" title="Drivers" kicker="Availability" orgName={network.activeOrganization.name}><div className="board-list">{drivers.map((driver) => <article className="trip-row" key={driver}><strong>{driver}</strong><span>Available for matching work</span><Badge tone="success">Ready</Badge></article>)}</div></AppShell>
}

export function FleetAvailability({ network }: NetworkProps) {
  return <AppShell role="fleet" title="Availability" kicker="Future capacity" orgName={network.activeOrganization.name}><section className="availability-board"><div className="guided-setup"><h2>Share capacity</h2>{['Available now', 'Available tomorrow', 'Available this week', 'Unavailable'].map((item) => <button type="button" key={item}>{item}</button>)}</div><div className="board-list">{network.futureAvailability.map((item) => <article className="trip-row" key={item.id}><strong>{item.equipmentLabel}</strong><span>{item.windowLabel}</span><Badge tone={item.status === "available" ? "success" : "warning"}>{item.status}</Badge></article>)}</div></section></AppShell>
}

export function FleetOpportunities({ network }: NetworkProps) {
  return <AppShell role="fleet" title="Opportunities" kicker="Put trucks to work" orgName={network.activeOrganization.name}><LoadDiscovery loads={network.loads.filter((load) => load.capacity.remaining > 0)} /></AppShell>
}

export function FleetTrips({ network }: NetworkProps) {
  return <AppShell role="fleet" title="Trips" kicker="Moving work" orgName={network.activeOrganization.name}><div className="board-list">{network.trips.map((trip) => <article className="trip-row" key={trip.id}><strong>{trip.loadTitle}</strong><span>{tripStatusLabel(trip.status)}</span><Badge tone={trip.status === "completed" ? "success" : "warning"}>{tripStatusLabel(trip.status)}</Badge></article>)}</div></AppShell>
}

export function FleetNetwork({ network }: NetworkProps) {
  return <AppShell role="fleet" title="Network" kicker="Partner work" orgName={network.activeOrganization.name}><RelationshipGrid network={network} /></AppShell>
}
