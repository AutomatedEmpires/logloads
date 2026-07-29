import "server-only"

import { z } from "zod"

const RESEND_EMAIL_ENDPOINT = "https://api.resend.com/emails"
const RESEND_TIMEOUT_MS = 8_000
const MAX_PROVIDER_MESSAGE_ID_LENGTH = 200

const claimedBillingNotificationEmailSchema = z
  .object({
    body: z
      .string()
      .trim()
      .min(1)
      .max(10_000)
      .refine((value) => !value.includes("\0"), {
        message: "Notification body cannot contain a null byte"
      }),
    claimToken: z.string().trim().min(1).max(200),
    notificationId: z.string().uuid(),
    recipientEmail: z.string().trim().email().max(320),
    title: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .refine((value) => !/[\r\n]/.test(value), {
        message: "Notification title cannot contain a line break"
      })
  })
  .strict()

const resendSuccessSchema = z.object({
  id: z
    .string()
    .trim()
    .min(1)
    .max(MAX_PROVIDER_MESSAGE_ID_LENGTH)
    .regex(/^[A-Za-z0-9_-]+$/)
})

export interface ClaimedBillingNotificationEmail {
  body: string
  claimToken: string
  notificationId: string
  recipientEmail: string
  title: string
}

export type BillingNotificationEmailDeliveryResult =
  | {
      outcome: "delivered"
      providerMessageId: string
    }
  | {
      outcome: "disabled" | "failed"
      reason: string
    }

type BillingNotificationEmailEnvironment = Readonly<
  Record<string, string | undefined>
>

interface BillingNotificationEmailConfig {
  apiKey: string
  from: string
  replyTo: string
}

function resolveBillingNotificationEmailConfig(
  environment: BillingNotificationEmailEnvironment
): BillingNotificationEmailConfig | null {
  const apiKey = environment.RESEND_API_KEY?.trim()
  const from =
    environment.RESEND_FROM?.trim() ||
    environment.LOGLOADS_EMAIL_FROM?.trim()

  if (!apiKey || !from) {
    return null
  }

  return {
    apiKey,
    from,
    replyTo:
      environment.RESEND_REPLY_TO?.trim() ||
      environment.SUPPORT_EMAIL?.trim() ||
      environment.LOGLOADS_EMAIL_REPLY_TO?.trim() ||
      "support@logloads.com"
  }
}

export function isBillingNotificationEmailDeliveryEnabled(
  environment: BillingNotificationEmailEnvironment = process.env
): boolean {
  return resolveBillingNotificationEmailConfig(environment) !== null
}

/**
 * A notification id identifies one business email for its whole lifetime.
 * Reclaims intentionally reuse this provider key so an ambiguous prior response
 * cannot turn a new worker claim into a duplicate customer email.
 */
function billingNotificationIdempotencyKey(notificationId: string): string {
  return `logloads:billing-notification:${notificationId}`
}

function failed(reason: string): BillingNotificationEmailDeliveryResult {
  return { outcome: "failed", reason }
}

/**
 * Delivers one already-claimed billing outbox row.
 *
 * The result stays provider-neutral so the caller can mark its canonical claim
 * delivered or failed without persisting a Resend response body. Provider
 * errors and thrown exception messages are deliberately never returned.
 */
export async function deliverClaimedBillingNotificationEmail(
  input: ClaimedBillingNotificationEmail,
  environment: BillingNotificationEmailEnvironment = process.env
): Promise<BillingNotificationEmailDeliveryResult> {
  const config = resolveBillingNotificationEmailConfig(environment)

  if (!config) {
    return {
      outcome: "disabled",
      reason: "Billing notification email delivery is not configured."
    }
  }

  const parsed = claimedBillingNotificationEmailSchema.safeParse(input)

  if (!parsed.success) {
    return failed("The claimed billing notification email is invalid.")
  }

  const idempotencyKey = billingNotificationIdempotencyKey(
    parsed.data.notificationId
  )

  try {
    const response = await fetch(RESEND_EMAIL_ENDPOINT, {
      body: JSON.stringify({
        from: config.from,
        reply_to: config.replyTo,
        subject: parsed.data.title,
        text: parsed.data.body,
        to: [parsed.data.recipientEmail]
      }),
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey
      },
      method: "POST",
      signal: AbortSignal.timeout(RESEND_TIMEOUT_MS)
    })

    if (!response.ok) {
      return failed(
        response.status === 429 || response.status >= 500
          ? "The billing email provider is temporarily unavailable."
          : "The billing email provider rejected the request."
      )
    }

    let responseBody: unknown

    try {
      responseBody = await response.json()
    } catch {
      return failed(
        "The billing email provider returned an invalid confirmation."
      )
    }

    const confirmation = resendSuccessSchema.safeParse(responseBody)

    if (!confirmation.success) {
      return failed(
        "The billing email provider returned an invalid confirmation."
      )
    }

    return {
      outcome: "delivered",
      providerMessageId: confirmation.data.id
    }
  } catch {
    return failed(
      "Billing email delivery failed before provider confirmation."
    )
  }
}
