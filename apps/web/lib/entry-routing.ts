import { safeInternalPath } from "./safe-redirect"
import {
  canAccessCockpit,
  homePathFor,
  membershipForCockpit,
  type Cockpit,
  type SessionActor
} from "./session-policy"

export type EntryIntent = Exclude<Cockpit, "admin">
export type FirstRunSource = "created" | "invited"

export interface FirstRunHandoff {
  continuation: string
  source: FirstRunSource
}

export function firstRunContinuationCookieName(intent: EntryIntent): string {
  return `ll_first_run_${intent}`
}

export type ExistingActorEntryDecision =
  | { kind: "redirect"; href: string }
  | { kind: "switch"; href: string; organizationId: string; organizationName: string }
  | { kind: "session"; currentHome: string }

const ENTRY_ROUTES = ["/sign-in", "/sign-up", "/onboarding"] as const

function isRouteAtOrBelow(pathname: string, route: string): boolean {
  return pathname === route || pathname.startsWith(`${route}/`)
}

function pathnameOf(path: string): string {
  return path.split(/[?#]/, 1)[0] ?? path
}

function normalizedPathname(path: string): string {
  const pathname = pathnameOf(path)

  return pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname
}

function cockpitForPath(path: string): Cockpit | null {
  const pathname = pathnameOf(path)

  for (const cockpit of ["driver", "fleet", "host", "admin"] as const) {
    if (isRouteAtOrBelow(pathname, `/${cockpit}`)) {
      return cockpit
    }
  }

  return null
}

export function parseEntryIntent(value: unknown): EntryIntent | null {
  return value === "driver" || value === "fleet" || value === "host" ? value : null
}

export function firstSearchValue(
  value: string | string[] | undefined
): string | undefined {
  return Array.isArray(value) ? value.at(0) : value
}

/**
 * Authentication continuations must stay internal, must not point back into an
 * entry loop, and must not contradict an explicit role intent.
 */
export function safeEntryNext(
  value: unknown,
  intent: EntryIntent | null = null
): string {
  if (typeof value !== "string") {
    return ""
  }

  const safePath = safeInternalPath(value, "")

  if (!safePath) {
    return ""
  }

  const pathname = pathnameOf(safePath)

  if (ENTRY_ROUTES.some((route) => isRouteAtOrBelow(pathname, route))) {
    return ""
  }

  const targetCockpit = cockpitForPath(safePath)

  if (intent && targetCockpit && targetCockpit !== intent) {
    return ""
  }

  return safePath
}

/**
 * A first-run page may offer the original destination only when it stays in
 * the account's cockpit and is not another spelling of the handoff page.
 * Consumers re-check this rule so a hand-crafted URL cannot introduce a
 * public, cross-role, or self-looping continuation.
 */
export function safeFirstRunContinuation(
  intent: EntryIntent,
  handoffPath: string,
  value: unknown
): string {
  const safePath = safeEntryNext(value, intent)

  if (
    !safePath ||
    cockpitForPath(safePath) !== intent ||
    normalizedPathname(safePath) === normalizedPathname(handoffPath)
  ) {
    return ""
  }

  // The pathname is enough to resume role-specific work. Nested query values
  // and fragments are intentionally not carried through onboarding URLs,
  // browser history, platform logs, or error reports.
  const pathname = pathnameOf(safePath)

  return pathname.length <= 512 ? pathname : ""
}

const FIRST_RUN_DESTINATIONS = {
  driver: "/driver/profile?welcome=1",
  fleet: "/fleet/command?welcome=1",
  host: "/host/landings?welcome=1"
} satisfies Record<EntryIntent, string>

/**
 * A newly created account always sees its role-specific handoff before any
 * requested destination. The redirect URL never carries the continuation;
 * the action stores a short-lived, role-scoped HttpOnly handoff separately.
 * This keeps a posted `next` value from bypassing first-run guidance or
 * entering browser history, analytics, referrers, and platform request logs.
 */
export function firstRunDestination(
  intent: EntryIntent
): string {
  return FIRST_RUN_DESTINATIONS[intent]
}

/**
 * The continuation lives briefly in an HttpOnly cookie instead of the browser
 * URL. This avoids duplicating private resource paths into analytics, history,
 * referrers, platform request logs, or client error reports.
 */
export function createFirstRunHandoffCookie(
  intent: EntryIntent,
  value: unknown,
  source: FirstRunSource,
  userId: string
): string {
  const path = safeFirstRunContinuation(intent, FIRST_RUN_DESTINATIONS[intent], value)

  return encodeURIComponent(JSON.stringify({ intent, path, source, userId }))
}

export function readFirstRunHandoffCookie(
  intent: EntryIntent,
  value: unknown,
  userId: string
): FirstRunHandoff | null {
  if (typeof value !== "string" || value.length > 1024) {
    return null
  }

  try {
    const parsed = JSON.parse(decodeURIComponent(value)) as {
      intent?: unknown
      path?: unknown
      source?: unknown
      userId?: unknown
    }

    if (
      parsed.intent !== intent ||
      parsed.userId !== userId ||
      (parsed.source !== "created" && parsed.source !== "invited")
    ) {
      return null
    }

    return {
      continuation: safeFirstRunContinuation(
        intent,
        FIRST_RUN_DESTINATIONS[intent],
        parsed.path
      ),
      source: parsed.source
    }
  } catch {
    return null
  }
}

function defaultHomeForIntent(intent: EntryIntent): string {
  if (intent === "driver") {
    return "/driver/loads"
  }

  return intent === "fleet" ? "/fleet/command" : "/host/command"
}

/**
 * Marketplace V2's entry (#246). While V2 is on, `/v2/start` replaces the legacy `/onboarding` (UX 02 §2.3): a finished
 * sign-up lands there, and so does every legacy route that sends an account without a profile to onboarding. These are
 * the paths the V2 setup pages use (`marketplace-v2/hauler-profile-form.ts`, checked by a test). They are restated
 * here because the middleware imports this module, and that one imports the contracts package.
 */
export const V2_START_PATH = "/v2/start"
export const V2_HAULER_START_PATH = "/v2/start/hauler"
export const V2_LANDING_START_PATH = "/v2/start/landing"

/** A public call to action's role intent already chose the side, so its setup skips the choice (UX 02 §A1). */
const V2_START_FOR_INTENT = {
  driver: V2_HAULER_START_PATH,
  fleet: V2_HAULER_START_PATH,
  host: V2_LANDING_START_PATH
} satisfies Record<EntryIntent, string>

/** The hauler setup's business types (`/v2/start/hauler?type=`, UX 02 §A2). */
const HAULER_SETUP_TYPES: ReadonlySet<string> = new Set(["solo", "company", "member"])
const MAX_V2_SETUP_STEP_LENGTH = 512
const MAX_V2_CONTINUATION_LENGTH = 1024

/**
 * Remembers the setup step a sign-in or sign-up continues to (#246), for the hops that do not carry `next` along:
 * from sign-in to sign-up, and through the provider's email verification. It holds a canonical setup step only.
 */
export const V2_SETUP_RESUME_COOKIE = "ll_v2_setup"
/** An hour: time to find a verification email, and short enough that a much later visit is not sent back to it. */
export const V2_SETUP_RESUME_MAX_AGE_SECONDS = 60 * 60

export function v2SetupResumeCookieOptions(secure = process.env.NODE_ENV === "production") {
  return { httpOnly: true, maxAge: V2_SETUP_RESUME_MAX_AGE_SECONDS, path: "/", sameSite: "lax" as const, secure }
}

/** Whether a path is in Marketplace V2: `/v2` or below it, by whole segment. */
export function isMarketplaceV2Path(path: string): boolean {
  return isRouteAtOrBelow(pathnameOf(path), "/v2")
}

/**
 * The legacy onboarding entry a pathname is (`/onboarding`, or `/onboarding/<role>` from a public call to action),
 * with the role intent it names; `null` for any other route.
 */
export function legacyOnboardingEntry(pathname: string): { intent: EntryIntent | null } | null {
  const path = normalizedPathname(pathname)

  if (path === "/onboarding") {
    return { intent: null }
  }

  const intent = path.startsWith("/onboarding/") ? parseEntryIntent(path.slice("/onboarding/".length)) : null

  return intent ? { intent } : null
}

/**
 * The setup step a path names, in canonical form, or "" when it names none (#246). Setup steps are the V2 pages a
 * person can be on before they have a business: the path choice and the two setup starts. Only the query values those
 * pages read survive (`type` on hauler setup), so a remembered step never carries anything else, and
 * `/v2/start?path=hauler` is the same step as `/v2/start/hauler`, where that page sends it.
 */
export function v2SetupStep(value: unknown): string {
  if (typeof value !== "string" || value.length > MAX_V2_SETUP_STEP_LENGTH) {
    return ""
  }

  const safePath = safeInternalPath(value, "")

  if (!safePath) {
    return ""
  }

  const url = new URL(safePath, "https://logloads.internal")
  const pathname = normalizedPathname(url.pathname)

  if (pathname === V2_START_PATH) {
    const path = url.searchParams.get("path")

    return path === "hauler" ? V2_HAULER_START_PATH : path === "landing" ? V2_LANDING_START_PATH : V2_START_PATH
  }

  if (pathname === V2_HAULER_START_PATH) {
    const type = url.searchParams.get("type") ?? ""

    return HAULER_SETUP_TYPES.has(type) ? `${V2_HAULER_START_PATH}?type=${type}` : V2_HAULER_START_PATH
  }

  return pathname === V2_LANDING_START_PATH ? V2_LANDING_START_PATH : ""
}

/**
 * Where a Marketplace V2 entry continues (#246), in this order:
 *
 * 1. `next`, when it is a safe V2 path: the page the person asked for before signing in or up, such as a job or a
 *    setup step. A legacy cockpit or any other continuation is dropped: V2 never sends anyone to one (UX 02 §2.2).
 * 2. The setup start for an explicit role intent, such as `/sign-up?path=host` from a public call to action.
 * 3. `resume`: the setup step remembered when sign-in or sign-up began (`V2_SETUP_RESUME_COOKIE`). LogLoads only ever
 *    writes a canonical step there, so anything else is ignored.
 * 4. `/v2/start`.
 */
export function v2EntryDestination({
  intent = null,
  next,
  resume
}: {
  intent?: EntryIntent | null
  next?: unknown
  resume?: unknown
}): string {
  const continuation = safeEntryNext(next)

  if (continuation && continuation.length <= MAX_V2_CONTINUATION_LENGTH && isMarketplaceV2Path(continuation)) {
    return continuation
  }

  if (intent) {
    return V2_START_FOR_INTENT[intent]
  }

  const step = v2SetupStep(resume)

  return step && step === resume ? step : V2_START_PATH
}

export function homePathForIntent(actor: SessionActor, intent: EntryIntent): string | null {
  return canAccessCockpit(actor, intent) ? defaultHomeForIntent(intent) : null
}

/**
 * Preserve explicit work intent for an already-provisioned account. If the
 * current identity cannot enter the requested cockpit, stop on a transparent
 * account-state screen instead of silently opening its default cockpit.
 */
export function decideExistingActorEntry(
  actor: SessionActor,
  options: { intent?: EntryIntent | null; next?: string | null }
): ExistingActorEntryDecision {
  const intent = options.intent ?? null
  const next = safeEntryNext(options.next, intent)
  const intentHome = intent ? homePathForIntent(actor, intent) : null
  const inactiveMembership = intent && !intentHome ? membershipForCockpit(actor, intent) : null

  if (intent && !intentHome && !inactiveMembership) {
    return { currentHome: homePathFor(actor), kind: "session" }
  }

  if (next) {
    const targetCockpit = cockpitForPath(next)

    if (intent && targetCockpit === intent && inactiveMembership) {
      return {
        href: next,
        kind: "switch",
        organizationId: inactiveMembership.organization.id,
        organizationName: inactiveMembership.organization.displayName
      }
    }

    if (intent ? targetCockpit === intent : !targetCockpit || canAccessCockpit(actor, targetCockpit)) {
      return { href: next, kind: "redirect" }
    }
  }

  if (intentHome) {
    return { href: intentHome, kind: "redirect" }
  }

  if (intent && inactiveMembership) {
    return {
      href: defaultHomeForIntent(intent),
      kind: "switch",
      organizationId: inactiveMembership.organization.id,
      organizationName: inactiveMembership.organization.displayName
    }
  }

  return { currentHome: homePathFor(actor), kind: "session" }
}
