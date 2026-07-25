/**
 * Civil time at a site, resolved against that site's own zone.
 *
 * A landing's operating hours are a CIVIL fact ("we load 06:00 to 18:00"), and a
 * slot's date is the civil date at the landing. Both become UTC instants before
 * any scheduling arithmetic touches them — the conflict maths in `scheduling.ts`
 * works only on instants, never on civil dates.
 *
 * Why this exists rather than a date library: the two failure modes that matter
 * are DST edges, and both need a STATED answer rather than whatever a library
 * happens to do. `packages/services/src/truck-slots.ts` slices UTC to derive a
 * slot's date, which is wrong for any site whose civil date differs from UTC's
 * at that hour — the whole US west coast, every evening.
 *
 * The two stated rules:
 * - A civil time that does not exist (spring forward) resolves FORWARD, to the
 *   first valid instant at or after it. It never throws: a host's stated 02:30
 *   opening must still generate a slot on the day the clocks jump.
 * - A civil time that occurs twice (fall back) resolves to the FIRST occurrence.
 *
 * A null zone is a real state, not an error: a site whose zone nobody has stated
 * must not have one guessed for it (a wrong-but-plausible zone silently mis-times
 * every slot by hours, and nothing ever prompts anyone to fix it). Callers that
 * need a zone refuse; callers that only render get null back.
 */

const MINUTE_MS = 60_000

interface CivilFields {
  dateKey: string
  minutesFromMidnight: number
}

function civilFormatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "2-digit",
    second: "2-digit",
    timeZone,
    year: "numeric"
  })
}

function civilFieldsAt(instant: number, timeZone: string): CivilFields & { totalMs: number } {
  const parts = civilFormatter(timeZone).formatToParts(new Date(instant))
  const read = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? "0")
  // en-US with hour12:false renders midnight as hour 24, not 0.
  const hour = read("hour") % 24
  const year = read("year")
  const month = read("month")
  const day = read("day")
  const minute = read("minute")

  return {
    dateKey: `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    minutesFromMidnight: hour * 60 + minute,
    totalMs: Date.UTC(year, month - 1, day, hour, minute, read("second"))
  }
}

/** The zone's UTC offset in minutes at a given instant (positive east of UTC). */
function zoneOffsetMinutes(instant: number, timeZone: string): number {
  return (civilFieldsAt(instant, timeZone).totalMs - instant) / MINUTE_MS
}

function civilTargetMs(dateKey: string, minutesFromMidnight: number): number {
  const [year, month, day] = dateKey.split("-").map(Number)

  return Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1) + minutesFromMidnight * MINUTE_MS
}

function rendersRequestedCivil(
  instant: number,
  timeZone: string,
  target: number
): boolean {
  const fields = civilFieldsAt(instant, timeZone)

  return civilTargetMs(fields.dateKey, fields.minutesFromMidnight) === target
}

/**
 * The civil date at a site, as the site would write it. Never slice a UTC
 * timestamp for this: 23:30 in Oregon is already tomorrow in UTC.
 */
export function civilDateKey(instant: string, timeZone: string): string {
  return civilFieldsAt(new Date(instant).getTime(), timeZone).dateKey
}

/**
 * Resolve a civil time at a site to a UTC instant.
 *
 * `minutesFromMidnight` is minutes into the civil day, which is how operating
 * hours are stated; values beyond 1440 are permitted so a window may close after
 * midnight without the caller doing date arithmetic.
 */
export function zonedCivilToUtc(
  dateKey: string,
  minutesFromMidnight: number,
  timeZone: string
): string {
  const target = civilTargetMs(dateKey, minutesFromMidnight)
  // Two candidate instants: one using the offset well before the requested
  // civil time, one well after. On a normal day both agree. Across a DST
  // transition they differ, and that difference IS the edge case.
  const candidates = [
    target - zoneOffsetMinutes(target - 12 * 60 * MINUTE_MS, timeZone) * MINUTE_MS,
    target - zoneOffsetMinutes(target + 12 * 60 * MINUTE_MS, timeZone) * MINUTE_MS
  ]
  const valid = candidates
    .filter((candidate) => rendersRequestedCivil(candidate, timeZone, target))
    .sort((left, right) => left - right)

  // Occurs twice (fall back) -> the FIRST occurrence. Occurs once -> itself.
  if (valid.length > 0) {
    return new Date(valid[0]!).toISOString()
  }

  // Does not exist (spring forward). Resolve FORWARD to the first valid instant
  // at or after the requested civil time, found by bisecting the transition
  // rather than by guessing the gap's width — gaps are not always one hour.
  let low = Math.min(...candidates)
  let high = Math.max(...candidates)

  while (high - low > MINUTE_MS) {
    const middle = low + Math.floor((high - low) / 2 / MINUTE_MS) * MINUTE_MS
    const fields = civilFieldsAt(middle, timeZone)

    if (civilTargetMs(fields.dateKey, fields.minutesFromMidnight) < target) {
      low = middle
    } else {
      high = middle
    }
  }

  return new Date(high).toISOString()
}

/**
 * A time as the site reads it, with its own abbreviation, so a driver in one
 * zone is never shown a pickup time in theirs. Null zone renders nothing at all
 * rather than a confident wrong abbreviation.
 */
export function formatSiteLocal(instant: string, timeZone: string | null): string | null {
  if (!timeZone) {
    return null
  }

  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    hour12: true,
    minute: "2-digit",
    timeZone,
    timeZoneName: "short"
  }).format(new Date(instant))
}
