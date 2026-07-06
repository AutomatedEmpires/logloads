"use client"

import Link from "next/link"
import type { CSSProperties } from "react"
import { Badge } from "@logloads/ui"

import type { NetworkView } from "@/lib/network"
import { formatHuman, tripStatusLabel } from "@/lib/v3-shared"
import { DecisionList, RelationshipGrid, toneForNotice } from "./Common"
import { LoadCard } from "./LoadMap"
import { AppShell, Metric } from "./Shells"

interface NetworkProps { network: NetworkView }

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
