"use server"

import { auth } from "@clerk/nextjs/server"
import { revalidatePath } from "next/cache"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"

import { captureServerEvent } from "./analytics"
import { DEMO_PERSONAS, isDemoSignInEmail } from "./demo-personas"
import {
  createFirstRunHandoffCookie,
  firstRunContinuationCookieName,
  firstRunDestination,
  parseEntryIntent,
  type EntryIntent
} from "./entry-routing"
import { checkRateLimit, requestClientKey } from "./rate-limit"
import { mutateState, refreshState, serializeError, services } from "./services"
import {
  SESSION_COOKIE,
  createSessionCookieValue,
  getClerkIdentity,
  getSessionActor,
  homePathFor,
  isClerkConfigured,
  isDevSessionEnabled,
  isFounderDemoMode
} from "./session"
import {
  cockpitForMembership,
  homePathForMembership
} from "./session-policy"
import { safeInternalPath } from "./safe-redirect"

const COOKIE_OPTIONS = {
  httpOnly: true,
  maxAge: 60 * 60 * 24 * 14,
  path: "/",
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production"
}

function firstRunContinuationCookieOptions(intent: EntryIntent) {
  return {
    ...COOKIE_OPTIONS,
    maxAge: 10 * 60,
    path: `/${intent}`
  }
}

export interface AuthFormState {
  error: string | null
}

export async function signInWithEmail(_previous: AuthFormState, formData: FormData): Promise<AuthFormState> {
  if (!(await isDevSessionEnabled())) {
    return { error: "Email sign-in is not enabled in this environment." }
  }

  const email = String(formData.get("email") ?? "").trim()

  if (!email) {
    return { error: "Enter the email address on your account." }
  }

  return signInDevProfile(email, String(formData.get("next") ?? ""))
}

async function signInDevProfile(email: string, next: string): Promise<AuthFormState> {
  if (await isFounderDemoMode() && !isDemoSignInEmail(email)) {
    return { error: "Use one of the available founder demo accounts." }
  }

  try {
    // Per-identity limit catches guessing without punishing shared IPs (crew
    // NAT, office wifi); the wider per-IP cap still stops bulk enumeration.
    const clientKey = await requestClientKey()

    // Consume the broad IP bucket first so an email-specific rejection cannot
    // bypass the aggregate enumeration limit. The two checks are intentionally
    // sequential: Promise.all would keep the shared-store calls running after an
    // early rejection and make outage/rate-limit behavior harder to reason about.
    await checkRateLimit("sign-in-ip", clientKey, 60, 60_000)
    await checkRateLimit("sign-in", `${clientKey}:${email.toLowerCase()}`, 10, 60_000)
  } catch (error) {
    return { error: serializeError(error).error }
  }

  await refreshState()
  const profile = services.findProfileByEmail(email)

  if (!profile) {
    return { error: "No account found for that email. Create an account to get started." }
  }

  const cookieStore = await cookies()

  cookieStore.set(SESSION_COOKIE, createSessionCookieValue(profile.id, null), COOKIE_OPTIONS)

  const actor = await getSessionActor()
  const destination = safeInternalPath(next, actor ? homePathFor(actor) : "/workspace")

  redirect(destination)
}

export async function signInDemoPersona(formData: FormData): Promise<void> {
  if (!(await isFounderDemoMode())) {
    redirect("/sign-in")
  }

  const email = String(formData.get("persona") ?? "").trim().toLowerCase()
  const persona = DEMO_PERSONAS.find((candidate) => candidate.email === email)

  if (!persona) {
    redirect("/sign-in")
  }

  const result = await signInDevProfile(persona.email, "")

  if (result.error) {
    redirect("/sign-in?demoError=1")
  }
}

export async function clearLocalSessionAction(): Promise<void> {
  const cookieStore = await cookies()

  cookieStore.delete(SESSION_COOKIE)
  for (const intent of ["driver", "fleet", "host"] as const) {
    cookieStore.set(firstRunContinuationCookieName(intent), "", {
      ...firstRunContinuationCookieOptions(intent),
      maxAge: 0
    })
  }
}

