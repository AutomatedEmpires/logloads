"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"

import {
  EMPTY_HAULER_PROFILE_FORM,
  HOME_BASE_UNKNOWN_MESSAGE,
  haulerProfileFormValues,
  validateHaulerProfileForm,
  type HaulerProfileInput
} from "@logloads/contracts"
import { DomainRefusalError } from "@logloads/services"

import { checkRateLimit } from "../rate-limit"
import { marketplaceV2Enabled } from "./flag"
import {
  PROFILE_PATH,
  PROFILE_SAVE_FAILED,
  PROFILE_SAVE_UNAVAILABLE,
  PROFILE_SAVED,
  PROFILE_SETUP_NEXT_PATH,
  PROFILE_SETUP_PATH,
  profileValuesFromForm,
  START_BUSINESS_FAILED,
  START_BUSINESS_NOT_SELECTED,
  START_BUSINESS_UNAVAILABLE,
  HAULER_START_PATH,
  type HaulerProfileFormState,
  type StartBusinessFormState
} from "./hauler-profile-form"
import { pilotMarketplaceV2 } from "./pilot-adapter"
import { placeLabel, resolvePlace } from "./places"
import { MarketplaceOperationUnavailableError, MarketplaceRefusalError } from "./port"
import { getV2SessionActor, selectNormalizedSessionBusiness, v2SignedInWithoutPerson } from "./v2-session"

/**
 * The home base placed on the Find work place list (#129): its label becomes the list's ("97386" -> "Sweet Home, OR")
 * and its 0.1 degree point the business's service point. `null` when the place is not on the list; it is never guessed.
 */
function placedProfile(input: HaulerProfileInput): HaulerProfileInput | null {
  if (input.homeBase === null) {
    return { ...input, homeBasePoint: null }
  }

  const lookup = resolvePlace(input.homeBase)

  return lookup.status === "found" ? { ...input, homeBase: placeLabel(lookup.place), homeBasePoint: lookup.place.point } : null
}

/**
 * The hauling business profile form's action (#125). Identity and the acting business come from the server session
 * only; the form supplies the business's own words. Every outcome returns the posted values, so a failed or
 * unavailable save never loses what the person typed, and nothing is reported as saved unless the store saved it.
 */
export async function saveHaulerProfileAction(previous: HaulerProfileFormState, formData: FormData): Promise<HaulerProfileFormState> {
  if (!marketplaceV2Enabled()) {
    redirect("/")
  }

  const actor = await getV2SessionActor()

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

  const input = placedProfile(validation.input)

  if (!input) {
    return { ...answer("invalid", null), issues: [{ field: "homeBase", message: HOME_BASE_UNKNOWN_MESSAGE }] }
  }

  const viewer = { organizationId: actor.activeOrganization.id, userId: actor.profile.id }
  let saved: HaulerProfileFormState

  try {
    await checkRateLimit("marketplace-hauler-profile", viewer.userId, 30, 60 * 60_000)
    const profile = await pilotMarketplaceV2.saveHaulerProfile(viewer, input)
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
 * like the profile's.
 *
 * - Normalized store (#213): the business is created with its public basics, owned by the session's person, and
 *   becomes the session's selected business at once (the V2 session reads its memberships from the same store).
 *   Setup then continues on the business profile.
 * - Pilot store (the default): the page says plainly that creating a business is not available. The pilot store has
 *   no service that adds a business to an existing account. Nothing is written.
 */
export async function startHaulingBusinessAction(previous: StartBusinessFormState, formData: FormData): Promise<StartBusinessFormState> {
  if (!marketplaceV2Enabled()) {
    redirect("/")
  }

  const actor = await getV2SessionActor()

  // A sign-in with no LogLoads profile yet is still a person setting up; only no sign-in at all goes to sign-in.
  if (!actor && !(await v2SignedInWithoutPerson())) {
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

  const input = placedProfile(validation.input)

  if (!input) {
    return { attempt, issues: [{ field: "homeBase", message: HOME_BASE_UNKNOWN_MESSAGE }], message: null, status: "invalid", values }
  }

  const unavailable: StartBusinessFormState = { attempt, issues: [], message: START_BUSINESS_UNAVAILABLE, status: "unavailable", values }

  // Only where the V2 session reads the store the business is created in can the person act for it afterwards.
  if (!actor || actor.store !== "normalized") {
    return unavailable
  }

  try {
    await checkRateLimit("marketplace-organization", actor.profile.id, 5, 60 * 60_000)
    const { organizationId } = await pilotMarketplaceV2.createHaulingBusiness({ userId: actor.profile.id }, input)

    if (!(await selectNormalizedSessionBusiness(organizationId))) {
      return { attempt, issues: [], message: START_BUSINESS_NOT_SELECTED, status: "refused", values }
    }
  } catch (error) {
    if (error instanceof MarketplaceOperationUnavailableError) {
      return unavailable
    }

    const message = error instanceof MarketplaceRefusalError || error instanceof DomainRefusalError ? error.message.slice(0, 300) : START_BUSINESS_FAILED

    return { attempt, issues: [], message, status: "refused", values }
  }

  revalidatePath("/v2", "layout")
  redirect(PROFILE_SETUP_PATH)
}
