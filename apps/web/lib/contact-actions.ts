"use server"

import { persistState, services } from "./services"

/** Platform admin seed user; contact inquiries land in their notifications. */
const PLATFORM_ADMIN_USER_ID = "11111111-1111-4111-8111-111111111111"

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

  const bodyLines = [
    `From: ${name} <${email}>`,
    organization ? `Organization: ${organization}` : null,
    "",
    message
  ].filter((line): line is string => line !== null)

  try {
    services.createNotification({
      body: bodyLines.join("\n"),
      relatedEntityType: "contact_inquiry",
      title: `Contact inquiry from ${name}`,
      type: "system_alert",
      userId: PLATFORM_ADMIN_USER_ID
    })
    persistState()
  } catch {
    return { error: "We could not send your message just now. Try again in a moment.", ok: false }
  }

  return { error: null, ok: true }
}