export async function switchOrganizationAction(organizationId: string): Promise<boolean> {
  const actor = await getSessionActor()

  if (!actor) {
    redirect("/sign-in")
  }

  const membership = actor.memberships.find((entry) => entry.organization.id === organizationId)

  if (!membership) {
    return false
  }

  const cookieStore = await cookies()

  cookieStore.set(SESSION_COOKIE, createSessionCookieValue(actor.profile.id, organizationId), COOKIE_OPTIONS)

  revalidatePath("/", "layout")
  return true
}

/**
 * An already-onboarded person accepting a workspace invitation: one new
 * active membership, then the session moves to the joined workspace so the
 * switcher shows both. The service owns every rule (invited email match,
 * expiry, duplicates); a refused accept simply leaves the invitation visible.
 */
export async function acceptInvitationAction(
  invitationId: string
): Promise<{ error?: string; ok: boolean }> {
  const actor = await getSessionActor()

  if (!actor) {
    redirect("/sign-in")
  }

  try {
    await checkRateLimit("invitation-respond", actor.profile.id, 10, 60_000)

    const { membership } = await mutateState((draft) =>
      draft.acceptInvitationForExistingUser({ actorUserId: actor.profile.id, invitationId })
    )

    captureServerEvent("invitation_accepted", actor.profile.id, { invitationId })

    const cookieStore = await cookies()

    cookieStore.set(
      SESSION_COOKIE,
      createSessionCookieValue(actor.profile.id, membership.organizationId),
      COOKIE_OPTIONS
    )
  } catch (error) {
    const serialized = serializeError(error)

    console.error("invitation accept refused", serialized)
    return { error: serialized.error, ok: false }
  }

  revalidatePath("/", "layout")
  return { ok: true }
}

export async function declineInvitationAction(
  invitationId: string
): Promise<{ error?: string; ok: boolean }> {
  const actor = await getSessionActor()

  if (!actor) {
    redirect("/sign-in")
  }

  try {
    await checkRateLimit("invitation-respond", actor.profile.id, 10, 60_000)
    await mutateState((draft) =>
      draft.declineOrganizationInvitation({ actorUserId: actor.profile.id, invitationId })
    )
    captureServerEvent("invitation_declined", actor.profile.id, { invitationId })
  } catch (error) {
    const serialized = serializeError(error)

    console.error("invitation decline refused", serialized)
    return { error: serialized.error, ok: false }
  }

  revalidatePath("/", "layout")
  return { ok: true }
}

export interface OnboardingFormState {
  error: string | null
}

