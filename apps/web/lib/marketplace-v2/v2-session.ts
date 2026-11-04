import "server-only"

import type { MarketplaceMemberRole, Organization } from "@logloads/contracts"
import { revalidatePath } from "next/cache"
import { cookies } from "next/headers"
import { cache } from "react"

import { MEMBER_ROLE_LABELS } from "../plans"
import {
  createSessionCookieValue,
  getClerkUserId,
  getSessionActor,
  getSessionIdentity,
  hasSessionIdentity,
  SESSION_COOKIE,
  SESSION_COOKIE_OPTIONS,
  type SessionActor
} from "../session"
import { marketplaceV2AdapterKind, normalizedSessionStore, type NormalizedSessionPrincipal } from "./adapter"
import { hasHaulerSide, hasLandingSide } from "./navigation"
import type { NormalizedViewerMembership } from "./normalized-mapping"

/**
 * The Marketplace V2 session (#213): the signed-in person, the businesses they may act for, and the one they are
 * acting for, from the store the selected marketplace adapter uses (`adapter.ts`).
 *
 * - Pilot (the default, and always in production): exactly the pilot session (`getSessionActor()`), relabelled
 *   for V2. Nothing about it changes.
 * - Normalized: the person and their active memberships come from the normalized store, read as that person
 *   (`normalized-session.ts`). A first sign-in is linked there through `sync_verified_identity`.
 *
 * On both, the identity comes only from the server session, and the active business is always one of the person's
 * active memberships: the signed cookie's selection is honoured only while it matches one, and a selection that no
 * longer matches is marked invalid instead of falling through to another business. Every request reads the
 * memberships again, so a removed membership loses access on the next request. Legacy cockpits keep using the
 * pilot session; this is V2's view only.
 */

export type V2SessionStore = "pilot" | "normalized"

export interface V2SessionMembership {
  organization: { id: string; displayName: string }
  /** V2 wording for the kind of business, e.g. "Hauling business". */
  kindLabel: string
  /** The person's role in it, e.g. "Owner". */
  roleLabel: string
}

export interface V2SessionActor {
  /** The store the memberships come from: the selected marketplace adapter's. */
  store: V2SessionStore
  /** The person. On the normalized store `id` is their `app_users.id`, which every port call carries. */
  profile: { id: string; fullName: string; email: string | null }
  /** Active memberships of businesses that can operate, in a stable order. */
  memberships: V2SessionMembership[]
  activeOrganization: { id: string; displayName: string } | null
  activeMembership: V2SessionMembership | null
  /** A pilot platform administrator, whose home is the legacy admin cockpit. Never set from the normalized store. */
  isPlatformAdmin: boolean
  /** A signed business selection was present but matches none of the person's active memberships. */
  workspaceSelectionInvalid: boolean
}

/** V2 wording for a pilot organization's kind; hauling covers both carrier and fleet organizations. */
const PILOT_KIND_LABELS = {
  carrier: "Hauling business",
  destination: "Destination facility",
  fleet: "Hauling business",
  landing_source: "Landing business",
  platform: "LogLoads platform"
} satisfies Record<Organization["type"], string>

/** The normalized schema's four roles (`organization_memberships.role`). */
const NORMALIZED_ROLE_LABELS = {
  driver: "Driver",
  manager: "Manager",
  owner: "Owner",
  staff: "Staff"
} satisfies Record<MarketplaceMemberRole, string>

/**
 * The active business for a signed selection: exactly the requested one while it is still a membership (and
 * otherwise none, marked invalid, never another business), or the first membership when nothing was selected.
 * The same rule as the pilot session (`selectedSessionMembership`).
 */
export function selectV2Membership<T extends { organization: { id: string } }>(
  memberships: readonly T[],
  requestedOrganizationId: string | null
): { active: T | null; invalid: boolean } {
  if (requestedOrganizationId) {
    const active = memberships.find((entry) => entry.organization.id === requestedOrganizationId) ?? null

    return { active, invalid: !active }
  }

  return { active: memberships[0] ?? null, invalid: false }
}

/** The pilot session, as V2 shows it. Labels only; which businesses and which one is active are unchanged. */
export function v2ActorFromPilot(actor: SessionActor): V2SessionActor {
  const memberships = actor.memberships.map((entry): V2SessionMembership => ({
    kindLabel: PILOT_KIND_LABELS[entry.organization.type],
    organization: { displayName: entry.organization.displayName, id: entry.organization.id },
    roleLabel: MEMBER_ROLE_LABELS[entry.membership.role]
  }))
  const active = actor.activeOrganization
  const activeMembership = active && actor.activeMembership
    ? memberships.find((entry) => entry.organization.id === active.id) ?? null
    : null

  return {
    activeMembership,
    activeOrganization: active ? { displayName: active.displayName, id: active.id } : null,
    isPlatformAdmin: actor.isPlatformAdmin,
    memberships,
    profile: { email: actor.profile.email ?? null, fullName: actor.profile.fullName, id: actor.profile.id },
    store: "pilot",
    workspaceSelectionInvalid: actor.workspaceSelectionInvalid
  }
}

