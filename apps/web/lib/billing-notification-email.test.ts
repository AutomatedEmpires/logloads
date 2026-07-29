import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import {
  deliverClaimedBillingNotificationEmail,
  isBillingNotificationEmailDeliveryEnabled
} from "./billing-notification-email"

const NOTIFICATION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"

const claimedNotification = {
  body: "Your Network subscription payment needs attention.",
  claimToken: "billing-cron-attempt-1",
  notificationId: NOTIFICATION_ID,
  recipientEmail: "billing@example.com",
  title: "Subscription payment needs attention"
}

const configuredEnvironment = {
  RESEND_API_KEY: " re_test_logloads ",
  RESEND_FROM: " LogLoads <notifications@logloads.com> ",
  RESEND_REPLY_TO: " billing@logloads.com "
}

function resendSuccess(id = "email_123"): Response {
  return Response.json({ id }, { status: 200 })
}

function requestHeaders(
  request: ReturnType<typeof vi.fn>,
  callIndex = 0
): Headers {
  const [, init] = request.mock.calls[callIndex] as [
    string,
    RequestInit
  ]

  return new Headers(init.headers)
}

function requestBody(
  request: ReturnType<typeof vi.fn>,
  callIndex = 0
): Record<string, unknown> {
  const [, init] = request.mock.calls[callIndex] as [
    string,
    RequestInit
  ]

  return JSON.parse(String(init.body)) as Record<string, unknown>
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("billing notification email delivery", () => {
  it("stays disabled unless both an API key and explicit sender are configured", async () => {
    const request = vi.fn()
    vi.stubGlobal("fetch", request)

    expect(isBillingNotificationEmailDeliveryEnabled({})).toBe(false)
    expect(
      isBillingNotificationEmailDeliveryEnabled({
        RESEND_API_KEY: "re_test"
      })
    ).toBe(false)
    expect(
      isBillingNotificationEmailDeliveryEnabled({
        RESEND_FROM: "LogLoads <notifications@logloads.com>"
      })
    ).toBe(false)
    expect(
      isBillingNotificationEmailDeliveryEnabled(configuredEnvironment)
    ).toBe(true)

    await expect(
      deliverClaimedBillingNotificationEmail(claimedNotification, {
        RESEND_API_KEY: "re_test"
      })
    ).resolves.toEqual({
      outcome: "disabled",
      reason: "Billing notification email delivery is not configured."
    })
    expect(request).not.toHaveBeenCalled()
  })

  it("uses the canonical Resend identities and returns only the validated provider id", async () => {
    const request = vi.fn(async () => resendSuccess())
    vi.stubGlobal("fetch", request)

    await expect(
      deliverClaimedBillingNotificationEmail(
        claimedNotification,
        configuredEnvironment
      )
    ).resolves.toEqual({
      outcome: "delivered",
      providerMessageId: "email_123"
    })

    expect(request).toHaveBeenCalledOnce()
    const [requestUrl] = request.mock.calls[0] as unknown as [
      string,
      RequestInit
    ]

    expect(requestUrl).toBe("https://api.resend.com/emails")
    expect(requestHeaders(request).get("Authorization")).toBe(
      "Bearer re_test_logloads"
    )
    expect(requestBody(request)).toEqual({
      from: "LogLoads <notifications@logloads.com>",
      reply_to: "billing@logloads.com",
      subject: claimedNotification.title,
      text: claimedNotification.body,
      to: [claimedNotification.recipientEmail]
    })
  })

  it("keeps one short idempotency key stable across worker reclaims", async () => {
    const request = vi.fn(async () => resendSuccess())
    vi.stubGlobal("fetch", request)

    await deliverClaimedBillingNotificationEmail(
      claimedNotification,
      configuredEnvironment
    )
    await deliverClaimedBillingNotificationEmail(
      {
        ...claimedNotification,
        claimToken: "billing-cron-attempt-2"
      },
      configuredEnvironment
    )

    const firstKey = requestHeaders(request, 0).get("Idempotency-Key")
    const secondKey = requestHeaders(request, 1).get("Idempotency-Key")

    expect(firstKey).toBe(`logloads:billing-notification:${NOTIFICATION_ID}`)
    expect(secondKey).toBe(firstKey)
    expect(firstKey?.length).toBeLessThanOrEqual(256)
  })

  it("keeps the established legacy sender and reply-to fallbacks", async () => {
    const request = vi.fn(async () => resendSuccess())
    vi.stubGlobal("fetch", request)

    const result = await deliverClaimedBillingNotificationEmail(
      claimedNotification,
      {
        LOGLOADS_EMAIL_FROM: " LogLoads <legacy@logloads.com> ",
        LOGLOADS_EMAIL_REPLY_TO: " legacy-replies@logloads.com ",
        RESEND_API_KEY: "re_test"
      }
    )

    expect(result.outcome).toBe("delivered")
    expect(requestBody(request)).toEqual(
      expect.objectContaining({
        from: "LogLoads <legacy@logloads.com>",
        reply_to: "legacy-replies@logloads.com"
      })
    )
  })

  it("refuses invalid claimed notification data before issuing a request", async () => {
    const request = vi.fn(async () => resendSuccess())
    vi.stubGlobal("fetch", request)

    const result = await deliverClaimedBillingNotificationEmail(
      {
        ...claimedNotification,
        recipientEmail: "not-an-email",
        title: "Injected\r\nBcc: attacker@example.com"
      },
      configuredEnvironment
    )

    expect(result).toEqual({
      outcome: "failed",
      reason: "The claimed billing notification email is invalid."
    })
    expect(request).not.toHaveBeenCalled()
  })

  it("rejects malformed success confirmations without inventing delivery", async () => {
    const request = vi.fn(async () =>
      Response.json({ id: "" }, { status: 200 })
    )
    vi.stubGlobal("fetch", request)

    await expect(
      deliverClaimedBillingNotificationEmail(
        claimedNotification,
        configuredEnvironment
      )
    ).resolves.toEqual({
      outcome: "failed",
      reason: "The billing email provider returned an invalid confirmation."
    })
  })

  it("never exposes provider response bodies or thrown error messages", async () => {
    const rejected = vi.fn(async () =>
      Response.json(
        {
          message:
            "Authorization re_secret and recipient customer@example.com were rejected"
        },
        { status: 400 }
      )
    )
    vi.stubGlobal("fetch", rejected)

    const rejection = await deliverClaimedBillingNotificationEmail(
      claimedNotification,
      configuredEnvironment
    )

    expect(rejection).toEqual({
      outcome: "failed",
      reason: "The billing email provider rejected the request."
    })
    expect(JSON.stringify(rejection)).not.toContain("re_secret")
    expect(JSON.stringify(rejection)).not.toContain("customer@example.com")

    const failedRequest = vi.fn(async () => {
      throw new Error(
        "Socket failed with Authorization: Bearer re_secret_logloads"
      )
    })
    vi.stubGlobal("fetch", failedRequest)

    const failure = await deliverClaimedBillingNotificationEmail(
      claimedNotification,
      configuredEnvironment
    )

    expect(failure).toEqual({
      outcome: "failed",
      reason: "Billing email delivery failed before provider confirmation."
    })
    expect(JSON.stringify(failure)).not.toContain("re_secret")
  })

  it("classifies rate limits and provider outages as sanitized transient failures", async () => {
    const request = vi.fn(async () =>
      Response.json({ message: "rate limited" }, { status: 429 })
    )
    vi.stubGlobal("fetch", request)

    await expect(
      deliverClaimedBillingNotificationEmail(
        claimedNotification,
        configuredEnvironment
      )
    ).resolves.toEqual({
      outcome: "failed",
      reason: "The billing email provider is temporarily unavailable."
    })
  })
})
