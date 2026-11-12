import "server-only"

import { createHmac, timingSafeEqual } from "node:crypto"

import { auth, currentUser } from "@clerk/nextjs/server"
import type { User } from "@logloads/contracts"
import { cookies, headers } from "next/headers"
import { redirect } from "next/navigation"
import { cache } from "react"

import { decideDevSession } from "./demo-mode"
import { isPlatformAdminAllowed } from "./platform-admin"
import { refreshState, services } from "./services"
import {
  canAccessCockpit,
  homePathFor,
  selectedSessionMembership,
  type Cockpit,
  type SessionActor
} from "./session-policy"

export {
  canAccessCockpit,
  homePathFor,
  restrictedAccessRecoveryPath
} from "./session-policy"
export type { Cockpit, SessionActor } from "./session-policy"

export const SESSION_COOKIE = "ll_session"
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 14

/** How the signed session cookie is written (server actions only). */
export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  maxAge: SESSION_TTL_SECONDS,
  path: "/",
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production"
}

export function isClerkConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY)
}

async function devSessionDecision() {
  const requestHeaders = await headers()

  return decideDevSession(process.env, requestHeaders.get("host"))
}

export async function isDevSessionEnabled(): Promise<boolean> {
  return (await devSessionDecision()).enabled
}

export async function isFounderDemoMode(): Promise<boolean> {
  const decision = await devSessionDecision()

  return decision.enabled && decision.demoMode
}

function sessionSecret(): string {
  const secret = process.env.LOGLOADS_SESSION_SECRET

  if (secret) {
    return secret
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("LOGLOADS_SESSION_SECRET must be set in production")
  }

  return "logloads-development-session-secret"
}

function signPayload(payload: string): string {
  return createHmac("sha256", sessionSecret()).update(payload).digest("hex")
}

export function createSessionCookieValue(userId: string, organizationId: string | null): string {
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS
  const payload = `${userId}.${organizationId ?? "-"}.${expiresAt}`

  return `v1.${payload}.${signPayload(payload)}`
}

export function verifySessionCookieValue(value: string | undefined): { userId: string; organizationId: string | null } | null {
  if (!value) {
    return null
  }

  const parts = value.split(".")
  const [version, userId, organizationId, expiresAt, signature] = parts

  if (parts.length !== 5 || version !== "v1" || !userId || !organizationId || !expiresAt || !signature) {
    return null
  }

  const payload = `${userId}.${organizationId}.${expiresAt}`
  const expectedBuffer = new Uint8Array(Buffer.from(signPayload(payload), "hex"))
  const actualBuffer = new Uint8Array(Buffer.from(signature, "hex"))

  if (expectedBuffer.length !== actualBuffer.length || !timingSafeEqual(expectedBuffer, actualBuffer)) {
    return null
  }

  if (Number(expiresAt) * 1000 < Date.now()) {
    return null
  }

  return { organizationId: organizationId === "-" ? null : organizationId, userId }
}

export async function getClerkUserId(): Promise<string | null> {
  if (!isClerkConfigured()) {
    return null
  }

  try {
    const session = await auth()

    return session.userId ?? null
  } catch {
    return null
  }
}

/**
 * Lightweight identity check for public navigation. This deliberately avoids
 * loading the canonical operating state: `/workspace` remains the single place
 * that resolves whether the identity should open onboarding or a cockpit.
 */
export async function hasSessionIdentity(): Promise<boolean> {
  if (await getClerkUserId()) {
    return true
  }

  if (!(await isDevSessionEnabled())) {
    return false
  }

  const cookieStore = await cookies()

  return Boolean(verifySessionCookieValue(cookieStore.get(SESSION_COOKIE)?.value))
}

/** The slice of a Clerk user that decides which email address it may act as. */
export interface ClerkEmailOwner {
  primaryEmailAddressId: string | null
  primaryEmailAddress: {
    emailAddress: string
    id: string
    verification: { status: string } | null
  } | null
}

