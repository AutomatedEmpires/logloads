"use client"

import Link from "next/link"
import { useMemo, useState, type ReactNode } from "react"
import { Badge, Icon } from "@logloads/ui"

import type { NetworkLoadView, NetworkView } from "@/lib/network"
import type {
  DispatchTruckPlan,
  DriverOption,
  FleetDriverRow,
  FleetTruckRow,
  LoadDispatchOption
} from "@/lib/fleet-data"
import { formatDateTime, formatHuman, tripStatusLabel, visibilityLabel } from "@/lib/v3-shared"
import { RelationshipGrid } from "./Common"
import {
  AddEquipmentForm,
  AvailabilityPublisher,
  DriverAssignSelect,
  EquipmentStatusSelect,
  RequestForTruckButton
} from "./FleetActions"
import { LoadCard } from "./LoadMap"
import { AppShell, EmptyState, Metric, SectionHeader, type ShellAccount } from "./Shells"

interface FleetShellProps {
  network: NetworkView
  account?: ShellAccount
}

type Trip = NetworkView["trips"][number]

const ACTIVE_TRIP_STATUSES = new Set([
  "assigned",
  "en_route_to_landing",
  "checked_in",
  "loading",
  "loaded",
  "en_route_to_destination",
  "at_destination",
  "unloading"
])

const STALL_THRESHOLD_MS = 8 * 60 * 60 * 1000

function isActiveTrip(trip: Trip): boolean {
  return ACTIVE_TRIP_STATUSES.has(trip.status)
}

function lastActivityAt(trip: Trip): string | null {
  return trip.events.at(-1)?.occurredAt ?? trip.lastSyncedAt
}

function isStalledTrip(trip: Trip): boolean {
  if (!isActiveTrip(trip)) {
    return false
  }

  const last = lastActivityAt(trip)

  return last !== null && Date.now() - Date.parse(last) > STALL_THRESHOLD_MS
}

function opportunityHref(loadId: string): string {
  return `/fleet/opportunities/${loadId}`
}

function DecisionRow({
  actionLabel,
  body,
  href,
  title,
  tone
}: {
  actionLabel: string
  body: string
  href: string
  title: string
  tone: "success" | "warning" | "critical" | "info"
}) {
  return (
    <article className="fleet-decision">
      <div className="fleet-decision__head">
        <Badge tone={tone}>{tone === "critical" ? "Exception" : tone === "warning" ? "Review" : tone === "success" ? "Ready" : "Waiting"}</Badge>
        <strong>{title}</strong>
      </div>
      <p>{body}</p>
      <Link className="action-link action-link--secondary" href={href}>{actionLabel}</Link>
    </article>
  )
}

function DecisionColumn({ children, count, title }: { children: ReactNode; count: number; title: string }) {
  return (
    <section className="fleet-decision-column" aria-label={title}>
      <header>
        <h2>{title}</h2>
        <span>{count}</span>
      </header>
      {children}
    </section>
  )
}

// --- Command -------------------------------------------------------------------

