"use client"

import Link from "next/link"
import type { CSSProperties } from "react"
import { Badge, Icon } from "@logloads/ui"

import type { HostLandingRecord, HostLoadPlanFacts, HostPublishingOptions } from "@/lib/host-data"
import type { NetworkLoadView, NetworkView } from "@/lib/network"
import { formatDateTime, formatHuman, tripStatusLabel } from "@/lib/v3-shared"
import { DecisionList, toneForNotice } from "./Common"
import {
  CancelAssignmentButton,
  CapacityApprovalList,
  CloseWorkButton,
  DirectOfferPanel,
  NoticeComposer,
  OpportunityBuilder,
  PublishDraftButton,
  type PendingCapacityRequest
} from "./HostActions"
import { TripReviewForm } from "./Reputation"
import { AppShell, EmptyState, Metric, type ShellAccount } from "./Shells"

interface HostPageProps {
  account: ShellAccount
  network: NetworkView
}

type HostTrip = NetworkView["trips"][number]

function ownLoads(network: NetworkView): NetworkLoadView[] {
  return network.loads.filter((load) => load.sourceOrganizationId === network.activeOrganization.id)
}

function activeLoads(loads: NetworkLoadView[]): NetworkLoadView[] {
  return loads.filter((load) => !["archived", "cancelled", "completed"].includes(load.status))
}

function pendingRequests(loads: NetworkLoadView[]): PendingCapacityRequest[] {
  return loads.flatMap((load) =>
    load.assignments
      .filter((assignment) => assignment.status === "requested")
      .map((assignment) => ({
        assignmentId: assignment.id,
        driverName: assignment.driverName,
        loadTitle: load.title,
        scheduleLabel: load.scheduleLabel,
        truckUnit: assignment.truckUnit
      }))
  )
}

function statusTone(status: string): "success" | "warning" | "critical" | "info" | "neutral" {
  if (status === "open") return "success"
  if (status === "draft") return "warning"
  if (status === "cancelled") return "critical"
  if (status === "completed" || status === "archived") return "neutral"

  return "info"
}

function roadTone(condition: string): "success" | "warning" | "critical" {
  if (condition === "good") return "success"
  if (condition === "wet" || condition === "muddy") return "warning"

  return "critical"
}

// --- Command -------------------------------------------------------------------

export function HostCommand({ account, network }: HostPageProps) {
  const own = ownLoads(network)
  const active = activeLoads(own)
  const planned = active.reduce((sum, load) => sum + load.capacity.total, 0)
  const committed = active.reduce((sum, load) => sum + load.capacity.committed, 0)
  const delivered = active.reduce((sum, load) => sum + load.capacity.completed, 0)
  const remaining = active.reduce((sum, load) => sum + load.capacity.remaining, 0)
  const requests = pendingRequests(own)
  const gaps = active.filter(
    (load) => load.capacity.remaining > 0 && ["open", "scheduled"].includes(load.status)
  )

  return (
    <AppShell account={account} kicker="Landing operations" role="host" title="Command">
      <section className="host-need">
        <p className="eyebrow">Capacity position</p>
        <h2>
          {planned === 0
            ? "No truckloads scheduled"
            : remaining === 0
              ? "All planned truckloads are covered"
              : `${remaining} truckload${remaining === 1 ? "" : "s"} still open`}
        </h2>
        <div
          className="capacity-meter"
          style={{ "--fill": `${planned > 0 ? Math.round((committed / planned) * 100) : 0}%` } as CSSProperties}
        >
          <span />
        </div>
        <p>
          {planned} planned · {committed} committed · {delivered} delivered
        </p>
        <Link className="action-link" href="/host/opportunities">
          Publish work
        </Link>
      </section>
      <section className="decision-grid host-command-grid">
        <article className="decision-list">
          <h2>Capacity requests</h2>
          <CapacityApprovalList requests={requests} />
        </article>
        <DecisionList
          items={network.notices.map((notice) => ({
            body: notice.body,
            title: notice.title,
            tone: toneForNotice(notice.severity)
          }))}
          title="Needs attention"
        />
        <article className="decision-list">
          <h2>Capacity gaps</h2>
          {gaps.length === 0 ? (
            <EmptyState
              actionHref="/host/opportunities"
              actionLabel="Publish work"
              body="Every planned truckload is committed. Publish the next block when it is ready to move."
              title="No open gaps."
            />
          ) : (
            <>
              {gaps.map((load) => (
                <Link className="host-gap-row" href="/host/opportunities" key={load.id}>
                  <strong>{load.title}</strong>
                  <span>
                    {load.capacity.remaining} of {load.capacity.total} truckloads uncommitted · {load.scheduleLabel}
                  </span>
                </Link>
              ))}
            </>
          )}
        </article>
      </section>
    </AppShell>
  )
}

