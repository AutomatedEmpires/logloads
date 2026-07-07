import type { AvailabilityWindow } from "@logloads/contracts"

import { services } from "./services"

export interface AvailabilityWindowView {
  id: string
  status: string
  windowLabel: string
  notes: string | null
}

export interface DriverAvailabilitySummary {
  current: AvailabilityWindowView | null
  upcoming: AvailabilityWindowView[]
}

function formatWindow(startAt: string, endAt: string): string {
  const formatter = new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    timeZone: "UTC"
  })

  return `${formatter.format(new Date(startAt))} - ${formatter.format(new Date(endAt))}`
}

function toView(window: AvailabilityWindow): AvailabilityWindowView {
  return {
    id: window.id,
    notes: window.notes ?? null,
    status: window.status,
    windowLabel: formatWindow(window.startAt, window.endAt)
  }
}

/**
 * Driver availability windows for the cockpit: the window covering right now
 * plus the next few posted windows. Read-only view over the operating state.
 */
export function getDriverAvailability(driverProfileId: string | null): DriverAvailabilitySummary {
  if (!driverProfileId) {
    return { current: null, upcoming: [] }
  }

  const now = Date.now()
  const windows = services.state.availabilityWindows
    .filter((window) => window.driverProfileId === driverProfileId)
    .sort((left, right) => left.startAt.localeCompare(right.startAt))
  const current = windows.find((window) => Date.parse(window.startAt) <= now && now <= Date.parse(window.endAt)) ?? null
  const upcoming = windows.filter((window) => Date.parse(window.startAt) > now).slice(0, 4)

  return {
    current: current ? toView(current) : null,
    upcoming: upcoming.map(toView)
  }
}
