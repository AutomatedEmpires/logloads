"use client"

import Link from "next/link"
import type { CSSProperties } from "react"
import { Badge, Icon } from "@logloads/ui"

import type {
  HostLandingRecord,
  HostLoadPlanFacts,
  HostPublishingOptions,
  HostWorkspaceSetup
} from "@/lib/host-data"
import { hostPercentagePublicationIsReady } from "@/lib/host-publishing-options"
import type { NetworkLoadView, NetworkView } from "@/lib/network"
import { formatDateTime, formatHuman, tripStatusLabel } from "@/lib/v3-shared"
import { DecisionList, toneForNotice } from "./Common"
import {
  CancelAssignmentButton,
  CapacityApprovalList,
  CloseWorkButton,
  DirectOfferPanel,
  DriverPaymentControl,
  NoticeComposer,
  OpportunityBuilder,
  PublishDraftButton,
  RefreshRoutePackButton,
  SettleDeliveryControl,
  type PendingCapacityRequest
} from "./HostActions"
import {
  LaneBuilder,
  LandingActiveToggle,
  LandingDetailsForm,
  LandingForm,
  MillActiveToggle,
  MillForm,
  RateForm
} from "./HostWorkspaceActions"
import { TripReviewForm } from "./Reputation"
import { AppShell, EmptyState, Metric, type ShellAccount } from "./Shells"

interface HostPageProps {
  account: ShellAccount
  network: NetworkView
}

export function HostOpportunityAction({
  activationComplete,
  canPublish,
  context
}: {
  activationComplete: boolean
  canPublish: boolean
  context: "command" | "landing"
}) {
  const action = hostOpportunityActionState({ activationComplete, canPublish, context })

  return (
    <Link className={action.className} href={action.href}>
      {action.label}
    </Link>
  )
}

export function hostOpportunityActionState({
  activationComplete,
  canPublish,
  context
}: {
  activationComplete: boolean
  canPublish: boolean
  context: "command" | "landing"
}): { className: string; href: string; label: string } {
  if (!canPublish) {
    return {
      className: "action-link action-link--secondary",
      href: context === "landing" ? "/host/settings" : "/host/opportunities",
      label: context === "landing" ? "Review workspace access" : "Review work"
    }
  }

  return {
    className: context === "landing" ? "action-link action-link--secondary" : "action-link",
    href: "/host/opportunities",
    label: context === "landing" || !activationComplete ? "Prepare work" : "Publish work"
  }
}

export function hostCapacityGapEmptyState({
  activationComplete,
  canPublish,
  planned
}: {
  activationComplete: boolean
  canPublish: boolean
  planned: number
}): { actionHref: string; actionLabel: string; body: string; title: string } {
  const action = hostOpportunityActionState({
    activationComplete,
    canPublish,
    context: "command"
  })

  if (planned === 0) {
    return {
      actionHref: action.href,
      actionLabel: action.label,
      body: canPublish
        ? activationComplete
          ? "Drafts and closed work do not create live capacity. Publish the next block when it is ready to move."
          : "Drafts and closed work do not create live capacity. Prepare the next block now; publication remains locked until host billing activation is ready."
        : "No live capacity is published. Review Work to follow drafts and closed records; an authorized publisher opens the next block.",
      title: "No published capacity yet."
    }
  }

  return {
    actionHref: action.href,
    actionLabel: action.label,
    body: canPublish
      ? activationComplete
        ? "Every planned truckload is committed. Publish the next block when it is ready to move."
        : "Every planned truckload is committed. Prepare the next block now; publication remains locked until host billing activation is ready."
      : "Every planned truckload is committed. Review the operation while an authorized publisher prepares the next block.",
    title: "No open gaps."
  }
}

type HostTrip = NetworkView["trips"][number]

function ownLoads(network: NetworkView): NetworkLoadView[] {
  return network.loads.filter((load) => load.sourceOrganizationId === network.activeOrganization.id)
}