// --- Opportunities ----------------------------------------------------------------

export function HostOpportunities({
  account,
  network,
  options,
  planFacts
}: HostPageProps & { options: HostPublishingOptions; planFacts: HostLoadPlanFacts }) {
  const own = ownLoads(network)

  return (
    <AppShell account={account} kicker="Publish capacity" role="host" title="Work">
      <section className="builder-layout">
        <OpportunityBuilder options={options} />
        <div className="host-published">
          <div>
            <p className="eyebrow">Published work</p>
            <h2 className="host-published__title">On the network</h2>
          </div>
          {own.length === 0 ? (
            <EmptyState
              body="Use the builder to publish your first timber movement. Open work is visible to the network the moment you publish it."
              title="Nothing published yet."
            />
          ) : (
            own.map((load) => {
              const waiting = load.assignments.filter((assignment) => assignment.status === "requested").length
              const dailyNeed = planFacts[load.id]?.dailyTruckCountNeeded

              return (
                <article className="host-load-row" key={load.id}>
                  <div>
                    <strong>{load.title}</strong>
                    <span>
                      {load.landing.city} to {load.destination.name} · {load.scheduleLabel} · {load.payLabel}
                    </span>
                    <span>
                      {load.capacity.total > 0
                        ? `${load.capacity.committed} of ${load.capacity.total} truckloads committed`
                        : dailyNeed
                          ? `Needs ${dailyNeed} truckload${dailyNeed === 1 ? "" : "s"} per day. Loading slots are not scheduled yet, so haulers cannot request this work.`
                          : "Loading slots are not scheduled yet, so haulers cannot request this work."}
                    </span>
                  </div>
                  <div className="host-load-row__side">
                    <Badge tone={statusTone(load.status)}>{formatHuman(load.status)}</Badge>
                    {waiting > 0 ? (
                      <Link className="text-link" href="/host/command">
                        {waiting} request{waiting === 1 ? "" : "s"} waiting
                      </Link>
                    ) : null}
                    {load.status === "draft" ? <PublishDraftButton loadPostingId={load.id} /> : null}
                    {["open", "scheduled", "filled"].includes(load.status) ? (
                      <CloseWorkButton loadPostingId={load.id} waitingRequests={waiting} />
                    ) : null}
                  </div>
                </article>
              )
            })
          )}
        </div>
      </section>
    </AppShell>
  )
}

// --- Live board ---------------------------------------------------------------------

const LIVE_LANES: Array<{ title: string; statuses: HostTrip["status"][] }> = [
  { statuses: ["assigned", "en_route_to_landing"], title: "Expected" },
  { statuses: ["checked_in"], title: "At the landing" },
  { statuses: ["loading", "loaded"], title: "Loading" },
  { statuses: ["en_route_to_destination", "at_destination", "unloading"], title: "Departed" },
  { statuses: ["completed"], title: "Delivered" },
  { statuses: ["cancelled"], title: "Exception" }
]

function tripTone(status: HostTrip["status"]): "success" | "critical" | "info" {
  if (status === "completed") return "success"
  if (status === "cancelled") return "critical"

  return "info"
}