/** A normalized business's kind, from what the schema says the person can do there and its hauler profile. */
function normalizedKindLabel(membership: NormalizedViewerMembership): string {
  const hauling = membership.haulerProfile || hasHaulerSide(membership.capabilities)
  // `get_viewer_marketplace_access`: a business without a hauler profile is a landing business.
  const landing = hasLandingSide(membership.capabilities) || !membership.haulerProfile

  return hauling && landing ? "Landing and hauling business" : hauling ? "Hauling business" : "Landing business"
}

export function v2MembershipFromNormalized(membership: NormalizedViewerMembership): V2SessionMembership {
  return {
    kindLabel: normalizedKindLabel(membership),
    organization: { displayName: membership.organizationName, id: membership.organizationId },
    roleLabel: NORMALIZED_ROLE_LABELS[membership.role]
  }
}

interface NormalizedSession {
  actor: V2SessionActor
  principal: NormalizedSessionPrincipal
  /** The signed cookie's user id to keep when the selection is re-signed (`SessionIdentity.cookieUserId`). */
  cookieUserId: string | null
}

const normalizedSession = cache(async (): Promise<NormalizedSession | null> => {
  // Every exported reader of this session (principal, cookie user id, re-signed selection) stays off the normalized
  // store and its identity-sync connection unless that store is selected; `VERCEL_ENV=production` never selects it.
  if (marketplaceV2AdapterKind() !== "normalized") {
    return null
  }

  const identity = await getSessionIdentity()

  if (!identity) {
    return null
  }

  const resolved = await normalizedSessionStore().resolve({ hints: identity.hints, subject: identity.clerkUserId })

  if (!resolved) {
    return null
  }

  const memberships = resolved.memberships.map(v2MembershipFromNormalized)
  const { active, invalid } = selectV2Membership(memberships, identity.requestedOrganizationId)
  const { person } = resolved

  return {
    actor: {
      activeMembership: active,
      activeOrganization: active?.organization ?? null,
      isPlatformAdmin: false,
      memberships,
      profile: { email: person.email, fullName: person.displayName, id: person.id },
      store: "normalized",
      workspaceSelectionInvalid: invalid
    },
    cookieUserId: identity.cookieUserId,
    principal: { subject: identity.clerkUserId, userId: person.id }
  }
})

/**
 * The V2 session for this request, from the selected store; `null` for a visitor or a sign-in that has no person in
 * that store. Cached per request. A broken normalized configuration throws rather than falling back to the pilot.
 */
export const getV2SessionActor = cache(async (): Promise<V2SessionActor | null> => {
  if (marketplaceV2AdapterKind() === "normalized") {
    return (await normalizedSession())?.actor ?? null
  }

  const actor = await getSessionActor()

  return actor ? v2ActorFromPilot(actor) : null
})

/**
 * Whether someone is signed in although `getV2SessionActor()` found no person for them: a Clerk sign-in without a
 * pilot profile, or (normalized) any sign-in the normalized store has no active person for. Such a sign-in gets an
 * explanation, never a sign-in loop.
 */
export async function v2SignedInWithoutPerson(): Promise<boolean> {
  if (await getV2SessionActor()) {
    return false
  }

  return marketplaceV2AdapterKind() === "normalized" ? hasSessionIdentity() : Boolean(await getClerkUserId())
}

/** The normalized session's person and Clerk user id, for the adapter's principal resolver (`adapter.ts`). */
export async function normalizedSessionPrincipal(): Promise<NormalizedSessionPrincipal | null> {
  return (await normalizedSession())?.principal ?? null
}

/**
 * The cookie user id a re-signed selection must carry on the normalized store: the dev profile's id for a dev
 * sign-in (so the next request still finds it), otherwise the person's own id. `null` without a normalized session.
 */
export async function normalizedSessionCookieUserId(): Promise<string | null> {
  const session = await normalizedSession()

  return session ? session.cookieUserId ?? session.actor.profile.id : null
}

/**
 * Server actions only, normalized store: make `organizationId` the session's selected business by re-signing the
 * session cookie. The cookie keeps its user id (`normalizedSessionCookieUserId`), so only the selection changes.
 * The caller has established that the person is a member (the switch re-reads the memberships; a business just
 * created by the person is theirs); every later request re-checks the selection against the memberships anyway.
 */
export async function selectNormalizedSessionBusiness(organizationId: string): Promise<boolean> {
  const cookieUserId = await normalizedSessionCookieUserId()

  if (!cookieUserId || !organizationId) {
    return false
  }

  const cookieStore = await cookies()

  cookieStore.set(SESSION_COOKIE, createSessionCookieValue(cookieUserId, organizationId), SESSION_COOKIE_OPTIONS)
  revalidatePath("/", "layout")
  return true
}
