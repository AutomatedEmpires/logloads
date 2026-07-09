"use client"

import Link from "next/link"
import { Badge, Icon } from "@logloads/ui"

import type { DriverAvailabilitySummary } from "@/lib/driver-data"
import type { NetworkLoadView, NetworkView } from "@/lib/network"
import type { VerificationRecordView } from "@/lib/verification-data"
import { formatDateTime, formatHuman, tripStatusLabel } from "@/lib/v3-shared"
import { RelationshipGrid } from "./Common"
import { ReputationChip, TripReviewForm } from "./Reputation"
import { VerificationSubmit, type VerificationTypeOption } from "./VerificationSubmit"
import {
  AddEquipmentForm,
  AvailabilityQuickSet,
  EquipmentStatusToggle,
  LogProofControl,
  RequestCapacityPanel,
  SignOutButton,
  TripProgressButton
} from "./DriverActions"
import { DecisionPanel, LoadCard, LoadDiscovery, OperatingMap, OperationSections, RoutePackPreview } from "./LoadMap"
import { AppShell, EmptyState, Metric, SectionHeader, type ShellAccount } from "./Shells"

interface DriverPageProps {
  account: ShellAccount
  network: NetworkView
}

type TripView = NetworkView["trips"][number]

function isOpenTrip(trip: TripView): boolean {
  return trip.status !== "completed" && trip.status !== "cancelled"
}

function activeTripFor(network: NetworkView): TripView | null {
  const driverId = network.currentDriver?.id ?? null
  const trips = driverId ? network.trips.filter((trip) => trip.driverProfileId === driverId) : network.trips

  return trips.find(isOpenTrip) ?? null
}

function matchingLoads(network: NetworkView): NetworkLoadView[] {
  return network.loads.filter((load) =>
    ["open", "scheduled"].includes(load.status) &&
    load.capacity.remaining > 0 &&
    !load.viewerAssignment &&
    (!load.compatibility || load.compatibility.eligibility !== "ineligible")
  )
}

function recommendBandTone(band: NetworkView["topRecommendations"][number]["band"]): "success" | "warning" | "info" | "neutral" {
  if (band === "top_pick" || band === "strong") {
    return "success"
  }

  if (band === "worth_review") {
    return "warning"
  }

  return "info"
}

export function RecommendedLoads({ recommendations }: { recommendations: NetworkView["topRecommendations"] }) {
  return (
    <ol className="recommend-list">
      {recommendations.map((rec, index) => (
        <li key={rec.loadId}>
          <Link className="recommend-card" href={`/driver/loads/${rec.loadId}`}>
            <span aria-hidden className="recommend-rank">{index + 1}</span>
            <div className="recommend-body">
              <div className="recommend-head">
                <strong>{rec.title}</strong>
                <Badge tone={recommendBandTone(rec.band)}>{rec.label}</Badge>
              </div>
              <span className="recommend-lane">
                <Icon aria-hidden name="load.origin" size={14} /> {rec.lane}
              </span>
              <span className="recommend-meta">{rec.scheduleLabel} · {rec.payLabel}</span>
              <ul className="recommend-reasons">
                {rec.reasons.map((reason) => (
                  <li key={reason}>
                    <Icon aria-hidden name="status.assigned" size={13} /> {reason}
                  </li>
                ))}
              </ul>
            </div>
            <span className="recommend-go">View load</span>
          </Link>
        </li>
      ))}
    </ol>
  )
}

function verificationBadge(status: string): { label: string; tone: "success" | "warning" | "critical" } {
  if (status === "verified") {
    return { label: "Verified", tone: "success" }
  }

  if (status === "rejected") {
    return { label: "Not approved", tone: "critical" }
  }

  if (status === "suspended") {
    return { label: "Suspended", tone: "critical" }
  }

  return { label: "Review pending", tone: "warning" }
}

