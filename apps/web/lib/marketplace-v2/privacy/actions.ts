"use server"

import { MARKETPLACE_PRIVACY_DETAILS_MAX, MARKETPLACE_PRIVACY_REQUEST_ADDRESS, MARKETPLACE_PRIVACY_REQUEST_KINDS } from "@logloads/contracts"

import { checkRateLimit } from "../../rate-limit"
import { v2FailureMessage } from "../error-log"
import { marketplaceV2Enabled } from "../flag"
import { getV2SessionActor } from "../v2-session"
import type { PrivacyRequestFormState } from "./form-state"
import { privacyRequestStore } from "./index"
import { submitPrivacyRequest } from "./requests"

/**
 * The in-app privacy request (#343, legal review §6.6 item 1): the form in account settings (spec §5.10, drawn in
 * #336) posts here. The person is the session's; the form supplies only the kind, optional details and its own
 * submission id. A privacy request is about the person, not a business, so no business needs to be selected. The
 * answer is state for the form (`useActionState`), so the person's words stay in it when nothing was stored.
 */

const HOUR_MS = 60 * 60_000
/** Requests per person per hour: enough to ask for every kind, too few to flood the staff queue. */
const PRIVACY_RATE_LIMIT = { bucket: "marketplace-privacy-request", limit: 5 } as const

const BY_EMAIL = `email ${MARKETPLACE_PRIVACY_REQUEST_ADDRESS} from the address on your account, and we'll answer within 45 days`
const UNAVAILABLE = `Requests in the app aren't connected yet, so nothing was sent. Instead, ${BY_EMAIL}.`

function field(formData: FormData, name: string): string {
  const value = formData.get(name)
  return typeof value === "string" ? value : ""
}

export async function submitPrivacyRequestAction(_previous: PrivacyRequestFormState, formData: FormData): Promise<PrivacyRequestFormState> {
  const kindField = field(formData, "kind")
  const kept = {
    details: field(formData, "details").slice(0, MARKETPLACE_PRIVACY_DETAILS_MAX * 2),
    // Only a known kind is echoed back into the form.
    kind: (MARKETPLACE_PRIVACY_REQUEST_KINDS as readonly string[]).includes(kindField) ? kindField : ""
  }

  if (!marketplaceV2Enabled()) {
    return { ...kept, message: "This page is not available.", status: "error" }
  }

  const actor = await getV2SessionActor()

  if (!actor) {
    return { ...kept, message: `Sign in to make a privacy request, or ${BY_EMAIL}.`, status: "error" }
  }

  const store = privacyRequestStore()

  if (!store) {
    return { ...kept, message: UNAVAILABLE, status: "unavailable" }
  }

  try {
    await checkRateLimit(PRIVACY_RATE_LIMIT.bucket, actor.profile.id, PRIVACY_RATE_LIMIT.limit, HOUR_MS)

    const result = await submitPrivacyRequest(
      store,
      { userId: actor.profile.id },
      { details: kept.details, kind: kindField, submissionId: field(formData, "submissionId") }
    )

    return { alreadyOpen: result.alreadyOpen, receipt: result.receipt, status: "sent" }
  } catch (error) {
    // A refusal keeps its words; anything else is logged and answered with fixed copy and a reference (#279).
    return { ...kept, message: v2FailureMessage(error, "privacy.request"), status: "error" }
  }
}
