"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { Fragment, useEffect, useMemo, useState, useTransition, type ReactNode } from "react"
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
  ClaimDirectOfferButton,
  DeclineDirectOfferButton,
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

const CURRENT_COMMITMENT_ASSIGNMENT_STATUSES = new Set<
  NetworkLoadView["assignments"][number]["status"]
>(["accepted", "checked_in", "loading", "hauled"])

const CURRENT_COMMITMENT_LOAD_STATUSES = new Set<NetworkLoadView["status"]>([
  "open",
  "scheduled",
  "filled",
  "in_transit"
])

const STALL_THRESHOLD_MS = 8 * 60 * 60 * 1000

function isActiveTrip(trip: Trip): boolean {
  return ACTIVE_TRIP_STATUSES.has(trip.status)
}

function lastActivityAt(trip: Trip): string | null {
  return trip.events.at(-1)?.occurredAt ?? trip.lastSyncedAt
}

export function isStalledTrip(trip: Trip): boolean {
  // `assigned` can be valid future work. This view has no due-time fact that
  // would distinguish "scheduled later" from "late".
  if (!isActiveTrip(trip) || trip.status === "assigned") {
    return false
  }

  const last = lastActivityAt(trip)

  return last !== null && Date.now() - Date.parse(last) > STALL_THRESHOLD_MS
}

export function loadHasCurrentFleetWarning(
  load: Pick<NetworkLoadView, "assignments" | "status" | "warnings">
): boolean {
  return CURRENT_COMMITMENT_LOAD_STATUSES.has(load.status) &&
    load.warnings.length > 0 &&
    load.assignments.some((assignment) =>
      CURRENT_COMMITMENT_ASSIGNMENT_STATUSES.has(assignment.status)
    )
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

export interface FleetCredentialReadiness {
  missingLabels: string[]
  satisfied: boolean
}

export interface FleetFirstRunFact {
  complete: boolean
  detail: string
  id: "organization" | "unit" | "driver" | "credentials"
  label: string
}

function listSentence(items: string[]): string {
  if (items.length === 0) {
    return "the required driver and exact-rig records"
  }

  if (items.length === 1) {
    return items[0] ?? "the required records"
  }

  if (items.length === 2) {
    return `${items[0]} and ${items[1]}`
  }

  return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`
}

/**
 * First-run facts are projected only from the fleet read model and, when the
 * authorized server page can read it, the same credential gate used before a
 * load request. An assigned driver alone never becomes a credential claim.
 */
export function getFleetFirstRunReadiness(
  network: Pick<NetworkView, "activeOrganization" | "trucks">,
  credentialReadiness: FleetCredentialReadiness | null
): FleetFirstRunFact[] {
  const firstUnit = network.trucks.at(0) ?? null
  const driverAssigned = Boolean(firstUnit?.driverProfileId)
  const driverName = driverAssigned ? firstUnit?.driverName ?? "Assigned driver" : null
  const organizationVerified = network.activeOrganization.verificationStatus === "verified"

  let credentialFact: FleetFirstRunFact

  if (!driverAssigned) {
    credentialFact = {
      complete: false,
      detail: "Choose a driver before LogLoads can evaluate driver and exact-rig records for load requests.",
      id: "credentials",
      label: "Credential readiness follows driver assignment"
    }
  } else if (credentialReadiness?.satisfied) {
    credentialFact = {
      complete: true,
      detail: `${driverName}'s approved, current records cover ${firstUnit?.unitNumber ?? "the assigned unit"}.`,
      id: "credentials",
      label: "Driver and exact-rig credential gate clear"
    }
  } else if (credentialReadiness) {
    credentialFact = {
      complete: false,
      detail: `Before ${driverName} can request work with ${firstUnit?.unitNumber ?? "this unit"}, complete ${listSentence(credentialReadiness.missingLabels)}.`,
      id: "credentials",
      label: "Driver and exact-rig records need attention"
    }
  } else {
    credentialFact = {
      complete: false,
      detail: `Open Drivers to review ${driverName}'s current driver and exact-rig records before requesting work.`,
      id: "credentials",
      label: "Credential gate needs review"
    }
  }

  return [
    {
      complete: organizationVerified,
      detail: organizationVerified
        ? `${network.activeOrganization.name} is verified.`
        : `Current state: ${formatHuman(network.activeOrganization.verificationStatus)}.`,
      id: "organization",
      label: organizationVerified
        ? "Organization verified"
        : `Organization verification: ${formatHuman(network.activeOrganization.verificationStatus)}`
    },
    {
      complete: firstUnit !== null,
      detail: firstUnit
        ? `${firstUnit.unitNumber} is the first unit in this workspace.`
        : "Add the first truck and its working configuration.",
      id: "unit",
      label: firstUnit ? "First unit created" : "First unit still needed"
    },
    {
      complete: driverAssigned,
      detail: driverAssigned
        ? `${driverName} is assigned to ${firstUnit?.unitNumber ?? "the first unit"}.`
        : "Add a driver, then assign that person to the first unit.",
      id: "driver",
      label: driverAssigned ? "Driver assigned" : "Driver assignment still needed"
    },
    credentialFact
  ]
}

