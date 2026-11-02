"use server"

import { randomUUID } from "node:crypto"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"

import { validateMarketplaceJobDraft } from "@logloads/contracts"

import { checkRateLimit } from "../rate-limit"
import { serializeError } from "../services"
import { getSessionActor } from "../session"
import { marketplaceV2Enabled } from "./flag"
import { pilotMarketplaceV2 } from "./pilot-adapter"
import { MarketplaceOperationUnavailableError, type MarketplaceV2Viewer } from "./port"

/**
 * Marketplace V2 form actions. Identity and workspace always come from the server session; the form
 * supplies only the job/inquiry ids and the hauler's or landing's own words. Every write goes through
 * the port (and the service-layer authorization behind it). No dispatch, trip, invitation or fee.
 */

async function requireViewer(nextPath: string): Promise<MarketplaceV2Viewer> {
  if (!marketplaceV2Enabled()) {
    redirect("/")
  }

  const actor = await getSessionActor()

  if (!actor) {
    redirect(`/sign-in?next=${encodeURIComponent(nextPath)}`)
  }

  if (actor.workspaceSelectionInvalid || !actor.activeOrganization) {
    throw new Error("Choose a workspace before continuing")
  }

  return { organizationId: actor.activeOrganization.id, userId: actor.profile.id }
}

function field(formData: FormData, name: string): string {
  const value = formData.get(name)
  return typeof value === "string" ? value : ""
}

/**
 * Per-configuration counts from the inquiry form: parallel `equipmentKey` / `equipmentCount` fields.
 * Only keys and counts come from the form; labels and limits are resolved from the profile server-side.
 */
function equipmentLines(formData: FormData): Array<{ configurationKey: string; count: string }> {
  const keys = formData.getAll("equipmentKey")
  const counts = formData.getAll("equipmentCount")

  return keys.slice(0, 20).flatMap((key, index) => {
    const count = counts[index]
    return typeof key === "string" && typeof count === "string" && key ? [{ configurationKey: key, count: count || "0" }] : []
  })
}

function safeRedirect(path: string, query: Record<string, string>): never {
  const params = new URLSearchParams(query)
  redirect(`${path}?${params.toString()}`)
}

/** Returns a short, user-safe message (service refusals are written for end users). */
function message(error: unknown): string {
  return serializeError(error).error.slice(0, 160)
}

export async function expressInterestAction(formData: FormData): Promise<void> {
  const jobId = field(formData, "loadPostingId")
  const back = `/v2/work/${jobId}`
  const viewer = await requireViewer(back)

  try {
    await checkRateLimit("marketplace-interest", viewer.userId, 20, 60 * 60_000)
    await pilotMarketplaceV2.expressInterest(viewer, {
      availableFrom: field(formData, "availableFrom"),
      availableUntil: field(formData, "availableUntil"),
      contactPreference: field(formData, "contactPreference") || "in_app",
      equipment: equipmentLines(formData),
      loadPostingId: jobId,
      message: field(formData, "message"),
      trucksOffered: field(formData, "trucksOffered")
    })
  } catch (error) {
    safeRedirect(back, { error: message(error) })
  }

  revalidatePath("/v2", "layout")
  safeRedirect(back, { sent: "1" })
}

export async function withdrawInterestAction(formData: FormData): Promise<void> {
  const viewer = await requireViewer("/v2/inquiries")

  try {
    await pilotMarketplaceV2.withdrawInterest(viewer, field(formData, "interestId"))
  } catch (error) {
    safeRedirect("/v2/inquiries", { error: message(error) })
  }

  revalidatePath("/v2", "layout")
  safeRedirect("/v2/inquiries", { updated: "withdrawn" })
}

export async function haulerReplyAction(formData: FormData): Promise<void> {
  const viewer = await requireViewer("/v2/inquiries")

  try {
    await checkRateLimit("marketplace-reply", viewer.userId, 60, 60 * 60_000)
    await pilotMarketplaceV2.postHaulerReply(viewer, {
      body: field(formData, "body"),
      interestId: field(formData, "interestId"),
      replyId: field(formData, "replyId") || randomUUID()
    })
  } catch (error) {
    safeRedirect("/v2/inquiries", { error: message(error) })
  }

  revalidatePath("/v2", "layout")
  safeRedirect("/v2/inquiries", { updated: "reply" })
}

