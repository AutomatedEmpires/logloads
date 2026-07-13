"use server"

import { auth } from "@clerk/nextjs/server"
import { revalidatePath } from "next/cache"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"

import { captureServerEvent } from "./analytics"
import { checkRateLimit, requestClientKey } from "./rate-limit"
import { mutateState, refreshState, serializeError, services } from "./services"
import {
  SESSION_COOKIE,
  createSessionCookieValue,
  getSessionActor,
  homePathFor,
  isClerkConfigured,
  isDevSessionEnabled
} from "./session"

const COOKIE_OPTIONS = {
  httpOnly: true,
  maxAge: 60 * 60 * 24 * 14,
  path: "/",
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production"
}

export interface AuthFormState {
  error: string | null
}

export async function signInWithEmail(_previous: AuthFormState, formData: FormData): Promise<AuthFormState> {
  if (!isDevSessionEnabled()) {
    return { error: "Email sign-in is not enabled in this environment." }
  }

  const email = String(formData.get("email") ?? "").trim()

  if (!email) {
    return { error: "Enter the email address on your account." }
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
  const next = String(formData.get("next") ?? "")
  const destination = next.startsWith("/") && !next.startsWith("//") ? next : actor ? homePathFor(actor) : "/"

  redirect(destination)
}

export async function signOutAction(): Promise<void> {
  const cookieStore = await cookies()

  cookieStore.delete(SESSION_COOKIE)
  redirect("/")
}

export async function switchOrganizationAction(organizationId: string): Promise<void> {
  const actor = await getSessionActor()

  if (!actor) {
    redirect("/sign-in")
  }

  const membership = actor.memberships.find((entry) => entry.organization.id === organizationId)

  if (!membership) {
    return
  }

  const cookieStore = await cookies()

  cookieStore.set(SESSION_COOKIE, createSessionCookieValue(actor.profile.id, organizationId), COOKIE_OPTIONS)

  revalidatePath("/", "layout")
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
  const email = String(formData.get("email") ?? "").trim()
  const phone = String(formData.get("phone") ?? "").trim()
  const organizationName = String(formData.get("organizationName") ?? "").trim()
  const region = String(formData.get("region") ?? "").trim()
  const truckType = String(formData.get("truckType") ?? "")
  const trailerType = String(formData.get("trailerType") ?? "")
  const maxPayloadTons = Number(formData.get("maxPayloadTons") ?? 0)

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
  } else if (!isDevSessionEnabled()) {
    return { error: "Account creation requires a configured sign-in provider in this environment." }
  }

  try {
    const account = await mutateState((draft) =>
      draft.createAccount({
        accountType,
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
        path,
        phone,
        region
      })
    )

    captureServerEvent("account_created", account.profile.id, { path, accountType })

    const cookieStore = await cookies()

    cookieStore.set(
      SESSION_COOKIE,
      createSessionCookieValue(account.profile.id, account.memberships[0]?.organization.id ?? null),
      COOKIE_OPTIONS
    )
  } catch (error) {
    return { error: serializeError(error).error }
  }

  const actor = await getSessionActor()

  redirect(actor ? homePathFor(actor) : "/")
}
