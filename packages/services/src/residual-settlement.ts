import {
  formatMoney,
  organizationRoleCan,
  readFrozenDriverPay
} from "@logloads/contracts"
import type { LogLoadsDatabaseState } from "@logloads/db"

import { resolveRestrictedOrganizationAccess } from "./organization-access"

type DriverPaymentStatus = "not_sent" | "received" | "sent"

interface ResidualSettlementBase {
  assignmentId: string
  completedAt: string | null
  expectedPayLabel: string | null
  loadTitle: string
  status: DriverPaymentStatus
}

export interface ResidualHostPayment extends ResidualSettlementBase {
  driverName: string
  kind: "host_payment"
  matchesExpected: boolean | null
  receivedPayLabel: string | null
}

export interface ResidualDriverReceipt extends ResidualSettlementBase {
  expectedPayAmountCents: number | null
  expectedPayCurrency: string | null
  hostName: string
  kind: "driver_receipt"
  matchesExpected: boolean | null
  receivedPayLabel: string | null
}

export type ResidualSettlementItem = ResidualDriverReceipt | ResidualHostPayment

function paymentStatus(
  assignment: LogLoadsDatabaseState["assignments"][number]
): DriverPaymentStatus {
  if (assignment.driverPaymentReceivedAt) {
    return "received"
  }

  return assignment.driverPaymentSentAt ? "sent" : "not_sent"
}

/**
 * Returns the only operational records a rejected or suspended organization
 * may still use: unfinished off-platform driver-payment evidence for completed,
 * host-confirmed hauls. Authorization and role eligibility live here so every
 * caller receives the same fail-closed answer.
 */
export function residualSettlementItemsForOrganization(
  state: LogLoadsDatabaseState,
  userId: string,
  organizationId: string
): ResidualSettlementItem[] {
  const access = resolveRestrictedOrganizationAccess(state, {
    actorUserId: userId,
    organizationId
  })

  if (!access) {
    return []
  }

  const membership = access.membership
  const confirmedCompletedTrips = new Map(
    state.tripsV2
      .filter(
        (trip) =>
          trip.status === "completed" && trip.completionStatus === "confirmed"
      )
      .map((trip) => [trip.assignmentId, trip] as const)
  )
  const items: ResidualSettlementItem[] = []

  for (const assignment of state.assignments) {
    if (
      assignment.status !== "completed" ||
      assignment.driverPaymentReceivedAt ||
      !confirmedCompletedTrips.has(assignment.id)
    ) {
      continue
    }

    const load = state.loadPostings.find(
      (candidate) => candidate.id === assignment.loadPostingId
    )
    const driver = state.driverProfiles.find(
      (candidate) => candidate.id === assignment.driverProfileId
    )

    if (!load || !driver) {
      continue
    }

    const frozenPay = readFrozenDriverPay(assignment.termsSnapshot)
    const receivedPay =
      assignment.driverPaymentReceivedAmountCents !== null &&
      assignment.driverPaymentReceivedCurrency
        ? {
            amountCents: assignment.driverPaymentReceivedAmountCents,
            currency: assignment.driverPaymentReceivedCurrency
          }
        : null
    const matchesExpected = frozenPay && receivedPay
      ? frozenPay.amountCents === receivedPay.amountCents &&
        frozenPay.currency === receivedPay.currency
      : null
    const status = paymentStatus(assignment)
    const trip = confirmedCompletedTrips.get(assignment.id)!

    if (
      load.companyId === organizationId &&
      organizationRoleCan(membership.role, "manage_billing") &&
      driver.userId !== userId
    ) {
      const driverUser = state.profiles.find(
        (candidate) => candidate.id === driver.userId
      )

      items.push({
        assignmentId: assignment.id,
        completedAt: trip.completedAt ?? null,
        driverName: driverUser?.fullName ?? "Assigned driver",
        expectedPayLabel: frozenPay ? formatMoney(frozenPay) : null,
        kind: "host_payment",
        loadTitle: load.title,
        matchesExpected,
        receivedPayLabel: receivedPay ? formatMoney(receivedPay) : null,
        status
      })
      continue
    }

    if (
      organizationRoleCan(membership.role, "progress_trip") &&
      driver.userId === userId &&
      driver.companyId === organizationId
    ) {
      const host = state.organizations.find(
        (candidate) => candidate.id === load.companyId
      )

      items.push({
        assignmentId: assignment.id,
        completedAt: trip.completedAt ?? null,
        expectedPayAmountCents: frozenPay?.amountCents ?? null,
        expectedPayCurrency: frozenPay?.currency ?? null,
        expectedPayLabel: frozenPay ? formatMoney(frozenPay) : null,
        hostName: host?.displayName ?? "Posting organization",
        kind: "driver_receipt",
        loadTitle: load.title,
        matchesExpected,
        receivedPayLabel: receivedPay ? formatMoney(receivedPay) : null,
        status
      })
    }
  }

  return items.sort((left, right) =>
    (right.completedAt ?? "").localeCompare(left.completedAt ?? "") ||
    left.loadTitle.localeCompare(right.loadTitle)
  )
}
