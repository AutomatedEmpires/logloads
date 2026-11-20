import {
  MARKETPLACE_LANDING_FORM_FIELDS,
  MARKETPLACE_LANDING_STATUS_LABELS,
  type LandingAllowanceSummary,
  type MarketplaceLandingFormField,
  type MarketplaceLandingStatus,
  type MarketplaceLandingView
} from "@logloads/contracts"

/**
 * The landing workspace's page state and wording (#127, #133), shared by the server actions and the pages. Pure: no
 * session, no store. Plan limits always arrive through a `LandingAllowanceSummary`, which reads `LANDING_PLANS`.
 */

export const LANDINGS_PATH = "/v2/landing/landings"
export const NEW_LANDING_PATH = "/v2/landing/landings/new"
export const LANDING_SETUP_PATH = "/v2/start/landing"
export const PLANS_HREF = "/v2/start/landing#plans"

export const LANDING_SAVE_UNAVAILABLE =
  "Saving landings isn't available in this preview yet: it needs the normalized marketplace store. Nothing was saved, and what you entered is still here."
export const LANDING_STATUS_UNAVAILABLE =
  "Changing a landing's status isn't available in this preview yet: it needs the normalized marketplace store. Nothing was changed."
export const ORGANIZATION_SETUP_UNAVAILABLE =
  "Setting up a business isn't available in this preview yet: it needs the normalized marketplace store. Nothing was saved, and what you entered is still here."
export const FIX_LANDING_FIELDS = "Check the highlighted fields. Nothing was saved yet."

/**
 * What a landing row or its status forms need: public labels and the status, never the private half. Pages pass this
 * (not the whole landing) to their components, because a development build also sends server components' props to
 * the browser for debugging.
 */
export type LandingRowView = Pick<MarketplaceLandingView, "id" | "name" | "areaLabel" | "status" | "activeJobs">

export function landingRowView(landing: MarketplaceLandingView): LandingRowView {
  return { activeJobs: landing.activeJobs, areaLabel: landing.areaLabel, id: landing.id, name: landing.name, status: landing.status }
}

export type LandingFormValues = Record<MarketplaceLandingFormField, string>

/** What the last submission of a landing form came to. `idle` is a fresh form. */
export type LandingFormOutcome = "idle" | "invalid" | "refused" | "unavailable" | "at_cap" | "billing_inactive"

export interface LandingFormState {
  outcome: LandingFormOutcome
  message: string | null
  fieldErrors: Partial<Record<MarketplaceLandingFormField, string>>
  values: LandingFormValues
}

function text(value: number | string | null | undefined): string {
  return value === null || value === undefined ? "" : String(value)
}

/** The form's fields for an existing landing (its own team's view), or empty for a new one. */
export function landingFormValues(landing?: MarketplaceLandingView | null): LandingFormValues {
  const values = Object.fromEntries(MARKETPLACE_LANDING_FORM_FIELDS.map((field) => [field, ""])) as LandingFormValues

  if (!landing) {
    return values
  }

  return {
    ...values,
    areaLabel: landing.areaLabel,
    county: text(landing.county),
    exactLat: text(landing.privateDetails.exactLocation?.lat),
    exactLng: text(landing.privateDetails.exactLocation?.lng),
    gateInstructions: text(landing.privateDetails.gateInstructions),
    name: landing.name,
    publicRoadNotes: text(landing.publicRoadNotes),
    siteContactName: text(landing.privateDetails.siteContactName),
    siteContactPhone: text(landing.privateDetails.siteContactPhone),
    stateCode: landing.stateCode,
    typicalHours: text(landing.typicalHours)
  }
}

export function initialLandingFormState(landing?: MarketplaceLandingView | null): LandingFormState {
  return { fieldErrors: {}, message: null, outcome: "idle", values: landingFormValues(landing) }
}

