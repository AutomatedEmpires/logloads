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
import { DomainRefusalError, HAULER_PROFILE_EDIT_REFUSED } from "@logloads/services"

import { checkRateLimit } from "../rate-limit"
import { reportV2Error } from "./error-log"
import { marketplaceV2Enabled } from "./flag"
import {
  initialListingState,
  LISTING_NO_CHOICE,
  LISTING_NOT_SAVED,
  LISTING_OUTCOME_PARAM,
  LISTING_PROFILE_TO_FIX,
  LISTING_UNAVAILABLE,
  listingChoiceFromForm,
  listingOutcome,
  PROFILE_LISTING_PATH,
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
  type HaulerListingState,
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
 *
 * The directory listing is not the form's to change (#423): the save keeps the listing as stored, read just before
 * it, whatever the post says. Only a tap on the directory listing screen (`saveHaulerListingAction`) changes it.
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
    const stored = await pilotMarketplaceV2.haulerProfile(viewer)
    const profile = await pilotMarketplaceV2.saveHaulerProfile(viewer, { ...input, listed: stored.listed })
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
 * One tap on the directory listing (#423; Figma 04 Settings 361:4236 to 361:7563; legal review §6.5): List my
 * profile, Remove my listing, or Undo after a removal.
 *
 * - The choice is the posted one only, and both of its fields must agree (`listingChoiceFromForm`); anything else is
 *   refused before the store is read, so nothing is ever read as consent.
 * - The person and business come from the server session. A member who may not change the profile is refused before
 *   anything is written; the store refuses them again (`planHaulerProfileSave`, row-level security).
 * - The store has one write for the profile (`saveHaulerProfile`, the only writer of the listing). The tap reads the
 *   profile as stored and saves it back with only the listing changed, in one save, so every other field stays as
 *   stored. The answer is what the store saved; a failure leaves the listing as it was and says so.
 * - Undo is the same save with the listing put back to the value before the removal (`undoTo`).
 */
export async function saveHaulerListingAction(previous: HaulerListingState, formData: FormData): Promise<HaulerListingState> {
  if (!marketplaceV2Enabled()) {
    redirect("/")
  }

  const actor = await getV2SessionActor()

  if (!actor) {
    redirect(`/sign-in?next=${encodeURIComponent(PROFILE_LISTING_PATH)}`)
  }

  const before = previous ?? initialListingState(false)
  const attempt = before.attempt + 1
  const choice = listingChoiceFromForm(formData)
  const unchanged = (status: HaulerListingState["status"], message: string, listed: boolean, reference: string | null = null): HaulerListingState => ({
    attempt,
    intent: choice?.intent ?? before.intent,
    listed,
    message,
    reference,
    status,
    undoTo: before.undoTo
  })

  if (!choice) {
    return unchanged("error", LISTING_NO_CHOICE, before.listed)
  }

  if (!actor.activeOrganization || actor.workspaceSelectionInvalid) {
    return unchanged("refused", "No business is selected for your account. Choose one from the business name at the top of the page.", before.listed)
  }

  const viewer = { organizationId: actor.activeOrganization.id, userId: actor.profile.id }
  let stored: boolean | null = null

  try {
    await checkRateLimit("marketplace-hauler-profile", viewer.userId, 30, 60 * 60_000)
    const current = await pilotMarketplaceV2.haulerProfile(viewer)
    stored = current.listed

    if (!current.canEditProfile) {
      return unchanged("refused", HAULER_PROFILE_EDIT_REFUSED, current.listed)
    }

    if (current.listed === choice.listed) {
      // Already as chosen (a second tap, or another member's change): nothing to write, and nothing to undo.
      return { attempt, intent: choice.intent, listed: current.listed, message: null, reference: null, status: "saved", undoTo: null }
    }

    const validation = validateHaulerProfileForm({ ...haulerProfileFormValues(current), listed: choice.listed })
    const input = validation.ok ? placedProfile(validation.input) : null

    if (!input) {
      return unchanged("error", LISTING_PROFILE_TO_FIX, current.listed)
    }

    const saved = await pilotMarketplaceV2.saveHaulerProfile(viewer, input)
    revalidatePath("/v2", "layout")

    if (saved.listed !== choice.listed) {
      return unchanged("error", LISTING_NOT_SAVED, saved.listed)
    }

    return {
      attempt,
      intent: choice.intent,
      listed: saved.listed,
      message: null,
      reference: null,
      status: "saved",
      undoTo: choice.intent === "remove" ? current.listed : null
    }
  } catch (error) {
    const listed = stored ?? before.listed

    if (error instanceof MarketplaceOperationUnavailableError) {
      return unchanged("unavailable", LISTING_UNAVAILABLE, listed)
    }

    if (error instanceof MarketplaceRefusalError || error instanceof DomainRefusalError) {
      return unchanged("refused", error.message.slice(0, 300), listed)
    }

    return unchanged("error", LISTING_NOT_SAVED, listed, reportV2Error(error, "hauler.listing").requestId)
  }
}

/**
 * The same tap posted without JavaScript: one save through `saveHaulerListingAction`, then back to the listing
 * screen with its outcome in the address. The screen reads the listing from the store again; the outcome only picks
 * the notice's words (`initialListingState`).
 */
export async function submitHaulerListingAction(formData: FormData): Promise<void> {
  const state = await saveHaulerListingAction(initialListingState(false), formData)

  redirect(`${PROFILE_LISTING_PATH}?${LISTING_OUTCOME_PARAM}=${listingOutcome(state)}`)
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