export function HostLiveBoard({ account, network }: HostPageProps) {
  const own = ownLoads(network)
  const ownIds = new Set(own.map((load) => load.id))
  const trips = network.trips.filter((trip) => ownIds.has(trip.loadPostingId))

  const truckUnitFor = (trip: HostTrip): string =>
    own
      .find((load) => load.id === trip.loadPostingId)
      ?.assignments.find((assignment) => assignment.id === trip.assignmentId)?.truckUnit ?? "Unit on file"

  const lastUpdateFor = (trip: HostTrip): string => {
    const at = trip.events[trip.events.length - 1]?.occurredAt ?? trip.lastSyncedAt

    return at ? `Last update ${formatDateTime(at)}` : "No updates synced yet"
  }

  return (
    <AppShell account={account} kicker="Landing flow" role="host" title="Live Board">
      {trips.length === 0 ? (
        <section className="host-board-empty">
          <EmptyState
            actionHref="/host/command"
            actionLabel="Review requests"
            body="Trucks appear here the moment you approve a capacity request on your work. Pending requests wait on Command."
            title="No trucks on the board."
          />
        </section>
      ) : (
        <section className="live-board">
          {LIVE_LANES.map((lane) => {
            const laneTrips = trips.filter((trip) => lane.statuses.includes(trip.status))

            return (
              <article key={lane.title}>
                <h2>
                  {lane.title} <span className="host-lane-count">{laneTrips.length}</span>
                </h2>
                {laneTrips.length === 0 ? (
                  <p className="muted">None right now.</p>
                ) : (
                  laneTrips.map((trip) => (
                    <div className="live-card" key={trip.id}>
                      <strong>{trip.driverName}</strong>
                      <span>
                        {truckUnitFor(trip)} · {trip.loadTitle}
                      </span>
                      <Badge tone={tripTone(trip.status)}>{tripStatusLabel(trip.status)}</Badge>
                      <span>{lastUpdateFor(trip)}</span>
                      {trip.reviewable ? (
                        trip.reviewable.alreadyReviewed ? (
                          <span className="review-done">
                            <Icon aria-hidden name="status.verified" size={14} /> You rated {trip.reviewable.counterpartyName}.
                          </span>
                        ) : (
                          <TripReviewForm
                            counterpartyName={trip.reviewable.counterpartyName}
                            direction={trip.reviewable.direction}
                            tripId={trip.id}
                          />
                        )
                      ) : null}
                      {!["cancelled", "completed"].includes(trip.status) ? (
                        <CancelAssignmentButton assignmentId={trip.assignmentId} driverName={trip.driverName} />
                      ) : null}
                    </div>
                  ))
                )}
              </article>
            )
          })}
        </section>
      )}
    </AppShell>
  )
}

// --- Landings --------------------------------------------------------------------------

export function HostLandings({
  account,
  landings,
  network
}: HostPageProps & { landings: HostLandingRecord[] }) {
  return (
    <AppShell account={account} kicker="Access control" role="host" title="Landings">
      <section className="host-landing-grid">
        {landings.length === 0 ? (
          <EmptyState
            body={`No landing records are linked to ${network.activeOrganization.name} yet. Landing records are set up during onboarding — contact LogLoads support to add your first landing.`}
            title="No landings on file."
          />
        ) : (
          landings.map((landing) => (
            <article className="host-landing-card" key={landing.id}>
              <header>
                <div>
                  <h2>{landing.name}</h2>
                  <p>{landing.area}</p>
                </div>
                <Badge tone={roadTone(landing.roadCondition)}>Road {formatHuman(landing.roadCondition)}</Badge>
              </header>
              <dl>
                <div>
                  <dt>Open work</dt>
                  <dd>
                    {landing.openLoadCount === 0
                      ? "None"
                      : `${landing.openLoadCount} posting${landing.openLoadCount === 1 ? "" : "s"}`}
                  </dd>
                </div>
                <div>
                  <dt>Loading gear</dt>
                  <dd>{landing.loadingEquipment.join(", ") || "Not recorded"}</dd>
                </div>
                <div>
                  <dt>Turnaround</dt>
                  <dd>{landing.turnaroundConstraints.join(", ") || "No constraints recorded"}</dd>
                </div>
                {landing.accessNotes ? (
                  <div>
                    <dt>Approach</dt>
                    <dd>{landing.accessNotes}</dd>
                  </div>
                ) : null}
                <div>
                  <dt>Site contact</dt>
                  <dd>{landing.contactName}</dd>
                </div>
              </dl>
              <p className="host-access-line">
                <Icon aria-hidden name="status.lock" size={16} />
                {landing.accessPolicyLine}
              </p>
              <footer>
                <span>
                  {landing.lastVerifiedAt
                    ? `Details verified ${formatDateTime(landing.lastVerifiedAt)}`
                    : "Details not yet verified"}
                </span>
                <Link className="action-link action-link--secondary" href="/host/opportunities">
                  Publish from this landing
                </Link>
              </footer>
            </article>
          ))
        )}
      </section>
    </AppShell>
  )
}