function activeLoads(loads: NetworkLoadView[]): NetworkLoadView[] {
  return loads.filter((load) => !["archived", "cancelled", "completed"].includes(load.status))
}

interface HostReadinessFacts {
  activeLandingCount: number
  activeRouteCount: number
  hasDraft: boolean
  hasLanding: boolean
  hasRate: boolean
  hasRoute: boolean
  preparedWorkCount: number
  rateCount: number
  readyCount: number
}

function getHostReadinessFacts(
  network: NetworkView,
  options: HostPublishingOptions,
  setup: HostWorkspaceSetup
): HostReadinessFacts {
  const activeLandingIds = new Set(options.landings.map((landing) => landing.id))
  const activeRouteCount = options.routes.filter((route) =>
    activeLandingIds.has(route.landingId)
  ).length
  const preparedWorkCount = ownLoads(network).length
  const hasLanding = setup.activeLandingCount > 0 && activeLandingIds.size > 0
  const hasRoute = activeRouteCount > 0
  const hasRate = setup.rates.length > 0
  const hasDraft = preparedWorkCount > 0

  return {
    activeLandingCount: setup.activeLandingCount,
    activeRouteCount,
    hasDraft,
    hasLanding,
    hasRate,
    hasRoute,
    preparedWorkCount,
    rateCount: setup.rates.length,
    readyCount: [hasLanding, hasRoute, hasRate, hasDraft].filter(Boolean).length
  }
}