export function FleetFirstRunPanel({
  continuationHref,
  credentialReadiness,
  network
}: {
  continuationHref: string | null
  credentialReadiness: FleetCredentialReadiness | null
  network: Pick<NetworkView, "activeOrganization" | "trucks">
}) {
  const readiness = getFleetFirstRunReadiness(network, credentialReadiness)
  const completeCount = readiness.filter((fact) => fact.complete).length
  const firstUnitReady = readiness.find((fact) => fact.id === "unit")?.complete ?? false
  const driverReady = readiness.find((fact) => fact.id === "driver")?.complete ?? false
  const primaryAction = firstUnitReady
    ? {
        href: "/fleet/drivers",
        label: driverReady ? "Review driver records" : "Add or assign a driver",
        testId: "fleet-first-run-drivers"
      }
    : {
        href: "/fleet/trucks",
        label: "Add the first unit",
        testId: "fleet-first-run-trucks"
      }
  const secondaryAction = firstUnitReady
    ? {
        href: "/fleet/trucks",
        label: "Review the first unit",
        testId: "fleet-first-run-trucks"
      }
    : {
        href: "/fleet/drivers",
        label: "Open drivers",
        testId: "fleet-first-run-drivers"
      }

  return (
    <section
      aria-labelledby="fleet-first-run-title"
      className="first-run-panel"
      data-testid="fleet-first-run"
    >
      <div className="first-run-panel__copy">
        <p className="eyebrow">Fleet Free is active</p>
        <h2 id="fleet-first-run-title">Build the operating picture before you put a truck on work.</h2>
        <p>
          This workspace is ready for drivers, trucks, and dispatch with no checkout. Confirm the
          organization, review the first unit, and assign its driver. A load request opens only
          when that driver&apos;s records and the exact rig meet the credential gate.
        </p>
        <nav className="first-run-panel__actions" aria-label="Fleet setup actions">
          <Link className="action-link" data-testid={primaryAction.testId} href={primaryAction.href}>
            {primaryAction.label}
          </Link>
          <Link
            className="action-link action-link--secondary"
            data-testid={secondaryAction.testId}
            href={secondaryAction.href}
          >
            {secondaryAction.label}
          </Link>
          {continuationHref ? (
            <form action="/fleet/first-run/continue" method="post">
              <button
                className="action-link action-link--secondary"
                data-testid="fleet-first-run-continue"
                type="submit"
              >
                Continue to the requested Fleet page
              </button>
            </form>
          ) : null}
        </nav>
      </div>
      <section
        aria-labelledby="fleet-first-run-readiness-title"
        className="first-run-panel__state"
      >
        <strong id="fleet-first-run-readiness-title">
          {completeCount} of {readiness.length} readiness checks complete
        </strong>
        <ul className="first-run-panel__checklist">
          {readiness.map((fact) => (
            <li
              className={fact.complete ? "is-complete" : undefined}
              data-status={fact.complete ? "complete" : "waiting"}
              data-testid={`fleet-readiness-${fact.id}`}
              key={fact.id}
            >
              <span>
                <span className="sr-only">{fact.complete ? "Complete: " : "Waiting: "}</span>
                {fact.label}. {fact.detail}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </section>
  )
}

// --- Command -------------------------------------------------------------------

export function FleetCommand({
  account,
  continuationHref = null,
  credentialReadiness = null,
  dispatchPlan,
  network,
  welcome = false
}: FleetShellProps & {
  continuationHref?: string | null
  credentialReadiness?: FleetCredentialReadiness | null
  dispatchPlan: DispatchTruckPlan[]
  welcome?: boolean
}) {
  const activeTrips = network.trips.filter(isActiveTrip)
  const movingDriverIds = new Set(activeTrips.map((trip) => trip.driverProfileId))
  const availableTrucks = network.trucks.filter((truck) =>
    truck.status === "available" &&
    truck.combinationStatus === "available" &&
    !(truck.driverProfileId && movingDriverIds.has(truck.driverProfileId))
  )

  const readyDecisions = dispatchPlan.flatMap((plan) =>
    plan.suggestion ? [{ plan, suggestion: plan.suggestion }] : []
  )
  const staffingDecisions = dispatchPlan.filter((plan) => plan.blocked === "no_driver")
  const stalledTrips = network.trips.filter(isStalledTrip)
  const warningLoads = network.loads.filter(loadHasCurrentFleetWarning)
  const waitingRequests = network.loads.flatMap((load) =>
    load.assignments
      .filter((assignment) => assignment.status === "requested")
      .map((assignment) => ({ assignment, load }))
  )

  const exceptionCount = stalledTrips.length + warningLoads.length
  const decisionCount = readyDecisions.length + staffingDecisions.length

  return (
    <AppShell account={account} role="fleet" title="Command" kicker="Fleet operations" orgName={network.activeOrganization.name}>
      {welcome ? (
        <FleetFirstRunPanel
          continuationHref={continuationHref}
          credentialReadiness={credentialReadiness}
          network={network}
        />
      ) : null}
      <section className="command-grid">
        <Metric label="Trucks free now" value={availableTrucks.length} />
        <Metric label="Active trips" value={activeTrips.length} />
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
            <EmptyState title="No exceptions." body="No stalled trips or road warnings on active committed work." />
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

export type FleetDispatchWorkState = "ready" | "needs_driver" | "no_match" | "moving"

export interface FleetDispatchWorkItem {
  plan: DispatchTruckPlan
  state: FleetDispatchWorkState
}

export interface FleetDispatchSummary {
  moving: number
  needsDriver: number
  noMatch: number
  ready: number
}

export interface FleetDispatchEmptyState {
  actionHref: "/fleet/availability" | "/fleet/trips" | "/fleet/trucks"
  actionLabel: string
  body: string
  title: string
}

const DISPATCH_STATE_PRIORITY: Record<FleetDispatchWorkState, number> = {
  ready: 0,
  needs_driver: 1,
  no_match: 2,
  moving: 3
}

/**
 * Each available combination becomes exactly one dispatch decision. Aggregate
 * counts may summarize the queue, but no second lane board repeats the trucks.
 */
export function getFleetDispatchWorkItems(
  dispatchPlan: DispatchTruckPlan[]
): FleetDispatchWorkItem[] {
  return dispatchPlan
    .map((plan): FleetDispatchWorkItem => ({
      plan,
      state: plan.blocked === "no_driver"
        ? "needs_driver"
        : plan.blocked === "driver_on_trip"
          ? "moving"
          : plan.suggestion?.requestableSlotId
            ? "ready"
            : "no_match"
    }))
    .sort((left, right) => {
      const stateDelta = DISPATCH_STATE_PRIORITY[left.state] - DISPATCH_STATE_PRIORITY[right.state]

      return stateDelta !== 0 ? stateDelta : left.plan.label.localeCompare(right.plan.label)
    })
}

export function getFleetDispatchSummary(
  workItems: FleetDispatchWorkItem[]
): FleetDispatchSummary {
  const summary: FleetDispatchSummary = {
    moving: 0,
    needsDriver: 0,
    noMatch: 0,
    ready: 0
  }

  for (const item of workItems) {
    if (item.state === "needs_driver") {
      summary.needsDriver += 1
    } else if (item.state === "no_match") {
      summary.noMatch += 1
    } else {
      summary[item.state] += 1
    }
  }

  return summary
}

export function getFleetDispatchEmptyState(
  trucks: Array<Pick<NetworkView["trucks"][number], "combinationStatus">>
): FleetDispatchEmptyState {
  if (trucks.length === 0) {
    return {
      actionHref: "/fleet/trucks",
      actionLabel: "Add equipment",
      body: "Add the first truck and its working configuration before dispatching capacity.",
      title: "No equipment is ready for dispatch."
    }
  }

  if (trucks.some((truck) =>
    truck.combinationStatus === "maintenance" || truck.combinationStatus === "inactive"
  )) {
    return {
      actionHref: "/fleet/trucks",
      actionLabel: "Review equipment",
      body: "Equipment in maintenance or parked inactive must return to an available state before it can enter dispatch.",
      title: "No available trucks are in the dispatch queue."
    }
  }

  if (trucks.some((truck) => truck.combinationStatus === "committed")) {
    return {
      actionHref: "/fleet/trips",
      actionLabel: "Review committed work",
      body: "Current capacity is already committed. Follow the work before planning the next free move.",
      title: "No available trucks are in the dispatch queue."
    }
  }

  return {
    actionHref: "/fleet/availability",
    actionLabel: "Review availability",
    body: "Review the current availability window before putting free equipment back in the queue.",
    title: "No available trucks are in the dispatch queue."
  }
}

export function FleetDispatch({ account, dispatchPlan, network }: FleetShellProps & { dispatchPlan: DispatchTruckPlan[] }) {
  const activeTripDriverIds = new Set(
    network.trips.filter(isActiveTrip).map((trip) => trip.driverProfileId)
  )
  const workItems = getFleetDispatchWorkItems(dispatchPlan)
  const summary = getFleetDispatchSummary(workItems)
  const committedCount = network.trucks.filter((truck) =>
    truck.combinationStatus === "committed" &&
    !(truck.driverProfileId && activeTripDriverIds.has(truck.driverProfileId))
  ).length
  const exceptionTrucks = network.trucks.filter((truck) => truck.combinationStatus === "maintenance")
  const emptyState = getFleetDispatchEmptyState(network.trucks)

  return (
    <AppShell account={account} role="fleet" title="Dispatch" kicker="Assign capacity" orgName={network.activeOrganization.name}>
      <section className="fleet-dispatch-overview" aria-label="Dispatch queue summary">
        <div>
          <strong>{summary.ready}</strong>
          <span>Ready to request</span>
        </div>
        <div>
          <strong>{summary.needsDriver}</strong>
          <span>Need a driver</span>
        </div>
        <div>
          <strong>{summary.noMatch}</strong>
          <span>No requestable match</span>
        </div>
        <div>
          <strong>{summary.moving}</strong>
          <span>Finish active trip first</span>
        </div>
        <div>
          <strong>{committedCount}</strong>
          <span>Committed ahead</span>
        </div>
      </section>

      <section className="fleet-panel fleet-dispatch-workbench">
        <SectionHeader eyebrow="Dispatch queue" title="One truck, one next move" />
        {workItems.length === 0 ? (
          <EmptyState
            title={emptyState.title}
            body={emptyState.body}
            actionHref={emptyState.actionHref}
            actionLabel={emptyState.actionLabel}
          />
        ) : (
          <div className="fleet-dispatch-queue">
            {workItems.map(({ plan, state }) => (
              <article
                className="fleet-dispatch-decision"
                data-state={state}
                key={plan.combinationId}
              >
                <header>
                  <div>
                    <strong>{plan.label}</strong>
                    <span>{plan.driverName ?? "Driver unassigned"} · {plan.payload} · {plan.region}</span>
                  </div>
                  <Badge tone={state === "ready" ? "success" : state === "moving" ? "info" : "warning"}>
                    {state === "ready"
                      ? "Ready to request"
                      : state === "needs_driver"
                        ? "Driver needed"
                        : state === "moving"
                          ? "On active trip"
                          : "No requestable match"}
                  </Badge>
                </header>
                {state === "moving" ? (
                  <div className="fleet-dispatch-decision__body">
                    <p>{plan.driverName} is on an active trip. This truck frees up when the trip completes.</p>
                    <Link className="action-link action-link--secondary" href="/fleet/trips">Follow the trip</Link>
                  </div>
                ) : state === "needs_driver" ? (
                  <div className="fleet-dispatch-decision__body">
                    <p>Assign a driver before LogLoads can evaluate the driver, exact rig, and matching work.</p>
                    <Link className="action-link action-link--secondary" href="/fleet/trucks">Assign a driver</Link>
                  </div>
                ) : state === "ready" && plan.suggestion ? (
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
                    <p>
                      {plan.suggestion
                        ? `${plan.suggestion.title} is the closest current fit, but it has no open request window.`
                        : "No open load currently fits this driver and truck. The truck stays in the queue without implying a match."}
                    </p>
                    <Link className="action-link action-link--secondary" href="/fleet/opportunities">Browse all opportunities</Link>
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </section>

      {exceptionTrucks.length > 0 ? (
        <section className="fleet-panel fleet-panel--secondary fleet-dispatch-exceptions" aria-labelledby="fleet-dispatch-exceptions-title">
          <div>
            <p className="eyebrow">Equipment attention</p>
            <h2 id="fleet-dispatch-exceptions-title">Resolve capacity outside the queue</h2>
            <p>These units are not presented as dispatch candidates until their equipment status changes.</p>
          </div>
          <ul>
            {exceptionTrucks.map((truck) => (
              <li key={truck.id}>
                <span>
                  <strong>{truck.unitNumber}</strong>
                  <small>{truck.driverName || "Driver unassigned"} · {truck.payload} · {truck.region}</small>
                </span>
                <Badge tone="critical">{formatHuman(truck.combinationStatus)}</Badge>
              </li>
            ))}
          </ul>
          <Link className="action-link action-link--secondary" href="/fleet/trucks">Review equipment</Link>
        </section>
      ) : null}
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

export interface FleetDriverPresentation {
  actionHref: "/fleet/availability" | "/fleet/dispatch" | "/fleet/trips" | "/fleet/trucks"
  actionLabel: string
  bucket: "moving" | "dispatch_ready" | "needs_truck" | "equipment_review" | "availability_review"
  currentDetail: string
  currentLabel: string
  currentTone: "success" | "warning" | "critical" | "info"
  gateDetail: string
  gateLabel: string
}

export interface FleetDriverSummary {
  availabilityReview: number
  dispatchReady: number
  equipmentReview: number
  moving: number
  needsTruck: number
}

/**
 * FleetDriverRow intentionally carries no credential verdict. This projection
 * describes only known capacity and makes the per-request credential gate
 * explicit instead of turning a truck assignment into a verification claim.
 */
export function getFleetDriverPresentation(driver: FleetDriverRow): FleetDriverPresentation {
  const gateDetail = driver.equipmentLabel
    ? "Driver and exact-rig credentials are checked before each new load request."
    : "Assign a truck before the exact-rig credential gate can be evaluated."

  if (driver.activeTrip) {
    return {
      actionHref: "/fleet/trips",
      actionLabel: "Open trip",
      bucket: "moving",
      currentDetail: driver.activeTrip.loadTitle,
      currentLabel: driver.activeTrip.statusLabel,
      currentTone: "info",
      gateDetail,
      gateLabel: driver.equipmentLabel ? "Checked on the next request" : "Blocked by truck assignment"
    }
  }

  if (!driver.equipmentLabel || driver.equipmentStatus === null) {
    return {
      actionHref: "/fleet/trucks",
      actionLabel: "Assign a truck",
      bucket: "needs_truck",
      currentDetail: driver.availabilityLabel,
      currentLabel: "Truck needed",
      currentTone: "warning",
      gateDetail,
      gateLabel: "Blocked by truck assignment"
    }
  }

  if (driver.equipmentStatus !== "available") {
    const committed = driver.equipmentStatus === "committed"

    return {
      actionHref: committed ? "/fleet/trips" : "/fleet/trucks",
      actionLabel: committed ? "Open trips" : "Review equipment",
      bucket: "equipment_review",
      currentDetail: committed
        ? `${driver.equipmentLabel} is committed to upcoming work.`
        : `${driver.equipmentLabel} is ${formatHuman(driver.equipmentStatus)}.`,
      currentLabel: committed ? "Committed" : formatHuman(driver.equipmentStatus),
      currentTone: committed ? "info" : driver.equipmentStatus === "maintenance" ? "critical" : "warning",
      gateDetail: "The assigned combination must be available before another load can be requested; credentials are still checked at request time.",
      gateLabel: "Rig unavailable for new work"
    }
  }

  if (driver.availabilityStatus === "available") {
    return {
      actionHref: "/fleet/dispatch",
      actionLabel: "Open dispatch",
      bucket: "dispatch_ready",
      currentDetail: driver.availabilityLabel,
      currentLabel: "Available",
      currentTone: "success",
      gateDetail,
      gateLabel: "Checked on request"
    }
  }

  return {
    actionHref: "/fleet/availability",
    actionLabel: "Update availability",
    bucket: "availability_review",
    currentDetail: driver.availabilityLabel,
    currentLabel: formatHuman(driver.availabilityStatus),
    currentTone: driverTone(driver.availabilityStatus),
    gateDetail,
    gateLabel: "Checked when availability opens"
  }
}

export function getFleetDriverSummary(
  presentations: FleetDriverPresentation[]
): FleetDriverSummary {
  const summary: FleetDriverSummary = {
    availabilityReview: 0,
    dispatchReady: 0,
    equipmentReview: 0,
    moving: 0,
    needsTruck: 0
  }

  for (const presentation of presentations) {
    if (presentation.bucket === "availability_review") {
      summary.availabilityReview += 1
    } else if (presentation.bucket === "dispatch_ready") {
      summary.dispatchReady += 1
    } else if (presentation.bucket === "needs_truck") {
      summary.needsTruck += 1
    } else if (presentation.bucket === "equipment_review") {
      summary.equipmentReview += 1
    } else {
      summary.moving += 1
    }
  }

  return summary
}

export function FleetDrivers({ account, drivers, network }: FleetShellProps & { drivers: FleetDriverRow[] }) {
  const driverPresentations = drivers.map((driver) => ({
    driver,
    presentation: getFleetDriverPresentation(driver)
  }))
  const driverSummary = getFleetDriverSummary(
    driverPresentations.map(({ presentation }) => presentation)
  )

  return (
    <AppShell account={account} role="fleet" title="Drivers" kicker="People and availability" orgName={network.activeOrganization.name}>
      {drivers.length === 0 ? (
        <EmptyState
          title="No drivers in this organization yet."
          body="Open Workspace to review driver invitations and access. Driver profiles assigned to this organization appear here."
          actionHref="/fleet/settings"
          actionLabel="Open workspace"
        />
      ) : (
        <section className="fleet-panel fleet-driver-roster" aria-label="Fleet driver roster">
          <SectionHeader
            action={<Link className="action-link action-link--secondary" href="/fleet/settings">Open roster settings</Link>}
            eyebrow="Operating roster"
            title="Drivers and next actions"
          />
          <div className="fleet-driver-overview" aria-label="Driver capacity summary">
            <div><strong>{driverSummary.dispatchReady}</strong><span>Available with a truck</span></div>
            <div><strong>{driverSummary.moving}</strong><span>On active trips</span></div>
            <div><strong>{driverSummary.needsTruck}</strong><span>Need a truck</span></div>
            <div><strong>{driverSummary.equipmentReview}</strong><span>Rig status to review</span></div>
            <div><strong>{driverSummary.availabilityReview}</strong><span>Availability to review</span></div>
          </div>
          <div className="fleet-driver-list">
            {driverPresentations.map(({ driver, presentation }) => (
              <article aria-labelledby={`fleet-driver-${driver.id}`} className="fleet-driver-row" key={driver.id}>
                {/* The rig the driver chose to show off — streamed through the
                    authorized delivery route, never a raw provider URL. */}
                <div className="fleet-driver-row__identity">
                  {driver.hasFeaturedTruckPhoto ? (
                    // eslint-disable-next-line @next/next/no-img-element -- authorized streaming route, not a static asset
                    <img
                      alt={`${driver.name}'s truck`}
                      className="fleet-driver-row__truck-photo"
                      height={64}
                      loading="lazy"
                      src={`/api/media/featured-truck?driverProfileId=${driver.id}`}
                      width={64}
                    />
                  ) : (
                    <span aria-hidden className="fleet-driver-row__photo-placeholder">
                      <Icon name="nav.fleet" size={22} />
                    </span>
                  )}
                  <div className="fleet-driver-row__who">
                    <h3 id={`fleet-driver-${driver.id}`}>{driver.name}</h3>
                    <span>{driver.homeBase} · {driver.yearsExperience} yrs</span>
                    <span className="fleet-driver-row__rig">
                      <Icon aria-hidden name="truck.log" size={16} />
                      {driver.equipmentLabel ?? "No truck assigned"}
                    </span>
                  </div>
                </div>
                <div className="fleet-driver-row__state">
                  <span className="card-kicker">Current capacity</span>
                  <Badge tone={presentation.currentTone}>{presentation.currentLabel}</Badge>
                  <span>{presentation.currentDetail}</span>
                </div>
                <div className="fleet-driver-row__gate">
                  <span className="card-kicker">Work gate</span>
                  <strong>{presentation.gateLabel}</strong>
                  <span>{presentation.gateDetail}</span>
                </div>
                <nav aria-label={`Actions for ${driver.name}`} className="fleet-driver-row__actions">
                  <Link className="action-link action-link--secondary" href={presentation.actionHref}>
                    {presentation.actionLabel}
                  </Link>
                  {driver.phone ? <a className="text-link" href={`tel:${driver.phone}`}>Call driver</a> : null}
                </nav>
              </article>
            ))}
          </div>
        </section>
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
                        {/* A dispatcher chasing a disputed figure needs the
                            ticket itself, not its filename. Records with no
                            stored file stay listed, unlinked. */}
                        <span className="fleet-trip-timeline__note">
                          {trip.documents.map((document, index) => (
                            <Fragment key={document.id}>
                              {index > 0 ? ", " : null}
                              {document.viewable ? (
                                <a href={`/api/trip-documents/asset?documentId=${document.id}`} rel="noreferrer" target="_blank">
                                  {document.filename}
                                </a>
                              ) : (
                                document.filename
                              )}
                            </Fragment>
                          ))}
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
  const receivedOffers = network.directOffers.filter((offer) =>
    offer.direction === "received" && offer.actionable && offer.remainingTruckloads > 0
  )

  return (
    <AppShell account={account} role="fleet" title="Opportunities" kicker="Put trucks to work" orgName={network.activeOrganization.name}>
      {receivedOffers.length > 0 ? (
        <section className="fleet-panel" aria-label="Direct offers awaiting a truck">
          <SectionHeader eyebrow="Direct offers" title="Partners invited your trucks" />
          <div className="board-list">
            {receivedOffers.map((offer) => (
              <article className="trip-row" key={offer.id}>
                <div>
                  <strong>{offer.loadTitle}</strong>
                  <span>
                    {offer.counterpartName} · {offer.acceptedTruckloads} of {offer.offeredTruckloads} accepted · expires {formatDateTime(offer.expiresAt)}
                  </span>
                </div>
                <Link className="action-link" href={opportunityHref(offer.loadPostingId)} prefetch={false}>Review offer</Link>
              </article>
            ))}
          </div>
        </section>
      ) : null}
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
  const serverDirectOffer = load
    ? network.directOffers.find((offer) =>
        offer.direction === "received" &&
        offer.loadPostingId === load.id &&
        offer.actionable &&
        offer.remainingTruckloads > 0
      ) ?? null
    : null
  const [optimisticOffer, setOptimisticOffer] = useState<{
    directOfferId: string
    remainingTruckloads: number
    serverRemainingTruckloads: number
  } | null>(null)
  const [claimConvergence, setClaimConvergence] = useState<{
    directOfferId: string
    equipmentCombinationId: string
    serverRemainingTruckloads: number
  } | null>(null)

  useEffect(() => {
    setOptimisticOffer((current) =>
      current &&
      (
        current.directOfferId !== serverDirectOffer?.id ||
        current.serverRemainingTruckloads !==
          serverDirectOffer.remainingTruckloads
      )
        ? null
        : current
    )
    setClaimConvergence((current) =>
      current &&
      (
        current.directOfferId !== serverDirectOffer?.id ||
        current.serverRemainingTruckloads !==
          serverDirectOffer.remainingTruckloads
      )
        ? null
        : current
    )
  }, [serverDirectOffer?.id, serverDirectOffer?.remainingTruckloads])

  const claimConvergenceActive = Boolean(
    claimConvergence &&
    claimConvergence.directOfferId === serverDirectOffer?.id &&
    claimConvergence.serverRemainingTruckloads ===
      serverDirectOffer.remainingTruckloads
  )

  // A claim whose canonical refresh never lands must not pin this panel
  // forever: after a bounded wait the operator gets an explicit retry.
  const router = useRouter()
  const [claimConvergenceStalled, setClaimConvergenceStalled] = useState(false)
  const [refreshPending, startRefreshTransition] = useTransition()
  useEffect(() => {
    if (!claimConvergenceActive) {
      setClaimConvergenceStalled(false)
      return
    }

    const stalledTimer = setTimeout(() => {
      setClaimConvergenceStalled(true)
    }, 12_000)

    return () => clearTimeout(stalledTimer)
  }, [claimConvergenceActive])
  useEffect(() => {
    if (!claimConvergenceActive || claimConvergenceStalled || refreshPending) {
      return
    }

    // A refresh issued inside the action transition can be folded into that
    // response. Ask again only after the previous refresh has settled so slow
    // server projections cannot stack work in the browser. The separate
    // deadline above preserves the explicit manual fallback.
    const refreshTimer = setTimeout(() => {
      startRefreshTransition(() => router.refresh())
    }, 1_500)

    return () => clearTimeout(refreshTimer)
  }, [claimConvergenceActive, claimConvergenceStalled, refreshPending, router])
  const displayedRemainingTruckloads = serverDirectOffer
    ? optimisticOffer?.directOfferId === serverDirectOffer.id &&
      optimisticOffer.serverRemainingTruckloads ===
        serverDirectOffer.remainingTruckloads
      ? optimisticOffer.remainingTruckloads
      : serverDirectOffer.remainingTruckloads
    : 0
  const directOffer =
    serverDirectOffer && displayedRemainingTruckloads > 0
      ? {
          ...serverDirectOffer,
          remainingTruckloads: displayedRemainingTruckloads
        }
      : null
  const recordDirectOfferClaim = (equipmentCombinationId: string) => {
    if (!serverDirectOffer) {
      return
    }

    setClaimConvergence({
      directOfferId: serverDirectOffer.id,
      equipmentCombinationId,
      serverRemainingTruckloads: serverDirectOffer.remainingTruckloads
    })
    setOptimisticOffer((current) => ({
      directOfferId: serverDirectOffer.id,
      remainingTruckloads: Math.max(
        0,
        current?.directOfferId === serverDirectOffer.id &&
          current.serverRemainingTruckloads ===
            serverDirectOffer.remainingTruckloads
          ? current.remainingTruckloads - 1
          : serverDirectOffer.remainingTruckloads - 1
      ),
      serverRemainingTruckloads: serverDirectOffer.remainingTruckloads
    }))
  }

  return (
    <AppShell account={account} contentOwnsHeading role="fleet" title="Load detail" kicker="Dispatch decision" orgName={network.activeOrganization.name}>
      {!load ? (
        <EmptyState
          title="Load not found."
          body="This load may have been filled or is no longer visible to your organization."
          actionHref="/fleet/opportunities"
          actionLabel="Back to opportunities"
        />
      ) : (
        <div className="fleet-detail">
          <div className="fleet-detail__main">
            <div className="fleet-detail__summary">
              <Link className="back-link" href="/fleet/opportunities">Back to opportunities</Link>
              <p className="eyebrow">{load.landing.city} to {load.destination.name}</p>
              <h1>{load.title}</h1>
              <p className="lead">{load.scheduleLabel} · {load.payLabel} · {load.capacity.remaining} of {load.capacity.total} loads open</p>
              <div className="fleet-detail__badges">
                <Badge tone={load.visibilityMode === "private_network" ? "info" : "neutral"}>{visibilityLabel(load)}</Badge>
                <Badge tone={load.capacity.remaining > 0 ? "success" : "warning"}>{load.capacity.remaining > 0 ? "Capacity open" : "All loads assigned"}</Badge>
              </div>
            </div>
            {directOffer ? (
              <section className="fleet-panel" aria-label="Direct offer">
                <SectionHeader eyebrow="Direct offer" title={`${directOffer.remainingTruckloads} truckload${directOffer.remainingTruckloads === 1 ? "" : "s"} still invited`} />
                <p>
                  {directOffer.counterpartName} invited up to {directOffer.offeredTruckloads} trucks. Capacity is committed only when each truck is accepted below.
                </p>
                <p>Offer expires {formatDateTime(directOffer.expiresAt)}.</p>
                <DeclineDirectOfferButton directOfferId={directOffer.id} />
              </section>
            ) : null}
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
            <h2>{directOffer || claimConvergenceActive ? "Accept with a truck" : "Send a truck"}</h2>
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
                    claimConvergenceActive ? (
                      <div className="fleet-action" role="status">
                        <Badge tone={claimConvergence?.equipmentCombinationId === option.combinationId ? "success" : "neutral"}>
                          {claimConvergence?.equipmentCombinationId === option.combinationId
                            ? "Truck confirmed"
                            : "Refreshing offer"}
                        </Badge>
                        <p className="fleet-action__hint">
                          {claimConvergence?.equipmentCombinationId === option.combinationId
                            ? "The assignment and field Route Pack are ready."
                            : "Waiting for the next canonical haul window before another truck can be assigned."}
                        </p>
                        {claimConvergenceStalled ? (
                          <button
                            className="action-link action-link--secondary"
                            onClick={() => router.refresh()}
                            type="button"
                          >
                            Refresh offer status
                          </button>
                        ) : null}
                      </div>
                    ) : directOffer ? (
                      <ClaimDirectOfferButton
                        directOfferId={directOffer.id}
                        equipmentCombinationId={option.combinationId}
                        onClaimed={() => recordDirectOfferClaim(option.combinationId)}
                        truckSlotId={load.slots.claimableSlotId}
                      />
                    ) : (
                      <RequestForTruckButton
                        driverProfileId={option.driverProfileId}
                        loadPostingId={load.id}
                        truckSlotId={load.slots.requestableSlotId}
                      />
                    )
                  ) : null}
                </article>
              ))
            )}
          </aside>
        </div>
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
