export const CONTACT_INTEREST_OPTIONS = [
  { label: "General question", value: "general" },
  { label: "See the complete LogLoads workflow", value: "pilot_end_to_end" },
  { label: "Plan a host pilot", value: "pilot_host" },
  { label: "Explore fleet operations", value: "pilot_fleet" },
  { label: "Explore the driver experience", value: "pilot_driver" }
] as const

export type ContactInterest = (typeof CONTACT_INTEREST_OPTIONS)[number]["value"]

const CONTACT_INTEREST_VALUES = new Set<ContactInterest>(
  CONTACT_INTEREST_OPTIONS.map((option) => option.value)
)

export function parseContactInterest(value: unknown): ContactInterest | null {
  if (typeof value !== "string") {
    return null
  }

  const normalized = value.trim().toLowerCase()

  return CONTACT_INTEREST_VALUES.has(normalized as ContactInterest)
    ? normalized as ContactInterest
    : null
}

export function contactInterestLabel(value: ContactInterest): string {
  return CONTACT_INTEREST_OPTIONS.find((option) => option.value === value)?.label ?? "General question"
}

export function contactInterestFromQuery(
  topic: string | string[] | undefined,
  role: string | string[] | undefined
): ContactInterest {
  const firstTopic = Array.isArray(topic) ? topic[0] : topic
  const firstRole = Array.isArray(role) ? role[0] : role
  const normalizedRole = firstRole?.trim().toLowerCase()

  if (firstTopic?.trim().toLowerCase() !== "pilot") {
    return "general"
  }

  if (normalizedRole === "host") return "pilot_host"
  if (normalizedRole === "fleet") return "pilot_fleet"
  if (normalizedRole === "driver") return "pilot_driver"

  return "pilot_end_to_end"
}