export async function respondToInterestAction(formData: FormData): Promise<void> {
  const viewer = await requireViewer("/v2/landing/inquiries")
  const decision = field(formData, "decision")

  try {
    await checkRateLimit("marketplace-reply", viewer.userId, 120, 60 * 60_000)
    await pilotMarketplaceV2.respondToInterest(viewer, {
      body: field(formData, "body"),
      decision,
      interestId: field(formData, "interestId"),
      replyId: field(formData, "replyId") || undefined
    })
  } catch (error) {
    safeRedirect("/v2/landing/inquiries", { error: message(error) })
  }

  revalidatePath("/v2", "layout")
  safeRedirect("/v2/landing/inquiries", { updated: decision })
}

const DRAFT_FIELDS = [
  "landingId", "title", "product", "description", "payUnit", "payAmount", "payNote", "trucksRequested", "trucksPerDay",
  "startsOn", "durationDays", "estLoadsPerTruckPerDay", "estDailyLoads", "estTonsPerLoad", "destinationLabel",
  "estOneWayMiles", "publicRoadNotes"
] as const

/** The draft as plain query parameters, so preview/edit round-trips keep everything the poster typed. */
function draftQuery(formData: FormData): Record<string, string> {
  const query: Record<string, string> = {}

  for (const name of DRAFT_FIELDS) {
    const value = field(formData, name).slice(0, 6000)
    if (value) query[name] = value
  }

  const equipment = formData.getAll("equipment").filter((value): value is string => typeof value === "string").slice(0, 11)
  if (equipment.length > 0) query.equipment = equipment.join(",")

  return query
}

/**
 * Publishing a native V2 job. Requires `job.publish`; the draft is validated again server-side. On the
 * pilot store the port refuses (no persistence yet), and the poster is returned to the preview with an
 * explanation instead of a fake success.
 */
export async function publishJobAction(formData: FormData): Promise<void> {
  const viewer = await requireViewer("/v2/landing/jobs/new")
  const query = draftQuery(formData)
  const access = await pilotMarketplaceV2.viewerAccess(viewer)

  if (!access.capabilities.includes("job.publish")) {
    safeRedirect("/v2/landing/jobs/preview", { ...query, error: "Your role cannot publish jobs for this organization" })
  }

  const parsed = validateMarketplaceJobDraft({ ...query, equipment: query.equipment ? query.equipment.split(",") : [] })

  if (!parsed.ok) {
    safeRedirect("/v2/landing/jobs/new", { ...query, error: "Fix the highlighted fields before publishing" })
  }

  let published: { jobId: string }

  try {
    published = await pilotMarketplaceV2.publishJob(viewer, parsed.draft)
  } catch (error) {
    if (error instanceof MarketplaceOperationUnavailableError) {
      safeRedirect("/v2/landing/jobs/preview", { ...query, unavailable: "publish" })
    }

    safeRedirect("/v2/landing/jobs/preview", { ...query, error: message(error) })
  }

  revalidatePath("/v2", "layout")
  safeRedirect(`/v2/work/${published.jobId}`, { published: "1" })
}

/** The poster's explicit "this work is still available" confirmation. Requires `job.publish`. */
export async function reconfirmJobAction(formData: FormData): Promise<void> {
  const viewer = await requireViewer("/v2/landing/jobs")
  const jobId = field(formData, "jobId")
  const access = await pilotMarketplaceV2.viewerAccess(viewer)

  if (!access.capabilities.includes("job.publish")) {
    safeRedirect("/v2/landing/jobs", { error: "Your role cannot confirm jobs for this organization" })
  }

  try {
    await pilotMarketplaceV2.reconfirmJob(viewer, jobId)
  } catch (error) {
    if (error instanceof MarketplaceOperationUnavailableError) {
      safeRedirect("/v2/landing/jobs", { unavailable: "reconfirm" })
    }

    safeRedirect("/v2/landing/jobs", { error: message(error) })
  }

  revalidatePath("/v2", "layout")
  safeRedirect("/v2/landing/jobs", { updated: "reconfirmed" })
}
