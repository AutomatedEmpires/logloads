"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"

import { phoneShareInputSchema } from "@logloads/contracts"

import { sharePhoneForSession } from "@/lib/marketplace-v2/disclosure/load"
import { v2ErrorQuery } from "@/lib/marketplace-v2/error-codes"
import { reportV2Error } from "@/lib/marketplace-v2/error-log"
import { marketplaceV2Enabled } from "@/lib/marketplace-v2/flag"
import { getV2SessionActor } from "@/lib/marketplace-v2/v2-session"
import { checkRateLimit } from "@/lib/rate-limit"

const PATH = "/v2/landing/inquiries"

/** Show my number (flow C, C4): the landing's number to the one hauling business on this replied inquiry (#403). */
export async function sharePhoneAction(formData: FormData): Promise<void> {
  await phoneAction(formData, true)
}

/** Hide my number (flow C, C5): the hauling business stops reading it at once. */
export async function hidePhoneAction(formData: FormData): Promise<void> {
  await phoneAction(formData, false)
}

function back(query: Record<string, string>): never {
  redirect(`${PATH}?${new URLSearchParams(query).toString()}#conversation`)
}

/**
 * The person and the business come from the server session only; the form supplies the inquiry id. The answer is a
 * fixed code in the redirect: `phone_shared`, `phone_not_shared` (for any reason, never said), `phone_hidden`, or an
 * error code. The number itself never travels in a URL, a log or an event.
 */
async function phoneAction(formData: FormData, share: boolean): Promise<void> {
  if (!marketplaceV2Enabled()) redirect("/")

  const actor = await getV2SessionActor()

  if (!actor) redirect(`/sign-in?next=${encodeURIComponent(PATH)}`)

  const parsed = phoneShareInputSchema.safeParse({ interestId: formData.get("interestId") })

  if (!parsed.success) back(v2ErrorQuery({ code: "inquiry_not_found", requestId: null }))

  const { interestId } = parsed.data

  if (actor.workspaceSelectionInvalid || !actor.activeOrganization) {
    back({ ...v2ErrorQuery({ code: "choose_business", requestId: null }), inquiry: interestId })
  }

  try {
    await checkRateLimit("marketplace-phone-share", actor.profile.id, 60, 60 * 60_000)
  } catch (error) {
    back({ ...v2ErrorQuery(reportV2Error(error, share ? "disclosure.show_phone" : "disclosure.hide_phone")), inquiry: interestId })
  }

  const outcome = await sharePhoneForSession(actor.activeOrganization.id, interestId, share)

  revalidatePath("/v2", "layout")

  if (outcome.kind === "refused") {
    back({ ...v2ErrorQuery({ code: outcome.message === "Inquiry not found" ? "inquiry_not_found" : "not_allowed", requestId: null }), inquiry: interestId })
  }

  if (outcome.kind === "failed") {
    back({ ...v2ErrorQuery({ code: "unexpected", requestId: outcome.requestId }), inquiry: interestId })
  }

  back({ inquiry: interestId, updated: UPDATED[outcome.kind] })
}

const UPDATED = { hidden: "phone_hidden", not_shared: "phone_not_shared", shared: "phone_shared" } as const