function TodayActiveTrip({ load, network, trip }: { load: NetworkLoadView | null; network: NetworkView; trip: TripView }) {
  const headingToLanding = ["assigned", "en_route_to_landing", "checked_in", "loading"].includes(trip.status)
  const stop = load ? (headingToLanding ? load.landing : load.destination) : null
  const lastEvent = trip.events[trip.events.length - 1] ?? null
  const criticalNotice = network.notices.find(
    (notice) => notice.severity === "critical" && notice.relatedLoadId === trip.loadPostingId
  ) ?? null
  const interrupt = criticalNotice ? `${criticalNotice.title}: ${criticalNotice.body}` : load?.warnings[0] ?? null

  return (
    <section className="driver-now">
      <p className="eyebrow">Now hauling</p>
      <h2>{load?.title ?? trip.loadTitle}</h2>
      {stop ? (
        <p className="now-stop">
          <Icon aria-hidden name={headingToLanding ? "map.landing" : "map.destination"} size={18} />
          <span>Next stop: {stop.name} · {stop.city}, {stop.state}</span>
        </p>
      ) : (
        <p className="now-stop">Dispatch holds the full load record for this move.</p>
      )}
      <div className="now-grid">
        <Metric label="Route miles" value={load ? Math.round(load.route.distanceMiles) : "—"} />
        <Metric label="Status" value={tripStatusLabel(trip.status)} />
        <Metric label="Last update" value={lastEvent ? formatDateTime(lastEvent.occurredAt) : "No updates yet"} />
      </div>
      {interrupt ? (
        <div className="interrupt">
          <Icon aria-hidden name="status.warning" size={18} />
          <span>{interrupt}</span>
        </div>
      ) : null}
      <TripProgressButton status={trip.status} tone="hero" tripId={trip.id} />
      <div className="primary-action-row">
        <Link className="action-link action-link--secondary" href={`/driver/loads/${trip.loadPostingId}`}>Open Route Pack</Link>
        <Link className="action-link action-link--secondary" href="/driver/messages">Message dispatch</Link>
      </div>
    </section>
  )
}

export function DriverToday({ account, availability, network }: DriverPageProps & { availability: DriverAvailabilitySummary }) {
  const activeTrip = activeTripFor(network)
  const activeLoad = activeTrip ? network.loads.find((load) => load.id === activeTrip.loadPostingId) ?? null : null
  const matches = matchingLoads(network)

  return (
    <AppShell account={account} kicker="Driver cockpit" role="driver" title="Today">
      {activeTrip ? (
        <TodayActiveTrip load={activeLoad} network={network} trip={activeTrip} />
      ) : (
        <>
          <section className="driver-now driver-now--clear">
            <p className="eyebrow">Today</p>
            <h2>You&apos;re clear right now.</h2>
            <p>
              {matches.length === 0
                ? "No open loads fit your setup yet. Keep your availability current so new work finds you."
                : `${matches.length} open ${matches.length === 1 ? "load fits" : "loads fit"} your setup.`}
            </p>
            <div className="primary-action-row">
              <Link className="action-link" href="/driver/loads">Find loads</Link>
            </div>
          </section>
          <section className="app-section availability-panel">
            <SectionHeader eyebrow="Availability" title="Tell hosts when you can haul" />
            <AvailabilityQuickSet
              currentStatus={availability.current?.status ?? null}
              currentWindow={availability.current?.windowLabel ?? null}
              hasDriverProfile={Boolean(network.currentDriver)}
            />
          </section>
          <section className="app-section">
            <SectionHeader
              action={<Link className="action-link action-link--secondary" href="/driver/loads">See all loads</Link>}
              eyebrow="Recommended for you"
              title="Best work for your truck right now"
            />
            {network.topRecommendations.length > 0 ? (
              <RecommendedLoads recommendations={network.topRecommendations} />
            ) : matches.length === 0 ? (
              <EmptyState
                title="No loads fit your current setup."
                body="Add your truck so matching can work with real equipment details, then recommendations appear here ranked for you."
                actionHref="/driver/equipment"
                actionLabel="Update equipment"
              />
            ) : (
              <div className="load-card-grid">
                {matches.slice(0, 3).map((load) => <LoadCard href={`/driver/loads/${load.id}`} key={load.id} load={load} />)}
              </div>
            )}
          </section>
        </>
      )}
    </AppShell>
  )
}