// --- Carriers ---------------------------------------------------------------------------

export function HostCarriers({ account, network }: HostPageProps) {
  const own = ownLoads(network)
  const offerable = own
    .filter((load) => load.status === "open")
    .map((load) => ({
      detail: `${load.capacity.remaining} open · ${load.scheduleLabel}`,
      id: load.id,
      title: load.title
    }))
  const partners = network.privateNetwork
    .filter((relationship) => relationship.status === "active")
    .map((relationship) => ({ id: relationship.partnerOrganizationId, name: relationship.partnerName }))
  const noticeTargets = activeLoads(own).map((load) => ({ id: load.id, title: load.title }))

  return (
    <AppShell account={account} kicker="Private network" role="host" title="Carriers">
      <section className="relationship-grid">
        {network.privateNetwork.length === 0 ? (
          <EmptyState
            body="Partner relationships let you share work privately and send direct offers. Relationships are set up with the outfits you already haul with."
            title="No operating relationships yet."
          />
        ) : (
          network.privateNetwork.map((relationship) => (
            <article key={relationship.id}>
              <Badge tone={relationship.status === "active" ? "success" : "warning"}>{relationship.status}</Badge>
              <h2>{relationship.partnerName}</h2>
              <p>{relationship.notes ?? "Trusted partner relationship."}</p>
              <span>{formatHuman(relationship.scope)}</span>
            </article>
          ))
        )}
      </section>
      <section className="host-carrier-tools">
        <article className="host-panel">
          <h2>Send a direct offer</h2>
          <p>Hold truckloads on your open work for a trusted partner before the wider network fills them.</p>
          <DirectOfferPanel loads={offerable} partners={partners} />
        </article>
        <article className="host-panel">
          <h2>Publish an operational notice</h2>
          <p>Road, weather, and schedule changes reach the crews working the related load.</p>
          <NoticeComposer loads={noticeTargets} />
        </article>
      </section>
    </AppShell>
  )
}

// --- Schedule ------------------------------------------------------------------------------

