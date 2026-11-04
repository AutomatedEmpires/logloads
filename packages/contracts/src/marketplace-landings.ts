import { z } from "zod"

import { containsPublicContactText, containsSensitiveAccessText } from "./marketplace-job-draft"
import { canActivateLanding, LANDING_PLANS, landingPlan, landingPlanCodeSchema, type LandingPlan, type LandingPlanCode } from "./membership"

/**
 * Marketplace V2 landing workspace (#127 UX-04, #133 UX-10): the operator's own landings, their public and private
 * halves, and the plan allowances shown on the landing pages.
 *
 * A landing mirrors `marketplace.landings` (the public row) plus `marketplace.landing_private_details` (team only) in
 * architecture/normalized-v2. The public half is exactly what haulers may see; the private half (exact location, gate
 * and access instructions, site contact) never reaches a listing, a map or a public response (AGENTS.md §7.4).
 *
 * Plan facts come only from `LANDING_PLANS` (membership.ts). Nothing here makes a plan purchasable: billing is not
 * active, and these types describe an allowance, never a checkout. The landing rules are pure, so both V2 adapters
 * apply them from here (the normalized adapter may not import the pilot services); the normalized store enforces the
 * cap again in its own trigger (`tg_landing_guard`).
 */

// ---------------------------------------------------------------------------
// Status: only a recruiting landing counts toward the plan (Blueprint §3.3)
// ---------------------------------------------------------------------------

/** `paused` is the store's `inactive`: saved, not recruiting, not counted. */
export const marketplaceLandingStatusSchema = z.enum(["active", "paused", "archived"])
export type MarketplaceLandingStatus = z.infer<typeof marketplaceLandingStatusSchema>

export const MARKETPLACE_LANDING_STATUS_LABELS: Readonly<Record<MarketplaceLandingStatus, string>> = Object.freeze({
  active: "Recruiting",
  archived: "Archived",
  paused: "Paused"
})

/** Archived and paused landings never count toward the active-landing allowance. */
export function landingCountsTowardPlan(status: MarketplaceLandingStatus): boolean {
  return status === "active"
}

// ---------------------------------------------------------------------------
// Read model
// ---------------------------------------------------------------------------

export interface MarketplaceLandingPoint {
  lat: number
  lng: number
}

/** What haulers may see about a landing. Exact coordinates and access details are never part of it. */
export interface MarketplaceLandingPublicView {
  id: string
  name: string
  /** The nearest town or area, e.g. "Oakridge, OR". */
  areaLabel: string
  stateCode: string
  county: string | null
  /** The store's 0.10° public grid point (V2-DEC-01), or `null` when no exact location is saved to derive it from. */
  approximatePoint: MarketplaceLandingPoint | null
  status: MarketplaceLandingStatus
}

/** The keys of `MarketplaceLandingPublicView`, in display order. A public projection copies these and nothing else. */
export const MARKETPLACE_LANDING_PUBLIC_FIELDS = Object.freeze([
  "id",
  "name",
  "areaLabel",
  "stateCode",
  "county",
  "approximatePoint",
  "status"
] as const satisfies ReadonlyArray<keyof MarketplaceLandingPublicView>)

/** Team only. Never on a listing, a map or a public response; shared with a hauler only by a later, explicit act. */
export interface MarketplaceLandingPrivateDetails {
  exactLocation: MarketplaceLandingPoint | null
  gateInstructions: string | null
  siteContactName: string | null
  /** E.164, as the store keeps it (`landing_private_details.site_contact_phone`). */
  siteContactPhone: string | null
}

/** The landing as its own team sees it. */
export interface MarketplaceLandingView extends MarketplaceLandingPublicView {
  privateDetails: MarketplaceLandingPrivateDetails
  /** Job postings at this landing that are accepting interest; `null` when the store cannot say. */
  activeJobs: number | null
  updatedAt: string | null
}

/** The business's current allowances. Limits are never stored here: they come from `LANDING_PLANS` by `planCode`. */
export interface MarketplaceLandingAllowanceView {
  /** The plan that currently entitles the business, or `null` when none does (billing isn't active yet). */
  planCode: LandingPlanCode | null
  /** Recruiting landings. Paused and archived landings are not counted. */
  activeLandings: number
  /** Team members holding a landing workspace seat, the owner included. */
  teamMembers: number
  /** Targeted invitations left in the current billing cycle; `null` without an entitling plan. */
  invitationsRemaining: number | null
  /** The exclusive end of the current billing cycle, when invitations reset (no rollover); `null` without one. */
  cycleEndsAt: string | null
}

export interface LandingAllowanceFigure {
  used: number
  /** From `LANDING_PLANS`; `null` when the plan is unlimited or no plan is active. */
  limit: number | null
  unlimited: boolean
}

