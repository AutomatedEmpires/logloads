import "server-only"

import { createHmac, timingSafeEqual } from "node:crypto"

import { auth } from "@clerk/nextjs/server"
import type { Organization, OrganizationMembership, User } from "@logloads/contracts"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { cache } from "react"

import { refreshState, services } from "./services"

export const SESSION_COOKIE = "ll_session"
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 14

export type Cockpit = "driver" | "fleet" | "host" | "admin"

export interface SessionActor {
  profile: User
  memberships: Array<{ membership: OrganizationMembership; organization: Organization }>
  activeOrganization: Organization | null
  activeMembership: OrganizationMembership | null
  driverProfileId: string | null
  isPlatformAdmin: boolean
}

export function isClerkConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY)
}

export function isDevSessionEnabled(): boolean {
  if (isClerkConfigured()) {
    return false
  }

  return process.env.NODE_ENV !== "production" || process.env.LOGLOADS_ENABLE_DEV_LOGIN === "true"
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

  if (!isDevSessionEnabled() || !devSession) {
    return null
  }

  const profile = services.state.profiles.find((candidate) => candidate.id === devSession.userId && candidate.isActive)

  if (!profile) {
    return null
  }

  return buildSessionActor(profile, devSession.organizationId)
})

export function homePathFor(actor: SessionActor): string {
  if (actor.isPlatformAdmin) {
    return "/admin"
  }

  if (actor.driverProfileId) {
    return "/driver/today"
  }

  const orgType = actor.activeOrganization?.type

  if (orgType === "landing_source" || orgType === "destination") {
    return "/host/command"
  }

  if (orgType === "fleet" || orgType === "carrier") {
    return "/fleet/command"
  }

  return "/onboarding"
}

const FLEET_ROLES = new Set(["owner", "admin", "dispatcher", "fleet_manager"])
const HOST_ROLES = new Set(["owner", "admin", "dispatcher", "landing_manager", "destination_manager", "billing"])

export function canAccessCockpit(actor: SessionActor, cockpit: Cockpit): boolean {
  if (cockpit === "admin") {
    return actor.isPlatformAdmin
  }

  if (actor.isPlatformAdmin) {
    return true
  }

  if (cockpit === "driver") {
    return Boolean(actor.driverProfileId) || actor.activeMembership?.role === "driver"
  }

  const orgType = actor.activeOrganization?.type
  const role = actor.activeMembership?.role

  if (!orgType || !role) {
    return false
  }

  if (cockpit === "fleet") {
    return (orgType === "fleet" || orgType === "carrier") && FLEET_ROLES.has(role)
  }

  return (orgType === "landing_source" || orgType === "destination") && HOST_ROLES.has(role)
}

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

/**
 * Actor resolution for API routes: returns null instead of redirecting so the
 * route can respond 401/403.
 */
export async function getApiActor(): Promise<SessionActor | null> {
  return getSessionActor()
}