export async function completeOnboardingAction(
  _previous: OnboardingFormState,
  formData: FormData
): Promise<OnboardingFormState> {
  const path = String(formData.get("path") ?? "")
  const accountType = String(formData.get("accountType") ?? "")
  const fullName = String(formData.get("fullName") ?? "").trim()
  let email = String(formData.get("email") ?? "").trim()
  const phone = String(formData.get("phone") ?? "").trim()
  const organizationName = String(formData.get("organizationName") ?? "").trim()
  const region = String(formData.get("region") ?? "").trim()
  const truckType = String(formData.get("truckType") ?? "")
  const trailerType = String(formData.get("trailerType") ?? "")
  const maxPayloadTons = Number(formData.get("maxPayloadTons") ?? 0)
  const availabilityPreset = String(formData.get("availabilityPreset") ?? "three_days")
  const next = String(formData.get("next") ?? "")

  const existingActor = await getSessionActor()

  if (existingActor) {
    redirect(homePathFor(existingActor))
  }

  try {
    await checkRateLimit("onboarding", await requestClientKey(), 5, 60 * 60_000)
  } catch (error) {
    return { error: serializeError(error).error }
  }

  let clerkUserId: string | null = null

  if (isClerkConfigured()) {
    try {
      const clerkSession = await auth()

      clerkUserId = clerkSession.userId ?? null
    } catch {
      clerkUserId = null
    }

    if (!clerkUserId) {
      return { error: "Sign in first, then finish setting up your account." }
    }

    const clerkIdentity = await getClerkIdentity()

    if (!clerkIdentity) {
      return { error: "We could not verify the email on your signed-in account. Sign in again and retry setup." }
    }

    email = clerkIdentity.email
  } else if (!(await isDevSessionEnabled())) {
    return { error: "Account creation requires a configured sign-in provider in this environment." }
  }

  // Joining THROUGH an invitation: profile + membership in the inviting
  // workspace, and deliberately no new organization. The service re-verifies
  // that the invitation belongs to the resolved email — a posted id alone
  // proves nothing.
  const invitationId = String(formData.get("invitationId") ?? "")

  if (invitationId) {
    let joined: { organizationId: string; userId: string }
    let joinedHome = "/workspace"
    let joinedIntent: EntryIntent | null = null

    try {
      const accepted = await mutateState((draft) =>
        draft.acceptInvitationAsNewAccount({
          clerkUserId,
          email,
          fullName,
          invitationId,
          phone
        })
      )
      joined = accepted

      const cookieStore = await cookies()

      cookieStore.set(SESSION_COOKIE, createSessionCookieValue(joined.userId, joined.organizationId), COOKIE_OPTIONS)

      const organization = services.state.organizations.find(
        (candidate) => candidate.id === joined.organizationId
      )

      if (organization) {
        joinedHome = homePathForMembership(organization.type, accepted.invitation.invitedRole)
        joinedIntent = cockpitForMembership(organization.type, accepted.invitation.invitedRole)

        if (joinedIntent) {
          cookieStore.set(
            firstRunContinuationCookieName(joinedIntent),
            createFirstRunHandoffCookie(joinedIntent, next, "invited", joined.userId),
            firstRunContinuationCookieOptions(joinedIntent)
          )

        }
      }

      const analyticsPath = joinedIntent ?? "workspace"
      const analyticsEvents = [
        captureServerEvent("invitation_accepted", joined.userId, {
          invitationId,
          newAccount: true
        }),
        captureServerEvent("account_created", joined.userId, {
          accountType: "invited_member",
          path: analyticsPath
        }),
        captureServerEvent("onboarding_completed", joined.userId, {
          accountType: "invited_member",
          invitedRole: accepted.invitation.invitedRole,
          organizationId: joined.organizationId,
          path: analyticsPath
        })
      ]

      await Promise.all(analyticsEvents)
    } catch (error) {
      return { error: serializeError(error).error }
    }

    redirect(joinedIntent ? firstRunDestination(joinedIntent) : safeInternalPath(next, joinedHome))
  }

  const intent = parseEntryIntent(path)

  if (!intent) {
    return { error: "Choose whether you haul timber, manage trucks, or have timber to move." }
  }

  try {
    const account = await mutateState((draft) =>
      draft.createAccount({
        accountType,
        availabilityPreset,
        clerkUserId,
        email,
        equipment: truckType
          ? {
              maxPayloadTons: Number.isFinite(maxPayloadTons) && maxPayloadTons > 0 ? maxPayloadTons : 30,
              trailerType: trailerType || null,
              truckType
            }
          : null,
        fullName,
        organizationName: organizationName || null,
        path: intent,
        phone,
        region
      })
    )

    const organizationId = account.memberships[0]?.organization.id ?? null
    const cookieStore = await cookies()

    cookieStore.set(
      SESSION_COOKIE,
      createSessionCookieValue(account.profile.id, organizationId),
      COOKIE_OPTIONS
    )

    cookieStore.set(
      firstRunContinuationCookieName(intent),
      createFirstRunHandoffCookie(intent, next, "created", account.profile.id),
      firstRunContinuationCookieOptions(intent)
    )

    await Promise.all([
      captureServerEvent("account_created", account.profile.id, {
        path: intent,
        accountType
      }),
      captureServerEvent("onboarding_completed", account.profile.id, {
        accountType,
        organizationId,
        path: intent
      })
    ])
  } catch (error) {
    return { error: serializeError(error).error }
  }

  redirect(firstRunDestination(intent))
}