export interface LandingAllowanceSummary {
  plan: LandingPlan | null
  billingActive: boolean
  landings: LandingAllowanceFigure
  team: LandingAllowanceFigure
  invitations: { remaining: number | null; perCycle: number | null; resetsAt: string | null }
}

/** The allowance read from the store, with every limit taken from `LANDING_PLANS` (never from the page). */
export function summarizeLandingAllowance(allowance: MarketplaceLandingAllowanceView): LandingAllowanceSummary {
  const plan = allowance.planCode ? LANDING_PLANS[landingPlanCodeSchema.parse(allowance.planCode)] : null

  return {
    billingActive: plan !== null,
    invitations: {
      perCycle: plan ? plan.targetedInvitationsPerCycle : null,
      remaining: plan ? Math.min(allowance.invitationsRemaining ?? 0, plan.targetedInvitationsPerCycle) : null,
      resetsAt: plan ? allowance.cycleEndsAt : null
    },
    landings: {
      limit: plan ? plan.activeLandingLimit : null,
      unlimited: plan !== null && plan.activeLandingLimit === null,
      used: allowance.activeLandings
    },
    plan,
    team: { limit: plan ? plan.teamSeatLimit : null, unlimited: false, used: allowance.teamMembers }
  }
}

// ---------------------------------------------------------------------------
// Rules both V2 adapters apply: activation under the plan, status changes, the public projection
// ---------------------------------------------------------------------------

export const LANDING_BILLING_INACTIVE_REFUSAL =
  "Billing isn't active yet, so no landing can recruit. Save it paused; it starts counting only once it recruits."

export function landingAtCapRefusal(planCode: NonNullable<MarketplaceLandingAllowanceView["planCode"]>): string {
  const plan = landingPlan(planCode)
  const limit = plan.activeLandingLimit ?? 0

  return `Your ${plan.name} plan allows ${limit} active landing${limit === 1 ? "" : "s"}, and ${limit === 1 ? "it is" : "all are"} in use. Pause another landing or see plans.`
}

export type LandingActivationRefusal =
  | { reason: "billing_inactive"; message: string }
  | { reason: "at_plan_limit"; message: string }

/**
 * Whether one more landing may start recruiting. Paused and archived landings never count; a landing that is already
 * recruiting asks for nothing. `null` means it may.
 */
export function landingActivationRefusal(
  allowance: Pick<MarketplaceLandingAllowanceView, "planCode" | "activeLandings">,
  currentStatus: MarketplaceLandingStatus | null = null
): LandingActivationRefusal | null {
  if (currentStatus === "active") {
    return null
  }

  if (!allowance.planCode) {
    return { message: LANDING_BILLING_INACTIVE_REFUSAL, reason: "billing_inactive" }
  }

  return canActivateLanding(allowance.planCode, allowance.activeLandings)
    ? null
    : { message: landingAtCapRefusal(allowance.planCode), reason: "at_plan_limit" }
}

/**
 * Allowed status changes. Archived landings come back paused, never straight to recruiting, so restoring one never
 * takes a plan slot by itself.
 */
const STATUS_CHANGES: Readonly<Record<MarketplaceLandingStatus, readonly MarketplaceLandingStatus[]>> = Object.freeze({
  active: ["paused", "archived"],
  archived: ["paused"],
  paused: ["active", "archived"]
})

export function landingStatusChangeAllowed(from: MarketplaceLandingStatus, to: MarketplaceLandingStatus): boolean {
  return STATUS_CHANGES[from].includes(to)
}

export const LANDING_STATUS_CHANGE_REFUSAL = "An archived landing comes back paused first. Restore it, then start recruiting."

/** The public half of a landing: exactly `MARKETPLACE_LANDING_PUBLIC_FIELDS`, copied one by one. */
export function publicLandingView(view: MarketplaceLandingPublicView): MarketplaceLandingPublicView {
  const picked: Record<string, unknown> = {}

  for (const field of MARKETPLACE_LANDING_PUBLIC_FIELDS) {
    picked[field] = field === "approximatePoint" && view.approximatePoint
      ? { lat: view.approximatePoint.lat, lng: view.approximatePoint.lng }
      : view[field]
  }

  return picked as unknown as MarketplaceLandingPublicView
}

// ---------------------------------------------------------------------------
// Plan cards (B2): facts from LANDING_PLANS only
// ---------------------------------------------------------------------------

const wholeDollars = new Intl.NumberFormat("en-US", { currency: "USD", maximumFractionDigits: 0, minimumFractionDigits: 0, style: "currency" })
const dollarsAndCents = new Intl.NumberFormat("en-US", { currency: "USD", style: "currency" })

