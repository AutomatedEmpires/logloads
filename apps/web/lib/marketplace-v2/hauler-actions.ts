"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"

import { EMPTY_HAULER_PROFILE_FORM, haulerProfileFormValues, validateHaulerProfileForm } from "@logloads/contracts"
import { DomainRefusalError } from "@logloads/services"

import { checkRateLimit } from "../rate-limit"
import { getClerkUserId, getSessionActor } from "../session"
import { marketplaceV2Enabled } from "./flag"
import {
  PROFILE_PATH,
  PROFILE_SAVE_FAILED,
  PROFILE_SAVE_UNAVAILABLE,
  PROFILE_SAVED,
  PROFILE_SETUP_NEXT_PATH,
  profileValuesFromForm,
  START_BUSINESS_UNAVAILABLE,
  HAULER_START_PATH,
  type HaulerProfileFormState,
  type StartBusinessFormState
} from "./hauler-profile-form"
import { pilotMarketplaceV2 } from "./pilot-adapter"
import { MarketplaceOperationUnavailableError, MarketplaceRefusalError } from "./port"

/**
 * The hauling business profile form's action (#125). Identity and the acting business come from the server session
 * only; the form supplies the business's own words. Every outcome returns the posted values, so a failed or
 * unavailable save never loses what the person typed, and nothing is reported as saved unless the store saved it.
 */
export async function saveHaulerProfileAction(previous: HaulerProfileFormState, formData: FormData): Promise<HaulerProfileFormState> {
  if (!marketplaceV2Enabled()) {
    redirect("/")
  }

  const actor = await getSessionActor()

  if (!actor) {
    redirect(`/sign-in?next=${encodeURIComponent(PROFILE_PATH)}`)
  }

  const values = profileValuesFromForm(formData)
  const attempt = (previous?.attempt ?? 0) + 1
  const setup = formData.get("setup") === "1"
  const answer = (status: HaulerProfileFormState["status"], message: string | null): HaulerProfileFormState => ({
    attempt,
    issues: [],
    message,
    status,
    values
  })

  if (!actor.activeOrganization || actor.workspaceSelectionInvalid) {
    return answer("refused", "No business is selected for your account. Choose one from the business name at the top of the page.")
  }

  const validation = validateHaulerProfileForm(values)

  if (!validation.ok) {
    return { ...answer("invalid", null), issues: validation.issues }
  }

  const viewer = { organizationId: actor.activeOrganization.id, userId: actor.profile.id }
  let saved: HaulerProfileFormState

  try {
    await checkRateLimit("marketplace-hauler-profile", viewer.userId, 30, 60 * 60_000)
    const profile = await pilotMarketplaceV2.saveHaulerProfile(viewer, validation.input)
    saved = { ...answer("saved", PROFILE_SAVED), values: haulerProfileFormValues(profile) }
  } catch (error) {
    if (error instanceof MarketplaceOperationUnavailableError) {
      return answer("unavailable", PROFILE_SAVE_UNAVAILABLE)
    }

    if (error instanceof MarketplaceRefusalError || error instanceof DomainRefusalError) {
      return answer("refused", error.message.slice(0, 300))
    }

    return answer("error", PROFILE_SAVE_FAILED)
  }

  revalidatePath("/v2", "layout")

  if (setup) {
    redirect(PROFILE_SETUP_NEXT_PATH)
  }

  return saved
}

/**
 * "Your business" for an account with no hauling business (UX 02 §A3, #125). The input is validated on the server
 * like the profile's, and then the page says plainly that creating a business is not available: V2 sessions read
 * their businesses from the pilot store, which has no service that adds a business to an existing account, so a
 * business created elsewhere could not be selected. Nothing is written.
 */
export async function startHaulingBusinessAction(previous: StartBusinessFormState, formData: FormData): Promise<StartBusinessFormState> {
  if (!marketplaceV2Enabled()) {
    redirect("/")
  }

  // A sign-in with no LogLoads profile yet is still a person setting up; only no sign-in at all goes to sign-in.
  if (!(await getSessionActor()) && !(await getClerkUserId())) {
    redirect(`/sign-in?next=${encodeURIComponent(HAULER_START_PATH)}`)
  }

  const values = {
    businessName: typeof formData.get("businessName") === "string" ? String(formData.get("businessName")).slice(0, 500) : "",
    homeBase: typeof formData.get("homeBase") === "string" ? String(formData.get("homeBase")).slice(0, 500) : ""
  }
  const attempt = (previous?.attempt ?? 0) + 1
  const validation = validateHaulerProfileForm({ ...EMPTY_HAULER_PROFILE_FORM, ...values })

  if (!validation.ok) {
    return { attempt, issues: validation.issues, message: null, status: "invalid", values }
  }

  return { attempt, issues: [], message: START_BUSINESS_UNAVAILABLE, status: "unavailable", values }
}