/**
 * The user's primary email address, and only while Clerk reports it verified.
 *
 * Onboarding stores this address on the profile, and invitations are claimed
 * by matching it, so an address the person has not proven they control must
 * never stand in for one they have. No other address is a fallback, verified or
 * not. The founder bootstrap applies the same rule.
 */
export function verifiedPrimaryEmailAddress(user: ClerkEmailOwner | null | undefined): string | null {
  const primary = user?.primaryEmailAddress

  if (
    !user ||
    !primary ||
    primary.id !== user.primaryEmailAddressId ||
    primary.verification?.status !== "verified"
  ) {
    return null
  }

  return primary.emailAddress || null
}

export const getClerkIdentity = cache(async (): Promise<{ email: string; fullName: string } | null> => {
  if (!isClerkConfigured()) {
    return null
  }

  try {
    const user = await currentUser()
    const email = verifiedPrimaryEmailAddress(user)
    const fullName = user?.fullName ?? [user?.firstName, user?.lastName].filter(Boolean).join(" ")

    return user && email ? { email, fullName } : null
  } catch {
    return null
  }
})

/**
 * The signed-in Clerk user's name and primary email address (only while Clerk reports it verified), for a first
 * link of the person in another store. Unlike `getClerkIdentity`, an unverified address does not hide the name.
 */
export const getClerkPersonHints = cache(async (): Promise<{ fullName: string; verifiedEmail: string | null } | null> => {
  if (!isClerkConfigured()) {
    return null
  }

  try {
    const user = await currentUser()

    if (!user) {
      return null
    }

    return {
      fullName: (user.fullName ?? [user.firstName, user.lastName].filter(Boolean).join(" ")).trim(),
      verifiedEmail: verifiedPrimaryEmailAddress(user)
    }
  } catch {
    return null
  }
})

/**
 * Who the server session says is signed in, without the pilot account context. Used by Marketplace V2 when its
 * store is not the pilot one (`marketplace-v2/v2-session.ts`, #213).
 *
 * - `clerk`: the Clerk user id from Clerk's verified session.
 * - `dev`: the loopback development bench only. The signed dev cookie names a pilot profile, and its linked
 *   `clerkUserId` stands in for a Clerk user id: the same dev identity mapping the normalized adapter uses.
 *
 * Nothing here comes from request input other than the server-signed cookie. `requestedOrganizationId` is that
 * cookie's workspace selection: a hint that every reader re-checks against the person's current memberships, and
 * honours only for the person it was signed for (`selectionUserId`, #246).
 */
export interface SessionIdentity {
  source: "clerk" | "dev"
  clerkUserId: string
  /**
   * The user id a re-signed workspace selection must keep: the dev profile's id for a dev sign-in, which is how the
   * next request finds that sign-in again. `null` for a Clerk sign-in, whose identity is Clerk's own session.
   */
  cookieUserId: string | null
  requestedOrganizationId: string | null
  /**
   * The user id the selection was signed for (#246). A Clerk sign-in can find a cookie that an earlier sign-in left on
   * the same browser, so a reader honours `requestedOrganizationId` only when this is the id it signs its own
   * selections with: the pilot profile id, or the normalized store's `normalizedSessionCookieUserId()`. For a dev
   * sign-in it is the dev profile's id, which is also who is signed in. `null` without a selection cookie.
   */
  selectionUserId: string | null
  /**
   * The person's name and provider-verified email, for a first link and for recording an email verified later (#246).
   * Dev profiles never carry a verified email.
   */
  hints: () => Promise<{ fullName: string; verifiedEmail: string | null }>
}

