"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"

import {
  haulerAvailabilityInputSchema,
  haulerEquipmentAddInputSchema,
  haulerEquipmentCountInputSchema
} from "@logloads/contracts"
import { DomainRefusalError } from "@logloads/services"
import type { z } from "zod"

import { checkRateLimit } from "../rate-limit"
import { FLEET_SAVE_FAILED, FLEET_SAVE_UNAVAILABLE, fleetAnswerQuery, TRUCKS_PATH, type FleetForm, type FleetOutcome } from "./fleet-page"
import { marketplaceV2Enabled } from "./flag"
import { pilotMarketplaceV2 } from "./pilot-adapter"
import { MarketplaceOperationUnavailableError, MarketplaceRefusalError, type MarketplaceV2Viewer } from "./port"
import { getV2SessionActor } from "./v2-session"

/**
 * "My trucks" form actions (#126). Identity and the acting business come from the server session only; the forms
 * post truck types, counts and dates. Each answers with a redirect back to the page carrying the outcome and, unless
 * saved, what was posted, so nothing typed is lost. Nothing is reported as saved unless the store saved it.
 */

function field(formData: FormData, name: string): string {
  const value = formData.get(name)
  return typeof value === "string" ? value.slice(0, 200) : ""
}

async function requireViewer(setup: boolean): Promise<MarketplaceV2Viewer> {
  if (!marketplaceV2Enabled()) {
    redirect("/")
  }

  const actor = await getV2SessionActor()

  if (!actor) {
    redirect(`/sign-in?next=${encodeURIComponent(setup ? `${TRUCKS_PATH}?setup=1` : TRUCKS_PATH)}`)
  }

  if (!actor.activeOrganization || actor.workspaceSelectionInvalid) {
    redirect(`${TRUCKS_PATH}?${fleetAnswerQuery("add", "refused", "No business is selected for your account.", {}, setup)}`)
  }

  return { organizationId: actor.activeOrganization.id, userId: actor.profile.id }
}

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Fix the highlighted fields before saving"
}

async function run(form: FleetForm, formData: FormData, posted: Record<string, string | string[]>, work: (viewer: MarketplaceV2Viewer) => Promise<string | null>): Promise<never> {
  const setup = formData.get("setup") === "1"
  const viewer = await requireViewer(setup)
  let outcome: FleetOutcome = "saved"
  let message: string | null = null

  try {
    await checkRateLimit("marketplace-hauler-fleet", viewer.userId, 60, 60 * 60_000)
    message = await work(viewer)
  } catch (error) {
    if (error instanceof MarketplaceOperationUnavailableError) {
      outcome = "unavailable"
      message = FLEET_SAVE_UNAVAILABLE
    } else if (error instanceof MarketplaceRefusalError || error instanceof DomainRefusalError) {
      outcome = "refused"
      message = error.message
    } else if (error instanceof InvalidPost) {
      outcome = "invalid"
      message = error.message
    } else {
      outcome = "error"
      message = FLEET_SAVE_FAILED
    }
  }

  if (outcome === "saved") {
    revalidatePath("/v2", "layout")
  }

  redirect(`${TRUCKS_PATH}?${fleetAnswerQuery(form, outcome, message, posted, setup)}#${form === "availability" ? `availability-${String(posted.equipmentCode ?? "")}` : form === "add" ? "add-equipment" : "fleet-notice"}`)
}

class InvalidPost extends Error {}

function parseOrThrow<S extends z.ZodTypeAny>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value)

  if (!result.success) {
    throw new InvalidPost(firstIssue(result.error))
  }

  return result.data
}

export async function addHaulerEquipmentAction(formData: FormData): Promise<void> {
  const posted = {
    attachments: formData.getAll("attachments").filter((value): value is string => typeof value === "string").slice(0, 10),
    count: field(formData, "count"),
    otherTrailer: field(formData, "otherTrailer"),
    trailer: field(formData, "trailer"),
    truckCode: field(formData, "truckCode")
  }

  await run("add", formData, posted, async (viewer) => {
    await pilotMarketplaceV2.addHaulerEquipment(viewer, parseOrThrow(haulerEquipmentAddInputSchema, posted))
    return "Added to your trucks."
  })
}

export async function setHaulerEquipmentCountAction(formData: FormData): Promise<void> {
  const posted = { count: field(formData, "count"), unitId: field(formData, "unitId") }

  await run("count", formData, posted, async (viewer) => {
    const input = parseOrThrow(haulerEquipmentCountInputSchema, posted)
    await pilotMarketplaceV2.setHaulerEquipmentCount(viewer, input)
    return input.count === 0 ? "Removed from your trucks." : "Count updated. Availability never shows more than you list."
  })
}

export async function reportHaulerAvailabilityAction(formData: FormData): Promise<void> {
  const posted = { count: field(formData, "count"), equipmentCode: field(formData, "equipmentCode"), fromDate: field(formData, "fromDate"), state: field(formData, "state") }

  await run("availability", formData, posted, async (viewer) => {
    const input = parseOrThrow(haulerAvailabilityInputSchema, {
      count: posted.state === "none" || posted.count === "" ? null : posted.count,
      equipmentCode: posted.equipmentCode,
      fromDate: posted.state === "from" && posted.fromDate ? posted.fromDate : null,
      state: posted.state
    })
    await pilotMarketplaceV2.reportHaulerAvailability(viewer, input)
    // A withdrawn report is never shown to landings (availability_read), so neither message promises they see it.
    return input.state === "none" ? "Saved as not available, dated today." : "Availability saved, dated today."
  })
}

export async function confirmHaulerAvailabilityAction(formData: FormData): Promise<void> {
  await run("confirm", formData, {}, async (viewer) => {
    const { confirmed } = await pilotMarketplaceV2.confirmHaulerAvailability(viewer)
    return confirmed === 0 ? "Nothing to confirm: set each truck type's availability first." : `Confirmed ${confirmed} truck type${confirmed === 1 ? "" : "s"} as shown, dated today.`
  })
}
