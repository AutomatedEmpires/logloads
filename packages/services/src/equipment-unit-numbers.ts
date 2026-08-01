import type { LogLoadsDatabaseState } from "@logloads/db"

import { assertCondition, assertDomainCondition, assertFound } from "./utils"

export type EquipmentProfileKind = "trailer" | "truck"

interface EquipmentUnitProfile {
  id: string
  unitNumber: string
}

/**
 * Fleet labels are compared as a driver or reviewer reads them, not as raw
 * database bytes. Punctuation and spacing therefore cannot be used to create two
 * visually equivalent unit numbers such as `NP-101` and `np 101`.
 */
export function normalizeEquipmentUnitNumber(unitNumber: string): string {
  return unitNumber
    .normalize("NFKC")
    .toLocaleUpperCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, "")
}

function organizationEquipmentProfiles(
  state: LogLoadsDatabaseState,
  organizationId: string,
  kind: EquipmentProfileKind
): EquipmentUnitProfile[] {
  const organizationCombinations = state.equipmentCombinations.filter(
    (combination) => combination.organizationId === organizationId
  )
  const organizationTruckIds = new Set([
    ...state.truckProfiles
      .filter((truck) => truck.companyId === organizationId)
      .map((truck) => truck.id),
    ...organizationCombinations.map((combination) => combination.truckProfileId)
  ])

  if (kind === "truck") {
    return state.truckProfiles.filter((truck) => organizationTruckIds.has(truck.id))
  }

  const organizationTrailerIds = new Set(
    organizationCombinations.flatMap((combination) =>
      combination.trailerProfileId ? [combination.trailerProfileId] : []
    )
  )

  return state.trailerProfiles.filter(
    (trailer) =>
      organizationTrailerIds.has(trailer.id) ||
      Boolean(trailer.truckId && organizationTruckIds.has(trailer.truckId))
  )
}

function assertUsableUnitNumber(kind: EquipmentProfileKind, unitNumber: string): string {
  const normalized = normalizeEquipmentUnitNumber(unitNumber)

  assertCondition(
    normalized.length > 0,
    `${kind === "truck" ? "Truck" : "Trailer"} unit numbers must contain a letter or number`
  )

  return normalized
}

/**
 * Validate the whole existing organization before accepting another fleet row.
 * The state store has no unique index, so imported or historical duplicates must
 * fail closed rather than being silently preserved beside a valid new record.
 */
export function assertOrganizationEquipmentUnitNumbersUnique(
  state: LogLoadsDatabaseState,
  organizationId: string
): void {
  for (const kind of ["truck", "trailer"] as const) {
    const seen = new Map<string, string>()

    for (const profile of organizationEquipmentProfiles(state, organizationId, kind)) {
      const normalized = assertUsableUnitNumber(kind, profile.unitNumber)
      const existingProfileId = seen.get(normalized)

      assertCondition(
        !existingProfileId || existingProfileId === profile.id,
        `This organization has duplicate ${kind} unit numbers; resolve them before using fleet equipment`
      )
      seen.set(normalized, profile.id)
    }
  }
}

export function assertEquipmentUnitNumberAvailable(
  state: LogLoadsDatabaseState,
  organizationId: string,
  kind: EquipmentProfileKind,
  unitNumber: string
): void {
  assertOrganizationEquipmentUnitNumbersUnique(state, organizationId)

  const normalized = normalizeEquipmentUnitNumber(unitNumber)

  assertDomainCondition(
    normalized.length > 0,
    `${kind === "truck" ? "Truck" : "Trailer"} unit numbers must contain a letter or number`
  )

  const conflict = organizationEquipmentProfiles(state, organizationId, kind).some(
    (profile) => normalizeEquipmentUnitNumber(profile.unitNumber) === normalized
  )

  assertDomainCondition(
    !conflict,
    `That ${kind} unit number is already in use in this organization`
  )
}

/**
 * A photographed unit label can only prove one profile when that label is
 * unambiguous inside the organization. Recheck at every credential gate so
 * malformed imported state cannot revive the wrong-rig evidence bypass.
 */
export function assertEquipmentProfileUnitNumberUnambiguous(
  state: LogLoadsDatabaseState,
  organizationId: string,
  kind: EquipmentProfileKind,
  profileId: string
): void {
  const profiles = organizationEquipmentProfiles(state, organizationId, kind)
  const selected = assertFound(
    profiles.find((profile) => profile.id === profileId),
    `The selected ${kind} does not belong to this organization`
  )
  const normalized = assertUsableUnitNumber(kind, selected.unitNumber)

  assertCondition(
    profiles.filter(
      (profile) => normalizeEquipmentUnitNumber(profile.unitNumber) === normalized
    ).length === 1,
    `The selected ${kind} unit number is not unique in this organization`
  )
}

export function equipmentProfileUnitNumberIsUnambiguous(
  state: LogLoadsDatabaseState,
  organizationId: string,
  kind: EquipmentProfileKind,
  profileId: string
): boolean {
  const profiles = organizationEquipmentProfiles(state, organizationId, kind)
  const selected = profiles.find((profile) => profile.id === profileId)

  if (!selected) {
    return false
  }

  const normalized = normalizeEquipmentUnitNumber(selected.unitNumber)

  return (
    normalized.length > 0 &&
    profiles.filter(
      (profile) => normalizeEquipmentUnitNumber(profile.unitNumber) === normalized
    ).length === 1
  )
}
