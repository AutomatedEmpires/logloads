import {
  availabilityWindowSchema,
  driverProfileSchema,
  futureAvailabilitySchema,
  organizationRoleCan,
  type DriverProfile,
  type Organization
} from "@logloads/contracts"
import type { LogLoadsDatabaseState } from "@logloads/db"

import { organizationOperationallyAccessible } from "./organization-access"

/**
 * Driver access is organization-scoped. A profile alone is only historical
 * identity; it becomes usable when the person and the exact organization
 * membership that owns it are both active and the membership can request work.
 * Duplicate rows fail closed instead of letting array order choose authority.
 */
export function activeDriverProfileForOrganization(
  state: LogLoadsDatabaseState,
  userId: string,
  organizationId: string
): DriverProfile | null {
  const user = state.profiles.find((candidate) => candidate.id === userId && candidate.isActive)
  const organization = state.organizations.find(
    (candidate) =>
      candidate.id === organizationId &&
      organizationOperationallyAccessible(candidate)
  )
  const memberships = state.organizationMemberships.filter(
    (membership) =>
      membership.organizationId === organizationId &&
      membership.status === "active" &&
      membership.userId === userId
  )
  const profiles = state.driverProfiles.filter(
    (profile) => profile.companyId === organizationId && profile.userId === userId
  )

  return user &&
    organization &&
    memberships.length === 1 &&
    organizationRoleCan(memberships[0]!.role, "request_assignment") &&
    profiles.length === 1
    ? profiles[0]!
    : null
}

export function driverProfileCanRequestForOrganization(
  state: LogLoadsDatabaseState,
  driverProfile: DriverProfile,
  organizationId: string
): boolean {
  return (
    driverProfile.companyId === organizationId &&
    driverProfile.availabilityStatus !== "unavailable" &&
    activeDriverProfileForOrganization(state, driverProfile.userId, organizationId)?.id === driverProfile.id
  )
}

function organizationDriverProfiles(
  state: LogLoadsDatabaseState,
  userId: string,
  organizationId: string
): DriverProfile[] {
  return state.driverProfiles.filter(
    (profile) => profile.userId === userId && profile.companyId === organizationId
  )
}

export function assertOrganizationDriverProfileIntegrity(
  state: LogLoadsDatabaseState,
  userId: string,
  organizationId: string
): DriverProfile | null {
  const profiles = organizationDriverProfiles(state, userId, organizationId)

  if (profiles.length > 1) {
    throw new Error("Organization driver profile identity is ambiguous")
  }

  return profiles[0] ?? null
}

function markCurrentAndFutureAvailabilityUnavailable(
  state: LogLoadsDatabaseState,
  driverProfileId: string,
  organizationId: string,
  timestamp: string
): void {
  state.availabilityWindows = state.availabilityWindows.map((window) =>
    window.driverProfileId === driverProfileId && window.endAt >= timestamp
      ? availabilityWindowSchema.parse({ ...window, status: "unavailable", updatedAt: timestamp })
      : window
  )

  const equipmentCombinationIds = new Set(
    state.equipmentCombinations
      .filter(
        (combination) =>
          combination.assignedDriverProfileId === driverProfileId &&
          combination.organizationId === organizationId
      )
      .map((combination) => combination.id)
  )

  state.futureAvailability = state.futureAvailability.map((availability) =>
    availability.organizationId === organizationId &&
    equipmentCombinationIds.has(availability.equipmentCombinationId) &&
    availability.endsAt >= timestamp
      ? futureAvailabilitySchema.parse({ ...availability, status: "unavailable", updatedAt: timestamp })
      : availability
  )
}

/**
 * Preserve the profile and every completed-work reference while making the
 * driver unavailable. Historical availability windows stay historical; only
 * windows that are current or future at the lifecycle transition are closed.
 */
export function markOrganizationDriverUnavailable(
  state: LogLoadsDatabaseState,
  userId: string,
  organizationId: string,
  timestamp: string
): DriverProfile | null {
  const existing = assertOrganizationDriverProfileIntegrity(state, userId, organizationId)

  if (!existing) {
    return null
  }

  const updated = driverProfileSchema.parse({
    ...existing,
    availabilityStatus: "unavailable",
    updatedAt: timestamp
  })

  state.driverProfiles = state.driverProfiles.map((profile) =>
    profile.id === updated.id ? updated : profile
  )
  markCurrentAndFutureAvailabilityUnavailable(state, updated.id, organizationId, timestamp)

  return updated
}

/** Assigning or re-inviting a driver starts safely unavailable. */
export function ensureUnavailableOrganizationDriverProfile(
  state: LogLoadsDatabaseState,
  userId: string,
  organization: Organization,
  timestamp: string,
  id: string
): DriverProfile {
  const existing = assertOrganizationDriverProfileIntegrity(state, userId, organization.id)
  const profile = driverProfileSchema.parse(
    existing
      ? { ...existing, availabilityStatus: "unavailable", updatedAt: timestamp }
      : {
          availabilityStatus: "unavailable",
          companyId: organization.id,
          createdAt: timestamp,
          equipmentPreferences: [],
          homeBase: organization.primaryRegion,
          id,
          licenseNumber: "pending-review",
          notes: null,
          updatedAt: timestamp,
          userId,
          yearsExperience: 0
        }
  )

  if (existing) {
    state.driverProfiles = state.driverProfiles.map((candidate) =>
      candidate.id === profile.id ? profile : candidate
    )
  } else {
    state.driverProfiles.push(profile)
  }

  markCurrentAndFutureAvailabilityUnavailable(state, profile.id, organization.id, timestamp)

  return profile
}
