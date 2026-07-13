import "server-only"

/**
 * Outbound email through Resend, activated by RESEND_API_KEY. Without the key,
 * delivery is skipped and the caller's in-app notification remains the record —
 * never pretend an email was sent.
 */
export interface OutboundEmail {
  to: string
  subject: string
  text: string
}

export function isEmailDeliveryEnabled(): boolean {
  return Boolean(process.env.RESEND_API_KEY)
}

export async function deliverEmail(email: OutboundEmail): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY

  if (!apiKey) {
    return false
  }

  const from = process.env.RESEND_FROM?.trim()
    || process.env.LOGLOADS_EMAIL_FROM?.trim()
    || "LogLoads <notifications@logloads.com>"
  const replyTo = process.env.RESEND_REPLY_TO?.trim()
    || process.env.SUPPORT_EMAIL?.trim()
    || process.env.LOGLOADS_EMAIL_REPLY_TO?.trim()
    || "support@logloads.com"

  try {
    const response = await fetch("https://api.resend.com/emails", {
      body: JSON.stringify({
        from,
        reply_to: replyTo,
        subject: email.subject,
        text: email.text,
        to: [email.to]
      }),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      method: "POST",
      signal: AbortSignal.timeout(8000)
    })

    if (!response.ok) {
      console.error(`logloads: email delivery rejected (${response.status})`)

      return false
    }

    return true
  } catch (error) {
    console.error("logloads: email delivery failed", error)

    return false
  }
}
