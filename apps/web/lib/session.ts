import "server-only"

import { createHmac, timingSafeEqual } from "node:crypto"

import { auth, currentUser } from "@clerk/nextjs/server"
import type { User } from "@logloads/contracts"
import { cookies, headers } from "next/headers"
import { redirect } from "next/navigation"
import { cache } from "react"

import { decideDevSession } from "./demo-mode"
import { refreshState, services } from "./services"
import {
  canAccessCockpit,
  homePathFor,
  type Cockpit,
  type SessionActor
} from "./session-policy"

export { canAccessCockpit, homePathFor } from "./session-policy"
export type { Cockpit, SessionActor } from "./session-policy"

export const SESSION_COOKIE = "ll_session"
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 14

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

export const getClerkIdentity = cache(async (): Promise<{ email: string; fullName: string } | null> => {
  if (!isClerkConfigured()) {
    return null
  }

  try {
    const user = await currentUser()
    const email = user?.primaryEmailAddress?.emailAddress ?? user?.emailAddresses[0]?.emailAddress ?? ""
    const fullName = user?.fullName ?? [user?.firstName, user?.lastName].filter(Boolean).join(" ")

    return user && email ? { email, fullName } : null
  } catch {
    return null
  }
})

async function resolveClerkProfile(): Promise<User | null> {
  const clerkUserId = await getClerkUserId()

  if (!clerkUserId) {
    return null
  }

  return services.findProfileByClerkId(clerkUserId) ?? null
}

function buildSessionActor(profile: User, requestedOrganizationId: string | null): SessionActor {
  const account = services.getAccountContext(profile.id)
  const memberships = account?.memberships ?? []
  const active = (requestedOrganizationId
    ? memberships.find((entry) => entry.organization.id === requestedOrganizationId)
    : undefined) ?? memberships[0] ?? null

  return {
    activeMembership: active?.membership ?? null,
    activeOrganization: active?.organization ?? null,
    driverProfileId: account?.driverProfileId ?? null,
    isPlatformAdmin: profile.role === "admin",
    memberships,
    profile
  }
}

export const getSessionActor = cache(async (): Promise<SessionActor | null> => {
  await refreshState()

  const cookieStore = await cookies()
  const devSession = verifySessionCookieValue(cookieStore.get(SESSION_COOKIE)?.value)

  const clerkProfile = await resolveClerkProfile()

  if (clerkProfile) {
    return buildSessionActor(clerkProfile, devSession?.organizationId ?? null)
  }

  if (!(await isDevSessionEnabled()) || !devSession) {
    return null
  }

  const profile = services.state.profiles.find((candidate) => candidate.id === devSession.userId && candidate.isActive)

  if (!profile) {
    return null
  }

  return buildSessionActor(profile, devSession.organizationId)
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
