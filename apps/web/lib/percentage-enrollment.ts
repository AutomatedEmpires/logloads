import { createHash } from "node:crypto"

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type PercentageEnrollmentState =
  | "disabled"
  | "disabled_stale_scope"
  | "enabled"
  | "misconfigured"

export interface PercentageEnrollmentStatus {
  allowedOrganizationCount: number
  allowedOrganizationScopeSha256: string | null
  enrollment: PercentageEnrollmentState
  invalidEntryCount: number
}

type EnrollmentEnvironment = Readonly<Record<string, string | undefined>>

function enrollmentScope(env: EnrollmentEnvironment) {
  const entries = (env.LOGLOADS_PERCENTAGE_ALLOWED_ORGANIZATION_IDS ?? "")
    .split(",")
    .map((candidate) => candidate.trim().toLowerCase())
    .filter(Boolean)
  const invalidEntryCount = entries.filter(
    (candidate) => !UUID_PATTERN.test(candidate)
  ).length
  const organizationIds = [...new Set(
    entries.filter((candidate) => UUID_PATTERN.test(candidate))
  )].sort()

  return { invalidEntryCount, organizationIds }
}

export function percentageEnrollmentStatus(
  env: EnrollmentEnvironment = process.env
): PercentageEnrollmentStatus {
  const { invalidEntryCount, organizationIds } = enrollmentScope(env)
  const rawGate = env.LOGLOADS_PERCENTAGE_ENROLLMENT?.trim().toLowerCase() ?? ""
  const gateEnabled = rawGate === "enabled"
  const gateDisabled = rawGate === "" || rawGate === "disabled"
  const scopeConfigured = organizationIds.length > 0 || invalidEntryCount > 0
  const enrollment: PercentageEnrollmentState = !gateEnabled && !gateDisabled
    ? "misconfigured"
    : gateEnabled
      ? organizationIds.length > 0 && invalidEntryCount === 0
        ? "enabled"
        : "misconfigured"
      : scopeConfigured
        ? "disabled_stale_scope"
        : "disabled"

  return {
    allowedOrganizationCount: organizationIds.length,
    allowedOrganizationScopeSha256: organizationIds.length > 0
      ? createHash("sha256").update(organizationIds.join("\n")).digest("hex")
      : null,
    enrollment,
    invalidEntryCount
  }
}

export function percentageEnrollmentAllowed(
  organizationId: string,
  env: EnrollmentEnvironment = process.env
): boolean {
  const status = percentageEnrollmentStatus(env)

  if (status.enrollment !== "enabled") {
    return false
  }

  return enrollmentScope(env).organizationIds.includes(
    organizationId.trim().toLowerCase()
  )
}
