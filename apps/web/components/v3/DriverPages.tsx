"use client"

import Link from "next/link"
import { Badge, Icon } from "@logloads/ui"

import type { DriverAvailabilitySummary } from "@/lib/driver-data"
import type { CredentialVaultView } from "@/lib/credential-data"
import type { NetworkLoadView, NetworkView } from "@/lib/network"
import type { VerificationRecordView } from "@/lib/verification-data"
import { payHeadline, presentPay } from "@/lib/pay-display"
import { formatHuman, pluralize, tripStatusLabel } from "@/lib/v3-shared"
import { LocalTime, RelationshipGrid } from "./Common"
import { CredentialVault } from "./CredentialVault"
import { ReputationChip, TripReviewForm } from "./Reputation"
import { VerificationSubmit, type VerificationTypeOption } from "./VerificationSubmit"
import {
  AddEquipmentForm,
  AvailabilityQuickSet,
  CancelHaulControl,
  CompletionForm,
  DriverPaymentReceiptControl,
  DriverEconomicsForm,
  EquipmentStatusToggle,
  FeatureTruckPhotoToggle,
  LogProofControl,
  MediaUpload,
  nextFieldStepLabel,
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
  const mostRecentlyUpdated = (left: TripView, right: TripView) =>
    (right.lastSyncedAt ?? right.events.at(-1)?.occurredAt ?? "")
      .localeCompare(left.lastSyncedAt ?? left.events.at(-1)?.occurredAt ?? "")
  const inProgress = trips
    .filter((trip) => isOpenTrip(trip) && trip.status !== "assigned")
    .sort(mostRecentlyUpdated)

  // A future booking must never displace a haul that is already moving. When
  // no haul is in progress, the most recent assigned trip becomes the clear
  // "booked next" fallback.
  return inProgress[0] ?? trips.filter((trip) => trip.status === "assigned").sort(mostRecentlyUpdated)[0] ?? null
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

export function driverLoadBoardPresentation(loads: readonly NetworkLoadView[]): {
  orderedLoads: NetworkLoadView[]
  strongMatchCount: number
} {
  const strongMatches = loads.filter((load) => load.compatibility?.eligibility === "strong_match")
  const otherLoads = loads.filter((load) => load.compatibility?.eligibility !== "strong_match")

  return {
    orderedLoads: [...strongMatches, ...otherLoads],
    strongMatchCount: strongMatches.length
  }
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
  const isBookedNext = trip.status === "assigned"
  const headingToLanding = ["assigned", "en_route_to_landing", "checked_in", "loading"].includes(trip.status)
  const stop = load ? (headingToLanding ? load.landing : load.destination) : null
  const lastEvent = trip.events[trip.events.length - 1] ?? null
  const criticalNotice = network.notices.find(
    (notice) => notice.severity === "critical" && notice.relatedLoadId === trip.loadPostingId
  ) ?? null
  const interrupt = criticalNotice ? `${criticalNotice.title}: ${criticalNotice.body}` : load?.warnings[0] ?? null

  return (
    <section className="driver-now">
      <p className="eyebrow">{isBookedNext ? "Booked next" : "Now hauling"}</p>
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
        <Metric
          label="Last update"
          value={lastEvent ? <LocalTime value={lastEvent.occurredAt} /> : "No updates yet"}
        />
      </div>
      {/* The pre-trip state used to sit here as a metric reading "Required"
          over the label "Pre-trip" — a required action wearing a statistic's
          clothes, and backwards to read. It is an instruction, in the same
          words the Schedule uses and above the control that performs it. */}
      <p className="trip-card__next">
        <Icon aria-hidden name="ops.queue" size={16} />
        <span>
          <strong>Next step:</strong> {nextStepForTrip(trip)}
        </span>
      </p>
      {interrupt ? (
        <div className="interrupt">
          <Icon aria-hidden name="status.warning" size={18} />
          <span>{interrupt}</span>
        </div>
      ) : null}
      <TripProgressButton
        completionStatus={trip.completion.status}
        inspectionPassed={trip.inspection?.outcome === "pass"}
        status={trip.status}
        tone="hero"
        tripId={trip.id}
      />
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
  const { orderedLoads, strongMatchCount } = driverLoadBoardPresentation(availableLoads)
  const pendingRequests = network.loads.filter((load) => load.viewerAssignment?.status === "requested").length

  return (
    <AppShell account={account} kicker="Available work" role="driver" title="Loads">
      <section className="driver-flow-summary" aria-label="Your load board summary">
        <div>
          <p className="eyebrow">What can I haul?</p>
          <h2>{openHauls} open {openHauls === 1 ? "haul" : "hauls"}</h2>
          <p>
            {strongMatchCount > 0
              ? `${strongMatchCount} strong ${strongMatchCount === 1 ? "match" : "matches"} for your active truck. Open one to see why it fits.`
              : "Nothing is a perfect match right now. Open a load to see what needs review."}
          </p>
        </div>
        <dl>
          <div><dt>Load postings</dt><dd>{availableLoads.length}</dd></div>
          <div><dt>Strong matches</dt><dd>{strongMatchCount}</dd></div>
          <div><dt>Waiting on hosts</dt><dd>{pendingRequests}</dd></div>
        </dl>
      </section>
      <section className="app-section driver-load-discovery">
        {availableLoads.length === 0 ? (
          <EmptyState
            title="No open loads are available right now."
            body="There is no requestable host work on the board at the moment. Keep your equipment and availability current so the next matching load is useful when it appears."
            actionHref="/driver/profile"
            actionLabel="Review my readiness"
          />
        ) : (
          <>
            <SectionHeader
              eyebrow={strongMatchCount > 0 ? "Best matches first" : "Open work"}
              title={strongMatchCount > 0 ? "Compare every open load in one board" : "Find work that fits your day"}
            />
            <LoadDiscovery loads={orderedLoads} />
          </>
        )}
      </section>
    </AppShell>
  )
}

export function DriverMap({ account, network }: DriverPageProps) {
  const requestable = requestableLoads(network)
  const activeTrip = activeTripFor(network)
  const activeLoad = activeTrip ? network.loads.find((load) => load.id === activeTrip.loadPostingId) ?? null : null
  const loads = activeLoad ? [activeLoad, ...requestable.filter((load) => load.id !== activeLoad.id)] : requestable
  const selected = activeLoad ?? loads[0] ?? null
  const openHauls = requestable.reduce((total, load) => total + load.capacity.remaining, 0)

  return (
    <AppShell account={account} kicker="Your area" role="driver" title="Map">
      {activeTrip ? <TodayActiveTrip load={activeLoad} network={network} trip={activeTrip} /> : null}
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
              <span>{activeTrip ? "Your active route is selected. Open another landing to compare upcoming work." : "Tap a landing to see pay, timing, distance, and whether your truck matches."}</span>
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

function TripCard({ mediaReady, network, trip }: { mediaReady: boolean; network: NetworkView; trip: TripView }) {
  const load = network.loads.find((item) => item.id === trip.loadPostingId) ?? null
  const lastEvent = trip.events[trip.events.length - 1] ?? null
  const open = isOpenTrip(trip)
  const isOwnHaul = trip.driverProfileId === network.currentDriver?.id

  return (
    <article className="trip-card" data-trip-id={trip.id}>
      <header>
        <div>
          <span className="card-kicker">{load ? `${load.landing.city} to ${load.destination.name}` : "Assignment"}</span>
          <strong>{trip.loadTitle}</strong>
        </div>
        <div className="trip-card__badges">
          <Badge tone={trip.status === "completed" ? "success" : trip.status === "cancelled" ? "critical" : "warning"}>
            {trip.status === "assigned" ? "Booked" : tripStatusLabel(trip.status)}
          </Badge>
          {trip.status === "assigned" ? (
            <Badge tone={trip.inspection?.outcome === "pass" ? "success" : trip.inspection ? "critical" : "warning"}>
              {trip.inspection?.outcome === "pass"
                ? "Pre-trip passed"
                : trip.inspection
                  ? "Pre-trip failed"
                  : "Pre-trip pending"}
            </Badge>
          ) : null}
        </div>
      </header>
      <p className="trip-card__event">
        {lastEvent ? (
          <>
            Last update: {lastEvent.note ?? lastEvent.type} · <LocalTime value={lastEvent.occurredAt} />
          </>
        ) : (
          "This haul is booked. Start it when you head to the landing."
        )}
      </p>
      {/* The instruction, not just the badge: a driver should never have to
          infer the required action from a status chip. */}
      {open && isOwnHaul ? (
        <p className="trip-card__next">
          <Icon aria-hidden name="ops.queue" size={16} />
          <span>
            <strong>Next step:</strong> {nextStepForTrip(trip)}
          </span>
        </p>
      ) : null}
      {trip.documents.length > 0 ? (
        <ul className="doc-list">
          {trip.documents.map((document) => (
            <li key={document.id}>
              <Icon aria-hidden name="ops.document" size={14} />
              {document.viewable ? (
                <a href={`/api/trip-documents/asset?documentId=${document.id}`} rel="noreferrer" target="_blank">
                  {document.filename}
                </a>
              ) : (
                <span>{document.filename}</span>
              )}
              <em>{document.type}</em>
            </li>
          ))}
        </ul>
      ) : null}
      {open && isOwnHaul ? (
        <div className="trip-card__actions">
          <TripProgressButton
            completionStatus={trip.completion.status}
            inspectionPassed={trip.inspection?.outcome === "pass"}
            status={trip.status}
            tripId={trip.id}
          />
          <LogProofControl available={mediaReady} tripId={trip.id} />
          {/* Recorded at the destination, while the driver is standing at the
              scale — not reconstructed from memory later. */}
          {canRecordDelivery(trip) ? (
            <CompletionForm completion={trip.completion} tripId={trip.id} />
          ) : null}
          <CancelHaulControl assignmentId={trip.assignmentId} kind="haul" />
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
              <LogProofControl available={mediaReady} tripId={trip.id} />
              <CompletionForm completion={trip.completion} tripId={trip.id} />
            </div>
          ) : null}
        </>
      ) : null}
      {trip.completion.status === "confirmed" && isOwnHaul ? (
        <DriverPaymentReceiptControl
          assignmentId={trip.assignmentId}
          expectedPayAmountCents={trip.driverPayment.expectedPayAmountCents}
          expectedPayCurrency={trip.driverPayment.expectedPayCurrency}
          expectedPayLabel={trip.driverPayment.expectedPayLabel}
          matchesExpected={trip.driverPayment.matchesExpected}
          receivedPayLabel={trip.driverPayment.receivedPayLabel}
          status={trip.driverPayment.status}
        />
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

export function driverPendingAssignmentPresentation(status: string | null | undefined): {
  badge: string
  body: string
  cancellationKind: "offer" | "request"
  openLabel: string
  tone: "info" | "warning"
} {
  return status === "offered"
    ? {
        badge: "Offered to you",
        body: "Review the load details. You can message the host or decline this offer here.",
        cancellationKind: "offer",
        openLabel: "Review offer",
        tone: "info"
      }
    : {
        badge: "Host deciding",
        body: "Your request is sent. We will notify you when the host makes a decision.",
        cancellationKind: "request",
        openLabel: "Open request",
        tone: "warning"
      }
}

function RequestedHaulCard({ load }: { load: NetworkLoadView }) {
  const presentation = driverPendingAssignmentPresentation(load.viewerAssignment?.status)
  const isOffer = presentation.cancellationKind === "offer"

  return (
    <article className="schedule-request-card">
      <header>
        <div>
          <span className="card-kicker">{load.landing.city} to {load.destination.name}</span>
          <strong>{payHeadline(load)}</strong>
        </div>
        <Badge tone={presentation.tone}>{presentation.badge}</Badge>
      </header>
      <h3>{load.title}</h3>
      <div className="schedule-request-card__facts">
        <span>{load.scheduleLabel}</span>
        <span>{load.route.distanceMiles.toFixed(0)} miles</span>
        <span>{load.capacity.remaining} of {load.capacity.total} still open</span>
      </div>
      <p>{presentation.body}</p>
      <div className="primary-action-row">
        <Link className={isOffer ? "action-link" : "action-link action-link--secondary"} href={`/driver/loads/${load.id}`}>
          {presentation.openLabel}
        </Link>
        {load.viewerAssignment ? (
          <CancelHaulControl assignmentId={load.viewerAssignment.id} kind={presentation.cancellationKind} />
        ) : null}
        {isOffer ? <Link className="action-link action-link--secondary" href="/driver/messages">Message host</Link> : null}
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
          <strong>{payHeadline(load)}</strong>
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

type ScheduleTrip = NetworkView["trips"][number]

/**
 * The one thing this driver should do next on a haul, in words.
 *
 * Status and required action are different ideas. "Pre-trip pending" is a
 * state; "Complete your pre-trip inspection" is the instruction that clears
 * it. Badges keep carrying the state — the driver is given the instruction.
 * Both the panel and the card read from here so the two cannot drift.
 */
function nextStepForTrip(trip: ScheduleTrip): string {
  const inspectionPassed = trip.inspection?.outcome === "pass"

  if (trip.status === "assigned" && !inspectionPassed) {
    if (trip.inspection) {
      return "Pre-trip failed — contact dispatch before rolling"
    }

    return "Complete your pre-trip inspection"
  }

  // Read the label off the control itself, never off tripActionLabel: that
  // helper names the current leg, so it would tell a rolling driver to "Head
  // to landing" while the button beside it says "Arrived at landing".
  return nextFieldStepLabel(trip.status, trip.completion.status, inspectionPassed) ?? tripStatusLabel(trip.status)
}

/**
 * "Right now": the driver's next action, the haul it belongs to, and when it
 * runs. This replaced a four-cell counter grid that spent roughly half the
 * first screen — three of its four cells read zero for a driver with one
 * haul, and its only real fact was repeated by the card directly beneath it.
 * Counts still appear, but only the ones that are not zero.
 */
function NextActionPanel({
  activeTrips,
  bookedTrips,
  completedTrips,
  network,
  pendingLoads
}: {
  activeTrips: ScheduleTrip[]
  bookedTrips: ScheduleTrip[]
  completedTrips: ScheduleTrip[]
  network: NetworkView
  pendingLoads: NetworkLoadView[]
}) {
  // A haul already rolling outranks one that is merely booked.
  const focus = activeTrips[0] ?? bookedTrips[0] ?? null
  const focusLoad = focus ? network.loads.find((load) => load.id === focus.loadPostingId) ?? null : null

  const offeredLoads = pendingLoads.filter((load) => load.viewerAssignment?.status === "offered")
  const requestedLoads = pendingLoads.filter((load) => load.viewerAssignment?.status === "requested")
  const counts = [
    { label: "offered", value: offeredLoads.length },
    { label: "requested", value: requestedLoads.length },
    { label: "booked", value: bookedTrips.length },
    { label: "in progress", value: activeTrips.length },
    { label: "completed", value: completedTrips.length }
  ].filter((entry) => entry.value > 0)

  // An offer is the host's decision already made — the driver is the one who
  // has to answer it. Only a plain request is genuinely waiting on the host.
  const awaitingHost = requestedLoads.length

  const headline = focus
    ? nextStepForTrip(focus)
    : offeredLoads.length > 0
      ? offeredLoads.length === 1
        ? "Review the offer on your truck"
        : "Review the offers on your truck"
      : awaitingHost > 0
        ? "Waiting on a host decision"
        // "yet" would be wrong for a driver who has already run hauls.
        : completedTrips.length > 0
          ? "Nothing booked right now"
          : "Nothing booked yet"

  const detail = focus
    ? `${focus.loadTitle}${focusLoad ? ` · ${focusLoad.landing.city} to ${focusLoad.destination.name}` : ""}`
    : offeredLoads.length > 0
      ? `${pluralize(offeredLoads.length, "offer")} waiting for your review.`
      : awaitingHost > 0
        ? `${pluralize(awaitingHost, "request")} waiting on a host decision.`
        : "Find a load that fits your truck and request the haul."

  return (
    <section aria-label="What to do next" className="driver-next">
      <p className="eyebrow">Right now</p>
      <h2>{headline}</h2>
      <p className="driver-next__haul">{detail}</p>
      {focusLoad?.scheduleLabel ? <p className="driver-next__when">{focusLoad.scheduleLabel}</p> : null}
      {counts.length > 0 ? (
        <ul className="driver-next__counts">
          {counts.map((entry) => (
            <li key={entry.label}>
              <strong>{entry.value}</strong> {entry.label}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}

export function driverScheduleDecisionBuckets(loads: readonly NetworkLoadView[]): {
  offeredLoads: NetworkLoadView[]
  requestedLoads: NetworkLoadView[]
} {
  return {
    offeredLoads: loads.filter((load) => load.viewerAssignment?.status === "offered"),
    requestedLoads: loads.filter((load) => load.viewerAssignment?.status === "requested")
  }
}

export function DriverSchedule({ account, mediaReady, network }: DriverPageProps & { mediaReady: boolean }) {
  const { offeredLoads, requestedLoads } = driverScheduleDecisionBuckets(network.loads)
  const pendingLoads = [...offeredLoads, ...requestedLoads]
  const decisionLoads = network.loads.filter((load) => load.viewerDecision?.status === "declined")
  const bookedTrips = network.trips.filter((trip) => trip.status === "assigned")
  const activeTrips = network.trips.filter((trip) => isOpenTrip(trip) && trip.status !== "assigned")
  const completedTrips = network.trips.filter((trip) => trip.status === "completed")
  const cancelledTrips = network.trips.filter((trip) => trip.status === "cancelled")

  return (
    <AppShell account={account} kicker="Your work" role="driver" title="Schedule">
      {/* With nothing scheduled at all, the empty state below already says so
          and offers the way out — a panel repeating it would be noise. */}
      {network.trips.length > 0 || pendingLoads.length > 0 || decisionLoads.length > 0 ? (
        <NextActionPanel
          activeTrips={activeTrips}
          bookedTrips={bookedTrips}
          completedTrips={completedTrips}
          network={network}
          pendingLoads={pendingLoads}
        />
      ) : null}

      {pendingLoads.length === 0 && decisionLoads.length === 0 && network.trips.length === 0 ? (
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
          {offeredLoads.length > 0 ? (
            <section className="app-section">
              <SectionHeader eyebrow="Your decision" title="Offers to review now" />
              <div className="schedule-request-list">
                {offeredLoads.map((load) => <RequestedHaulCard key={load.id} load={load} />)}
              </div>
            </section>
          ) : null}
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
                {activeTrips.map((trip) => <TripCard key={trip.id} mediaReady={mediaReady} network={network} trip={trip} />)}
              </div>
            </section>
          ) : null}
          {bookedTrips.length > 0 ? (
            <section className="app-section">
              <SectionHeader eyebrow="Booked" title="Coming up" />
              <div className="board-list board-list--flush">
                {bookedTrips.map((trip) => <TripCard key={trip.id} mediaReady={mediaReady} network={network} trip={trip} />)}
              </div>
            </section>
          ) : null}
          {completedTrips.length > 0 ? (
            <section className="app-section">
              <SectionHeader eyebrow="Completed" title="Delivered hauls" />
              <div className="board-list board-list--flush">
                {completedTrips.map((trip) => <TripCard key={trip.id} mediaReady={mediaReady} network={network} trip={trip} />)}
              </div>
            </section>
          ) : null}
          {cancelledTrips.length > 0 ? (
            <section className="app-section">
              <SectionHeader eyebrow="History" title="Cancelled hauls" />
              <div className="board-list board-list--flush">
                {cancelledTrips.map((trip) => <TripCard key={trip.id} mediaReady={mediaReady} network={network} trip={trip} />)}
              </div>
            </section>
          ) : null}
        </>
      )}
    </AppShell>
  )
}

export function driverOwnedTrucks(
  network: Pick<NetworkView, "currentDriver" | "trucks">
): NetworkView["trucks"] {
  const driverId = network.currentDriver?.id

  return driverId ? network.trucks.filter((truck) => truck.driverProfileId === driverId) : []
}

export function DriverEquipment({ account, network }: DriverPageProps & { mediaReady: boolean }) {
  const ownedTrucks = driverOwnedTrucks(network)

  return (
    <AppShell account={account} kicker="Garage" role="driver" title="Equipment">
      <section className="app-section">
        <SectionHeader eyebrow="Active setup" title="What you run decides what you see" />
        {ownedTrucks.length === 0 ? (
          <EmptyState
            title="No equipment is assigned to your driver profile."
            body="Add the truck and trailer combination you run. Equipment powers your matching, readiness, and assignments without exposing another driver's setup."
          />
        ) : (
          <div className="truck-grid">
            {ownedTrucks.map((truck) => {
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
                  <EquipmentStatusToggle combinationId={truck.id} status={truck.combinationStatus} />
                </article>
              )
            })}
            <Link className="truck-grid__photo-link" href="/driver/profile">
              Manage photos for your primary equipment in Profile
            </Link>
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
  { value: "identity", label: "Identity", hint: "Describe the identity evidence available. Do not enter a full license or government ID number here." },
  { value: "contact", label: "Contact details", hint: "Tell us whether to review the phone or email already on your account; do not repeat the full value here." }
]

interface DriverProfileReadinessInput {
  accountName: string
  availability: DriverAvailabilitySummary["current"]
  credentialVault: Pick<CredentialVaultView, "blockedNotice" | "headline" | "satisfied"> | null
  driverName: string | null
  equipmentLabel: string | null
  verifications: readonly Pick<VerificationRecordView, "status">[]
}

export interface DriverProfileReadinessStep {
  actionHref: string | null
  actionLabel: string | null
  complete: boolean
  detail: string
  key: "account" | "profile" | "equipment" | "availability" | "credentials" | "verification"
  title: string
}

export interface DriverProfileReadiness {
  complete: boolean
  completedCount: number
  nextStep: DriverProfileReadinessStep | null
  steps: DriverProfileReadinessStep[]
}

export function getDriverProfileReadiness({
  accountName,
  availability,
  credentialVault,
  driverName,
  equipmentLabel,
  verifications
}: DriverProfileReadinessInput): DriverProfileReadiness {
  const profileCreated = driverName !== null
  const credentialsSatisfied = credentialVault?.satisfied === true
  const credentialDetail = credentialVault
    ? credentialsSatisfied
      ? credentialVault.headline
      : credentialVault.blockedNotice ?? credentialVault.headline
    : profileCreated
      ? "Credential readiness is not available yet. Review the vault below before requesting work."
      : "No credential gate can be evaluated until a driver profile is on file."
  const verifiedCount = verifications.filter((record) => record.status === "verified").length
  const pendingCount = verifications.filter((record) => record.status === "pending").length
  const attentionCount = verifications.filter(
    (record) => record.status === "rejected" || record.status === "suspended"
  ).length
  const verificationComplete = verifiedCount > 0 && pendingCount === 0 && attentionCount === 0
  const verificationDetail = attentionCount > 0
    ? `${attentionCount} verification ${attentionCount === 1 ? "record needs" : "records need"} attention below.`
    : pendingCount > 0
      ? `${pendingCount} verification ${pendingCount === 1 ? "submission is" : "submissions are"} in review.`
      : verifiedCount > 0
        ? `${verifiedCount} verification ${verifiedCount === 1 ? "record is" : "records are"} approved.`
        : "Submit identity or contact details for review."
  const steps: DriverProfileReadinessStep[] = [
    {
      actionHref: null,
      actionLabel: null,
      complete: true,
      detail: `The sign-in account for ${accountName} is on file.`,
      key: "account",
      title: "Account"
    },
    {
      actionHref: profileCreated ? null : "/contact",
      actionLabel: profileCreated ? null : "Get help with my driver record",
      complete: profileCreated,
      detail: profileCreated
        ? `Driver profile created for ${driverName}.`
        : "No driver profile is on file yet.",
      key: "profile",
      title: "Driver profile"
    },
    {
      actionHref: "/driver/equipment",
      actionLabel: equipmentLabel ? "Review equipment" : "Add equipment",
      complete: equipmentLabel !== null,
      detail: equipmentLabel
        ? `${equipmentLabel} is on file. Exact-rig requirements are evaluated separately below.`
        : "Add an equipment record for the truck and trailer combination you will use.",
      key: "equipment",
      title: "Equipment record"
    },
    {
      actionHref: "#driver-availability",
      actionLabel: availability ? "Update availability" : "Post availability",
      complete: availability !== null,
      detail: availability
        ? `${formatHuman(availability.status)} · ${availability.windowLabel}`
        : "Post when you are available to haul.",
      key: "availability",
      title: "Availability"
    },
    {
      actionHref: "#driver-credential-vault",
      actionLabel: credentialsSatisfied ? "Review credential vault" : "Review credential requirements",
      complete: credentialsSatisfied,
      detail: credentialDetail,
      key: "credentials",
      title: "Driver and exact-rig records"
    },
    {
      actionHref: pendingCount > 0 && attentionCount === 0 ? null : "#driver-verification",
      actionLabel: pendingCount > 0 && attentionCount === 0
        ? null
        : verificationComplete
          ? "Review verification"
          : "Review verification steps",
      complete: verificationComplete,
      detail: verificationDetail,
      key: "verification",
      title: "Verification"
    }
  ]
  const completedCount = steps.filter((step) => step.complete).length

  return {
    complete: completedCount === steps.length,
    completedCount,
    nextStep: steps.find((step) => !step.complete && step.actionHref !== null) ?? null,
    steps
  }
}

export function shouldShowDriverReadiness(readiness: Pick<DriverProfileReadiness, "complete">, welcome: boolean): boolean {
  return welcome || !readiness.complete
}

export function DriverFirstRunPanel({
  accountName,
  availability,
  continuationHref,
  credentialVault,
  driverName,
  equipmentLabel,
  verifications
}: {
  accountName: string
  availability: DriverAvailabilitySummary["current"]
  continuationHref?: string | null
  credentialVault: Pick<CredentialVaultView, "blockedNotice" | "headline" | "satisfied"> | null
  driverName: string | null
  equipmentLabel: string | null
  verifications: readonly Pick<VerificationRecordView, "status">[]
}) {
  const profileCreated = driverName !== null
  const readiness = getDriverProfileReadiness({
    accountName,
    availability,
    credentialVault,
    driverName,
    equipmentLabel,
    verifications
  })
  const credentialsSatisfied = credentialVault?.satisfied === true
  const credentialStep = readiness.steps.find((step) => step.key === "credentials")
  const credentialDetail = credentialStep?.detail ?? "Review credential readiness below."
  const nextStep = readiness.nextStep
  const waitingStep = readiness.steps.find((step) => !step.complete && step.actionHref === null)

  return (
    <section
      aria-labelledby="driver-first-run-title"
      className="first-run-panel first-run-panel--driver"
      data-testid="driver-first-run"
    >
      <div className="first-run-panel__copy">
        <p className="eyebrow">{profileCreated ? "Account and profile created" : "Account created"}</p>
        <h2 id="driver-first-run-title">
          {readiness.complete
            ? "Your driver workspace is ready."
            : profileCreated
              ? "Your driver workspace is ready to finish."
              : "Your account is open; your driver profile still needs setup."}
        </h2>
        <p>
          {readiness.complete
            ? "Your operating details are current. Keep equipment, availability, verification, and credential records updated as they change."
            : profileCreated
            ? "Your driver record is on file. Complete the operating details below so matching and readiness use current equipment, availability, verification, and credential truth. Hosts on accepted work receive only the scoped status and expiry summary required for that movement."
            : "Your sign-in account exists, but LogLoads has no driver profile on file. Finish that record before filing work credentials."}
        </p>
        <div className="driver-readiness-meter" data-testid="driver-readiness-meter">
          <div>
            <strong>{readiness.completedCount} of {readiness.steps.length} setup steps complete</strong>
            <span>
              {nextStep
                ? `Next: ${nextStep.title}`
                : readiness.complete
                  ? "Ready to review matching work"
                  : `Waiting: ${waitingStep?.title ?? "setup review"}`}
            </span>
          </div>
          <progress
            aria-label="Driver setup progress"
            max={readiness.steps.length}
            value={readiness.completedCount}
          />
        </div>
      </div>
      <div
        aria-label="Current load acceptance state"
        className="first-run-panel__state"
        data-credential-satisfied={credentialsSatisfied ? "true" : "false"}
        data-testid="driver-first-run-credential-state"
      >
        <strong>{credentialsSatisfied ? "Credential gate cleared" : "Load acceptance locked"}</strong>
        <span>{credentialDetail}</span>
      </div>
      <div className="first-run-panel__setup">
        <ul aria-label="Driver setup checklist" className="first-run-panel__checklist" data-testid="driver-first-run-checklist">
          {readiness.steps.map((step) => (
            <li
              className={step.complete ? "is-complete" : undefined}
              data-state={step.complete ? "complete" : "incomplete"}
              data-testid={`driver-first-run-${step.key}`}
              key={step.key}
            >
              <span>
                <span className="sr-only">{step.complete ? "Complete: " : "Not complete: "}</span>
                <strong>{step.title}:</strong> {step.detail}
              </span>
            </li>
          ))}
        </ul>
        <div className="first-run-panel__actions">
          {nextStep?.actionHref && nextStep.key !== "credentials" ? (
            <Link
              className="action-link"
              data-testid="driver-first-run-next-step"
              href={nextStep.actionHref}
            >
              {nextStep.actionLabel}
            </Link>
          ) : null}
          <Link
            className={nextStep?.key === "credentials" ? "action-link" : "action-link action-link--secondary"}
            data-testid="driver-first-run-credential-link"
            href="#driver-credential-vault"
          >
            {credentialsSatisfied ? "Review credential vault" : "Review credential requirements"}
          </Link>
          {continuationHref ? (
            <form action="/driver/first-run/continue" method="post">
              <button
                className="action-link action-link--secondary"
                data-testid="driver-first-run-continuation"
                type="submit"
              >
                Continue where you left off
              </button>
            </form>
          ) : null}
        </div>
      </div>
    </section>
  )
}

export function DriverProfile({
  account,
  availability,
  continuationHref = null,
  credentialVault,
  mediaReady,
  network,
  verifications,
  welcome = false
}: DriverPageProps & {
  availability: DriverAvailabilitySummary
  continuationHref?: string | null
  credentialVault: CredentialVaultView | null
  mediaReady: boolean
  verifications: VerificationRecordView[]
  welcome?: boolean
}) {
  const verification = verificationBadge(network.activeOrganization.verificationStatus)
  const profileReadiness = getDriverProfileReadiness({
    accountName: account.userName,
    availability: availability.current,
    credentialVault,
    driverName: network.currentDriver?.name ?? null,
    equipmentLabel: network.currentEquipment?.label ?? null,
    verifications
  })
  const showReadinessGuidance = shouldShowDriverReadiness(profileReadiness, welcome)

  return (
    <AppShell account={account} kicker="Your setup" role="driver" title="Profile">
      {showReadinessGuidance ? (
        <DriverFirstRunPanel
          accountName={account.userName}
          availability={availability.current}
          continuationHref={continuationHref}
          credentialVault={credentialVault}
          driverName={network.currentDriver?.name ?? null}
          equipmentLabel={network.currentEquipment?.label ?? null}
          verifications={verifications}
        />
      ) : null}
      <section className="profile-panel" id="driver-profile-summary">
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
      <section aria-labelledby="driver-profile-stage-ready" className="driver-profile-stage">
        <header className="driver-profile-stage__head">
          <span aria-hidden>1</span>
          <div>
            <p className="eyebrow">Work readiness</p>
            <h2 id="driver-profile-stage-ready">Get cleared for the next load</h2>
            <p>Keep the truck you run, your haul window, and required records current. These are the facts LogLoads uses before a request can move forward.</p>
          </div>
        </header>
        <div className="driver-profile-stage__content">
          <Link className="driver-equipment-summary" href="/driver/equipment">
            <Icon aria-hidden name="truck.log" size={22} />
            <span>
              <strong>{network.currentEquipment?.label ?? "Add your truck and trailer"}</strong>
              <small>{network.currentEquipment ? "Review the exact rig used for matching" : "Equipment is needed before fit can be evaluated"}</small>
            </span>
            <span aria-hidden>Open equipment</span>
          </Link>
          <section className="app-section availability-panel" id="driver-availability" tabIndex={-1}>
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
          <section
            aria-label="Driver credential readiness"
            className="app-section"
            data-testid="driver-credential-vault-section"
            id="driver-credential-vault"
            tabIndex={-1}
          >
            <SectionHeader eyebrow="Work credentials" title="Keep every record current" />
            {credentialVault ? (
              <CredentialVault vault={credentialVault} />
            ) : (
              <p className="action-note action-note--muted" role="note">
                Add your driver profile before filing work credentials.
              </p>
            )}
          </section>
          <section className="app-section" id="driver-verification" tabIndex={-1}>
            <SectionHeader eyebrow="Account identity" title="Get your profile verified" />
            <VerificationSubmit options={DRIVER_VERIFICATION_OPTIONS} records={verifications} subjectType="person" />
          </section>
        </div>
      </section>
      <details aria-labelledby="driver-profile-stage-match" className="driver-profile-stage driver-profile-stage--disclosure">
        <summary className="driver-profile-stage__head">
          <span aria-hidden>2</span>
          <span className="driver-profile-stage__summary-copy">
            <span className="eyebrow">Better matching</span>
            <span className="driver-profile-stage__summary-title" id="driver-profile-stage-match">Make every load easier to judge</span>
            <span className="driver-profile-stage__summary-description">Fuel assumptions and current photos improve the decision without changing what the host stated as driver pay.</span>
          </span>
          <span aria-hidden className="driver-profile-stage__toggle" />
        </summary>
        <div className="driver-profile-stage__content driver-profile-stage__content--split">
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
              <MediaUpload available={mediaReady} hasCurrent={network.currentDriver?.hasProfilePhoto ?? false} kind="profile" label="Profile photo" />
              <MediaUpload available={mediaReady} hasCurrent={network.currentEquipment?.hasTruckPhoto ?? false} kind="truck" label="Truck photo" />
              {network.currentDriver?.trailerId ? (
                <MediaUpload available={mediaReady} hasCurrent={network.currentEquipment?.hasTrailerPhoto ?? false} kind="trailer" label="Trailer photo" />
              ) : null}
            </div>
            <FeatureTruckPhotoToggle
              featured={network.currentDriver?.featureTruckPhoto ?? false}
              hasPhoto={network.currentEquipment?.hasTruckPhoto ?? false}
            />
          </section>
        </div>
      </details>
      <section aria-labelledby="driver-profile-stage-workspace" className="driver-profile-stage driver-profile-stage--compact">
        <header className="driver-profile-stage__head">
          <span aria-hidden>3</span>
          <div>
            <p className="eyebrow">Workspace</p>
            <h2 id="driver-profile-stage-workspace">Return to the work</h2>
          </div>
        </header>
        <div className="driver-profile-stage__content">
          <nav aria-label="Driver workspace shortcuts" className="choice-grid">
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
          </nav>
          <div className="signout-row">
            <SignOutButton />
          </div>
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
    <AppShell account={account} contentOwnsHeading kicker="Can I haul this?" role="driver" title="Load details">
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
        <div className="detail-layout detail-layout--app">
          <div className="detail-main">
            <div className="load-detail-summary">
              <Link className="back-link" href="/driver/loads">Back to loads</Link>
              <p className="eyebrow">{load.landing.city} to {load.destination.name} · {load.sourceName}</p>
              <h1>{load.title}</h1>
              <div className="load-decision-lead">
                <strong>{payHeadline(load)}</strong>
                {presentPay(load).estimateNote ? <span>{presentPay(load).estimateNote}</span> : null}
                <span>{load.scheduleLabel}</span>
                <span>{load.route.distanceMiles.toFixed(0)} miles</span>
                <span>{load.capacity.remaining} of {load.capacity.total} hauls open</span>
              </div>
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
        </div>
      )}
    </AppShell>
  )
}
