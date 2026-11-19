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

export const HAULER_START_PATH = "/v2/start/hauler"
/** The landing operator's setup is UX-04 (#127). */
export const LANDING_START_PATH = "/v2/start/landing"

/** The hauler setup steps after A1 (UX 02 §A2–A5): My trucks (#126) is A4 and A5 on one page. */
export const HAULER_SETUP_STEPS: readonly string[] = Object.freeze(["Business type", "Your business", "Trucks and availability", "Find work"])

export const PROFILE_PATH = "/v2/hauler/profile"
export const PROFILE_SETUP_PATH = `${PROFILE_PATH}?setup=1`
/** Where setup goes after the profile step, and where its Skip leads: My trucks (#126). */
export const PROFILE_SETUP_NEXT_PATH = "/v2/hauler/trucks?setup=1"
/** The end of setup: Find work, with the checklist for anything skipped. */
export const SETUP_DONE_PATH = "/v2/work"

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

// ---------------------------------------------------------------------------------------------------------------------
// The directory listing (#423; Figma 04 Settings 361:4236 to 361:7563; legal review §6.5)
// ---------------------------------------------------------------------------------------------------------------------

/**
 * The directory listing screen, reached from the profile. Listing is the hauler's choice, off until they tap List my
 * profile; Remove my listing is one tap too, and offers Undo. The profile form no longer carries the choice, so only
 * a tap here changes it.
 */
export const PROFILE_LISTING_PATH = `${PROFILE_PATH}/listing`

/** The address parameter that carries a tap's outcome back to the page when the form posted without JavaScript. */
export const LISTING_OUTCOME_PARAM = "listing"

/** What one tap asked for. Undo follows a removal and lists the business again, as it was before. */
export type HaulerListingIntent = "list" | "remove" | "undo"

/**
 * `saved` and the failures come from the server; `offline` and `unreachable` are set on the phone when nothing could
 * be sent. In every failure the listing is the one last saved.
 */
export type HaulerListingStatus = "idle" | "saved" | "unavailable" | "refused" | "error" | "offline" | "unreachable"

export interface HaulerListingChoice {
  intent: HaulerListingIntent
  listed: boolean
}

export interface HaulerListingState {
  /** The listing as the store last answered it. A failed, refused or unsent tap leaves it as it was. */
  listed: boolean
  status: HaulerListingStatus
  /** The tap this state answers; `null` before any. */
  intent: HaulerListingIntent | null
  /** After a removal, the listing before it, which Undo puts back; `null` when there is nothing to undo. */
  undoTo: boolean | null
  message: string | null
  /** The logged failure's reference, shown as "Reference: …". */
  reference: string | null
  /** Counts taps, so the notice can move focus after each one. */
  attempt: number
}

export const LISTING_NOT_SAVED = "Something went wrong on our side, so nothing changed. Try again."
export const LISTING_UNREACHABLE = "We couldn't reach LogLoads, so nothing changed. Try again."
export const LISTING_UNAVAILABLE = "Listing isn't available in this preview yet, so nothing changed."
export const LISTING_NO_CHOICE = "We couldn't tell what you chose, so nothing changed. Try again."
export const LISTING_REFUSED = "Only an owner or manager of this business can list it or remove it, so nothing changed."
export const LISTING_PROFILE_TO_FIX =
  "Your business profile needs a fix before its listing can change, so nothing changed. Open your profile, save it, then try again."
export const LISTING_OFFLINE = "You're offline, so nothing can change. Your listing stays as last saved."

const LISTING_OUTCOMES = {
  listed: { intent: "list", status: "saved" },
  "not-saved": { status: "error" },
  refused: { status: "refused" },
  removed: { intent: "remove", status: "saved" },
  unavailable: { status: "unavailable" }
} as const satisfies Record<string, { intent?: HaulerListingIntent; status: HaulerListingStatus }>

export type HaulerListingOutcome = keyof typeof LISTING_OUTCOMES

const OUTCOME_MESSAGES: Partial<Record<HaulerListingStatus, string>> = {
  error: LISTING_NOT_SAVED,
  refused: LISTING_REFUSED,
  unavailable: LISTING_UNAVAILABLE
}

function isOutcome(value: string | null): value is HaulerListingOutcome {
  return value !== null && Object.hasOwn(LISTING_OUTCOMES, value)
}

/**
 * The notice before any tap, from the stored listing. `outcome` is the address parameter a post without JavaScript
 * comes back with. It only picks the words: whether the business is listed always comes from the store, so an address
 * cannot show a removal (or offer Undo) for a business that is listed.
 */
