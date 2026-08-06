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