export function HostReadiness({
  activationState,
  billingProfileStatus,
  billingModel,
  canManageLandings,
  canPublish,
  continuationHref,
  currentPercentageAgreementActive,
  facts,
  title,
  welcome = false,
  welcomeSource,
  workspaceName
}: {
  activationState: HostPublishingOptions["billingActivationState"]
  billingProfileStatus: HostPublishingOptions["billingProfileStatus"]
  billingModel: HostPublishingOptions["billingModel"]
  canManageLandings: boolean
  canPublish: boolean
  continuationHref?: string
  currentPercentageAgreementActive: boolean
  facts: HostReadinessFacts
  title: string
  welcome?: boolean
  welcomeSource?: "created" | "invited"
  workspaceName: string
}) {
  const activationComplete = hostPercentagePublicationIsReady({
    billingActivationState: activationState,
    billingModel,
    billingProfileStatus,
    currentPercentageAgreementActive
  })
  const operatingSteps = [
    {
      complete: facts.hasLanding,
      detail: facts.hasLanding
        ? `${facts.activeLandingCount} active landing${facts.activeLandingCount === 1 ? "" : "s"} ready for operating details.`
        : "Add the operating site where trucks load.",
      title: "Add a landing"
    },
    {
      complete: facts.hasRoute,
      detail: facts.hasRoute
        ? `${facts.activeRouteCount} lane${facts.activeRouteCount === 1 ? "" : "s"} connect active landings to destinations.`
        : "Connect that landing to the mill or destination.",
      title: "Add a lane"
    },
    {
      complete: facts.hasRate,
      detail: facts.hasRate
        ? `${facts.rateCount} pay rate${facts.rateCount === 1 ? "" : "s"} available for a posting.`
        : "Record the standing rate used for your operating record.",
      title: "Add a pay rate"
    },
    {
      complete: facts.hasDraft,
      detail: facts.hasDraft
        ? `${facts.preparedWorkCount} movement record${facts.preparedWorkCount === 1 ? "" : "s"} prepared.`
        : "Save the first movement as a draft without putting it live.",
      title: "Prepare a draft"
    }
  ]
  const nextIndex = operatingSteps.findIndex((step) => !step.complete)
  const setupActions = [
    {
      allowed: canManageLandings,
      href: "/host/landings?welcome=1#add-landing",
      label: "Add first landing"
    },
    {
      allowed: canPublish,
      href: "/host/landings?welcome=1#landings",
      label: "Add first lane"
    },
    {
      allowed: canPublish,
      href: "/host/landings?welcome=1#pay-rate",
      label: "Add pay rate"
    },
    {
      allowed: canPublish,
      href: "/host/opportunities",
      label: "Prepare first draft"
    }
  ]
  const requiredSetupAction =
    nextIndex >= 0 ? setupActions[nextIndex] ?? null : null
  let activationDetail: string

  if (activationComplete) {
    activationDetail =
      "The current 5% completed-load agreement is active and a working payment method is attached."
  } else if (activationState === "suspended") {
    activationDetail =
      "Activation is suspended. Contact LogLoads to resolve the operating hold before publication resumes."
  } else if (activationState === "legacy") {
    activationDetail =
      "Historical percentage assignments remain preserved. Accept the current agreement from Billing before publishing new live work."
  } else if (billingModel && billingModel !== "percentage_v1") {
    activationDetail =
      "A historical commercial record exists. Reconcile it from Billing before new percentage work can activate."
  } else if (currentPercentageAgreementActive && billingModel === "percentage_v1") {
    if (billingProfileStatus === "failed") {
      activationDetail =
        "The current 5% completed-load agreement is active, but the payment method failed. Replace it in Billing before publishing live work."
    } else if (billingProfileStatus === null) {
      activationDetail =
        "The current 5% completed-load agreement is active, but the billing profile is conflicting. Resolve it before publishing live work."
    } else if (billingProfileStatus === "attached") {
      activationDetail =
        "The current 5% completed-load agreement is active, but activation is not recorded yet. Reconcile it in Billing before publishing live work."
    } else {
      activationDetail =
        "The current 5% completed-load agreement is active. Attach a working payment method in Billing before publishing live work."
    }
  } else if (activationState === "percentage_active") {
    activationDetail =
      "The percentage agreement record is incomplete or not current. Reconcile it in Billing before publishing live work."
  } else if (billingModel) {
    activationDetail =
      "A historical commercial record exists. Reconcile it from Billing before new percentage work can activate."
  } else {
    activationDetail =
      "Pilot activation is invitation-based. Review Billing to accept the current 5% agreement and attach a card when this workspace is approved. Workspace setup itself does not charge you."
  }
  const readinessDescription = welcome
    ? welcomeSource === "invited"
      ? activationComplete
        ? workspaceName +
          " is now your active host workspace. The agreement and payment method are ready. Finish the operating record to put your first movement live."
        : workspaceName +
          " is now your active host workspace. Build the operating record with your team; live publication stays off until percentage billing is approved and activated."
      : welcomeSource === "created"
        ? activationComplete
          ? "Your host workspace is created. The agreement and payment method are ready. Finish the operating record to put your first movement live."
          : "Your host workspace is created. Build the operating record now; live publication stays off until percentage billing is approved and activated."
        : activationComplete
          ? "This host workspace is ready. The agreement and payment method are ready. Finish the operating record to put your first movement live."
          : "This host workspace is ready for setup. Build the operating record now; live publication stays off until percentage billing is approved and activated."
    : activationComplete
      ? "The agreement and payment method are ready. Finish the operating record to put your first movement live."
      : "Build the operating record now. Live publication stays off until this workspace is approved for percentage billing and completes activation."
  const nextAction = requiredSetupAction
    ? requiredSetupAction.allowed
      ? {
          href: requiredSetupAction.href,
          label: requiredSetupAction.label,
          note: "Setup is free. No card is charged while you prepare the workspace."
        }
      : {
          href: "/host/settings",
          label: "Review workspace access",
          note: "An owner, admin, or authorized operations manager must complete the next setup step."
        }
    : activationComplete
      ? {
          href: "/host/command",
          label: "Open command center",
          note: "Activation is recorded for this workspace."
        }
      : {
          href: "/host/billing",
          label: "Review host billing",
          note: activationDetail
        }
  const steps = [
    ...operatingSteps,
    {
      complete: activationComplete,
      detail: activationDetail,
      title: "Host billing activation"
    }
  ]

  return (
    <section
      aria-labelledby="host-readiness-title"
      className={`host-readiness${welcome ? " host-readiness--welcome" : ""}`}
      data-testid={welcome ? "host-first-run" : undefined}
    >
      <header className="host-readiness__head">
        <div>
          <p className="eyebrow">
            {welcome
              ? welcomeSource === "invited"
                ? "Workspace joined"
                : welcomeSource === "created"
                  ? "Workspace created"
                  : "Workspace ready"
              : "First movement launchpad"}
          </p>
          <h2 id="host-readiness-title">{title}</h2>
          <p>{readinessDescription}</p>
        </div>
        <div className="host-readiness__progress">
          <strong>{facts.readyCount} of 4 operating steps ready</strong>
          <span>
            {activationComplete
              ? "Billing activation is complete for this workspace."
              : "Pilot billing activation is a separate final step."}
          </span>
          <div
            aria-hidden
            className="host-readiness__meter"
            style={{ "--fill": `${facts.readyCount * 25}%` } as CSSProperties}
          >
            <span />
          </div>
        </div>
      </header>
      <div className="host-readiness__actions">
        <Link className="action-link" href={nextAction.href}>{nextAction.label}</Link>
        {welcome && continuationHref ? (
          <form action="/host/first-run/continue" method="post">
            <button className="action-link action-link--secondary" type="submit">
              Continue to the host work you opened
            </button>
          </form>
        ) : null}
        <span>{nextAction.note}</span>
      </div>
      <ol className="host-readiness__steps">
        {steps.map((step, index) => {
          const isAssisted = index === steps.length - 1
          const isNext =
            index === nextIndex ||
            (isAssisted && nextIndex === -1 && !activationComplete)
          const status = isAssisted
            ? step.complete
              ? "Ready"
              : "Pilot"
            : step.complete
              ? "Ready"
              : isNext
                ? "Next"
                : "Waiting"

          return (
            <li
              className={`${step.complete ? "is-complete" : ""}${isNext ? " is-next" : ""}${isAssisted ? " is-assisted" : ""}`}
              key={step.title}
            >
              <span aria-hidden className="host-readiness__marker">
                {step.complete ? <Icon name="status.verified" size={18} /> : index + 1}
              </span>
              <div>
                <strong>{step.title}</strong>
                <span>{step.detail}</span>
              </div>
              <Badge tone={step.complete ? "success" : isNext ? "warning" : isAssisted ? "info" : "neutral"}>
                {status}
              </Badge>
            </li>
          )
        })}
      </ol>
    </section>
  )
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
  if (condition === "wet" || condition === "muddy" || condition === "not_recorded") return "warning"

  return "critical"
}