export function initialListingState(listed: boolean, outcome: string | null = null): HaulerListingState {
  const idle: HaulerListingState = { attempt: 0, intent: null, listed, message: null, reference: null, status: "idle", undoTo: null }

  if (!isOutcome(outcome)) return idle

  const known: { intent?: HaulerListingIntent; status: HaulerListingStatus } = LISTING_OUTCOMES[outcome]

  if (known.status === "saved") {
    if (known.intent === "remove" && !listed) return { ...idle, intent: "remove", status: "saved", undoTo: true }
    if (known.intent === "list" && listed) return { ...idle, intent: "list", status: "saved" }
    return idle
  }

  // A failure leaves the stored listing, so the tap that failed was the one that would have changed it.
  return { ...idle, intent: listed ? "remove" : "list", message: OUTCOME_MESSAGES[known.status] ?? null, status: known.status }
}

/** The outcome parameter for a state, for the page a post without JavaScript returns to. */
export function listingOutcome(state: HaulerListingState): HaulerListingOutcome {
  if (state.status === "saved") return state.listed ? "listed" : "removed"
  if (state.status === "unavailable" || state.status === "refused") return state.status
  return "not-saved"
}

/**
 * The posted tap. Both fields must be present and agree (Remove unlists; List and Undo list), so a missing, unknown
 * or crafted value is never read as consent to list.
 */
export function listingChoiceFromForm(formData: FormData): HaulerListingChoice | null {
  const intent = formData.get("intent")
  const listed = formData.get("listed")

  if (intent !== "list" && intent !== "remove" && intent !== "undo") return null
  if (listed !== (intent === "remove" ? "false" : "true")) return null

  return { intent, listed: listed === "true" }
}

/** The tap that Try again (or Retry, back in range) repeats: the one that did not go through. `null` otherwise. */
export function listingRetryChoice(state: HaulerListingState): HaulerListingChoice | null {
  if (state.intent === null || state.status === "idle" || state.status === "saved") return null
  return { intent: state.intent, listed: state.intent !== "remove" }
}

/** Nothing was sent: offline, or the request did not reach the server. The stored listing stays as it was. */
export function listingAfterFailure(state: HaulerListingState, choice: HaulerListingChoice, reason: "offline" | "unreachable"): HaulerListingState {
  return {
    ...state,
    attempt: state.attempt + 1,
    intent: choice.intent,
    message: reason === "offline" ? LISTING_OFFLINE : LISTING_UNREACHABLE,
    reference: null,
    status: reason
  }
}

export type HaulerListingView = "notListed" | "listed" | "removed"

/**
 * Which notice shows: the stored listing first, then whether the last tap removed it. `failed` is a tap the server
 * did not carry out (offline has its own banner, above the last saved notice).
 */
export function listingView(state: HaulerListingState): { view: HaulerListingView; failed: boolean; canUndo: boolean } {
  const failed = state.status !== "idle" && state.status !== "saved" && state.status !== "offline"

  if (state.listed) return { canUndo: false, failed, view: "listed" }

  const removed = state.status === "saved" && state.intent === "remove"

  return { canUndo: removed && state.undoTo === true, failed, view: removed ? "removed" : "notListed" }
}

/** The setup flow's business type from A2, carried through the steps for wording only (it has no column). */
export type HaulerSetupKind = "solo" | "company"

export function haulerSetupKind(value: unknown): HaulerSetupKind | null {
  return value === "solo" || value === "company" ? value : null
}

/**
 * "Your business" for an account with no hauling business yet (UX 02 §A3): the public basics only. `refused` is the
 * normalized store saying no (#213); on success the action goes on to the business profile instead of returning.
 */
export interface StartBusinessFormState {
  status: "idle" | "invalid" | "unavailable" | "refused"
  values: { businessName: string; homeBase: string }
  issues: HaulerProfileIssue[]
  message: string | null
  attempt: number
}

export const START_BUSINESS_FIELD_IDS = Object.freeze({ businessName: "start-business-name", homeBase: "start-home-base" })

export const START_BUSINESS_UNAVAILABLE =
  "Setting up a new hauling business from V2 isn't available in this preview yet. Nothing was saved; what you entered is still in the form. You can search for work now: it never needs a profile."

export const START_BUSINESS_FAILED =
  "We couldn't set up your business. Try again in a moment; what you entered is still in the form."
/** The business was created but the session could not select it; switching to it from the business name works. */
export const START_BUSINESS_NOT_SELECTED =
  "Your business was set up, but we couldn't switch you to it. Choose it from the business name at the top of the page."

export function initialStartBusinessState(): StartBusinessFormState {
  return { attempt: 0, issues: [], message: null, status: "idle", values: { businessName: "", homeBase: "" } }
}