/** "$149 per month". Whole-dollar prices drop the cents. */
export function formatLandingPlanPrice(plan: Pick<LandingPlan, "monthlyPriceCents">): string {
  const cents = plan.monthlyPriceCents
  const amount = cents % 100 === 0 ? wholeDollars.format(cents / 100) : dollarsAndCents.format(cents / 100)

  return `${amount} per month`
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

export interface LandingPlanCardFacts {
  code: LandingPlanCode
  name: string
  positioning: string
  price: string
  activeLandings: string
  teamMembers: string
  invitations: string
}

/** One plan's card, worded from the plan's own fields. The order is Basic, Pro, Regional, as `LANDING_PLANS` lists them. */
export function landingPlanCardFacts(plan: LandingPlan): LandingPlanCardFacts {
  return {
    activeLandings: plan.activeLandingLimit === null ? "Unlimited active landings" : plural(plan.activeLandingLimit, "active landing", "active landings"),
    code: plan.code,
    invitations: `${plural(plan.targetedInvitationsPerCycle, "targeted invitation", "targeted invitations")} per billing cycle`,
    name: plan.name,
    positioning: plan.positioning,
    price: formatLandingPlanPrice(plan),
    teamMembers: `${plural(plan.teamSeatLimit, "team member", "team members")}, including you`
  }
}

export function landingPlanCards(): LandingPlanCardFacts[] {
  return Object.values(LANDING_PLANS).map(landingPlanCardFacts)
}

// ---------------------------------------------------------------------------
// Inputs (actor identity always comes from the server session, never the form)
// ---------------------------------------------------------------------------

export const MARKETPLACE_LANDING_LIMITS = Object.freeze({
  /** The town as typed; the stored label adds ", ST" and stays within the store's 120 characters. */
  areaLabel: 116,
  county: 80,
  gateInstructions: 2000,
  name: 120,
  organizationName: 160,
  siteContactName: 120
})

const SENSITIVE_MESSAGE = "Remove coordinates and gate or lock codes. Put access details in the private section."
const CONTACT_MESSAGE = "Remove phone numbers and email addresses. Haulers contact you through LogLoads messages."
const PHONE_MESSAGE = "Enter the site contact's phone number with its area code, for example 541-555-0100"

const blankToUndefined = (value: unknown) => (typeof value === "string" && value.trim() === "" ? undefined : value)

/** Public landing text: trimmed, bounded, and free of private access details and direct contact details. */
const publicName = (max: number, required: string) =>
  z.string({ message: required })
    .trim()
    .min(1, required)
    .max(max, `Keep this under ${max + 1} characters`)
    .refine((text) => !containsSensitiveAccessText(text), SENSITIVE_MESSAGE)
    .refine((text) => !containsPublicContactText(text), CONTACT_MESSAGE)

const optionalPublicText = (max: number) =>
  z.preprocess(blankToUndefined, z.string().trim().max(max, `Keep this under ${max + 1} characters`)
    .refine((text) => !containsSensitiveAccessText(text), SENSITIVE_MESSAGE)
    .refine((text) => !containsPublicContactText(text), CONTACT_MESSAGE)
    .optional())

const optionalPrivateText = (max: number) =>
  z.preprocess(blankToUndefined, z.string().trim().max(max, `Keep this under ${max + 1} characters`).optional())

const stateCode = (required: boolean) => {
  const code = z.string().trim().transform((value) => value.toUpperCase()).pipe(z.string().regex(/^[A-Z]{2}$/, "Use the two-letter state code, for example OR"))

  return required
    ? z.preprocess(blankToUndefined, z.string({ message: "Enter the state, for example OR" }).pipe(code))
    : z.preprocess(blankToUndefined, code.optional())
}

const coordinate = (min: number, max: number, label: string) =>
  z.preprocess(blankToUndefined, z.coerce.number({ message: `Enter the ${label} as a decimal number` })
    .min(min, `The ${label} must be between ${min} and ${max}`)
    .max(max, `The ${label} must be between ${min} and ${max}`)
    .optional())

/** An HTML checkbox: absent or blank is false; "1", "on" or "true" is true; anything else is invalid. */
const checkbox = z.preprocess((value) => {
  if (value === undefined || value === null || value === false || value === "") return false
  if (value === true || value === "1" || value === "on" || value === "true") return true
  return value
}, z.boolean())

const E164 = /^\+[1-9][0-9]{6,14}$/

/**
 * A site contact phone in the store's E.164 form, or `null` when it cannot be read as one. Ten digits are a North
 * American number; a leading "+" keeps the caller's country code.
 */
export function normalizeSiteContactPhone(raw: string): string | null {
  const text = raw.trim()
  const digits = text.replace(/\D/g, "")
  const candidate = text.startsWith("+")
    ? `+${digits}`
    : digits.length === 10
      ? `+1${digits}`
      : digits.length === 11 && digits.startsWith("1")
        ? `+${digits}`
        : null

  return candidate && /^[+\d\s().-]+$/.test(text) && E164.test(candidate) ? candidate : null
}

const sitePhone = z.preprocess(
  blankToUndefined,
  z.string().trim().max(40, PHONE_MESSAGE).refine((value) => normalizeSiteContactPhone(value) !== null, PHONE_MESSAGE).transform((value) => normalizeSiteContactPhone(value) as string).optional()
)

/**
 * The landing form (B3). `landingId` absent creates a landing; present edits that landing's details. Status is not
 * part of an edit: pausing, recruiting and archiving are their own action (`marketplaceLandingStatusInputSchema`), so a
 * stale form can never flip a landing. `recruiting` applies to a new landing only.
 *
 * The exact location is optional (B3, spec §4.3): saving works without it, and then the landing has no public map
 * point. When it is given, the store derives the public point from it on the 0.10° grid (V2-DEC-01).
 */
export const marketplaceLandingInputSchema = z.object({
  landingId: z.preprocess(blankToUndefined, z.string().uuid({ message: "That landing was not found" }).optional()),
  name: publicName(MARKETPLACE_LANDING_LIMITS.name, "Name the landing so haulers can recognize it"),
  areaLabel: publicName(MARKETPLACE_LANDING_LIMITS.areaLabel, "Enter the nearest town, for example Oakridge"),
  stateCode: stateCode(true),
  county: optionalPublicText(MARKETPLACE_LANDING_LIMITS.county),
  exactLat: coordinate(-90, 90, "latitude"),
  exactLng: coordinate(-180, 180, "longitude"),
  gateInstructions: optionalPrivateText(MARKETPLACE_LANDING_LIMITS.gateInstructions),
  siteContactName: optionalPrivateText(MARKETPLACE_LANDING_LIMITS.siteContactName),
  siteContactPhone: sitePhone,
  recruiting: checkbox
}).superRefine((input, context) => {
  if ((input.exactLat === undefined) !== (input.exactLng === undefined)) {
    context.addIssue({
      code: "custom",
      message: "Enter both the latitude and the longitude, or leave both empty",
      path: [input.exactLat === undefined ? "exactLat" : "exactLng"]
    })
  }
}).transform((input) => ({
  // The public label is "Town, ST", as job pages show it after "Near". A town typed with its state is kept as typed.
  areaLabel: /,\s*[A-Za-z]{2}$/.test(input.areaLabel) ? input.areaLabel : `${input.areaLabel}, ${input.stateCode as string}`,
  county: input.county ?? null,
  exactLocation: input.exactLat !== undefined && input.exactLng !== undefined ? { lat: input.exactLat, lng: input.exactLng } : null,
  gateInstructions: input.gateInstructions ?? null,
  landingId: input.landingId ?? null,
  name: input.name,
  recruiting: input.recruiting,
  siteContactName: input.siteContactName ?? null,
  siteContactPhone: input.siteContactPhone ?? null,
  stateCode: input.stateCode as string
}))
export type MarketplaceLandingInput = z.output<typeof marketplaceLandingInputSchema>

/** The form field names of the landing form, for keeping a refused submission on the page. */
export const MARKETPLACE_LANDING_FORM_FIELDS = Object.freeze([
  "name",
  "areaLabel",
  "stateCode",
  "county",
  "exactLat",
  "exactLng",
  "gateInstructions",
  "siteContactName",
  "siteContactPhone",
  "recruiting"
] as const)
export type MarketplaceLandingFormField = (typeof MARKETPLACE_LANDING_FORM_FIELDS)[number]

export const marketplaceLandingStatusInputSchema = z.object({
  landingId: z.string().uuid({ message: "That landing was not found" }),
  status: marketplaceLandingStatusSchema
})

/** B1: a landing business. Only what the store can hold: its public name and home state. */
export const landingOrganizationInputSchema = z.object({
  displayName: publicName(MARKETPLACE_LANDING_LIMITS.organizationName, "Enter your business name"),
  homeState: stateCode(false)
}).transform((input) => ({ displayName: input.displayName, homeState: input.homeState ?? null }))
export type LandingOrganizationInput = z.output<typeof landingOrganizationInputSchema>

export interface MarketplaceInputIssue {
  field: string
  message: string
}

/** Field-keyed issues of a refused input, first message per field, for showing next to each field. */
export function marketplaceInputIssues(error: z.ZodError): MarketplaceInputIssue[] {
  const seen = new Set<string>()

  return error.issues.flatMap((issue) => {
    const field = String(issue.path[0] ?? "form")

    if (seen.has(field)) return []
    seen.add(field)
    return [{ field, message: issue.message }]
  })
}
