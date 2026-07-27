import { z } from "zod"

const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/
const realCalendarDate = z.string().date()

/**
 * The expiry a driver states, resolved from the date printed on the document to
 * the instant it lapses.
 *
 * The document remains valid through that date, so it resolves to the end of
 * the UTC day. Zod's calendar-date validation is deliberate: Date.parse
 * normalizes impossible inputs such as February 31 into March instead of
 * rejecting them.
 */
export function parseStatedCredentialExpiry(
  value: string | null | undefined
): string | null {
  if (!value) {
    return null
  }

  if (!CALENDAR_DATE.test(value)) {
    throw new Error("Enter the expiry date as it is printed on the document")
  }

  if (!realCalendarDate.safeParse(value).success) {
    throw new Error("That is not a real date")
  }

  return `${value}T23:59:59.000Z`
}