export function FleetCommand({ account, dispatchPlan, network }: FleetShellProps & { dispatchPlan: DispatchTruckPlan[] }) {
  const activeTrips = network.trips.filter(isActiveTrip)
  const movingDriverIds = new Set(activeTrips.map((trip) => trip.driverProfileId))
  const availableTrucks = network.trucks.filter((truck) =>
    ["available", "tentative"].includes(truck.status) && !(truck.driverProfileId && movingDriverIds.has(truck.driverProfileId))
  )

  const readyDecisions = dispatchPlan.flatMap((plan) =>
    plan.suggestion ? [{ plan, suggestion: plan.suggestion }] : []
  )
  const staffingDecisions = dispatchPlan.filter((plan) => plan.blocked === "no_driver")
  const stalledTrips = network.trips.filter(isStalledTrip)
  const cancelledTrips = network.trips.filter((trip) => trip.status === "cancelled")
  const warningLoads = network.loads.filter((load) => load.assignments.length > 0 && load.warnings.length > 0)
  const waitingRequests = network.loads.flatMap((load) =>
    load.assignments
      .filter((assignment) => assignment.status === "requested")
      .map((assignment) => ({ assignment, load }))
  )

  const exceptionCount = stalledTrips.length + cancelledTrips.length + warningLoads.length
  const decisionCount = readyDecisions.length + staffingDecisions.length

  return (
    <AppShell account={account} role="fleet" title="Command" kicker="Fleet operations" orgName={network.activeOrganization.name}>
      <section className="command-grid">
        <Metric label="Trucks free now" value={availableTrucks.length} />
        <Metric label="Moving now" value={activeTrips.length} />
        <Metric label="Waiting on approval" value={waitingRequests.length} />
        <Metric label="Exceptions" value={exceptionCount} />
      </section>

      <section className="fleet-command-grid">
        <DecisionColumn count={decisionCount} title="Needs your decision">
          {decisionCount === 0 ? (
            <EmptyState
              title="Nothing needs a decision."
              body="Every available truck is either matched, requested, or moving. Check opportunities for new work."
              actionHref="/fleet/opportunities"
              actionLabel="Browse opportunities"
            />
          ) : (
            <>
              {readyDecisions.map(({ plan, suggestion }) => (
                <DecisionRow
                  actionLabel="Review and request"
                  body={`${suggestion.fit}: ${suggestion.title} · ${suggestion.payLabel}`}
                  href={opportunityHref(suggestion.loadPostingId)}
                  key={`ready-${plan.combinationId}`}
                  title={`${plan.label} is free`}
                  tone="success"
                />
              ))}
              {staffingDecisions.map((plan) => (
                <DecisionRow
                  actionLabel="Assign a driver"
                  body="This truck cannot take work until a driver is assigned to it."
                  href="/fleet/trucks"
                  key={`staff-${plan.combinationId}`}
                  title={`${plan.label} has no driver`}
                  tone="warning"
                />
              ))}
            </>
          )}
        </DecisionColumn>

        <DecisionColumn count={exceptionCount} title="Exceptions">
          {exceptionCount === 0 ? (
            <EmptyState title="No exceptions." body="No stalled trips, cancellations, or road warnings on committed work." />
          ) : (
            <>
              {stalledTrips.map((trip) => (
                <DecisionRow
                  actionLabel="Open trips"
                  body={`No update since ${formatDateTime(lastActivityAt(trip))}. ${trip.driverName} was last ${tripStatusLabel(trip.status).toLowerCase()}.`}
                  href="/fleet/trips"
                  key={`stalled-${trip.id}`}
                  title={`${trip.loadTitle} has gone quiet`}
                  tone="critical"
                />
              ))}
              {cancelledTrips.map((trip) => (
                <DecisionRow
                  actionLabel="Open trips"
                  body={`${trip.driverName}'s trip was cancelled. ${trip.events.at(-1)?.note ?? "Review the timeline for the reason."}`}
                  href="/fleet/trips"
                  key={`cancelled-${trip.id}`}
                  title={`Cancelled: ${trip.loadTitle}`}
                  tone="critical"
                />
              ))}
              {warningLoads.map((load) => (
                <DecisionRow
                  actionLabel="Open load"
                  body={load.warnings.at(0) ?? "Review the current conditions on this load."}
                  href={opportunityHref(load.id)}
                  key={`warning-${load.id}`}
                  title={load.title}
                  tone="warning"
                />
              ))}
            </>
          )}
        </DecisionColumn>

        <DecisionColumn count={activeTrips.length + waitingRequests.length} title="In motion">
          {activeTrips.length === 0 && waitingRequests.length === 0 ? (
            <EmptyState
              title="Nothing is moving yet."
              body="Request capacity from dispatch to put free trucks on open loads."
              actionHref="/fleet/dispatch"
              actionLabel="Open dispatch"
            />
          ) : (
            <>
              {activeTrips.map((trip) => (
                <DecisionRow
                  actionLabel="Follow trip"
                  body={`${trip.driverName} · ${trip.events.at(-1)?.note ?? "Trip is underway."}`}
                  href="/fleet/trips"
                  key={`moving-${trip.id}`}
                  title={`${tripStatusLabel(trip.status)}: ${trip.loadTitle}`}
                  tone="info"
                />
              ))}
              {waitingRequests.map(({ assignment, load }) => (
                <DecisionRow
                  actionLabel="Open load"
                  body={`${assignment.driverName} is waiting on ${load.sourceName} to approve the request.`}
                  href={opportunityHref(load.id)}
                  key={`waiting-${assignment.id}`}
                  title={`Requested: ${load.title}`}
                  tone="info"
                />
              ))}
            </>
          )}
        </DecisionColumn>
      </section>
    </AppShell>
  )
}