/** The submitted values, exactly as typed, so a refused form comes back with them. Unknown fields are ignored. */
export function landingFormValuesFrom(formData: FormData): LandingFormValues {
  const values = landingFormValues()

  for (const field of MARKETPLACE_LANDING_FORM_FIELDS) {
    const value = formData.get(field)
    values[field] = typeof value === "string" ? value.slice(0, 4000) : ""
  }

  return values
}

export interface OrganizationFormState {
  outcome: "idle" | "invalid" | "refused" | "unavailable" | "created"
  message: string | null
  fieldErrors: Partial<Record<"displayName" | "homeState", string>>
  values: { displayName: string; homeState: string }
  createdName: string | null
}

export const INITIAL_ORGANIZATION_FORM_STATE: OrganizationFormState = Object.freeze({
  createdName: null,
  fieldErrors: {},
  message: null,
  outcome: "idle",
  values: { displayName: "", homeState: "" }
}) as OrganizationFormState

// ---------------------------------------------------------------------------
// Wording
// ---------------------------------------------------------------------------

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

/** "1 of 1 active landings" (AC #127.5), "4 active landings · unlimited on Regional", or the count with no plan. */
export function activeLandingsLine(summary: LandingAllowanceSummary): string {
  const { landings, plan } = summary

  if (!plan) {
    return `${plural(landings.used, "active landing", "active landings")} · no plan is active`
  }

  return landings.limit === null
    ? `${plural(landings.used, "active landing", "active landings")} · unlimited on ${plan.name}`
    : `${landings.used} of ${landings.limit} active landings (${plan.name})`
}

/** Whether the plan has room for one more recruiting landing. */
export function hasRoomToRecruit(summary: LandingAllowanceSummary): boolean {
  return summary.plan !== null && (summary.landings.limit === null || summary.landings.used < summary.landings.limit)
}

/** The hint under "Recruiting now" on a new landing. Saved landings never count. */
export function recruitingHint(summary: LandingAllowanceSummary): string {
  if (!summary.plan) {
    return "Billing isn't active yet, so a new landing is saved paused. Saved and paused landings don't count toward a plan."
  }

  if (!hasRoomToRecruit(summary)) {
    return `All ${summary.landings.limit} of ${summary.landings.limit} active landings on ${summary.plan.name} are in use. Save it paused, or pause another landing first.`
  }

  const next = summary.landings.used + 1

  return summary.landings.limit === null
    ? `Counts as an active landing (${next} on ${summary.plan.name}, which has no landing limit).`
    : `Counts as an active landing: this would be ${next} of ${summary.landings.limit} on your ${summary.plan.name} plan.`
}

const SHORT_DAY = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", timeZone: "UTC" })

/** "3 left (resets Dec 1)", or why there is no invitation allowance. */
export function invitationsLine(summary: LandingAllowanceSummary): string {
  const { invitations } = summary

  if (!summary.plan || invitations.remaining === null) {
    return "None while billing is inactive"
  }

  const resets = invitations.resetsAt ? ` (resets ${SHORT_DAY.format(new Date(invitations.resetsAt))})` : ""

  return `${invitations.remaining} of ${invitations.perCycle} left${resets}`
}

/** "2 of 2", or the count with no plan. */
export function teamLine(summary: LandingAllowanceSummary): string {
  return summary.plan && summary.team.limit !== null
    ? `${summary.team.used} of ${summary.team.limit}`
    : `${plural(summary.team.used, "member", "members")} · no plan is active`
}

export function landingStatusLabel(status: MarketplaceLandingStatus): string {
  return status === "paused" ? `${MARKETPLACE_LANDING_STATUS_LABELS.paused} · not counted` : status === "archived" ? `${MARKETPLACE_LANDING_STATUS_LABELS.archived} · not counted` : MARKETPLACE_LANDING_STATUS_LABELS.active
}

export function jobsLine(activeJobs: number | null): string {
  return activeJobs === null ? "Job count not available" : plural(activeJobs, "job accepting interest", "jobs accepting interest")
}
