"use server"

import { revalidatePath } from "next/cache"
import { redirect, unstable_rethrow } from "next/navigation"

import {
  LANDING_BILLING_INACTIVE_REFUSAL,
  landingOrganizationInputSchema,
  marketplaceInputIssues,
  marketplaceLandingInputSchema,
  marketplaceLandingStatusSchema,
  type MarketplaceLandingFormField
} from "@logloads/contracts"

import { checkRateLimit } from "../rate-limit"
import { serializeError } from "../services"
import { getSessionActor } from "../session"
import { marketplaceV2Enabled } from "./flag"
import {
  FIX_LANDING_FIELDS,
  LANDING_SAVE_UNAVAILABLE,
  LANDINGS_PATH,
  landingFormValuesFrom,
  ORGANIZATION_SETUP_UNAVAILABLE,
  type LandingFormState,
  type OrganizationFormState
} from "./landing-workspace"
import { pilotMarketplaceV2 } from "./pilot-adapter"
import { MarketplaceOperationUnavailableError, MarketplaceRefusalError, type MarketplaceV2Viewer } from "./port"

/**
 * Landing workspace form actions (#127). Identity and the active business always come from the server session; the
 * form supplies only the landing's id, its own words and the status asked for. Every write goes through the port,
 * which checks the role, the plan and ownership again. A refused or unavailable save keeps what the person typed.
 */

const HOUR_MS = 60 * 60_000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function sessionViewer(nextPath: string): Promise<MarketplaceV2Viewer> {
  if (!marketplaceV2Enabled()) {
    redirect("/")
  }

  const actor = await getSessionActor()

  if (!actor) {
    redirect(`/sign-in?next=${encodeURIComponent(nextPath)}`)
  }

  if (actor.workspaceSelectionInvalid || !actor.activeOrganization) {
    throw new MarketplaceRefusalError("Choose a business before continuing")
  }

  return { organizationId: actor.activeOrganization.id, userId: actor.profile.id }
}

function field(formData: FormData, name: string): string {
  const value = formData.get(name)
  return typeof value === "string" ? value : ""
}

function message(error: unknown): string {
  return serializeError(error).error.slice(0, 200)
}

/** Create or edit a landing (B3). On success it opens the landings list; otherwise the form comes back as typed. */
export async function saveLandingAction(_previous: LandingFormState, formData: FormData): Promise<LandingFormState> {
  const values = landingFormValuesFrom(formData)
  const landingId = field(formData, "landingId").trim()
  const back = landingId && UUID.test(landingId) ? `${LANDINGS_PATH}/${landingId}` : `${LANDINGS_PATH}/new`
  const keep = (outcome: LandingFormState["outcome"], text: string, fieldErrors: LandingFormState["fieldErrors"] = {}): LandingFormState =>
    ({ fieldErrors, message: text, outcome, values })

  let savedId: string

  try {
    const viewer = await sessionViewer(back)
    await checkRateLimit("marketplace-landing", viewer.userId, 60, HOUR_MS)

    const parsed = marketplaceLandingInputSchema.safeParse({ ...values, landingId })

    if (!parsed.success) {
      const fieldErrors: LandingFormState["fieldErrors"] = {}
      for (const issue of marketplaceInputIssues(parsed.error)) fieldErrors[issue.field as MarketplaceLandingFormField] = issue.message
      return keep("invalid", FIX_LANDING_FIELDS, fieldErrors)
    }

    savedId = (await pilotMarketplaceV2.saveLanding(viewer, { ...values, landingId })).landingId
  } catch (error) {
    // A redirect to sign-in (or out of V2) is navigation, not an error to show.
    unstable_rethrow(error)

    if (error instanceof MarketplaceOperationUnavailableError) {
      return keep("unavailable", LANDING_SAVE_UNAVAILABLE)
    }

    if (error instanceof MarketplaceRefusalError && error.message === LANDING_BILLING_INACTIVE_REFUSAL) {
      return keep("billing_inactive", error.message)
    }

    if (error instanceof MarketplaceRefusalError && /Pause another landing or see plans/.test(error.message)) {
      return keep("at_cap", error.message)
    }

    return keep("refused", message(error))
  }

  revalidatePath("/v2", "layout")
  redirect(`${LANDINGS_PATH}?saved=${encodeURIComponent(savedId)}`)
}

/** Pause, archive, restore or start recruiting (one landing, one status). Back to the list with the outcome. */
export async function setLandingStatusAction(formData: FormData): Promise<void> {
  const landingId = field(formData, "landingId").trim()
  const status = marketplaceLandingStatusSchema.safeParse(field(formData, "status"))
  const viewer = await sessionViewer(LANDINGS_PATH)
  const landing = UUID.test(landingId) ? landingId : ""
  let outcome: Record<string, string>

  try {
    await checkRateLimit("marketplace-landing", viewer.userId, 60, HOUR_MS)

    if (!status.success || !landing) {
      throw new MarketplaceRefusalError("That landing was not found")
    }

    await pilotMarketplaceV2.setLandingStatus(viewer, landing, status.data)
    outcome = { landing, updated: status.data }
  } catch (error) {
    if (error instanceof MarketplaceOperationUnavailableError) {
      outcome = { landing, unavailable: "status" }
    } else if (error instanceof MarketplaceRefusalError && (error.message === LANDING_BILLING_INACTIVE_REFUSAL || /Pause another landing or see plans/.test(error.message))) {
      outcome = { cap: "1", error: error.message, landing }
    } else {
      outcome = { error: message(error), landing }
    }
  }

  revalidatePath("/v2", "layout")
  redirect(`${LANDINGS_PATH}?${new URLSearchParams(Object.entries(outcome).filter(([, value]) => value)).toString()}`)
}

/** B1: set up a landing business owned by the signed-in person. */
export async function createLandingOrganizationAction(_previous: OrganizationFormState, formData: FormData): Promise<OrganizationFormState> {
  const values = { displayName: field(formData, "displayName").slice(0, 400), homeState: field(formData, "homeState").slice(0, 40) }
  const keep = (outcome: OrganizationFormState["outcome"], text: string, fieldErrors: OrganizationFormState["fieldErrors"] = {}): OrganizationFormState =>
    ({ createdName: null, fieldErrors, message: text, outcome, values })

  if (!marketplaceV2Enabled()) {
    redirect("/")
  }

  const actor = await getSessionActor()

  if (!actor) {
    redirect(`/sign-in?next=${encodeURIComponent("/v2/start/landing")}`)
  }

  const parsed = landingOrganizationInputSchema.safeParse(values)

  if (!parsed.success) {
    const fieldErrors: OrganizationFormState["fieldErrors"] = {}
    for (const issue of marketplaceInputIssues(parsed.error)) fieldErrors[issue.field as "displayName" | "homeState"] = issue.message
    return keep("invalid", "Check the highlighted fields. Nothing was saved yet.", fieldErrors)
  }

  try {
    await checkRateLimit("marketplace-organization", actor.profile.id, 5, HOUR_MS)
    await pilotMarketplaceV2.createLandingOrganization({ userId: actor.profile.id }, values)
  } catch (error) {
    if (error instanceof MarketplaceOperationUnavailableError) {
      return keep("unavailable", ORGANIZATION_SETUP_UNAVAILABLE)
    }

    return keep("refused", message(error))
  }

  revalidatePath("/v2", "layout")
  return { createdName: parsed.data.displayName, fieldErrors: {}, message: null, outcome: "created", values: { displayName: "", homeState: "" } }
}