export function DriverLoads({ account, network }: DriverPageProps) {
  return (
    <AppShell account={account} kicker="Find work" role="driver" title="Loads">
      {network.topRecommendations.length > 0 ? (
        <section className="app-section">
          <SectionHeader eyebrow="Recommended for you" title="Ranked for your truck" />
          <RecommendedLoads recommendations={network.topRecommendations} />
        </section>
      ) : null}
      <div className="app-section">
        <LoadDiscovery loads={network.loads} />
      </div>
    </AppShell>
  )
}

export function DriverMap({ account, network }: DriverPageProps) {
  const loads = network.loads.filter((load) => ["open", "scheduled"].includes(load.status))
  const selected = loads[0] ?? null

  return (
    <AppShell account={account} kicker="Nearby work" role="driver" title="Map">
      {!selected ? (
        <div className="app-section">
          <EmptyState
            title="No loads to map yet."
            body="When hosts publish work in your operating area, landings and mills show up here with approximate locations."
            actionHref="/driver/loads"
            actionLabel="Open the load board"
          />
        </div>
      ) : (
        <div className="map-layout map-layout--full">
          <OperatingMap loads={loads} selectedLoadId={selected.id} />
        </div>
      )}
    </AppShell>
  )
}

function TripCard({ network, trip }: { network: NetworkView; trip: TripView }) {
  const load = network.loads.find((item) => item.id === trip.loadPostingId) ?? null
  const lastEvent = trip.events[trip.events.length - 1] ?? null
  const open = isOpenTrip(trip)

  return (
    <article className="trip-card">
      <header>
        <div>
          <span className="card-kicker">{load ? `${load.landing.city} to ${load.destination.name}` : "Assignment"}</span>
          <strong>{trip.loadTitle}</strong>
        </div>
        <Badge tone={trip.status === "completed" ? "success" : trip.status === "cancelled" ? "critical" : "warning"}>
          {tripStatusLabel(trip.status)}
        </Badge>
      </header>
      <p className="trip-card__event">
        {lastEvent ? `${lastEvent.note ?? lastEvent.type} · ${formatDateTime(lastEvent.occurredAt)}` : "No trip events logged yet."}
      </p>
      {trip.documents.length > 0 ? (
        <ul className="doc-list">
          {trip.documents.map((document) => (
            <li key={document.id}>
              <Icon aria-hidden name="ops.document" size={14} />
              <span>{document.filename}</span>
              <em>{document.type}</em>
            </li>
          ))}
        </ul>
      ) : null}
      {open ? (
        <div className="trip-card__actions">
          <TripProgressButton status={trip.status} tripId={trip.id} />
          <LogProofControl tripId={trip.id} />
        </div>
      ) : null}
      {trip.reviewable ? (
        trip.reviewable.alreadyReviewed ? (
          <p className="review-done">
            <Icon aria-hidden name="status.verified" size={16} /> You reviewed {trip.reviewable.counterpartyName}.
          </p>
        ) : (
          <TripReviewForm
            counterpartyName={trip.reviewable.counterpartyName}
            direction={trip.reviewable.direction}
            tripId={trip.id}
          />
        )
      ) : null}
      {load ? <Link className="text-link" href={`/driver/loads/${load.id}`}>Route Pack and load detail</Link> : null}
    </article>
  )
}

