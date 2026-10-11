import type { AvailabilityWindow } from "@logloads/contracts"

import {
  buildDriverProfileShowcase,
  type DriverProfileShowcaseInput,
  type DriverProfileShowcaseView
} from "./driver-profile-showcase"
import type { NetworkView } from "./network"
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

  return `${formatter.format(new Date(startAt))} - ${formatter.format(new Date(endAt))} UTC`
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

/**
 * Assembles the facts behind the driver's own profile showcase. The view logic
 * lives in `buildDriverProfileShowcase`; this only reads canonical records for
 * the signed-in driver and their current equipment.
 */
export function getDriverProfileShowcase({
  availabilityStatus,
  driverProfileId,
  mediaReady,
  network,
  vault
}: {
  availabilityStatus: string | null
  driverProfileId: string | null
  mediaReady: boolean
  network: Pick<NetworkView, "activeOrganization" | "currentDriver" | "currentEquipment">
  vault: DriverProfileShowcaseInput["vault"]
}): DriverProfileShowcaseView {
  const state = services.state
  const driver = driverProfileId
    ? state.driverProfiles.find((profile) => profile.id === driverProfileId) ?? null
    : null
  const truck = network.currentEquipment
    ? state.truckProfiles.find((profile) => profile.id === network.currentEquipment?.truckId) ?? null
    : null
  const trailerId = network.currentEquipment?.trailerId ?? null
  const trailer = trailerId ? state.trailerProfiles.find((profile) => profile.id === trailerId) ?? null : null
  const reputation = driver
    ? services.getReputationForDriver(driver.id)
    : { avgRating: null, ratedCount: 0 }
  const trackRecord = driver
    ? services.getDriverTrackRecord(driver.id)
    : { approved: 0, completedHauls: 0, declined: 0, onTimeReviews: 0, requested: 0, statesHauled: [], timedReviews: 0 }

  return buildDriverProfileShowcase({
    availabilityStatus,
    driver: driver
      ? {
          homeBase: driver.homeBase,
          operatingRadiusMiles: driver.operatingRadiusMiles ?? null,
          yearsExperience: driver.yearsExperience
        }
      : null,
    driverName: network.currentDriver?.name ?? "Your driver profile",
    mediaReady,
    organizationName: network.activeOrganization.name,
    photos: {
      profile: network.currentDriver?.hasProfilePhoto ?? false,
      trailer: network.currentEquipment?.hasTrailerPhoto ?? false,
      truck: network.currentEquipment?.hasTruckPhoto ?? false,
      truckFeatured: network.currentDriver?.featureTruckPhoto ?? false
    },
    reputation: { avgRating: reputation.avgRating, ratedCount: reputation.ratedCount },
    trackRecord,
    trailer: trailer
      ? { capacityTons: trailer.capacityTons, trailerType: trailer.trailerType, unitNumber: trailer.unitNumber }
      : null,
    truck: truck
      ? {
          axleCount: truck.axleCount,
          make: truck.make,
          maxPayloadTons: truck.maxPayloadTons,
          model: truck.model,
          truckType: truck.truckType,
          unitNumber: truck.unitNumber,
          vin: truck.vin ?? null
        }
      : null,
    vault
  })
}
