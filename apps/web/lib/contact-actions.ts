"use server"

import { deliverEmail } from "./notify"
import { checkRateLimit, requestClientKey } from "./rate-limit"
import { mutateState, serializeError } from "./services"

/** Platform admin seed user; contact inquiries land in their notifications. */
const PLATFORM_ADMIN_USER_ID = "11111111-1111-4111-8111-111111111111"
const CONTACT_INBOX = process.env.LOGLOADS_CONTACT_EMAIL ?? "support@logloads.com"

export interface ContactFormState {
  ok: boolean
  error: string | null
}

export async function submitContactInquiryAction(
  _previous: ContactFormState,
  formData: FormData
): Promise<ContactFormState> {
  const name = String(formData.get("name") ?? "").trim().slice(0, 200)
  const email = String(formData.get("email") ?? "").trim().slice(0, 200)
  const organization = String(formData.get("organization") ?? "").trim().slice(0, 200)
  const message = String(formData.get("message") ?? "").trim().slice(0, 4000)

  if (!name || !email || !message) {
    return { error: "Add your name, email, and a short message so we can follow up.", ok: false }
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: "That email address does not look right. Check it and try again.", ok: false }
  }

  try {
    await checkRateLimit("contact", await requestClientKey(), 5, 60 * 60_000)
  } catch (error) {
    return { error: serializeError(error).error, ok: false }
  }

  const bodyLines = [
    `From: ${name} <${email}>`,
    organization ? `Organization: ${organization}` : null,
    "",
    message
  ].filter((line): line is string => line !== null)

  try {
    await mutateState((draft) =>
      draft.createNotification({
        body: bodyLines.join("\n"),
        relatedEntityType: "contact_inquiry",
        title: `Contact inquiry from ${name}`,
        type: "system_alert",
        userId: PLATFORM_ADMIN_USER_ID
      })
    )
  } catch {
    return { error: "We could not send your message just now. Try again in a moment.", ok: false }
  }

  // Email delivery activates with RESEND_API_KEY; the in-app record above is the
  // source of truth either way.
  void deliverEmail({
    subject: `LogLoads contact inquiry from ${name}`,
    text: bodyLines.join("\n"),
    to: CONTACT_INBOX
  })

  return { error: null, ok: true }
}