// --- Dispatch --------------------------------------------------------------------

export function FleetDispatch({ account, dispatchPlan, network }: FleetShellProps & { dispatchPlan: DispatchTruckPlan[] }) {
  const activeTripDriverIds = new Set(
    network.trips.filter(isActiveTrip).map((trip) => trip.driverProfileId)
  )
  const lanes = [
    { title: "Available", trucks: network.trucks.filter((truck) => truck.status === "available" && !(truck.driverProfileId && activeTripDriverIds.has(truck.driverProfileId))) },
    { title: "Committed", trucks: network.trucks.filter((truck) => (truck.status === "committed" || truck.status === "tentative") && !(truck.driverProfileId && activeTripDriverIds.has(truck.driverProfileId))) },
    { title: "Moving", trucks: network.trucks.filter((truck) => truck.driverProfileId && activeTripDriverIds.has(truck.driverProfileId)) },
    { title: "Exception", trucks: network.trucks.filter((truck) => truck.status === "maintenance" || truck.status === "limited") }
  ]
  const dispatchable = dispatchPlan.filter((plan) => plan.blocked !== "no_driver")

  return (
    <AppShell account={account} role="fleet" title="Dispatch" kicker="Assign capacity" orgName={network.activeOrganization.name}>
      <section className="fleet-panel">
        <SectionHeader eyebrow="Next moves" title="Put free trucks on work" />
        {dispatchable.length === 0 ? (
          <EmptyState
            title="No trucks are available right now."
            body="Update availability or review upcoming commitments."
            actionHref="/fleet/availability"
            actionLabel="Update availability"
          />
        ) : (
          <div className="fleet-dispatch-decisions">
            {dispatchable.map((plan) => (
              <article className="fleet-dispatch-decision" key={plan.combinationId}>
                <header>
                  <strong>{plan.label}</strong>
                  <span>{plan.driverName ?? "Unassigned"} · {plan.payload} · {plan.region}</span>
                </header>
                {plan.blocked === "driver_on_trip" ? (
                  <div className="fleet-dispatch-decision__body">
                    <p>{plan.driverName} is on an active trip. This truck frees up when the trip completes.</p>
                    <Link className="action-link action-link--secondary" href="/fleet/trips">Follow the trip</Link>
                  </div>
                ) : plan.suggestion ? (
                  <div className="fleet-dispatch-decision__body">
                    <div className="fleet-dispatch-decision__load">
                      <Badge tone={plan.suggestion.fit === "Strong fit" ? "success" : "warning"}>{plan.suggestion.fit}</Badge>
                      <Link href={opportunityHref(plan.suggestion.loadPostingId)}>{plan.suggestion.title}</Link>
                      {plan.suggestion.partnerLoad ? <Badge tone="info">Partner load</Badge> : null}
                    </div>
                    <p>{plan.suggestion.lane} · {plan.suggestion.scheduleLabel} · {plan.suggestion.payLabel} · {plan.suggestion.remaining} loads open</p>
                    {plan.suggestion.reason ? <p className="fleet-dispatch-decision__reason">{plan.suggestion.reason}</p> : null}
                    {plan.driverProfileId ? (
                      <RequestForTruckButton
                        driverProfileId={plan.driverProfileId}
                        loadPostingId={plan.suggestion.loadPostingId}
                        truckSlotId={plan.suggestion.requestableSlotId}
                      />
                    ) : null}
                  </div>
                ) : (
                  <div className="fleet-dispatch-decision__body">
                    <p>No open load fits this truck right now.</p>
                    <Link className="action-link action-link--secondary" href="/fleet/opportunities">Browse all opportunities</Link>
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="dispatch-board" aria-label="Dispatch lanes">
        {lanes.map((lane) => (
          <article key={lane.title}>
            <h2>{lane.title}</h2>
            {lane.trucks.length === 0 ? (
              <p className="muted">No trucks in this lane.</p>
            ) : (
              lane.trucks.map((truck) => (
                <div className="dispatch-card" key={`${lane.title}-${truck.id}`}>
                  <strong>{truck.unitNumber}</strong>
                  <span>{truck.driverName}</span>
                  <span>{truck.payload} · {truck.region}</span>
                  <Badge tone={truck.status === "available" ? "success" : lane.title === "Exception" ? "critical" : "warning"}>
                    {formatHuman(truck.status)}
                  </Badge>
                </div>
              ))
            )}
          </article>
        ))}
      </section>
    </AppShell>
  )
}

// --- Trucks -----------------------------------------------------------------------

function verificationBadge(verification: string) {
  if (verification === "verified") {
    return <Badge tone="success">Verified</Badge>
  }

  if (verification === "rejected" || verification === "suspended") {
    return <Badge tone="critical">Not approved</Badge>
  }

  return <Badge tone="warning">Review pending</Badge>
}

export function FleetTrucks({
  account,
  driverOptions,
  network,
  trucks
}: FleetShellProps & { driverOptions: DriverOption[]; trucks: FleetTruckRow[] }) {
  return (
    <AppShell account={account} role="fleet" title="Trucks" kicker="Fleet equipment" orgName={network.activeOrganization.name}>
      <section className="fleet-panel">
        <SectionHeader eyebrow="Equipment" title="Active combinations" />
        {trucks.length === 0 ? (
          <EmptyState
            title="No equipment yet."
            body="Add your first truck and trailer combination below. Equipment powers matching, dispatch, and availability."
          />
        ) : (
          <div className="fleet-truck-grid">
            {trucks.map((truck) => (
              <article className="fleet-truck-card" key={truck.combinationId}>
                <header>
                  <div>
                    <span className="card-kicker">{truck.configuration}</span>
                    <h2>{truck.label}</h2>
                  </div>
                  {verificationBadge(truck.verification)}
                </header>
                <div className="fact-row">
                  <span>{truck.payload}</span>
                  <span>{truck.region}</span>
                  <span>{truck.matchCount} matching loads</span>
                </div>
                <div className="fleet-truck-card__controls">
                  <EquipmentStatusSelect combinationId={truck.combinationId} status={truck.combinationStatus} />
                  <DriverAssignSelect
                    combinationId={truck.combinationId}
                    driverProfileId={truck.driverProfileId}
                    options={driverOptions}
                  />
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="fleet-panel fleet-panel--secondary">
        <SectionHeader eyebrow="Grow the fleet" title="Add equipment" />
        <AddEquipmentForm />
      </section>
    </AppShell>
  )
}

// --- Drivers -----------------------------------------------------------------------

function driverTone(status: string): "success" | "warning" | "critical" {
  if (status === "available") {
    return "success"
  }

  if (status === "limited") {
    return "warning"
  }

  return "critical"
}

export function FleetDrivers({ account, drivers, network }: FleetShellProps & { drivers: FleetDriverRow[] }) {
  return (
    <AppShell account={account} role="fleet" title="Drivers" kicker="People and availability" orgName={network.activeOrganization.name}>
      {drivers.length === 0 ? (
        <EmptyState
          title="No drivers in this organization yet."
          body="Invite drivers to your team or assign a driver profile to equipment so their work shows up here."
          actionHref="/fleet/trucks"
          actionLabel="Open trucks"
        />
      ) : (
        <div className="fleet-driver-list">
          {drivers.map((driver) => (
            <article className="fleet-driver-row" key={driver.id}>
              <div className="fleet-driver-row__who">
                <strong>{driver.name}</strong>
                <span>{driver.homeBase} · {driver.yearsExperience} yrs</span>
              </div>
              <div className="fleet-driver-row__state">
                {driver.activeTrip ? (
                  <>
                    <Badge tone="info">{driver.activeTrip.statusLabel}</Badge>
                    <span>{driver.activeTrip.loadTitle}</span>
                  </>
                ) : (
                  <>
                    <Badge tone={driverTone(driver.availabilityStatus)}>{formatHuman(driver.availabilityStatus)}</Badge>
                    <span>{driver.availabilityLabel}</span>
                  </>
                )}
              </div>
              <div className="fleet-driver-row__rig">
                <Icon aria-hidden name="truck.log" size={16} />
                <span>{driver.equipmentLabel ?? "No truck assigned"}</span>
              </div>
            </article>
          ))}
        </div>
      )}
    </AppShell>
  )
}

// --- Availability ---------------------------------------------------------------------

export function FleetAvailability({
  account,
  combinations,
  network
}: FleetShellProps & { combinations: Array<{ id: string; label: string }> }) {
  return (
    <AppShell account={account} role="fleet" title="Availability" kicker="Future capacity" orgName={network.activeOrganization.name}>
      <section className="fleet-panel">
        <SectionHeader eyebrow="Share capacity" title="Publish when trucks are free" />
        {combinations.length === 0 ? (
          <EmptyState
            title="Add equipment first."
            body="Availability windows are published per truck combination. Add a truck to start sharing capacity."
            actionHref="/fleet/trucks"
            actionLabel="Add equipment"
          />
        ) : (
          <AvailabilityPublisher combinations={combinations} />
        )}
      </section>

      <section className="fleet-panel fleet-panel--secondary">
        <SectionHeader eyebrow="Published" title="Upcoming windows" />
        {network.futureAvailability.length === 0 ? (
          <EmptyState
            title="No published windows yet."
            body="Publish a window above so trusted partners can plan work around your free trucks."
          />
        ) : (
          <div className="board-list">
            {network.futureAvailability.map((item) => (
              <article className="trip-row" key={item.id}>
                <div>
                  <strong>{item.equipmentLabel}</strong>
                  <span>{item.windowLabel}{item.notes ? ` · ${item.notes}` : ""}</span>
                </div>
                <Badge tone={item.status === "available" ? "success" : item.status === "unavailable" ? "critical" : "warning"}>
                  {formatHuman(item.status)}
                </Badge>
              </article>
            ))}
          </div>
        )}
      </section>
    </AppShell>
  )
}

// --- Trips -----------------------------------------------------------------------------

function tripBadgeTone(trip: Trip): "success" | "warning" | "critical" | "info" {
  if (trip.status === "completed") {
    return "success"
  }

  if (trip.status === "cancelled") {
    return "critical"
  }

  return "info"
}

export function FleetTrips({ account, network }: FleetShellProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const trips = useMemo(() => {
    return [...network.trips].sort((left, right) => {
      const activeDelta = Number(isActiveTrip(right)) - Number(isActiveTrip(left))

      if (activeDelta !== 0) {
        return activeDelta
      }

      return (lastActivityAt(right) ?? "").localeCompare(lastActivityAt(left) ?? "")
    })
  }, [network.trips])

  return (
    <AppShell account={account} role="fleet" title="Trips" kicker="Moving work" orgName={network.activeOrganization.name}>
      {trips.length === 0 ? (
        <EmptyState
          title="No trips yet."
          body="Approved capacity requests become trips with a live timeline, documents, and delivery proof."
          actionHref="/fleet/dispatch"
          actionLabel="Open dispatch"
        />
      ) : (
        <div className="fleet-trip-list">
          {trips.map((trip) => {
            const lastEvent = trip.events.at(-1)
            const stalled = isStalledTrip(trip)
            const expanded = expandedId === trip.id

            return (
              <article className={`fleet-trip-row${stalled || trip.status === "cancelled" ? " fleet-trip-row--exception" : ""}`} key={trip.id}>
                <div className="fleet-trip-row__main">
                  <div className="fleet-trip-row__who">
                    <strong>{trip.loadTitle}</strong>
                    <span>{trip.driverName}</span>
                  </div>
                  <div className="fleet-trip-row__status">
                    <Badge tone={tripBadgeTone(trip)}>{tripStatusLabel(trip.status)}</Badge>
                    {stalled ? <Badge tone="critical">Stalled</Badge> : null}
                  </div>
                  <div className="fleet-trip-row__last">
                    {lastEvent ? (
                      <span>{formatHuman(lastEvent.type)} · {formatDateTime(lastEvent.occurredAt)}{lastEvent.note ? ` · ${lastEvent.note}` : ""}</span>
                    ) : (
                      <span>No events recorded yet.</span>
                    )}
                  </div>
                  <button
                    aria-expanded={expanded}
                    className="fleet-trip-row__toggle"
                    onClick={() => setExpandedId(expanded ? null : trip.id)}
                    type="button"
                  >
                    {expanded ? "Hide timeline" : `Timeline (${trip.events.length})`}
                  </button>
                </div>
                {expanded ? (
                  <ol className="fleet-trip-timeline">
                    {trip.events.length === 0 ? <li>No events recorded yet.</li> : null}
                    {trip.events.map((event) => (
                      <li key={event.id}>
                        <span className="fleet-trip-timeline__time">{formatDateTime(event.occurredAt)}</span>
                        <span className="fleet-trip-timeline__type">{formatHuman(event.type)}</span>
                        <span className="fleet-trip-timeline__note">{event.note ?? formatHuman(event.source)}</span>
                      </li>
                    ))}
                    {trip.documents.length > 0 ? (
                      <li>
                        <span className="fleet-trip-timeline__time">Documents</span>
                        <span className="fleet-trip-timeline__note">
                          {trip.documents.map((document) => document.filename).join(", ")}
                        </span>
                      </li>
                    ) : null}
                  </ol>
                ) : null}
              </article>
            )
          })}
        </div>
      )}
    </AppShell>
  )
}

// --- Opportunities ------------------------------------------------------------------------

export function FleetOpportunities({ account, network }: FleetShellProps) {
  const [query, setQuery] = useState("")
  const [partnerOnly, setPartnerOnly] = useState(false)
  const openLoads = network.loads.filter((load) => load.status === "open" && load.capacity.remaining > 0)
  const filtered = openLoads.filter((load) => {
    const normalized = query.trim().toLowerCase()
    const matchesQuery = normalized.length === 0 ||
      [load.title, load.landing.city, load.destination.name, load.sourceName].some((value) => value.toLowerCase().includes(normalized))
    const matchesPartner = !partnerOnly || load.visibilityMode === "private_network" || load.visibilityMode === "direct_offer"

    return matchesQuery && matchesPartner
  })

  return (
    <AppShell account={account} role="fleet" title="Opportunities" kicker="Put trucks to work" orgName={network.activeOrganization.name}>
      <section className="discovery-v3" aria-label="Fleet load discovery">
        <div className="filter-bar">
          <label className="search-field-v3">
            <Icon aria-hidden name="action.search" size={18} />
            <span className="sr-only">Search loads</span>
            <input onChange={(event) => setQuery(event.target.value)} placeholder="Search landing, mill, source" type="search" value={query} />
          </label>
          <div className="segmented-v3" aria-label="Source filter">
            <button aria-pressed={!partnerOnly} onClick={() => setPartnerOnly(false)} type="button">All work</button>
            <button aria-pressed={partnerOnly} onClick={() => setPartnerOnly(true)} type="button">Partner loads</button>
          </div>
        </div>
        {filtered.length === 0 ? (
          <EmptyState
            title="No open loads match right now."
            body="Try a different search, check partner relationships, or publish availability so hosts can find you."
            actionHref="/fleet/availability"
            actionLabel="Publish availability"
          />
        ) : (
          <div className="load-list-v3">
            {filtered.map((load) => <LoadCard href={opportunityHref(load.id)} key={load.id} load={load} />)}
          </div>
        )}
      </section>
    </AppShell>
  )
}

// --- Opportunity detail ----------------------------------------------------------------------

export function FleetOpportunityDetail({
  account,
  load,
  network,
  options
}: FleetShellProps & { load: NetworkLoadView | null; options: LoadDispatchOption[] }) {
  return (
    <AppShell account={account} role="fleet" title="Load detail" kicker="Dispatch decision" orgName={network.activeOrganization.name}>
      {!load ? (
        <EmptyState
          title="Load not found."
          body="This load may have been filled or is no longer visible to your organization."
          actionHref="/fleet/opportunities"
          actionLabel="Back to opportunities"
        />
      ) : (
        <main className="fleet-detail">
          <div className="fleet-detail__main">
            <Link className="back-link" href="/fleet/opportunities">Back to opportunities</Link>
            <p className="eyebrow">{load.landing.city} to {load.destination.name}</p>
            <h1>{load.title}</h1>
            <p className="lead">{load.scheduleLabel} · {load.payLabel} · {load.capacity.remaining} of {load.capacity.total} loads open</p>
            <div className="fleet-detail__badges">
              <Badge tone={load.visibilityMode === "private_network" ? "info" : "neutral"}>{visibilityLabel(load)}</Badge>
              <Badge tone={load.capacity.remaining > 0 ? "success" : "warning"}>{load.capacity.remaining > 0 ? "Capacity open" : "All loads assigned"}</Badge>
            </div>
            <div className="fact-row">
              <span>{load.tonsLabel}</span>
              <span>{load.fuelSurchargeLabel}</span>
              <span>Next window: {load.slots.nextWindow}</span>
              <span>Published by {load.sourceName}</span>
            </div>
            {load.equipment.length > 0 ? (
              <p className="fleet-detail__equipment">Requires: {load.equipment.map((item) => formatHuman(item)).join(", ")}</p>
            ) : null}

            {load.warnings.length > 0 ? (
              <section className="fleet-detail__warnings" aria-label="Current conditions">
                {load.warnings.map((warning) => (
                  <p key={warning}><Icon aria-hidden name="status.warning" size={16} /> {warning}</p>
                ))}
              </section>
            ) : null}

            {load.assignments.length > 0 ? (
              <section className="fleet-panel fleet-panel--secondary">
                <SectionHeader eyebrow="Your commitments" title="Assignments on this load" />
                <div className="board-list">
                  {load.assignments.map((assignment) => (
                    <article className="trip-row" key={assignment.id}>
                      <div>
                        <strong>{assignment.driverName}</strong>
                        <span>{assignment.truckUnit}</span>
                      </div>
                      <Badge tone={["accepted", "checked_in", "loading", "hauled", "completed"].includes(assignment.status) ? "success" : "warning"}>
                        {formatHuman(assignment.status)}
                      </Badge>
                    </article>
                  ))}
                </div>
              </section>
            ) : null}
          </div>

          <aside className="fleet-detail__aside">
            <h2>Send a truck</h2>
            {options.length === 0 ? (
              <EmptyState
                title="No truck can take this right now."
                body="Free trucks with assigned drivers show up here. Update equipment status or assign drivers first."
                actionHref="/fleet/trucks"
                actionLabel="Open trucks"
              />
            ) : (
              options.map((option) => (
                <article className="fleet-dispatch-option" key={option.combinationId}>
                  <header>
                    <strong>{option.label}</strong>
                    <Badge tone={option.fit === "Strong fit" ? "success" : option.eligible ? "warning" : "critical"}>{option.fit}</Badge>
                  </header>
                  <span>{option.driverName} · {option.payload}</span>
                  {option.reasons.map((reason) => <p key={reason}>{reason}</p>)}
                  {option.eligible ? (
                    <RequestForTruckButton
                      driverProfileId={option.driverProfileId}
                      loadPostingId={load.id}
                      truckSlotId={load.slots.requestableSlotId}
                    />
                  ) : null}
                </article>
              ))
            )}
          </aside>
        </main>
      )}
    </AppShell>
  )
}

// --- Network -------------------------------------------------------------------------------

export function FleetNetwork({ account, network }: FleetShellProps) {
  const partnerLoads = network.loads.filter((load) =>
    (load.visibilityMode === "private_network" || load.visibilityMode === "direct_offer") && load.status === "open"
  )

  return (
    <AppShell account={account} role="fleet" title="Network" kicker="Partner work" orgName={network.activeOrganization.name}>
      <section className="fleet-panel">
        <SectionHeader eyebrow="Shared with you" title="Partner loads" />
        {partnerLoads.length === 0 ? (
          <EmptyState
            title="No partner loads right now."
            body="Loads shared privately by trusted hosts appear here before the open network sees them."
          />
        ) : (
          <div className="load-list-v3">
            {partnerLoads.map((load) => <LoadCard href={opportunityHref(load.id)} key={load.id} load={load} />)}
          </div>
        )}
      </section>
      <section className="fleet-panel fleet-panel--secondary">
        <SectionHeader eyebrow="Relationships" title="Operating partners" />
        <RelationshipGrid network={network} />
      </section>
    </AppShell>
  )
}
