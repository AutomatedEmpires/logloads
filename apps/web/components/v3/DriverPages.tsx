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
  CancelHaulControl,
  CompletionForm,
  DriverEconomicsForm,
  EquipmentStatusToggle,
  LogProofControl,
  MediaUpload,
  RequestCapacityPanel,
  SignOutButton,
  TripProgressButton
} from "./DriverActions"
import { DecisionPanel, EconomicsPanel, LoadCard, LoadDiscovery, OperatingMap, OperationSections, RoutePackPreview, WeatherWidget } from "./LoadMap"
import { AppShell, EmptyState, Metric, SectionHeader, type ShellAccount } from "./Shells"

interface DriverPageProps {
  account: ShellAccount
  network: NetworkView
}

type TripView = NetworkView["trips"][number]

function isOpenTrip(trip: TripView): boolean {
  return trip.status !== "completed" && trip.status !== "cancelled"
}

/**
 * Mirrors the server window: the delivery can be recorded from the destination
 * onward, and stays open until the host confirms it. A completed haul whose
 * record is still pending or disputed is exactly the case that most needs the
 * form — hiding it would strand the record with no way to author it.
 */
function canRecordDelivery(trip: TripView): boolean {
  return (
    ["at_destination", "unloading", "completed"].includes(trip.status) &&
    trip.status !== "cancelled" &&
    trip.completion.status !== "confirmed"
  )
}

function activeTripFor(network: NetworkView): TripView | null {
  const driverId = network.currentDriver?.id ?? null
  const trips = driverId ? network.trips.filter((trip) => trip.driverProfileId === driverId) : network.trips

  return trips.find(isOpenTrip) ?? null
}

function requestableLoads(network: NetworkView): NetworkLoadView[] {
  return network.loads.filter((load) =>
    load.discovery.available &&
    load.discovery.reason === "available" &&
    !load.viewerAssignment &&
    Boolean(load.slots.requestableSlotId)
  )
}

function matchingLoads(network: NetworkView): NetworkLoadView[] {
  return requestableLoads(network).filter((load) =>
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
  const availableLoads = requestableLoads(network)
  const openHauls = availableLoads.reduce((total, load) => total + load.capacity.remaining, 0)
  const matches = availableLoads.filter((load) => load.compatibility?.eligibility === "strong_match")
  const pendingRequests = network.loads.filter((load) => load.viewerAssignment?.status === "requested").length

  return (
    <AppShell account={account} kicker="Available work" role="driver" title="Loads">
      <section className="driver-flow-summary" aria-label="Your load board summary">
        <div>
          <p className="eyebrow">What can I haul?</p>
          <h2>{openHauls} open {openHauls === 1 ? "haul" : "hauls"}</h2>
          <p>
            {matches.length > 0
              ? `${matches.length} strong ${matches.length === 1 ? "match" : "matches"} for your active truck. Open one to see why it fits.`
              : "Nothing is a perfect match right now. Open a load to see what needs review."}
          </p>
        </div>
        <dl>
          <div><dt>Load postings</dt><dd>{availableLoads.length}</dd></div>
          <div><dt>Strong matches</dt><dd>{matches.length}</dd></div>
          <div><dt>Waiting on hosts</dt><dd>{pendingRequests}</dd></div>
        </dl>
      </section>
      {matches.length > 0 ? (
        <section className="app-section">
          <SectionHeader eyebrow="Best matches" title="Start with the loads that fit your truck" />
          <div className="load-list-v3">
            {matches.map((load) => <LoadCard href={`/driver/loads/${load.id}`} key={load.id} load={load} />)}
          </div>
        </section>
      ) : null}
      <div className="app-section">
        <LoadDiscovery loads={availableLoads} />
      </div>
    </AppShell>
  )
}

export function DriverMap({ account, network }: DriverPageProps) {
  const loads = requestableLoads(network)
  const selected = loads[0] ?? null
  const openHauls = loads.reduce((total, load) => total + load.capacity.remaining, 0)

  return (
    <AppShell account={account} kicker="Your area" role="driver" title="Map">
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
        <>
          <section className="map-availability-bar">
            <div>
              <strong>{openHauls} open {openHauls === 1 ? "haul" : "hauls"}</strong>
              <span>Tap a landing to see pay, timing, distance, and whether your truck matches.</span>
            </div>
            <Link className="action-link action-link--secondary" href="/driver/loads">See load list</Link>
          </section>
          <div className="map-layout map-layout--full">
            <OperatingMap loads={loads} selectedLoadId={selected.id} />
          </div>
        </>
      )}
    </AppShell>
  )
}

