"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"

import {
  haulerAvailabilityInputSchema,
  haulerEquipmentAddInputSchema,
  haulerEquipmentCountInputSchema
} from "@logloads/contracts"
import type { z } from "zod"

import { checkRateLimit } from "../rate-limit"
import { V2_FAULT_CODES } from "./error-codes"
import { reportV2Error } from "./error-log"
import { fleetAnswerQuery, TRUCKS_PATH, type FleetForm, type FleetNotice, type FleetOutcome } from "./fleet-page"
import { marketplaceV2Enabled } from "./flag"
import { pilotMarketplaceV2 } from "./pilot-adapter"
import { type MarketplaceV2Viewer } from "./port"
import { getV2SessionActor } from "./v2-session"

/**
 * "My trucks" form actions (#126). Identity and the acting business come from the server session only; the forms
 * post truck types, counts and dates. Each answers with a redirect back to the page carrying the outcome and, unless
 * saved, what was posted, so nothing typed is lost. Nothing is reported as saved unless the store saved it. The
 * answer is codes, never words (#279): the page shows the fixed copy for them (`fleet-page.ts`).
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
    redirect(`${TRUCKS_PATH}?${fleetAnswerQuery("add", "refused", { failure: { code: "choose_business", requestId: null } }, {}, setup)}`)
  }

  return { organizationId: actor.activeOrganization.id, userId: actor.profile.id }
}

type Saved = Exclude<FleetNotice, { failure: unknown } | null>

async function run(form: FleetForm, formData: FormData, posted: Record<string, string | string[]>, work: (viewer: MarketplaceV2Viewer) => Promise<Saved>): Promise<never> {
  const setup = formData.get("setup") === "1"
  const viewer = await requireViewer(setup)
  let outcome: FleetOutcome = "saved"
  let notice: FleetNotice = null

  try {
    await checkRateLimit("marketplace-hauler-fleet", viewer.userId, 60, 60 * 60_000)
    notice = await work(viewer)
  } catch (error) {
    // The form's own validation names its first issue; anything else is the store's or LogLoads' answer.
    const failure = reportV2Error(error instanceof InvalidPost ? error.issues : error, `fleet.${form}`)
    outcome = failure.code === "unavailable" ? "unavailable" : V2_FAULT_CODES.has(failure.code) ? "error" : error instanceof InvalidPost ? "invalid" : "refused"
    notice = { failure }
  }

  if (outcome === "saved") {
    revalidatePath("/v2", "layout")
  }

  redirect(`${TRUCKS_PATH}?${fleetAnswerQuery(form, outcome, notice, posted, setup)}#${form === "availability" ? `availability-${String(posted.equipmentCode ?? "")}` : form === "add" ? "add-equipment" : "fleet-notice"}`)
}

/** The form failed its contract schema: carries the Zod error, whose first known issue becomes the answer's code. */
class InvalidPost extends Error {
  constructor(readonly issues: z.ZodError) {
    super("The posted form did not pass validation")
    this.name = "InvalidPost"
  }
}

function parseOrThrow<S extends z.ZodTypeAny>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value)

  if (!result.success) {
    throw new InvalidPost(result.error)
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
    return { saved: "added" }
  })
}

export async function setHaulerEquipmentCountAction(formData: FormData): Promise<void> {
  const posted = { count: field(formData, "count"), unitId: field(formData, "unitId") }

  await run("count", formData, posted, async (viewer) => {
    const input = parseOrThrow(haulerEquipmentCountInputSchema, posted)
    await pilotMarketplaceV2.setHaulerEquipmentCount(viewer, input)
    return { saved: input.count === 0 ? "removed" : "count_updated" }
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
    return { saved: input.state === "none" ? "not_available" : "availability_saved" }
  })
}

export async function confirmHaulerAvailabilityAction(formData: FormData): Promise<void> {
  await run("confirm", formData, {}, async (viewer) => {
    const { confirmed } = await pilotMarketplaceV2.confirmHaulerAvailability(viewer)
    return confirmed === 0 ? { saved: "nothing_to_confirm" } : { confirmed, saved: "confirmed" }
  })
}