export const getSessionIdentity = cache(async (): Promise<SessionIdentity | null> => {
  const cookieStore = await cookies()
  const devSession = verifySessionCookieValue(cookieStore.get(SESSION_COOKIE)?.value)
  const clerkUserId = await getClerkUserId()

  if (clerkUserId) {
    return {
      clerkUserId,
      cookieUserId: null,
      hints: async () => (await getClerkPersonHints()) ?? { fullName: "", verifiedEmail: null },
      requestedOrganizationId: devSession?.organizationId ?? null,
      selectionUserId: devSession?.userId ?? null,
      source: "clerk"
    }
  }

  if (!devSession || !(await isDevSessionEnabled())) {
    return null
  }

  await refreshState()

  const profile = services.state.profiles.find((candidate) => candidate.id === devSession.userId)
  const linkedClerkUserId = profile?.isActive ? profile.clerkUserId?.trim() ?? "" : ""

  if (!profile || !linkedClerkUserId) {
    return null
  }

  return {
    clerkUserId: linkedClerkUserId,
    cookieUserId: profile.id,
    hints: async () => ({ fullName: profile.fullName, verifiedEmail: null }),
    requestedOrganizationId: devSession.organizationId,
    selectionUserId: devSession.userId,
    source: "dev"
  }
})

async function resolveClerkProfile(): Promise<User | null> {
  const clerkUserId = await getClerkUserId()

  if (!clerkUserId) {
    return null
  }

  return services.findProfileByClerkId(clerkUserId) ?? null
}

function buildSessionActor(
  profile: User,
  requestedOrganizationId: string | null,
  identitySource: "clerk" | "dev"
): SessionActor {
  const account = services.getAccountContext(profile.id)
  const memberships = (account?.memberships ?? []).map((entry) => ({
    ...entry,
    driverProfileId:
      services.activeDriverProfileForOrganization(
        profile.id,
        entry.organization.id
      )?.id ?? null
  }))
  const active = selectedSessionMembership(memberships, requestedOrganizationId)

  return {
    activeMembership: active?.membership ?? null,
    activeOrganization: active?.organization ?? null,
    driverProfileId: active?.driverProfileId ?? null,
    isPlatformAdmin: isPlatformAdminAllowed(
      profile,
      services.state,
      identitySource === "clerk"
    ),
    memberships,
    profile,
    workspaceSelectionInvalid: Boolean(requestedOrganizationId && !active)
  }
}

export const getSessionActor = cache(async (): Promise<SessionActor | null> => {
  await refreshState()

  const cookieStore = await cookies()
  const devSession = verifySessionCookieValue(cookieStore.get(SESSION_COOKIE)?.value)

  const clerkProfile = await resolveClerkProfile()

  if (clerkProfile) {
    // #246: the selection is honoured only for the profile it was signed for. One an earlier sign-in left on this
    // browser is not this person's, so they start on their own first business instead of an invalid selection.
    return buildSessionActor(
      clerkProfile,
      devSession?.userId === clerkProfile.id ? devSession.organizationId : null,
      "clerk"
    )
  }

  if (!(await isDevSessionEnabled()) || !devSession) {
    return null
  }

  const profile = services.state.profiles.find(
    (candidate) => candidate.id === devSession.userId
  )

  if (!profile) {
    return null
  }

  return buildSessionActor(profile, devSession.organizationId, "dev")
})

/**
 * Guard for cockpit pages: unauthenticated visitors go to sign-in, authenticated
 * users without access to this cockpit go to the cockpit they belong in.
 */
export async function requireCockpitActor(cockpit: Cockpit): Promise<SessionActor> {
  const actor = await getSessionActor()

  if (!actor) {
    // A signed-in Clerk user who has not finished provisioning a LogLoads
    // profile belongs in onboarding, not a sign-in loop.
    const clerkUserId = await getClerkUserId()

    redirect(clerkUserId ? "/onboarding" : `/sign-in?next=/${cockpit}`)
  }

  if (!canAccessCockpit(actor, cockpit)) {
    redirect(homePathFor(actor))
  }

  return actor
}

/** Guard for authenticated pages shared across every provisioned cockpit. */
export async function requireAuthenticatedActor(nextPath = "/support"): Promise<SessionActor> {
  const actor = await getSessionActor()

  if (!actor) {
    const clerkUserId = await getClerkUserId()

    redirect(clerkUserId ? "/onboarding" : `/sign-in?next=${encodeURIComponent(nextPath)}`)
  }

  return actor
}

/**
 * Actor resolution for API routes: returns null instead of redirecting so the
 * route can respond 401/403.
 */
export async function getApiActor(): Promise<SessionActor | null> {
  return getSessionActor()
}
