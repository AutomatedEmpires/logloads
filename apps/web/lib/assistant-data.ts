import "server-only"

import {
  suggestedPrompts,
  type AssistantGrounding,
  type AssistantRole
} from "@logloads/contracts"

import type { NetworkView } from "./network"
import { fitLabel, formatHuman, tripStatusLabel } from "./v3-shared"

/**
 * Projects a viewer's `NetworkView` into the compact, display-safe grounding the
 * assistant reasons over. Pure — no session/secret access — so both the page and
 * the server action can build it. Numeric scores are already stripped upstream;
 * we only ever carry fit labels + reasons.
 */
export function buildAssistantGrounding(
  network: NetworkView,
  role: AssistantRole,
  viewerName: string
): AssistantGrounding {
  const hasTruck =
    role === "driver"
      ? Boolean(network.currentEquipment) || network.loads.some((load) => load.compatibility !== null)
      : true

  return {
    availability: network.futureAvailability.map((window) => ({
      equipmentLabel: window.equipmentLabel,
      statusLabel: formatHuman(window.status),
      windowLabel: window.windowLabel
    })),
    hasTruck,
    loads: network.loads.map((load) => ({
      blockers: load.compatibility?.failures ?? [],
      fitLabel: fitLabel(load),
      lane: `${load.landing.city} to ${load.destination.name}`,
      loadId: load.id,
      payLabel: load.payLabel,
      reasons: load.recommendation?.reasons ?? load.compatibility?.positives ?? [],
      recommended: Boolean(load.recommendation && load.recommendation.band !== "not_recommended"),
      remaining: load.capacity.remaining,
      requestable: load.slots.requestableSlotId !== null,
      scheduleLabel: load.scheduleLabel,
      statusLabel: formatHuman(load.status),
      title: load.title
    })),
    metrics: {
      activeAssignments: network.metrics.activeAssignments,
      criticalNotices: network.metrics.criticalNotices,
      openLoads: network.metrics.openLoads,
      trucksAvailable: network.metrics.trucksAvailable
    },
    notices: network.notices.map((notice) => ({ body: notice.body, severity: notice.severity, title: notice.title })),
    orgName: network.activeOrganization.name,
    recommendations: network.topRecommendations.map((rec) => ({
      label: rec.label,
      lane: rec.lane,
      loadId: rec.loadId,
      payLabel: rec.payLabel,
      reasons: rec.reasons,
      scheduleLabel: rec.scheduleLabel,
      title: rec.title
    })),
    role,
    trips: network.trips.map((trip) => ({
      driverName: trip.driverName,
      loadTitle: trip.loadTitle,
      statusLabel: tripStatusLabel(trip.status)
    })),
    viewerName
  }
}

export interface AssistantInitialData {
  intro: string
  suggestions: string[]
}

export function assistantInitialData(grounding: AssistantGrounding): AssistantInitialData {
  const firstName = grounding.viewerName.split(" ")[0] || "there"

  return {
    intro: `Hi ${firstName} — ask me about your loads, matches, trips, or alerts. I answer from what's live in ${grounding.orgName} right now.`,
    suggestions: suggestedPrompts(grounding)
  }
}