export function DriverTrips({ account, network }: DriverPageProps) {
  const openTrips = network.trips.filter(isOpenTrip)
  const closedTrips = network.trips.filter((trip) => !isOpenTrip(trip))

  return (
    <AppShell account={account} kicker="Haul actions" role="driver" title="Trips">
      {network.trips.length === 0 ? (
        <div className="app-section">
          <EmptyState
            title="You're clear right now."
            body="Request capacity on a load that fits and your haul shows up here with its next action."
            actionHref="/driver/loads"
            actionLabel="Find loads"
          />
        </div>
      ) : (
        <>
          {openTrips.length > 0 ? (
            <section className="app-section">
              <SectionHeader eyebrow="In motion" title="One next action per haul" />
              <div className="board-list board-list--flush">
                {openTrips.map((trip) => <TripCard key={trip.id} network={network} trip={trip} />)}
              </div>
            </section>
          ) : (
            <section className="app-section">
              <EmptyState
                title="Nothing in motion."
                body="Your open hauls appear here with their next action the moment a host accepts your request."
                actionHref="/driver/loads"
                actionLabel="Find loads"
              />
            </section>
          )}
          {closedTrips.length > 0 ? (
            <section className="app-section">
              <SectionHeader eyebrow="Delivered" title="Closed hauls and their records" />
              <div className="board-list board-list--flush">
                {closedTrips.map((trip) => <TripCard key={trip.id} network={network} trip={trip} />)}
              </div>
            </section>
          ) : null}
        </>
      )}
    </AppShell>
  )
}

export function DriverEquipment({ account, network }: DriverPageProps) {
  return (
    <AppShell account={account} kicker="Garage" role="driver" title="Equipment">
      <section className="app-section">
        <SectionHeader eyebrow="Active setup" title="What you run decides what you see" />
        {network.trucks.length === 0 ? (
          <EmptyState
            title="Add your first truck."
            body="Equipment powers matching, availability, and assignments. Fill in the combination below to start seeing work that fits."
          />
        ) : (
          <div className="truck-grid">
            {network.trucks.map((truck) => {
              const verification = verificationBadge(truck.verification)

              return (
                <article className="truck-card-v3" key={truck.id}>
                  <span>{truck.unitNumber}</span>
                  <h2>{truck.configuration}</h2>
                  <p>{truck.driverName}</p>
                  <div className="fact-row">
                    <span>{truck.payload}</span>
                    <span>{truck.region}</span>
                    <span>{truck.matchCount} matching loads</span>
                  </div>
                  <div className="truck-card-v3__badges">
                    <Badge tone={verification.tone}>{verification.label}</Badge>
                    <ReputationChip reputation={truck.reputation} />
                  </div>
                  <EquipmentStatusToggle combinationId={truck.id} status={truck.status} />
                </article>
              )
            })}
          </div>
        )}
      </section>
      <section className="app-section">
        <SectionHeader eyebrow="Add equipment" title="Add a truck and trailer combination" />
        <AddEquipmentForm />
      </section>
    </AppShell>
  )
}

export function DriverNetwork({ account, network }: DriverPageProps) {
  return (
    <AppShell account={account} kicker="Trusted work" role="driver" title="Network">
      <RelationshipGrid network={network} />
    </AppShell>
  )
}

const DRIVER_VERIFICATION_OPTIONS: VerificationTypeOption[] = [
  { value: "identity", label: "Identity", hint: "A driver's license or government ID number a reviewer can confirm." },
  { value: "contact", label: "Contact details", hint: "A phone number or email we can reach you at for dispatch." }
]