const COMPLETION_TONE: Record<string, "success" | "warning" | "critical" | "neutral"> = {
  confirmed: "success",
  disputed: "critical",
  pending: "neutral",
  submitted: "warning"
}

const COMPLETION_LABEL: Record<string, string> = {
  confirmed: "Confirmed by the host",
  disputed: "Host contests this record",
  pending: "No delivery recorded",
  submitted: "Waiting on the host"
}

/** The settled account of a finished haul, as it will read in history. */
function DeliveredRecord({ completion }: { completion: TripView["completion"] }) {
  const delivered = completion.deliveredQuantity

  return (
    <div className="delivered-record">
      <Badge tone={COMPLETION_TONE[completion.status] ?? "neutral"}>
        {COMPLETION_LABEL[completion.status] ?? formatHuman(completion.status)}
      </Badge>
      <p>
        {delivered
          ? `${delivered.value} ${delivered.unit} delivered${delivered.ticketNumber ? ` · ticket ${delivered.ticketNumber}` : ""}`
          : "No delivered quantity was recorded for this haul."}
      </p>
      {completion.exception ? (
        <p className="delivered-record__exception">
          {formatHuman(completion.exception.type)}: {completion.exception.note}
        </p>
      ) : null}
      {completion.disputeReason ? (
        <p className="delivered-record__exception">Host: {completion.disputeReason}</p>
      ) : null}
    </div>
  )
}

function TripCard({ network, trip }: { network: NetworkView; trip: TripView }) {
  const load = network.loads.find((item) => item.id === trip.loadPostingId) ?? null
  const lastEvent = trip.events[trip.events.length - 1] ?? null
  const open = isOpenTrip(trip)
  const isOwnHaul = trip.driverProfileId === network.currentDriver?.id

  return (
    <article className="trip-card">
      <header>
        <div>
          <span className="card-kicker">{load ? `${load.landing.city} to ${load.destination.name}` : "Assignment"}</span>
          <strong>{trip.loadTitle}</strong>
        </div>
        <Badge tone={trip.status === "completed" ? "success" : trip.status === "cancelled" ? "critical" : "warning"}>
          {trip.status === "assigned" ? "Booked" : tripStatusLabel(trip.status)}
        </Badge>
      </header>
      <p className="trip-card__event">
        {lastEvent ? `Last update: ${lastEvent.note ?? lastEvent.type} · ${formatDateTime(lastEvent.occurredAt)}` : "This haul is booked. Start it when you head to the landing."}
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
          {/* Recorded at the destination, while the driver is standing at the
              scale — not reconstructed from memory later. */}
          {canRecordDelivery(trip) && isOwnHaul ? (
            <CompletionForm completion={trip.completion} tripId={trip.id} />
          ) : null}
          {isOwnHaul ? <CancelHaulControl assignmentId={trip.assignmentId} kind="haul" /> : null}
        </div>
      ) : null}
      {trip.status === "completed" ? (
        <>
          <DeliveredRecord completion={trip.completion} />
          {/* A haul closed before its delivery was recorded, or a figure the
              host disputed, must still be answerable — otherwise the record is
              stranded with no way to author it. */}
          {canRecordDelivery(trip) && isOwnHaul ? (
            <div className="trip-card__actions">
              <LogProofControl tripId={trip.id} />
              <CompletionForm completion={trip.completion} tripId={trip.id} />
            </div>
          ) : null}
        </>
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
      {load ? <Link className="text-link" href={`/driver/loads/${load.id}`}>Open haul details</Link> : null}
    </article>
  )
}

