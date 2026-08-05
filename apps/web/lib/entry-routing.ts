import { safeInternalPath } from "./safe-redirect"
import {
  canAccessCockpit,
  homePathFor,
  membershipForCockpit,
  type Cockpit,
  type SessionActor
} from "./session-policy"

export type EntryIntent = Exclude<Cockpit, "admin">

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
