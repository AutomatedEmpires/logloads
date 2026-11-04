import {
  EMPTY_HAULER_PROFILE_FORM,
  type HaulerProfileField,
  type HaulerProfileFormValues,
  type HaulerProfileIssue
} from "@logloads/contracts"

/**
 * The hauling business profile form (#125): its field ids, the state its server action returns, and reading a post.
 * Pure, so the page, the client form and the action share one definition. The action returns the posted values on
 * every outcome, so nothing the person typed is lost when saving fails or is not available; they travel in the
 * action's response, never in a URL.
 */

export const PROFILE_PATH = "/v2/hauler/profile"
export const PROFILE_SETUP_PATH = `${PROFILE_PATH}?setup=1`
/** Where setup goes after this step, and where Skip leads. My trucks (#126) is the next step once it exists. */
export const PROFILE_SETUP_NEXT_PATH = "/v2/work"

export const PROFILE_FIELD_IDS: Readonly<Record<HaulerProfileField, string>> = Object.freeze({
  about: "profile-about",
  acceptsInvitations: "profile-accepts-invitations",
  businessName: "profile-business-name",
  homeBase: "profile-home-base",
  legalName: "profile-legal-name",
  listed: "profile-listed",
  serviceRadiusMiles: "profile-service-radius"
})

export type HaulerProfileFormStatus = "idle" | "saved" | "invalid" | "unavailable" | "refused" | "error"

export interface HaulerProfileFormState {
  status: HaulerProfileFormStatus
  values: HaulerProfileFormValues
  issues: HaulerProfileIssue[]
  message: string | null
  /** Counts submissions, so the form can move focus to its summary after each one. */
  attempt: number
}

export const PROFILE_SAVE_UNAVAILABLE =
  "Saving your business profile isn't available in this preview yet. Nothing was saved; what you entered is still in the form."
export const PROFILE_SAVE_FAILED = "We couldn't save your profile. Try again in a moment; what you entered is still in the form."
export const PROFILE_SAVED = "Profile saved. Landing operators see the public part of it as shown in the preview."

export function initialProfileFormState(values: HaulerProfileFormValues): HaulerProfileFormState {
  return { attempt: 0, issues: [], message: null, status: "idle", values }
}

function text(formData: FormData, name: string): string {
  const value = formData.get(name)
  return typeof value === "string" ? value.slice(0, 5000) : ""
}

/** The posted form, as typed. Checkboxes post "on" only when ticked. */
export function profileValuesFromForm(formData: FormData): HaulerProfileFormValues {
  return {
    ...EMPTY_HAULER_PROFILE_FORM,
    about: text(formData, "about"),
    acceptsInvitations: formData.get("acceptsInvitations") === "on",
    businessName: text(formData, "businessName"),
    homeBase: text(formData, "homeBase"),
    legalName: text(formData, "legalName"),
    listed: formData.get("listed") === "on",
    serviceRadiusMiles: text(formData, "serviceRadiusMiles")
  }
}

/** The setup flow's business type from A2, carried through the steps for wording only (it has no column). */
export type HaulerSetupKind = "solo" | "company"

export function haulerSetupKind(value: unknown): HaulerSetupKind | null {
  return value === "solo" || value === "company" ? value : null
}
