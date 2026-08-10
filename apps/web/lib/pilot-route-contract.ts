export const pilotRoleSlugs = ["host", "fleet", "driver"] as const

export type PilotRole = (typeof pilotRoleSlugs)[number]

export const pilotSurfaceSlugs = [
  "host-command",
  "host-work",
  "host-live",
  "host-messages",
  "host-carriers",
  "host-landings",
  "host-schedule",
  "host-reliability",
  "host-assistant",
  "host-analytics",
  "host-workspace",
  "host-billing",
  "fleet-command",
  "fleet-dispatch",
  "fleet-trips",
  "fleet-messages",
  "fleet-opportunities",
  "fleet-opportunity-detail",
  "fleet-network",
  "fleet-drivers",
  "fleet-trucks",
  "fleet-availability",
  "fleet-performance",
  "fleet-assistant",
  "fleet-workspace",
  "fleet-billing",
  "driver-map",
  "driver-loads",
  "driver-load-detail",
  "driver-schedule",
  "driver-profile",
  "driver-messages",
  "driver-equipment",
  "driver-assistant",
  "driver-network"
] as const

const pilotRoleSet = new Set<string>(pilotRoleSlugs)
const pilotSurfaceSet = new Set<string>(pilotSurfaceSlugs)

export function isKnownPilotPath(pathname: string): boolean {
  const segments = pathname.split("/").filter(Boolean)

  if (segments[0] !== "pilot") return true
  if (segments.length === 1) return true
  if (segments.length === 2) {
    const candidate = segments[1] ?? ""

    if (pilotRoleSet.has(candidate)) return true
    if (!candidate.endsWith(".jpg")) return false

    return pilotSurfaceSet.has(candidate.slice(0, -4))
  }

  return segments.length === 3 &&
    segments[1] === "capture" &&
    pilotSurfaceSet.has(segments[2] ?? "")
}
