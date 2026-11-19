"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"

import { clearRevealPauseInputSchema } from "@logloads/contracts"

import { clearRevealPauseForSession } from "@/lib/marketplace-v2/disclosure/load"

import { REVEAL_PAUSES_ANCHOR, revealPauseNoticeFor } from "./_lib/reveal-pause-notice"

const PATH = "/admin/reports"

/**
 * A moderator clears one phone-reveal pause from the moderation screen (#403). The person is the server session's
 * own; the database checks the moderator role and records the reason on the audit row. The redirect carries only a
 * fixed notice code, never the reason or any store text.
 */
export async function clearRevealPauseAction(formData: FormData): Promise<void> {
  const parsed = clearRevealPauseInputSchema.safeParse({ pauseId: formData.get("pauseId"), reason: formData.get("reason") })
  const notice = parsed.success ? revealPauseNoticeFor(await clearRevealPauseForSession(parsed.data)) : "reason"

  revalidatePath(PATH)
  redirect(`${PATH}?pause=${notice}#${REVEAL_PAUSES_ANCHOR}`)
}
