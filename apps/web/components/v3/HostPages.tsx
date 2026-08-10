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

type HostLandingView = Omit<HostLandingRecord, "editable"> & {
  editable: HostLandingRecord["editable"] | null
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
  liveWorkCount = 0,
  planned
}: {
  activationComplete: boolean
  canPublish: boolean
  liveWorkCount?: number
  planned: number
}): { actionHref: string; actionLabel: string; body: string; title: string } {
  const action = hostOpportunityActionState({
    activationComplete,
    canPublish,
    context: "command"
  })

  if (planned === 0 && liveWorkCount > 0) {
    return {
      actionHref: "/host/opportunities#live-work",
      actionLabel: "Review loading slots",
      body: canPublish
        ? "Work is already live, but no truckload loading slots are scheduled. Review the live posting and its slot status before directing haulers to request it."
        : "Work is already live, but no truckload loading slots are scheduled. Review the live posting; an authorized publisher manages when capacity becomes available to haulers.",
      title: "Live work has no loading slots."
    }
  }

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
type HostNotice = NetworkView["notices"][number]

const HOST_LIVE_LOAD_STATUSES = new Set<NetworkLoadView["status"]>([
  "open",
  "scheduled",
  "filled",
  "in_transit"
])

const HOST_SCHEDULE_PRIORITY: Record<NetworkLoadView["status"], number> = {
  archived: 7,
  cancelled: 6,
  completed: 5,
  draft: 4,
  filled: 1,
  in_transit: 0,
  open: 3,
  scheduled: 2
}

function ownLoads(network: NetworkView): NetworkLoadView[] {
  return network.loads.filter((load) => load.sourceOrganizationId === network.activeOrganization.id)
}

function activeLoads(loads: NetworkLoadView[]): NetworkLoadView[] {
  return loads.filter((load) => HOST_LIVE_LOAD_STATUSES.has(load.status))
}

export function hostWorkPresentation(loads: NetworkLoadView[]): {
  drafts: NetworkLoadView[]
  history: NetworkLoadView[]
  live: NetworkLoadView[]
} {
  const live: NetworkLoadView[] = []
  const drafts: NetworkLoadView[] = []
  const history: NetworkLoadView[] = []

  for (const load of loads) {
    if (HOST_LIVE_LOAD_STATUSES.has(load.status)) {
      live.push(load)
    } else if (load.status === "draft") {
      drafts.push(load)
    } else {
      history.push(load)
    }
  }

  return { drafts, history, live }
}

export function hostSchedulePresentation(loads: NetworkLoadView[]): NetworkLoadView[] {
  return activeLoads(loads).toSorted(
    (left, right) => HOST_SCHEDULE_PRIORITY[left.status] - HOST_SCHEDULE_PRIORITY[right.status]
  )
}

export function hostTripAttentionMessage(trip: HostTrip): string | null {
  if (trip.status === "cancelled") return null

  if (trip.completion.status === "disputed") {
    return trip.completion.disputeReason
      ? `Delivery record disputed: ${trip.completion.disputeReason}`
      : "Delivery record disputed. Review the driver's quantity and evidence."
  }

  if (trip.completion.status === "submitted") {
    return "Delivery record waiting for host confirmation."
  }

  if (trip.status === "completed" && trip.completion.status === "pending") {
    return "Physical trip ended, but the driver has not submitted a completion record."
  }

  if (trip.completion.status === "confirmed" && trip.driverPayment.matchesExpected === false) {
    return "The recorded driver payment does not match the agreed driver pay."
  }

  if (trip.completion.status === "confirmed" && trip.driverPayment.status === "not_sent") {
    return "Delivery is confirmed, but driver payment has not been marked sent."
  }

  if (trip.inspection?.outcome === "fail") {
    const failedItems = trip.inspection.failedItems.join(", ")

    return failedItems
      ? `Pre-trip inspection failed: ${failedItems}.`
      : "Pre-trip inspection failed."
  }

  return null
}

export function hostLiveBoardPresentation(trips: HostTrip[]): {
  active: HostTrip[]
  attention: HostTrip[]
  history: HostTrip[]
} {
  const active: HostTrip[] = []
  const attention: HostTrip[] = []
  const history: HostTrip[] = []

  for (const trip of trips) {
    if (trip.status === "cancelled") {
      history.push(trip)
    } else if (hostTripAttentionMessage(trip)) {
      attention.push(trip)
    } else if (trip.status === "completed") {
      history.push(trip)
    } else {
      active.push(trip)
    }
  }

  return { active, attention, history }
}

export function hostOperationalNotices(
  notices: HostNotice[],
  liveLoadIds: Set<string>
): HostNotice[] {
  const severityOrder: Record<HostNotice["severity"], number> = {
    critical: 0,
    watch: 1,
    info: 2
  }

  return notices
    .filter((notice) => !notice.id.startsWith("capacity-"))
    .filter((notice) => !notice.relatedLoadId || liveLoadIds.has(notice.relatedLoadId))
    .toSorted((left, right) => severityOrder[left.severity] - severityOrder[right.severity])
}

export function hostOperatingPartners(
  relationships: NetworkView["privateNetwork"]
): Array<{ id: string; name: string }> {
  const partners = new Map<string, { id: string; name: string }>()

  for (const relationship of relationships) {
    if (relationship.status === "active" && !partners.has(relationship.partnerOrganizationId)) {
      partners.set(relationship.partnerOrganizationId, {
        id: relationship.partnerOrganizationId,
        name: relationship.partnerName
      })
    }
  }

  return [...partners.values()]
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

function noticeTone(severity: HostNotice["severity"]): "critical" | "info" | "warning" {
  if (severity === "critical") return "critical"
  if (severity === "watch") return "warning"

  return "info"
}

// --- Command -------------------------------------------------------------------

export function HostCommand({
  account,
  canAssignCapacity,
  canManageLandings,
  canPublish,
  network,
  options,
  setup
}: HostPageProps & {
  canAssignCapacity: boolean
  canManageLandings: boolean
  canPublish: boolean
  options: HostPublishingOptions
  setup: HostWorkspaceSetup
}) {
  const own = ownLoads(network)
  const readiness = getHostReadinessFacts(network, options, setup)
  const activationComplete = hostPercentagePublicationIsReady(options)
  const showReadiness =
    (canManageLandings || canPublish) &&
    (own.length === 0 ||
      (!activationComplete && options.billingActivationState !== "suspended"))
  const active = activeLoads(own)
  const planned = active.reduce((sum, load) => sum + load.capacity.total, 0)
  const committed = active.reduce((sum, load) => sum + load.capacity.committed, 0)
  const delivered = active.reduce((sum, load) => sum + load.capacity.completed, 0)
  const remaining = active.reduce((sum, load) => sum + load.capacity.remaining, 0)
  const requests = pendingRequests(active)
  const gaps = active.filter(
    (load) => load.capacity.remaining > 0 && ["open", "scheduled"].includes(load.status)
  )
  const ownIds = new Set(own.map((load) => load.id))
  const liveLoadIds = new Set(active.map((load) => load.id))
  const ownTrips = network.trips.filter((trip) => ownIds.has(trip.loadPostingId))
  const tripBoard = hostLiveBoardPresentation(ownTrips)
  const activeTripCount = ownTrips.filter((trip) => !["cancelled", "completed"].includes(trip.status)).length
  const notices = hostOperationalNotices(network.notices, liveLoadIds)
    .filter((notice) => notice.severity !== "info")
  const attentionCount = tripBoard.attention.length + notices.length
  const capacityGapEmptyState = hostCapacityGapEmptyState({
    activationComplete,
    canPublish,
    liveWorkCount: active.length,
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
            ? active.length > 0
              ? "Live work has no loading slots"
              : "No published capacity yet"
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
        {planned === 0 && active.length > 0 ? (
          <Link className="action-link action-link--secondary" href={capacityGapEmptyState.actionHref}>
            {capacityGapEmptyState.actionLabel}
          </Link>
        ) : (
          <HostOpportunityAction
            activationComplete={activationComplete}
            canPublish={canPublish}
            context="command"
          />
        )}
      </section>
      <section aria-label="Current host operations" className="host-command-pulse">
        <a className={requests.length > 0 ? "is-urgent" : undefined} href="#capacity-requests">
          <strong>{requests.length}</strong>
          <span>capacity request{requests.length === 1 ? "" : "s"}</span>
          <em>{requests.length > 0 ? canAssignCapacity ? "Decide now" : "Review only" : "Nothing waiting"}</em>
        </a>
        <Link className={attentionCount > 0 ? "is-critical" : undefined} href="/host/live-board">
          <strong>{attentionCount}</strong>
          <span>live exception{attentionCount === 1 ? "" : "s"}</span>
          <em>{attentionCount > 0 ? "Open live board" : "Operation clear"}</em>
        </Link>
        <Link href="/host/live-board">
          <strong>{activeTripCount}</strong>
          <span>active truck{activeTripCount === 1 ? "" : "s"}</span>
          <em>Follow live work</em>
        </Link>
        <a className={gaps.length > 0 ? "is-urgent" : undefined} href="#capacity-gaps">
          <strong>{gaps.length}</strong>
          <span>capacity gap{gaps.length === 1 ? "" : "s"}</span>
          <em>{gaps.length > 0 ? canPublish ? "Fill the plan" : "Review plan" : "Plan covered"}</em>
        </a>
      </section>
      <section className="decision-grid host-command-grid">
        <article className="decision-list host-command-priority" id="capacity-requests">
          <header className="host-decision-head">
            <div>
              <p className="eyebrow">Decisions</p>
              <h2>Capacity requests</h2>
            </div>
            <Badge tone={requests.length > 0 ? "warning" : "neutral"}>{requests.length} waiting</Badge>
          </header>
          {canAssignCapacity ? (
            <CapacityApprovalList requests={requests} />
          ) : requests.length === 0 ? (
            <EmptyState
              body="Requests appear here as operating context. An owner, admin, dispatcher, or landing manager makes assignment decisions."
              title="No capacity requests waiting."
            />
          ) : (
            <div className="host-approvals" aria-label="Capacity requests, read only">
              {requests.map((request) => (
                <div className="host-approval-row" key={request.assignmentId}>
                  <strong>{request.driverName} · {request.truckUnit}</strong>
                  <span>{request.loadTitle} · {request.scheduleLabel}</span>
                  <Badge tone="neutral">Decision access required</Badge>
                </div>
              ))}
            </div>
          )}
        </article>
        <article className="decision-list host-command-attention">
          <header className="host-decision-head">
            <div>
              <p className="eyebrow">Field state</p>
              <h2>Live exceptions</h2>
            </div>
            <Link className="text-link" href="/host/live-board">Open live board</Link>
          </header>
          {tripBoard.attention.length === 0 && notices.length === 0 ? (
            <EmptyState
              body="Failed inspections, delivery confirmations, disputes, and current operating notices surface here."
              title="No live exceptions."
            />
          ) : (
            <div className="host-attention-list">
              {tripBoard.attention.map((trip) => (
                <Link
                  className="host-attention-row host-attention-row--critical"
                  href={`/host/live-board#host-trip-${trip.id}`}
                  key={trip.id}
                >
                  <Badge tone="critical">Trip</Badge>
                  <strong>{trip.driverName} · {trip.loadTitle}</strong>
                  <span>{hostTripAttentionMessage(trip)}</span>
                </Link>
              ))}
              {notices.map((notice) => (
                <Link className="host-attention-row" href="/host/live-board#operational-notices" key={notice.id}>
                  <Badge tone={noticeTone(notice.severity)}>{formatHuman(notice.severity)}</Badge>
                  <strong>{notice.title}</strong>
                  <span>{notice.body}</span>
                </Link>
              ))}
            </div>
          )}
        </article>
        <article className="decision-list" id="capacity-gaps">
          <header className="host-decision-head">
            <div>
              <p className="eyebrow">Coverage</p>
              <h2>Capacity gaps</h2>
            </div>
            <Badge tone={gaps.length > 0 ? "warning" : "success"}>{gaps.length} open</Badge>
          </header>
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

function hostPublicationGateState(options: HostPublishingOptions): {
  body: string
  ready: boolean
  title: string
} {
  if (hostPercentagePublicationIsReady(options)) {
    return {
      body: "The current 5% completed-load agreement and a working payment method are recorded. Driver pay remains the separate amount shown on each posting.",
      ready: true,
      title: "Live publication is ready"
    }
  }

  if (options.billingActivationState === "suspended") {
    return {
      body: "Drafts remain available, but new live work is suspended. Review Billing or contact LogLoads to resolve the operating hold.",
      ready: false,
      title: "Live publication is suspended"
    }
  }

  if (options.billingActivationState === "legacy" || (options.billingModel && options.billingModel !== "percentage_v1")) {
    return {
      body: "Historical obligations stay preserved. Prepare drafts here, then reconcile the current percentage agreement from Billing before publishing new live work.",
      ready: false,
      title: "Current agreement required"
    }
  }

  if (options.currentPercentageAgreementActive && options.billingProfileStatus === "failed") {
    return {
      body: "The current agreement is active, but the payment method failed. Drafts remain available while Billing is corrected.",
      ready: false,
      title: "Payment method needs attention"
    }
  }

  return {
    body: "Drafts are free to prepare. Live publication stays off until this workspace is approved for the pilot, accepts the current 5% completed-load agreement, and attaches a working payment method.",
    ready: false,
    title: "Prepare now; activate separately"
  }
}

function HostLoadRow({
  canPublish,
  dailyNeed,
  load,
  options
}: {
  canPublish: boolean
  dailyNeed?: number
  load: NetworkLoadView
  options: HostPublishingOptions
}) {
  const waiting = load.assignments.filter((assignment) => assignment.status === "requested").length
  const closable = ["open", "scheduled", "filled"].includes(load.status)

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
          <Link className="text-link" href="/host/command#capacity-requests">
            {waiting} request{waiting === 1 ? "" : "s"} waiting
          </Link>
        ) : null}
        {canPublish && load.status === "draft" ? (
          <PublishDraftButton loadPostingId={load.id} options={options} />
        ) : null}
        {canPublish && closable ? (
          <CloseWorkButton loadPostingId={load.id} waitingRequests={waiting} />
        ) : null}
      </div>
    </article>
  )
}

export function HostOpportunities({
  account,
  canPublish,
  network,
  options,
  planFacts
}: HostPageProps & { canPublish: boolean; options: HostPublishingOptions; planFacts: HostLoadPlanFacts }) {
  const own = ownLoads(network)
  const work = hostWorkPresentation(own)
  const publication = hostPublicationGateState(options)

  return (
    <AppShell account={account} kicker="Publish capacity" role="host" title="Work">
      {canPublish ? (
        <section className={`host-publication-state${publication.ready ? " is-ready" : ""}`}>
          <div>
            <p className="eyebrow">Publication state</p>
            <h2>{publication.title}</h2>
            <p>{publication.body}</p>
          </div>
          {publication.ready ? (
            <a className="action-link action-link--secondary" href="#live-work">Review live work</a>
          ) : (
            <Link className="action-link action-link--secondary" href="/host/billing">Review host billing</Link>
          )}
        </section>
      ) : null}
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
          <header className="host-published__head">
            <div>
              <p className="eyebrow">Operating ledger</p>
              <h2 className="host-published__title">Your work</h2>
            </div>
            <div className="host-work-counts" aria-label="Work counts">
              <span><strong>{work.live.length}</strong> live</span>
              <span><strong>{work.drafts.length}</strong> draft</span>
              <span><strong>{work.history.length}</strong> closed</span>
            </div>
          </header>
          {own.length === 0 ? (
            <EmptyState
              body={canPublish
                ? "Use the builder to prepare your first timber movement. A draft stays with your team; live visibility is available only when the publication state above is ready."
                : "No work has been prepared for this operation. An authorized publisher can create the first movement; it will appear here when they do."}
              title="No work prepared yet."
            />
          ) : (
            <>
              <section className="host-work-group" id="live-work">
                <header>
                  <h3>Live network work</h3>
                  <span>Visible according to each posting&rsquo;s audience.</span>
                </header>
                {work.live.length === 0 ? (
                  <EmptyState
                    body={canPublish
                      ? "Drafts and closed records do not create live capacity. Publish the next movement when activation and field details are ready."
                      : "Drafts and closed records do not create live capacity. An authorized publisher opens the next movement; it will appear here."}
                    title="No live work."
                  />
                ) : (
                  work.live.map((load) => (
                    <HostLoadRow
                      canPublish={canPublish}
                      dailyNeed={planFacts[load.id]?.dailyTruckCountNeeded}
                      key={load.id}
                      load={load}
                      options={options}
                    />
                  ))
                )}
              </section>
              {work.drafts.length > 0 ? (
                <section className="host-work-group">
                  <header>
                    <h3>Drafts</h3>
                    <span>Visible only to this workspace.</span>
                  </header>
                  {work.drafts.map((load) => (
                    <HostLoadRow
                      canPublish={canPublish}
                      dailyNeed={planFacts[load.id]?.dailyTruckCountNeeded}
                      key={load.id}
                      load={load}
                      options={options}
                    />
                  ))}
                </section>
              ) : null}
              {work.history.length > 0 ? (
                <details className="host-work-history">
                  <summary>History <span>{work.history.length} closed record{work.history.length === 1 ? "" : "s"}</span></summary>
                  <div className="host-work-history__list">
                    {work.history.map((load) => (
                      <HostLoadRow
                        canPublish={false}
                        dailyNeed={planFacts[load.id]?.dailyTruckCountNeeded}
                        key={load.id}
                        load={load}
                        options={options}
                      />
                    ))}
                  </div>
                </details>
              ) : null}
            </>
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
  { statuses: ["en_route_to_destination", "at_destination", "unloading"], title: "Departed" }
]

function tripTone(status: HostTrip["status"]): "success" | "critical" | "info" {
  if (status === "completed") return "success"
  if (status === "cancelled") return "critical"

  return "info"
}

function tripLastUpdate(trip: HostTrip): string {
  return trip.events[trip.events.length - 1]?.occurredAt ?? trip.lastSyncedAt ?? ""
}

function HostTripCard({
  attentionMessage,
  canAssignCapacity,
  canManageBilling,
  canPublish,
  trip,
  truckUnit
}: {
  attentionMessage?: string | null
  canAssignCapacity: boolean
  canManageBilling: boolean
  canPublish: boolean
  trip: HostTrip
  truckUnit: string
}) {
  const lastUpdate = tripLastUpdate(trip)
  const paymentStatus =
    trip.driverPayment.status === "received"
      ? "Driver confirmed payment received."
      : trip.driverPayment.status === "sent"
        ? "Payment marked sent; driver confirmation is pending."
        : "Driver payment has not been marked sent."

  return (
    <article
      className={`live-card${attentionMessage ? " live-card--attention" : ""}`}
      id={`host-trip-${trip.id}`}
    >
      <header className="live-card__head">
        <strong>{trip.driverName}</strong>
        <Badge tone={tripTone(trip.status)}>{tripStatusLabel(trip.status)}</Badge>
      </header>
      <span>{truckUnit} · {trip.loadTitle}</span>
      {attentionMessage ? (
        <p className="live-card__alert">
          <Icon aria-hidden name="status.warning" size={16} />
          {attentionMessage}
        </p>
      ) : null}
      <span>{lastUpdate ? `Last update ${formatDateTime(lastUpdate)}` : "No updates synced yet"}</span>
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
      {trip.completion.status === "confirmed" ? (
        <>
          <span className="review-done">
            <Icon aria-hidden name="status.verified" size={14} />{" "}
            {trip.completion.deliveredQuantity
              ? `${trip.completion.deliveredQuantity.value} ${trip.completion.deliveredQuantity.unit} confirmed`
              : "Delivery confirmed"}
          </span>
          {canManageBilling ? (
            <DriverPaymentControl
              assignmentId={trip.assignmentId}
              driverName={trip.driverName}
              expectedPayLabel={trip.driverPayment.expectedPayLabel}
              matchesExpected={trip.driverPayment.matchesExpected}
              receivedPayLabel={trip.driverPayment.receivedPayLabel}
              status={trip.driverPayment.status}
            />
          ) : (
            <p className="host-permission-line">
              <Icon aria-hidden name="status.lock" size={15} />
              {paymentStatus}
            </p>
          )}
        </>
      ) : null}
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
      {["submitted", "disputed"].includes(trip.completion.status) ? (
        canAssignCapacity ? (
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
        ) : (
          <p className="host-permission-line">
            <Icon aria-hidden name="status.lock" size={15} />
            An authorized capacity manager must confirm or dispute this delivery record.
          </p>
        )
      ) : null}
      {!["cancelled", "completed"].includes(trip.status) && (canPublish || canAssignCapacity) ? (
        <div className="live-card__actions">
          {canPublish ? (
            <RefreshRoutePackButton assignmentId={trip.assignmentId} driverName={trip.driverName} />
          ) : null}
          {canAssignCapacity ? (
            <CancelAssignmentButton assignmentId={trip.assignmentId} driverName={trip.driverName} />
          ) : null}
        </div>
      ) : null}
    </article>
  )
}

export function HostLiveBoard({
  account,
  canAssignCapacity,
  canManageBilling,
  canPublish,
  network
}: HostPageProps & {
  canAssignCapacity: boolean
  canManageBilling: boolean
  canPublish: boolean
}) {
  const own = ownLoads(network)
  const ownIds = new Set(own.map((load) => load.id))
  const liveLoadIds = new Set(activeLoads(own).map((load) => load.id))
  const loadTitleById = new Map(own.map((load) => [load.id, load.title] as const))
  const trips = network.trips.filter((trip) => ownIds.has(trip.loadPostingId))
  const board = hostLiveBoardPresentation(trips)
  const notices = hostOperationalNotices(network.notices, liveLoadIds)
  const urgentNoticeCount = notices.filter((notice) => notice.severity !== "info").length
  const activeTripCount = trips.filter((trip) => !["cancelled", "completed"].includes(trip.status)).length
  const tripHistory = board.history
    .toSorted((left, right) => tripLastUpdate(right).localeCompare(tripLastUpdate(left)))
  const truckUnitByAssignment = new Map(
    own.flatMap((load) => load.assignments.map((assignment) => [assignment.id, assignment.truckUnit] as const))
  )
  const atSiteCount = board.active.filter((trip) => ["checked_in", "loading", "loaded"].includes(trip.status)).length
  const onRoadCount = board.active.filter((trip) =>
    ["en_route_to_landing", "en_route_to_destination", "at_destination", "unloading"].includes(trip.status)
  ).length

  return (
    <AppShell account={account} kicker="Landing flow" role="host" title="Live Board">
      <section aria-label="Live board summary" className="host-live-summary">
        <div><strong>{board.attention.length + urgentNoticeCount}</strong><span>need attention</span></div>
        <div><strong>{activeTripCount}</strong><span>active trucks</span></div>
        <div><strong>{atSiteCount}</strong><span>at the landing</span></div>
        <div><strong>{onRoadCount}</strong><span>on the road</span></div>
      </section>
      {board.attention.length > 0 ? (
        <section className="host-live-attention">
          <header>
            <p className="eyebrow">Decide or follow up</p>
            <h2>Needs attention now</h2>
          </header>
          <div className="host-live-attention__grid">
            {board.attention.map((trip) => (
              <HostTripCard
                attentionMessage={hostTripAttentionMessage(trip)}
                canAssignCapacity={canAssignCapacity}
                canManageBilling={canManageBilling}
                canPublish={canPublish}
                key={trip.id}
                trip={trip}
                truckUnit={truckUnitByAssignment.get(trip.assignmentId) ?? "Unit on file"}
              />
            ))}
          </div>
        </section>
      ) : null}
      {notices.length > 0 ? (
        <section className="host-live-notices" id="operational-notices">
          <header>
            <div>
              <p className="eyebrow">Current field guidance</p>
              <h2>Operating notices</h2>
            </div>
            <Badge tone={urgentNoticeCount > 0 ? "warning" : "info"}>{notices.length} current</Badge>
          </header>
          <div className="host-live-notices__list">
            {notices.map((notice) => (
              <article key={notice.id}>
                <Badge tone={noticeTone(notice.severity)}>{formatHuman(notice.severity)}</Badge>
                <div>
                  <strong>{notice.title}</strong>
                  <span>{notice.body}</span>
                  <em>{notice.relatedLoadId
                    ? loadTitleById.get(notice.relatedLoadId) ?? "Related live work"
                    : "Whole operation"}</em>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}
      {board.active.length === 0 ? (
        <section className="host-board-empty">
          <EmptyState
            actionHref="/host/command"
            actionLabel="Review requests"
            body={board.attention.length > 0
              ? "No trucks are moving now. Resolve the completion or inspection records above; new capacity requests wait on Command."
              : "Trucks appear here when an authorized operator approves capacity. Pending requests wait on Command."}
            title="No trucks moving now."
          />
        </section>
      ) : (
        <section className="live-board">
          {LIVE_LANES.map((lane) => {
            const laneTrips = board.active.filter((trip) => lane.statuses.includes(trip.status))

            return (
              <article key={lane.title}>
                <h2>
                  {lane.title} <span className="host-lane-count">{laneTrips.length}</span>
                </h2>
                {laneTrips.length === 0 ? (
                  <p className="muted">None right now.</p>
                ) : (
                  laneTrips.map((trip) => (
                    <HostTripCard
                      canAssignCapacity={canAssignCapacity}
                      canManageBilling={canManageBilling}
                      canPublish={canPublish}
                      key={trip.id}
                      trip={trip}
                      truckUnit={truckUnitByAssignment.get(trip.assignmentId) ?? "Unit on file"}
                    />
                  ))
                )}
              </article>
            )
          })}
        </section>
      )}
      {tripHistory.length > 0 ? (
        <details className="host-board-history">
          <summary>
            Trip history
            <span>{tripHistory.length} completed or cancelled trip{tripHistory.length === 1 ? "" : "s"}</span>
          </summary>
          <div className="host-board-history__grid">
            {tripHistory.map((trip) => (
              <HostTripCard
                canAssignCapacity={canAssignCapacity}
                canManageBilling={canManageBilling}
                canPublish={canPublish}
                key={trip.id}
                trip={trip}
                truckUnit={truckUnitByAssignment.get(trip.assignmentId) ?? "Unit on file"}
              />
            ))}
          </div>
        </details>
      ) : null}
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
  landingDetailsRestricted,
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
  landingDetailsRestricted: boolean
  landings: HostLandingView[]
  options: HostPublishingOptions
  setup: HostWorkspaceSetup
  welcome?: boolean
  welcomeSource?: "created" | "invited"
}) {
  const atLimit = setup.landingLimit !== null && setup.activeLandingCount >= setup.landingLimit
  const readiness = getHostReadinessFacts(network, options, setup)
  const activationComplete = hostPercentagePublicationIsReady(options)
  const showReadiness =
    (canManageLandings || canPublish) &&
    (welcome || readiness.readyCount < 4 || !activationComplete)

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
        {landingDetailsRestricted ? (
          <EmptyState
            actionHref="/host/settings"
            actionLabel="Review workspace access"
            body="Exact site contacts, approaches, and operating details are limited to roles that coordinate landings and assigned work."
            title="Landing details are restricted."
          />
        ) : landings.length === 0 ? (
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

              {canManageLandings && landing.details && landing.editable ? (
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

export function HostCarriers({
  account,
  canAssignCapacity,
  canSendNotices,
  network
}: HostPageProps & { canAssignCapacity: boolean; canSendNotices: boolean }) {
  const own = ownLoads(network)
  const offerable = own
    .filter((load) => load.status === "open" && load.capacity.remaining > 0)
    .map((load) => ({
      detail: `${load.capacity.remaining} open · ${load.scheduleLabel}`,
      id: load.id,
      title: load.title
    }))
  const partners = hostOperatingPartners(network.privateNetwork)
  const activeRelationships = network.privateNetwork.filter((relationship) => relationship.status === "active")
  const inactiveRelationships = network.privateNetwork.filter((relationship) => relationship.status !== "active")
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
      <section className="host-network-summary">
        <div>
          <p className="eyebrow">Known capacity</p>
          <h2>{partners.length} active operating partner{partners.length === 1 ? "" : "s"}</h2>
          <p>Direct offers go only to active relationships already established with this workspace.</p>
        </div>
        <div className="host-work-counts" aria-label="Carrier network counts">
          <span><strong>{partners.length}</strong> active</span>
          <span><strong>{offerable.length}</strong> offerable load{offerable.length === 1 ? "" : "s"}</span>
        </div>
      </section>
      <section className="relationship-grid">
        {activeRelationships.length === 0 ? (
          <EmptyState
            body="Partner relationships let you share work privately and send direct offers. Relationships are set up with the outfits you already haul with."
            title="No active operating relationships."
          />
        ) : (
          activeRelationships.map((relationship) => (
            <article key={relationship.id}>
              <Badge tone="success">Active partner</Badge>
              <h2>{relationship.partnerName}</h2>
              <p>{relationship.notes ?? "Trusted partner relationship."}</p>
              <span>{formatHuman(relationship.scope)}</span>
            </article>
          ))
        )}
      </section>
      {inactiveRelationships.length > 0 ? (
        <details className="host-network-history">
          <summary>Relationship history <span>{inactiveRelationships.length} inactive</span></summary>
          <div className="relationship-grid">
            {inactiveRelationships.map((relationship) => (
              <article key={relationship.id}>
                <Badge tone="neutral">{formatHuman(relationship.status)}</Badge>
                <h2>{relationship.partnerName}</h2>
                <p>{relationship.notes ?? "No relationship note on file."}</p>
                <span>{formatHuman(relationship.scope)}</span>
              </article>
            ))}
          </div>
        </details>
      ) : null}
      <section className="host-carrier-tools">
        <article className="host-panel">
          <h2>Send a direct offer</h2>
          <p>Invite a trusted partner to assign trucks. Capacity is committed only when each truck is accepted.</p>
          {canAssignCapacity ? (
            <DirectOfferPanel loads={offerable} partners={partners} sentOffers={sentOffers} />
          ) : (
            <>
              <EmptyState
                actionHref="/host/settings"
                actionLabel="Review workspace access"
                body="You can review partner relationships here. An owner, admin, dispatcher, or landing manager sends and closes capacity invitations."
                title="Direct offers are read-only for your role."
              />
              {sentOffers.length > 0 ? (
                <div aria-label="Sent direct offers" className="board-list">
                  {sentOffers.map((offer) => (
                    <article className="trip-row" key={offer.id}>
                      <div>
                        <strong>{offer.loadTitle}</strong>
                        <span>{offer.counterpartName} · {offer.acceptedTruckloads} of {offer.offeredTruckloads} accepted · {formatHuman(offer.status)}</span>
                      </div>
                      <Badge tone="neutral">Read only</Badge>
                    </article>
                  ))}
                </div>
              ) : null}
            </>
          )}
        </article>
        <article className="host-panel">
          <h2>Publish an operational notice</h2>
          <p>Road, weather, and schedule changes reach the crews working the related load.</p>
          {canSendNotices ? (
            <NoticeComposer loads={noticeTargets} />
          ) : (
            <EmptyState
              actionHref="/host/settings"
              actionLabel="Review workspace access"
              body="You can follow current notices on the Live Board. An authorized operations role publishes changes to crews."
              title="Notice publishing is not available to your role."
            />
          )}
        </article>
      </section>
    </AppShell>
  )
}

// --- Schedule ------------------------------------------------------------------------------

export function HostSchedule({ account, network }: HostPageProps) {
  const own = ownLoads(network)
  const work = hostWorkPresentation(own)
  const active = hostSchedulePresentation(own)
  const planned = active.reduce((sum, load) => sum + load.capacity.total, 0)
  const committed = active.reduce((sum, load) => sum + load.capacity.committed, 0)
  const delivered = active.reduce((sum, load) => sum + load.capacity.completed, 0)
  const remaining = active.reduce((sum, load) => sum + load.capacity.remaining, 0)

  return (
    <AppShell account={account} kicker="Upcoming work" role="host" title="Schedule">
      {own.length === 0 ? (
        <section className="host-board-empty">
          <EmptyState
            actionHref="/host/opportunities"
            actionLabel="Review work"
            body="Published work lands on this schedule with its dates, lanes, and remaining capacity."
            title="Nothing scheduled yet."
          />
        </section>
      ) : (
        <>
          <section className="command-grid">
            <Metric label="Live truckloads planned" value={planned} />
            <Metric label="Live commitments" value={committed} />
            <Metric label="Delivered within live work" value={delivered} />
            <Metric label="Live capacity open" value={remaining} />
          </section>
          <section className="host-schedule-group">
            <header className="host-schedule-head">
              <div>
                <p className="eyebrow">Current plan</p>
                <h2>Accepting and moving</h2>
              </div>
              <span>{active.length} live posting{active.length === 1 ? "" : "s"}</span>
            </header>
            {active.length === 0 ? (
              <EmptyState
                actionHref="/host/opportunities"
                actionLabel="Review work"
                body="Drafts and closed records do not create a live schedule. Review Work to prepare or publish the next movement."
                title="No live work scheduled."
              />
            ) : (
              <div className="board-list host-board-list">
                {active.map((load) => (
                  <Link
                    className="trip-row host-schedule-row"
                    href={load.status === "in_transit" ? "/host/live-board" : "/host/opportunities#live-work"}
                    key={load.id}
                  >
                    <div>
                      <strong>{load.title}</strong>
                      <span>{load.scheduleLabel} · {load.cadenceLabel}</span>
                      <span>{load.landing.city} to {load.destination.name}</span>
                    </div>
                    <Badge tone={statusTone(load.status)}>{formatHuman(load.status)}</Badge>
                    <Badge tone={load.capacity.remaining > 0 ? "warning" : "success"}>
                      {load.capacity.remaining > 0 ? `${load.capacity.remaining} open` : "Covered"}
                    </Badge>
                  </Link>
                ))}
              </div>
            )}
          </section>
          {work.drafts.length > 0 ? (
            <aside className="host-schedule-planning">
              <div>
                <strong>{work.drafts.length} draft movement{work.drafts.length === 1 ? "" : "s"} waiting off-network</strong>
                <span>Drafts stay in Work until an authorized publisher makes them live.</span>
              </div>
              <Link className="action-link action-link--secondary" href="/host/opportunities">Review drafts</Link>
            </aside>
          ) : null}
          {work.history.length > 0 ? (
            <details className="host-schedule-history">
              <summary>Work history <span>{work.history.length} closed record{work.history.length === 1 ? "" : "s"}</span></summary>
              <div className="board-list host-board-list">
                {work.history.map((load) => (
                  <article className="trip-row" key={load.id}>
                    <div>
                      <strong>{load.title}</strong>
                      <span>{load.scheduleLabel} · {load.landing.city} to {load.destination.name}</span>
                    </div>
                    <Badge tone={statusTone(load.status)}>{formatHuman(load.status)}</Badge>
                    <span className="muted">{load.payLabel}</span>
                  </article>
                ))}
              </div>
            </details>
          ) : null}
        </>
      )}
    </AppShell>
  )
}

// --- Analytics --------------------------------------------------------------------------------

export function HostAnalytics({ account, network }: HostPageProps) {
  const own = ownLoads(network)
  const work = hostWorkPresentation(own)
  const live = activeLoads(own)
  const ownIds = new Set(own.map((load) => load.id))
  const planned = live.reduce((sum, load) => sum + load.capacity.total, 0)
  const committed = live.reduce((sum, load) => sum + load.capacity.committed, 0)
  const delivered = own.reduce((sum, load) => sum + load.capacity.completed, 0)
  const remaining = live.reduce((sum, load) => sum + load.capacity.remaining, 0)
  const waiting = pendingRequests(live).length
  const deliveredTrips = network.trips.filter(
    (trip) => ownIds.has(trip.loadPostingId) && trip.status === "completed"
  ).length
  const measurable = live
    .filter((load) => load.capacity.total > 0)
    .toSorted((left, right) => right.capacity.remaining - left.capacity.remaining)
  const activePartners = hostOperatingPartners(network.privateNetwork).length

  return (
    <AppShell account={account} kicker="Capacity trends" role="host" title="Analytics">
      {own.length === 0 ? (
        <section className="host-board-empty">
          <EmptyState
            actionHref="/host/opportunities"
            actionLabel="Review work"
            body="Once work is prepared and made live, commitment and delivery numbers build here from real activity."
            title="No work records to measure yet."
          />
        </section>
      ) : (
        <>
          <section className="command-grid">
            <Metric label="Live work" value={live.length} />
            <Metric label="Live truckloads planned" value={planned} />
            <Metric label="Live commitments" value={committed} />
            <Metric label="Live capacity open" value={remaining} />
          </section>
          <section className="command-grid">
            <Metric label="Delivered truckloads recorded" value={delivered} />
            <Metric label="Completed trips recorded" value={deliveredTrips} />
            <Metric label="Capacity requests waiting" value={waiting} />
            <Metric label="Active carrier partners" value={activePartners} />
          </section>
          {measurable.length === 0 ? (
            <section className="host-board-empty">
              <EmptyState
                actionHref="/host/opportunities"
                actionLabel="Review work"
                body={work.drafts.length > 0
                  ? `${work.drafts.length} draft movement${work.drafts.length === 1 ? " is" : "s are"} still off-network. Fill progress begins after work is live and loading slots are scheduled.`
                  : "Only live work with scheduled truckload capacity appears in coverage. Closed records remain in the totals above."}
                title="No live truckload capacity to chart."
              />
            </section>
          ) : (
            <section className="host-fill-list">
              <header className="host-fill-list__head">
                <div>
                  <p className="eyebrow">Coverage risk</p>
                  <h2>Live capacity by posting</h2>
                </div>
                <span>Largest gaps first</span>
              </header>
              {measurable.map((load) => {
                const percent = Math.round((load.capacity.committed / load.capacity.total) * 100)

                return (
                  <div className="host-fill-row" key={load.id}>
                    <header>
                      <strong>{load.title}</strong>
                      <span>
                        {load.capacity.committed} of {load.capacity.total} committed · {load.capacity.remaining} open
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