export function HostSchedule({ account, network }: HostPageProps) {
  const own = ownLoads(network)
  const active = activeLoads(own)
  const planned = active.reduce((sum, load) => sum + load.capacity.total, 0)
  const committed = active.reduce((sum, load) => sum + load.capacity.committed, 0)
  const delivered = active.reduce((sum, load) => sum + load.capacity.completed, 0)
  const remaining = active.reduce((sum, load) => sum + load.capacity.remaining, 0)

  const groups = [
    {
      loads: own.filter((load) => ["open", "scheduled", "filled", "in_transit"].includes(load.status)),
      title: "Accepting and moving"
    },
    { loads: own.filter((load) => load.status === "draft"), title: "Drafts" },
    {
      loads: own.filter((load) => ["completed", "cancelled", "archived"].includes(load.status)),
      title: "Closed"
    }
  ]

  return (
    <AppShell account={account} kicker="Upcoming work" role="host" title="Schedule">
      {own.length === 0 ? (
        <section className="host-board-empty">
          <EmptyState
            actionHref="/host/opportunities"
            actionLabel="Publish work"
            body="Published work lands on this schedule with its dates, lanes, and remaining capacity."
            title="Nothing scheduled yet."
          />
        </section>
      ) : (
        <>
          <section className="command-grid">
            <Metric label="Truckloads planned" value={planned} />
            <Metric label="Committed" value={committed} />
            <Metric label="Delivered" value={delivered} />
            <Metric label="Still open" value={remaining} />
          </section>
          {groups.map((group) =>
            group.loads.length === 0 ? null : (
              <section className="host-schedule-group" key={group.title}>
                <h2>{group.title}</h2>
                <div className="board-list host-board-list">
                  {group.loads.map((load) => (
                    <article className="trip-row" key={load.id}>
                      <div>
                        <strong>{load.title}</strong>
                        <span>
                          {load.scheduleLabel} · {load.landing.city} to {load.destination.name}
                        </span>
                      </div>
                      <Badge tone={statusTone(load.status)}>{formatHuman(load.status)}</Badge>
                      {["open", "scheduled", "filled", "in_transit"].includes(load.status) ? (
                        <Badge tone={load.capacity.remaining > 0 ? "warning" : "success"}>
                          {load.capacity.remaining > 0 ? `${load.capacity.remaining} open` : "Covered"}
                        </Badge>
                      ) : (
                        <span className="muted">{load.payLabel}</span>
                      )}
                    </article>
                  ))}
                </div>
              </section>
            )
          )}
        </>
      )}
    </AppShell>
  )
}

// --- Analytics --------------------------------------------------------------------------------

export function HostAnalytics({ account, network }: HostPageProps) {
  const own = ownLoads(network)
  const ownIds = new Set(own.map((load) => load.id))
  const planned = own.reduce((sum, load) => sum + load.capacity.total, 0)
  const committed = own.reduce((sum, load) => sum + load.capacity.committed, 0)
  const delivered = own.reduce((sum, load) => sum + load.capacity.completed, 0)
  const remaining = own.reduce((sum, load) => sum + load.capacity.remaining, 0)
  const waiting = pendingRequests(own).length
  const deliveredTrips = network.trips.filter(
    (trip) => ownIds.has(trip.loadPostingId) && trip.status === "completed"
  ).length
  const measurable = own.filter((load) => load.capacity.total > 0)

  return (
    <AppShell account={account} kicker="Capacity trends" role="host" title="Analytics">
      {own.length === 0 ? (
        <section className="host-board-empty">
          <EmptyState
            actionHref="/host/opportunities"
            actionLabel="Publish work"
            body="Once work is published, commitment and delivery numbers build up here from real activity."
            title="No published work to measure yet."
          />
        </section>
      ) : (
        <>
          <section className="command-grid">
            <Metric label="Work published" value={own.length} />
            <Metric label="Truckloads planned" value={planned} />
            <Metric label="Committed" value={committed} />
            <Metric label="Still open" value={remaining} />
          </section>
          <section className="command-grid">
            <Metric label="Truckloads delivered" value={delivered} />
            <Metric label="Trips delivered" value={deliveredTrips} />
            <Metric label="Requests waiting" value={waiting} />
            <Metric label="Partners" value={network.privateNetwork.length} />
          </section>
          {measurable.length === 0 ? (
            <section className="host-board-empty">
              <EmptyState
                body="Published work gains truckload capacity once loading slots are scheduled. Until then there is no fill progress to chart."
                title="No scheduled truckload capacity to chart yet."
              />
            </section>
          ) : (
            <section className="host-fill-list">
              <h2>Fill progress by posting</h2>
              {measurable.map((load) => {
                const percent = Math.round((load.capacity.committed / load.capacity.total) * 100)

                return (
                  <div className="host-fill-row" key={load.id}>
                    <header>
                      <strong>{load.title}</strong>
                      <span>
                        {load.capacity.committed} of {load.capacity.total} committed
                      </span>
                    </header>
                    <div aria-hidden className="host-fill-bar">
                      <span style={{ width: `${percent}%` }} />
                    </div>
                  </div>
                )
              })}
            </section>
          )}
        </>
      )}
    </AppShell>
  )
}
