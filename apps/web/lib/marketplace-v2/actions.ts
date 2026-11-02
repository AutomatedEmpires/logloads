"use server"

import { randomUUID } from "node:crypto"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"

import { checkRateLimit } from "../rate-limit"
import { serializeError } from "../services"
import { getSessionActor } from "../session"
import { marketplaceV2Enabled } from "./flag"
import { pilotMarketplaceV2 } from "./pilot-adapter"
import type { MarketplaceV2Viewer } from "./port"

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
      availableFrom: field(formData, "availableFrom") || null,
      contactPreference: field(formData, "contactPreference") || "in_app",
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