function RequestedHaulCard({ load }: { load: NetworkLoadView }) {
  const isOffer = load.viewerAssignment?.status === "offered"

  return (
    <article className="schedule-request-card">
      <header>
        <div>
          <span className="card-kicker">{load.landing.city} to {load.destination.name}</span>
          <strong>{load.economics.grossLabel ? `${load.economics.grossLabel} est. gross` : load.payLabel}</strong>
        </div>
        <Badge tone={isOffer ? "info" : "warning"}>{isOffer ? "Offered to you" : "Host deciding"}</Badge>
      </header>
      <h3>{load.title}</h3>
      <div className="schedule-request-card__facts">
        <span>{load.scheduleLabel}</span>
        <span>{load.route.distanceMiles.toFixed(0)} miles</span>
        <span>{load.capacity.remaining} of {load.capacity.total} still open</span>
      </div>
      <p>{isOffer ? "Review the load and decide whether it works for you." : "Your request is sent. We will notify you when the host makes a decision."}</p>
      <div className="primary-action-row">
        <Link className="action-link action-link--secondary" href={`/driver/loads/${load.id}`}>Open request</Link>
        {load.viewerAssignment ? (
          <CancelHaulControl assignmentId={load.viewerAssignment.id} kind="request" />
        ) : null}
      </div>
    </article>
  )
}

function DecisionHaulCard({ load }: { load: NetworkLoadView }) {
  return (
    <article className="schedule-request-card">
      <header>
        <div>
          <span className="card-kicker">{load.landing.city} to {load.destination.name}</span>
          <strong>{load.economics.grossLabel ? `${load.economics.grossLabel} est. gross` : load.payLabel}</strong>
        </div>
        <Badge tone="info">Not selected</Badge>
      </header>
      <h3>{load.title}</h3>
      <p>The host chose another truck for that request. This is a decision, not a booked or cancelled haul.</p>
      <div className="primary-action-row">
        <Link className="action-link" href="/driver/loads">Find another load</Link>
        {load.capacity.remaining > 0 && load.slots.requestableSlotId ? (
          <Link className="action-link action-link--secondary" href={`/driver/loads/${load.id}`}>See reopened load</Link>
        ) : null}
      </div>
    </article>
  )
}