export function DriverProfile({
  account,
  availability,
  network,
  verifications
}: DriverPageProps & { availability: DriverAvailabilitySummary; verifications: VerificationRecordView[] }) {
  const verification = verificationBadge(network.activeOrganization.verificationStatus)

  return (
    <AppShell account={account} kicker="Profile" role="driver" title="Me">
      <section className="profile-panel">
        <div className="profile-head">
          <div>
            <h2>{network.currentDriver?.name ?? account.userName}</h2>
            <p className="muted">{account.organizationName} · {formatHuman(network.activeOrganization.role)}</p>
          </div>
          <div className="profile-head__badges">
            <Badge tone={verification.tone}>{verification.label}</Badge>
            <ReputationChip reputation={network.activeOrganization.reputation} />
          </div>
        </div>
        <dl>
          <div>
            <dt>Driver record</dt>
            <dd>{network.currentDriver ? "On file" : "Not set up"}</dd>
          </div>
          <div>
            <dt>Active equipment</dt>
            <dd>{network.currentEquipment?.label ?? "None assigned"}</dd>
          </div>
          <div>
            <dt>Availability now</dt>
            <dd>{availability.current ? formatHuman(availability.current.status) : "Not posted"}</dd>
          </div>
        </dl>
      </section>
      <section className="app-section availability-panel">
        <SectionHeader eyebrow="Availability" title="Keep your window current" />
        <AvailabilityQuickSet
          currentStatus={availability.current?.status ?? null}
          currentWindow={availability.current?.windowLabel ?? null}
          hasDriverProfile={Boolean(network.currentDriver)}
        />
        {availability.upcoming.length > 0 ? (
          <ul className="availability-list">
            {availability.upcoming.map((window) => (
              <li key={window.id}>
                <Badge tone={window.status === "available" ? "success" : window.status === "unavailable" ? "critical" : "warning"}>
                  {formatHuman(window.status)}
                </Badge>
                <span>{window.windowLabel}</span>
                {window.notes ? <em>{window.notes}</em> : null}
              </li>
            ))}
          </ul>
        ) : null}
      </section>
      <section className="app-section">
        <SectionHeader eyebrow="Trust" title="Get verified" />
        <VerificationSubmit options={DRIVER_VERIFICATION_OPTIONS} records={verifications} subjectType="person" />
      </section>
      <section className="app-section">
        <SectionHeader eyebrow="Account" title="Shortcuts" />
        <div className="choice-grid">
          <Link href="/driver/equipment">
            <strong>Equipment</strong>
            <span>{network.currentEquipment ? network.currentEquipment.label : "Add your truck and trailer"}</span>
          </Link>
          <Link href="/driver/trips">
            <strong>Trips</strong>
            <span>{network.trips.length === 0 ? "No hauls on record yet" : `${network.trips.length} on record`}</span>
          </Link>
          <Link href="/driver/messages">
            <strong>Messages</strong>
            <span>{network.messages.length === 0 ? "No threads yet" : `${network.messages.length} threads`}</span>
          </Link>
        </div>
        <div className="signout-row">
          <SignOutButton />
        </div>
      </section>
    </AppShell>
  )
}

export function FitWorkList({ network }: { network: NetworkView }) {
  return (
    <div className="load-card-grid">
      {matchingLoads(network).slice(0, 4).map((load) => <LoadCard href={`/driver/loads/${load.id}`} key={load.id} load={load} />)}
    </div>
  )
}

export function DriverLoadDetail({ account, loadId, network }: DriverPageProps & { loadId: string }) {
  const load = network.loads.find((item) => item.id === loadId)

  return (
    <AppShell account={account} kicker="Request decision" role="driver" title="Load detail">
      {!load ? (
        <div className="app-section">
          <EmptyState
            title="Load not found."
            body="This load may have been filled, closed, or made private since you last saw it."
            actionHref="/driver/loads"
            actionLabel="Back to loads"
          />
        </div>
      ) : (
        <main className="detail-layout detail-layout--app">
          <div className="detail-main">
            <Link className="back-link" href="/driver/loads">Back to loads</Link>
            <p className="eyebrow">{load.landing.city} to {load.destination.name} · {load.sourceName}</p>
            <h1>{load.title}</h1>
            <p className="lead">{load.scheduleLabel} · {load.payLabel} · {load.tonsLabel}</p>
            <DecisionPanel load={load} />
            <RoutePackPreview load={load} locked={!load.access.unlocked} />
            <OperationSections load={load} />
          </div>
          <aside className="sticky-action">
            <RequestCapacityPanel load={load} />
          </aside>
        </main>
      )}
    </AppShell>
  )
}