// --- Command -------------------------------------------------------------------

export function HostCommand({
  account,
  canManageLandings,
  canPublish,
  network,
  options,
  setup
}: HostPageProps & {
  canManageLandings: boolean
  canPublish: boolean
  options: HostPublishingOptions
  setup: HostWorkspaceSetup
}) {
  const own = ownLoads(network)
  const readiness = getHostReadinessFacts(network, options, setup)
  const activationComplete = hostPercentagePublicationIsReady(options)
  const showReadiness =
    own.length === 0 ||
    (!activationComplete && options.billingActivationState !== "suspended")
  const active = activeLoads(own)
  const planned = active.reduce((sum, load) => sum + load.capacity.total, 0)
  const committed = active.reduce((sum, load) => sum + load.capacity.committed, 0)
  const delivered = active.reduce((sum, load) => sum + load.capacity.completed, 0)
  const remaining = active.reduce((sum, load) => sum + load.capacity.remaining, 0)
  const requests = pendingRequests(own)
  const gaps = active.filter(
    (load) => load.capacity.remaining > 0 && ["open", "scheduled"].includes(load.status)
  )
  const capacityGapEmptyState = hostCapacityGapEmptyState({
    activationComplete,
    canPublish,
    planned
  })

  return (
    <AppShell account={account} kicker="Landing operations" role="host" title="Command">
      {showReadiness ? (
        <HostReadiness
          activationState={options.billingActivationState}
          billingProfileStatus={options.billingProfileStatus}
          billingModel={options.billingModel}
          canManageLandings={canManageLandings}
          canPublish={canPublish}
          currentPercentageAgreementActive={options.currentPercentageAgreementActive}
          facts={readiness}
          title={
            readiness.readyCount === 4
              ? "Complete billing activation"
              : "Finish workspace setup"
          }
          workspaceName={network.activeOrganization.name}
        />
      ) : null}
      <section className="host-need">
        <p className="eyebrow">Capacity position</p>
        <h2>
          {planned === 0
            ? showReadiness
              ? "No published capacity yet"
              : "No truckloads scheduled"
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
        <HostOpportunityAction
          activationComplete={activationComplete}
          canPublish={canPublish}
          context="command"
        />
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
              actionHref={capacityGapEmptyState.actionHref}
              actionLabel={capacityGapEmptyState.actionLabel}
              body={capacityGapEmptyState.body}
              title={capacityGapEmptyState.title}
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
  canPublish,
  network,
  options,
  planFacts
}: HostPageProps & { canPublish: boolean; options: HostPublishingOptions; planFacts: HostLoadPlanFacts }) {
  const own = ownLoads(network)

  return (
    <AppShell account={account} kicker="Publish capacity" role="host" title="Work">
      <section className="builder-layout">
        {canPublish ? (
          <OpportunityBuilder options={options} />
        ) : (
          <article className="opportunity-builder host-builder">
            <p className="eyebrow">Opportunity builder</p>
            <h2>Your role does not publish work</h2>
            <p className="host-builder-note">
              You can follow this operation&rsquo;s work here. Posting, publishing, and closing work is done by an
              owner, admin, dispatcher, or landing manager.
            </p>
          </article>
        )}
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
                    {canPublish && load.status === "draft" ? (
                      <PublishDraftButton loadPostingId={load.id} options={options} />
                    ) : null}
                    {canPublish && ["open", "scheduled", "filled"].includes(load.status) ? (
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
                      {/* Settling unmounts the control below, so the outcome
                          lives on the card rather than in a message that
                          disappears with it. */}
                      {trip.completion.status === "confirmed" ? (
                        <>
                          <span className="review-done">
                            <Icon aria-hidden name="status.verified" size={14} />{" "}
                            {trip.completion.deliveredQuantity
                              ? `${trip.completion.deliveredQuantity.value} ${trip.completion.deliveredQuantity.unit} confirmed`
                              : "Delivery confirmed"}
                          </span>
                          <DriverPaymentControl
                            assignmentId={trip.assignmentId}
                            driverName={trip.driverName}
                            expectedPayLabel={trip.driverPayment.expectedPayLabel}
                            matchesExpected={trip.driverPayment.matchesExpected}
                            receivedPayLabel={trip.driverPayment.receivedPayLabel}
                            status={trip.driverPayment.status}
                          />
                        </>
                      ) : null}
                      {/* The host is being asked to accept a figure. The proof
                          behind it belongs on the same card as the decision —
                          confirming a number you cannot check is not settling,
                          it is guessing. */}
                      {trip.documents.length > 0 ? (
                        <ul className="live-card__docs">
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
                      {/* A recorded delivery waits on the host, whether or not
                          the trip itself has closed. */}
                      {["submitted", "disputed"].includes(trip.completion.status) ? (
                        <SettleDeliveryControl
                          driverName={trip.driverName}
                          record={{
                            exceptionLabel: trip.completion.exception
                              ? `${formatHuman(trip.completion.exception.type)}: ${trip.completion.exception.note}`
                              : null,
                            quantityLabel: trip.completion.deliveredQuantity
                              ? `${trip.completion.deliveredQuantity.value} ${trip.completion.deliveredQuantity.unit} delivered`
                              : null,
                            status: trip.completion.status,
                            ticketNumber: trip.completion.deliveredQuantity?.ticketNumber ?? null
                          }}
                          tripId={trip.id}
                        />
                      ) : null}
                      {!["cancelled", "completed"].includes(trip.status) ? (
                        <>
                          <RefreshRoutePackButton assignmentId={trip.assignmentId} driverName={trip.driverName} />
                          <CancelAssignmentButton assignmentId={trip.assignmentId} driverName={trip.driverName} />
                        </>
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
  canManageDestinations,
  canManageLandings,
  canPublish,
  continuation,
  landings,
  network,
  options,
  setup,
  welcome = false,
  welcomeSource
}: HostPageProps & {
  canManageDestinations: boolean
  canManageLandings: boolean
  canPublish: boolean
  continuation?: string
  landings: HostLandingRecord[]
  options: HostPublishingOptions
  setup: HostWorkspaceSetup
  welcome?: boolean
  welcomeSource?: "created" | "invited"
}) {
  const atLimit = setup.landingLimit !== null && setup.activeLandingCount >= setup.landingLimit
  const readiness = getHostReadinessFacts(network, options, setup)
  const activationComplete = hostPercentagePublicationIsReady(options)
  const showReadiness =
    welcome || readiness.readyCount < 4 || !activationComplete

  return (
    <AppShell account={account} kicker="Access control" role="host" title="Landings">
      {showReadiness ? (
        <HostReadiness
          activationState={options.billingActivationState}
          billingProfileStatus={options.billingProfileStatus}
          billingModel={options.billingModel}
          canManageLandings={canManageLandings}
          canPublish={canPublish}
          continuationHref={continuation}
          currentPercentageAgreementActive={options.currentPercentageAgreementActive}
          facts={readiness}
          title="Prepare your first timber movement"
          welcome={welcome}
          welcomeSource={welcomeSource}
          workspaceName={network.activeOrganization.name}
        />
      ) : null}
      {canManageLandings ? (
        <section className="workspace-section" id="add-landing">
          <header className="workspace-section__head">
            <h2>Add a landing</h2>
            {/* No live plan and a full plan are different problems and read
                differently: there is no slot to free when the plan covers none,
                so telling them to retire one would send them somewhere that
                cannot help. The service refuses these two the same way. */}
            <p>
              {setup.landingLimit === null
                ? options.billingModel === "percentage_v1" && options.billingActivationState === "percentage_active"
                  ? "The current 5% completed-load agreement has no landing tier or allowance."
                  : "This historical agreement does not cap active landings."
                : setup.landingLimit === 0
                  ? "This workspace cannot add an active landing until its commercial record is reconciled."
                  : options.billingActivationState === "unenrolled"
                    ? `Pilot preparation includes ${setup.landingLimit} active landing before activation — ${setup.activeLandingCount} in use.`
                    : `The historical agreement covers ${setup.landingLimit} active landing${setup.landingLimit === 1 ? "" : "s"} — ${setup.activeLandingCount} in use.`}
            </p>
          </header>
          {atLimit ? (
            <p className="workspace-hint">
              {setup.landingLimit === 0
                ? "Check your billing to add landing coverage before setting one up."
                : "You are using every active landing your plan covers. Retire one below to free the slot, or talk to us about more."}
            </p>
          ) : (
            <LandingForm />
          )}
        </section>
      ) : null}

      {canManageDestinations ? (
        <section className="workspace-section" id="destinations">
          <header className="workspace-section__head">
            <h2>Destinations</h2>
            <p>Add the mill, scale house, yard, or other endpoint a lane delivers to. Host reports remain marked as reported until an operating verification is recorded.</p>
          </header>
          {setup.destinations.length > 0 ? (
            <ul className="workspace-list workspace-destination-list">
              {setup.destinations.map((destination) => (
                <li key={destination.id}>
                  <strong>{destination.label}</strong>
                  <span>
                    {destination.isActive ? "Available for new lanes" : "Retired from new lanes"} · {formatHuman(destination.roadCondition)} road
                  </span>
                  <details className="workspace-edit">
                    <summary>Edit destination</summary>
                    <MillForm mill={destination.editable} millId={destination.id} />
                    <MillActiveToggle isActive={destination.isActive} millId={destination.id} />
                  </details>
                </li>
              ))}
            </ul>
          ) : (
            <p className="workspace-hint">No organization-owned destinations are on file yet. Shared platform destinations still remain available in lane builders.</p>
          )}
          <details className="workspace-details">
            <summary>Add a destination</summary>
            <MillForm />
          </details>
        </section>
      ) : null}

      {canPublish ? (
        <section className="workspace-section" id="pay-rate">
          <header className="workspace-section__head">
            <h2>Rates you pay</h2>
            <p>Every posting carries one. Add the rates you haul at, then pick one when you publish.</p>
          </header>
          {setup.rates.length > 0 ? (
            <ul className="workspace-list">
              {setup.rates.map((rate) => (
                <li key={rate.id}>
                  <strong>{rate.label}</strong>
                  <span>from {rate.effectiveDate}{rate.notes ? ` · ${rate.notes}` : ""}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="workspace-hint">No rates on file yet. Work cannot be published without one.</p>
          )}
          <RateForm />
        </section>
      ) : null}

      <section className="host-landing-grid" id="landings">
        {landings.length === 0 ? (
          <EmptyState
            body={
              canManageLandings
                ? `No landings are on file for ${network.activeOrganization.name} yet. Add the first one above — work is published from a landing, so nothing can be posted until one exists.`
                : `No landings are on file for ${network.activeOrganization.name} yet. An owner, admin, or landing manager can add one.`
            }
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

              {/* A lane is what a posting quotes a driver: where the logs go, how
                  far, how long. Lanes hang off the landing they leave from. */}
              <div className="workspace-lanes">
                <h3>Lanes from this landing</h3>
                {landing.lanes.length === 0 ? (
                  <p className="workspace-hint">
                    No lanes yet. Work published from this landing needs one, so a driver knows where the load is going.
                  </p>
                ) : (
                  <ul className="workspace-list">
                    {landing.lanes.map((lane) => (
                      <li key={lane.id}>
                        <strong>{lane.routeName}</strong>
                        <span>
                          {lane.millLabel} · {lane.distanceMiles} mi · {lane.runTimeMinutes} min ·{" "}
                          {formatHuman(lane.roadCondition)} road
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {canPublish ? <LaneBuilder landingId={landing.id} mills={setup.mills} /> : null}
              </div>

              {canManageLandings && landing.details ? (
                <>
                  <details className="workspace-edit">
                    <summary>Driver briefing</summary>
                    <LandingDetailsForm details={landing.details} landingId={landing.id} />
                  </details>
                  <details className="workspace-edit">
                    <summary>Edit landing</summary>
                    <LandingForm landing={landing.editable} landingId={landing.id} />
                    <LandingActiveToggle isActive={landing.isActive} landingId={landing.id} />
                  </details>
                </>
              ) : null}

              <footer>
                <span>
                  {landing.isActive
                    ? landing.lastVerifiedAt
                      ? `Details verified ${formatDateTime(landing.lastVerifiedAt)}`
                      : "Details not yet verified"
                    : "Retired — not available for new work"}
                </span>
                <HostOpportunityAction
                  activationComplete={activationComplete}
                  canPublish={canPublish}
                  context="landing"
                />
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
  const sentOffers = network.directOffers
    .filter((offer) => offer.direction === "sent")
    .map((offer) => ({
      acceptedTruckloads: offer.acceptedTruckloads,
      actionable: offer.actionable,
      counterpartName: offer.counterpartName,
      expiresAt: offer.expiresAt,
      id: offer.id,
      loadTitle: offer.loadTitle,
      offeredTruckloads: offer.offeredTruckloads,
      remainingTruckloads: offer.remainingTruckloads,
      status: offer.status
    }))
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
          <p>Invite a trusted partner to assign trucks. Capacity is committed only when each truck is accepted.</p>
          <DirectOfferPanel loads={offerable} partners={partners} sentOffers={sentOffers} />
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
