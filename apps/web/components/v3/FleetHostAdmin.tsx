"use client"

import Link from "next/link"
import type { CSSProperties } from "react"
import { Badge } from "@logloads/ui"

import type { NetworkView } from "@/lib/network"
import { formatHuman, tripStatusLabel, userPlanFeatures } from "@/lib/v3-shared"
import { LoadCard, LoadDiscovery } from "./LoadMap"
import { RelationshipGrid, simpleOpportunityItems } from "./DriverPages"
import { AppShell, EmptyState, Metric } from "./Shells"

interface NetworkProps { network: NetworkView }

interface AdminSummary {
  activeReports: number
  billingExceptions: number
  openLoads: number
  organizations: number
  suspiciousReviews: number
  trips: number
  verificationRecords: number
}

type DecisionTone = "success" | "warning" | "info" | "critical"

function toneForNotice(severity: string): DecisionTone {
  if (severity === "critical") return "critical"
  if (severity === "watch") return "warning"
  return "info"
}

function DecisionList({ items, title }: { items: Array<{ body: string; title: string; tone: DecisionTone }>; title: string }) {
  return (
    <article className="decision-list">
      <h2>{title}</h2>
      {items.length === 0 ? <EmptyState title="Nothing waiting." body="Your current commitments are clean." /> : items.map((item) => <div className="decision-item" key={`${title}-${item.title}`}><Badge tone={item.tone}>{item.tone === "success" ? "Ready" : item.tone === "warning" ? "Review" : item.tone === "critical" ? "Critical" : "Info"}</Badge><strong>{item.title}</strong><span>{item.body}</span></div>)}
    </article>
  )
}

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
  const lanes = [
    { title: "Available", trucks: network.trucks.filter((truck) => truck.status === "available") },
    { title: "Committed", trucks: network.trucks.filter((truck) => truck.status === "committed" || truck.status === "tentative") },
    { title: "Moving", trucks: network.trucks.filter((truck) => network.trips.some((trip) => !["completed", "cancelled"].includes(trip.status) && truck.driverName !== "Unassigned")) },
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

export function BillingPage({ network, role }: NetworkProps & { role: "fleet" | "host" }) {
  return <AppShell role={role} title="Billing" kicker="Plan features" orgName={network.activeOrganization.name}><section className="pricing-grid pricing-grid--app">{network.entitlements.map((entitlement) => <article key={entitlement.id}><span>{entitlement.status}</span><h2>{entitlement.product === "fleet_operations" ? "Fleet Operations" : "Host Operations"}</h2><strong>{entitlement.limitLabel}</strong><ul>{userPlanFeatures(entitlement.product).map((feature) => <li key={feature}>{feature}</li>)}</ul></article>)}</section></AppShell>
}

export function SettingsPage({ network, role }: NetworkProps & { role: "fleet" | "host" }) {
  return <AppShell role={role} title="Settings" kicker="Organization" orgName={network.activeOrganization.name}><section className="settings-grid">{['Team access', 'Notifications', 'Operating regions', 'Verification', 'Templates'].map((item) => <article key={item}><h2>{item}</h2><p>Configured for {network.activeOrganization.name}.</p></article>)}</section></AppShell>
}

export function HostCommand({ network }: NetworkProps) {
  const hostLoads = network.loads.filter((load) => load.sourceOrganizationId === network.activeOrganization.id)
  const planned = hostLoads.reduce((sum, load) => sum + load.capacity.total, 0)
  const committed = hostLoads.reduce((sum, load) => sum + load.capacity.committed, 0)
  const remaining = hostLoads.reduce((sum, load) => sum + load.capacity.remaining, 0)
  return <AppShell role="host" title="Command" kicker="Landing operations" orgName={network.activeOrganization.name}><section className="host-need"><p className="eyebrow">Needs capacity</p><h2>Tomorrow</h2><div className="capacity-meter" style={{ "--fill": `${planned > 0 ? (committed / planned) * 100 : 0}%` } as CSSProperties}><span /></div><p>{planned} loads planned · {committed} committed · {remaining} still open</p><Link className="action-link" href="/host/opportunities">Publish work</Link></section><section className="decision-grid"><DecisionList title="Arriving now" items={network.trips.filter((trip) => !["completed", "cancelled"].includes(trip.status)).map((trip) => ({ title: trip.loadTitle, body: tripStatusLabel(trip.status), tone: "success" }))} /><DecisionList title="Needs attention" items={network.notices.map((notice) => ({ title: notice.title, body: notice.body, tone: toneForNotice(notice.severity) }))} /><DecisionList title="Upcoming gaps" items={hostLoads.filter((load) => load.capacity.remaining > 0).map((load) => ({ title: load.title, body: `${load.capacity.remaining} loads still open`, tone: "warning" }))} /></section></AppShell>
}

export function HostLandings({ network }: NetworkProps) {
  const landings = network.loads.filter((load) => load.sourceOrganizationId === network.activeOrganization.id)
  return <AppShell role="host" title="Landings" kicker="Access control" orgName={network.activeOrganization.name}><div className="relationship-grid">{landings.map((load) => <article key={load.id}><h2>{load.landing.name}</h2><p>{load.landingDetails?.publicApproximateArea ?? `${load.landing.city}, ${load.landing.state}`}</p><span>Exact access: {formatHuman(load.landingDetails?.exactLocationVisibility ?? "assigned_only")}</span></article>)}</div></AppShell>
}

export function HostOpportunities({ network }: NetworkProps) {
  const hostLoads = network.loads.filter((load) => load.sourceOrganizationId === network.activeOrganization.id)
  return <AppShell role="host" title="Opportunities" kicker="Publish capacity" orgName={network.activeOrganization.name}><section className="builder-layout"><OpportunityBuilder network={network} /><div className="load-card-grid">{hostLoads.map((load) => <LoadCard key={load.id} load={load} />)}</div></section></AppShell>
}

function OpportunityBuilder({ network }: NetworkProps) {
  const steps = ["Timber", "Movement", "Capacity", "Schedule", "Equipment", "Terms", "Network", "Preview", "Publish"]
  const previewLoad = network.loads.find((load) => load.sourceOrganizationId === network.activeOrganization.id) ?? network.loads[0]
  return <article className="opportunity-builder"><h2>Create repeatable work without rebuilding every field.</h2><div className="builder-steps">{steps.map((step, index) => <span key={step}>{index + 1}. {step}</span>)}</div><div className="builder-form"><label>Visibility<select defaultValue="private_network"><option value="private_network">Private network</option><option value="verified_network">Verified regional network</option><option value="open_network">Open network</option></select></label><label>Allocation<select defaultValue="request_approval"><option>Approval required</option><option>Direct offer</option><option>Invitation only</option></select></label><label>Capacity<input defaultValue={previewLoad?.capacity.remaining ?? 1} min="1" type="number" /></label><label>Access release<select defaultValue="after_assignment"><option>Exact access after assignment</option><option>Trusted partners only</option></select></label></div>{previewLoad ? <LoadCard load={previewLoad} /> : null}</article>
}

export function HostLiveBoard({ network }: NetworkProps) {
  const lanes = [{ title: "Expected", statuses: ["assigned", "en_route_to_landing"] }, { title: "Arriving", statuses: ["checked_in"] }, { title: "Waiting", statuses: ["checked_in"] }, { title: "Loading", statuses: ["loading", "loaded"] }, { title: "Departed", statuses: ["en_route_to_destination", "at_destination", "unloading", "completed"] }, { title: "Exception", statuses: ["cancelled"] }]
  return <AppShell role="host" title="Live Board" kicker="Landing flow" orgName={network.activeOrganization.name}><section className="live-board">{lanes.map((lane) => { const trips = network.trips.filter((trip) => lane.statuses.includes(trip.status)); return <article key={lane.title}><h2>{lane.title}</h2>{trips.length === 0 ? <p className="muted">No trucks.</p> : trips.map((trip) => <div className="live-card" key={`${lane.title}-${trip.id}`}><strong>{trip.loadTitle}</strong><span>{tripStatusLabel(trip.status)}</span><span>ETA grounded by trip status</span></div>)}</article> })}</section></AppShell>
}

export function HostCarriers({ network }: NetworkProps) {
  return <AppShell role="host" title="Carriers" kicker="Private network" orgName={network.activeOrganization.name}><RelationshipGrid network={network} /><section className="invite-panel"><h2>Invite existing haulers</h2><p>Start privately with known carriers, then open work to eligible regional capacity when needed.</p><Link className="action-link" href="/host/opportunities">Send direct offer</Link></section></AppShell>
}

export function HostSchedule({ network }: NetworkProps) {
  return <AppShell role="host" title="Schedule" kicker="Upcoming work" orgName={network.activeOrganization.name}><div className="board-list">{network.loads.filter((load) => load.sourceOrganizationId === network.activeOrganization.id).map((load) => <article className="trip-row" key={load.id}><strong>{load.title}</strong><span>{load.scheduleLabel}</span><Badge tone={load.capacity.remaining > 0 ? "warning" : "success"}>{load.capacity.remaining} open</Badge></article>)}</div></AppShell>
}

export function HostAnalytics({ network }: NetworkProps) {
  return <AppShell role="host" title="Analytics" kicker="Capacity trends" orgName={network.activeOrganization.name}><section className="command-grid"><Metric label="Loads published" value={network.loads.length} /><Metric label="Committed" value={network.loads.reduce((sum, load) => sum + load.capacity.committed, 0)} /><Metric label="Still open" value={network.loads.reduce((sum, load) => sum + load.capacity.remaining, 0)} /><Metric label="Partners" value={network.privateNetwork.length} /></section></AppShell>
}

export function AdminDashboard({ summary }: { summary: AdminSummary }) {
  return <AppShell role="admin" title="Admin" kicker="Platform intervention"><section className="command-grid"><Metric label="Organizations" value={summary.organizations} /><Metric label="Verification records" value={summary.verificationRecords} /><Metric label="Open loads" value={summary.openLoads} /><Metric label="Critical reports" value={summary.activeReports} /></section><section className="decision-grid"><DecisionList title="Verification" items={[{ title: "Carrier information reviewed", body: `${summary.verificationRecords} records are available for review`, tone: "info" }]} /><DecisionList title="Moderation" items={[{ title: "Marketplace behavior", body: `${summary.suspiciousReviews} suspicious records queued`, tone: "warning" }]} /><DecisionList title="Billing" items={[{ title: "Plan exceptions", body: `${summary.billingExceptions} accounts need billing review`, tone: "info" }]} /></section></AppShell>
}

export function AdminSectionPage({ summary, title }: { summary: AdminSummary; title: string }) {
  return <AppShell role="admin" title={title} kicker="Platform review"><section className="decision-grid"><DecisionList title="Queue" items={[{ title, body: `${summary.organizations} organizations and ${summary.verificationRecords} verification records in the platform sample.`, tone: "info" }]} /><DecisionList title="Review posture" items={[{ title: "Human review required", body: "Reports and unusual marketplace behavior are reviewed before enforcement.", tone: "warning" }]} /></section></AppShell>
}