export function DriverSchedule({ account, network }: DriverPageProps) {
  const requestedLoads = network.loads.filter((load) => ["requested", "offered"].includes(load.viewerAssignment?.status ?? ""))
  const decisionLoads = network.loads.filter((load) => load.viewerDecision?.status === "declined")
  const bookedTrips = network.trips.filter((trip) => trip.status === "assigned")
  const activeTrips = network.trips.filter((trip) => isOpenTrip(trip) && trip.status !== "assigned")
  const completedTrips = network.trips.filter((trip) => trip.status === "completed")
  const cancelledTrips = network.trips.filter((trip) => trip.status === "cancelled")
  const doingNow = bookedTrips.length + activeTrips.length

  return (
    <AppShell account={account} kicker="Your work" role="driver" title="Schedule">
      <section className="schedule-summary" aria-label="Schedule summary">
        <div>
          <p className="eyebrow">What am I doing?</p>
          <h2>{doingNow === 0 ? "No hauls booked yet" : `${doingNow} ${doingNow === 1 ? "haul" : "hauls"} on your schedule`}</h2>
          <p>{requestedLoads.length === 0 ? "No host decisions are pending." : `${requestedLoads.length} ${requestedLoads.length === 1 ? "request is" : "requests are"} waiting on a host decision.`}</p>
        </div>
        <div className="schedule-counts">
          <span><strong>{requestedLoads.length}</strong> Requested</span>
          <span><strong>{bookedTrips.length}</strong> Booked</span>
          <span><strong>{activeTrips.length}</strong> In progress</span>
          <span><strong>{completedTrips.length}</strong> Completed</span>
        </div>
      </section>

      {requestedLoads.length === 0 && decisionLoads.length === 0 && network.trips.length === 0 ? (
        <div className="app-section">
          <EmptyState
            title="Nothing scheduled yet."
            body="Find a load that matches your truck and request the haul. You will see the host's decision and every next step here."
            actionHref="/driver/loads"
            actionLabel="Find loads"
          />
        </div>
      ) : (
        <>
          {requestedLoads.length > 0 ? (
            <section className="app-section">
              <SectionHeader eyebrow="Waiting on a decision" title="Requested hauls" />
              <div className="schedule-request-list">
                {requestedLoads.map((load) => <RequestedHaulCard key={load.id} load={load} />)}
              </div>
            </section>
          ) : null}
          {decisionLoads.length > 0 ? (
            <section className="app-section">
              <SectionHeader eyebrow="Host decisions" title="Not selected" />
              <div className="schedule-request-list">
                {decisionLoads.map((load) => <DecisionHaulCard key={load.id} load={load} />)}
              </div>
            </section>
          ) : null}
          {activeTrips.length > 0 ? (
            <section className="app-section">
              <SectionHeader eyebrow="In progress" title="Do the next step shown" />
              <div className="board-list board-list--flush">
                {activeTrips.map((trip) => <TripCard key={trip.id} network={network} trip={trip} />)}
              </div>
            </section>
          ) : null}
          {bookedTrips.length > 0 ? (
            <section className="app-section">
              <SectionHeader eyebrow="You got it" title="Booked next" />
              <div className="board-list board-list--flush">
                {bookedTrips.map((trip) => <TripCard key={trip.id} network={network} trip={trip} />)}
              </div>
            </section>
          ) : null}
          {completedTrips.length > 0 ? (
            <section className="app-section">
              <SectionHeader eyebrow="Completed" title="Delivered hauls" />
              <div className="board-list board-list--flush">
                {completedTrips.map((trip) => <TripCard key={trip.id} network={network} trip={trip} />)}
              </div>
            </section>
          ) : null}
          {cancelledTrips.length > 0 ? (
            <section className="app-section">
              <SectionHeader eyebrow="History" title="Cancelled hauls" />
              <div className="board-list board-list--flush">
                {cancelledTrips.map((trip) => <TripCard key={trip.id} network={network} trip={trip} />)}
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
    <AppShell account={account} kicker="Your setup" role="driver" title="Profile">
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
        <SectionHeader eyebrow="Fuel" title="Make earnings estimates yours" />
        <p className="muted">Add your truck MPG and current diesel price. LogLoads shows gross after estimated fuel—not profit—and labels every assumption.</p>
        <DriverEconomicsForm
          currentFuelEconomyMpg={network.currentEquipment?.fuelEconomyMpg ?? null}
          currentFuelPriceCentsPerGallon={network.currentDriver?.preferredFuelPriceCentsPerGallon ?? null}
        />
      </section>
      <section className="app-section">
        <SectionHeader eyebrow="Photos" title="Show your driver and primary equipment" />
        <div className="media-upload-grid">
          <MediaUpload hasCurrent={network.currentDriver?.hasProfilePhoto ?? false} kind="profile" label="Profile photo" />
          <MediaUpload hasCurrent={network.currentEquipment?.hasTruckPhoto ?? false} kind="truck" label="Truck photo" />
          {network.currentDriver?.trailerId ? (
            <MediaUpload hasCurrent={network.currentEquipment?.hasTrailerPhoto ?? false} kind="trailer" label="Trailer photo" />
          ) : null}
        </div>
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
          <Link href="/driver/schedule">
            <strong>Schedule</strong>
            <span>{network.trips.length === 0 ? "No hauls on your schedule" : `${network.trips.length} hauls on record`}</span>
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
    <AppShell account={account} kicker="Can I haul this?" role="driver" title="Load details">
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
            <div className="load-decision-lead">
              <strong>{load.economics.grossLabel ? `${load.economics.grossLabel} est. gross` : load.payLabel}</strong>
              {load.economics.grossLabel ? <span>Base {load.payLabel} · {load.fuelSurchargeLabel}</span> : null}
              <span>{load.scheduleLabel}</span>
              <span>{load.route.distanceMiles.toFixed(0)} miles</span>
              <span>{load.capacity.remaining} of {load.capacity.total} hauls open</span>
            </div>
            <EconomicsPanel load={load} />
            <WeatherWidget loadId={load.id} />
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
