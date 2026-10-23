import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const mocks = vi.hoisted(() => ({
  billingNotificationEmailIsClaimable: vi.fn(),
  chargeHostInvoice: vi.fn(),
  claimBillingNotificationEmail: vi.fn(),
  deliverClaimedBillingNotificationEmail: vi.fn(),
  isBillingNotificationEmailDeliveryEnabled: vi.fn(),
  listOpenHostInvoices: vi.fn(),
  markBillingNotificationEmailDelivered: vi.fn(),
  markBillingNotificationEmailFailed: vi.fn(),
  openAllClosedPeriodInvoices: vi.fn(),
  operatingStateAccess: vi.fn(),
  platformFeeCollectionEnabled: vi.fn(),
  reconcileMissingPlatformFees: vi.fn(),
  resolveStripeBilling: vi.fn(),
  verifyExpectedStripeAccount: vi.fn()
}))

vi.mock("@logloads/services", () => ({
  BILLING_NOTIFICATION_EMAIL_MAX_ATTEMPTS: 5,
  billingNotificationEmailIsClaimable:
    mocks.billingNotificationEmailIsClaimable,
  claimBillingNotificationEmail: mocks.claimBillingNotificationEmail,
  markBillingNotificationEmailDelivered:
    mocks.markBillingNotificationEmailDelivered,
  markBillingNotificationEmailFailed:
    mocks.markBillingNotificationEmailFailed,
  openAllClosedPeriodInvoices: mocks.openAllClosedPeriodInvoices,
  reconcileMissingPlatformFees: mocks.reconcileMissingPlatformFees
}))

vi.mock("@/lib/billing-notification-email", () => ({
  deliverClaimedBillingNotificationEmail:
    mocks.deliverClaimedBillingNotificationEmail,
  isBillingNotificationEmailDeliveryEnabled:
    mocks.isBillingNotificationEmailDeliveryEnabled
}))

vi.mock("@/lib/billing", () => ({
  chargeHostInvoice: mocks.chargeHostInvoice,
  listOpenHostInvoices: mocks.listOpenHostInvoices,
  operatingStateAccess: mocks.operatingStateAccess,
  platformFeeCollectionEnabled: mocks.platformFeeCollectionEnabled,
  resolveStripeBilling: mocks.resolveStripeBilling
}))

vi.mock("@/lib/stripe-account", () => ({
  verifyExpectedStripeAccount: mocks.verifyExpectedStripeAccount
}))

import { GET } from "@/app/api/billing/cron/route"

const BILLING_NOTIFICATION_ID =
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa71"

function queuedBillingNotification(
  overrides: Record<string, unknown> = {}
) {
  return {
    body: "A billing event needs attention.",
    createdAt: "2026-07-28T00:00:00.000Z",
    emailAttemptCount: 0,
    emailClaimToken: null,
    emailClaimedAt: null,
    emailDeliveryState: "pending",
    id: BILLING_NOTIFICATION_ID,
    relatedEntityType: "host_invoice",
    title: "Billing update",
    ...overrides
  }
}

function configureBillingEmailCron(
  state: { notifications: Array<Record<string, unknown>> },
  recipientAuthorized = true
) {
  mocks.reconcileMissingPlatformFees.mockReturnValue([])
  mocks.openAllClosedPeriodInvoices.mockReturnValue([])
  mocks.listOpenHostInvoices.mockReturnValue([])
  // Billing email rides on fee collection; with no open invoice nothing is charged.
  mocks.platformFeeCollectionEnabled.mockReturnValue(true)
  mocks.operatingStateAccess.mockReturnValue({
    async mutate<T>(
      mutate: (draft: { state: typeof state }) => T | Promise<T>
    ) {
      return mutate({ state })
    },
    async read<T>(
      read: (current: typeof state) => T | Promise<T>
    ) {
      return read(state)
    }
  })
  mocks.claimBillingNotificationEmail.mockImplementation(
    (
      current: typeof state,
      input: { claimToken: string; notificationId: string },
      at: string
    ) => {
      const notification = current.notifications.find(
        (candidate) => candidate.id === input.notificationId
      )

      if (!notification) {
        throw new Error("Notification not found")
      }

      Object.assign(notification, {
        emailAttemptCount:
          Number(notification.emailAttemptCount) + 1,
        emailClaimToken: input.claimToken,
        emailClaimedAt: at,
        emailDeliveryState: "claimed"
      })

      return {
        changed: true,
        notification: { ...notification },
        recipient: recipientAuthorized
          ? {
              organizationId:
                "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
              recipientEmail: "billing@example.com"
            }
          : null,
        recipientBlockReason: recipientAuthorized
          ? null
          : "The billing notification recipient is no longer authorized."
      }
    }
  )
  mocks.markBillingNotificationEmailDelivered.mockImplementation(
    (
      current: typeof state,
      input: {
        claimToken: string
        notificationId: string
        providerMessageId: string
      }
    ) => {
      const notification = current.notifications.find(
        (candidate) => candidate.id === input.notificationId
      )!

      Object.assign(notification, {
        emailDeliveryState: "delivered",
        emailProviderMessageId: input.providerMessageId
      })

      return { changed: true, notification }
    }
  )
  mocks.markBillingNotificationEmailFailed.mockImplementation(
    (
      current: typeof state,
      input: {
        notificationId: string
        reason: string
      }
    ) => {
      const notification = current.notifications.find(
        (candidate) => candidate.id === input.notificationId
      )!

      Object.assign(notification, {
        emailClaimToken: null,
        emailClaimedAt: null,
        emailDeliveryState: "failed",
        emailLastFailure: input.reason
      })

      return { changed: true, notification }
    }
  )
}

describe("billing cron fee reconciliation", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv("CRON_SECRET", "cron-test-secret")
    mocks.billingNotificationEmailIsClaimable.mockImplementation(
      (notification: {
        emailAttemptCount: number
        emailDeliveryState: string
      }) =>
        notification.emailAttemptCount < 5 &&
        ["pending", "failed"].includes(
          notification.emailDeliveryState
        )
    )
    mocks.isBillingNotificationEmailDeliveryEnabled.mockReturnValue(false)
    mocks.verifyExpectedStripeAccount.mockResolvedValue(undefined)
  })

  function cronRequest(): Request {
    return new Request("https://logloads.test/api/billing/cron", {
      headers: { authorization: "Bearer cron-test-secret" }
    })
  }

  function serveState<T extends object>(state: T): void {
    mocks.operatingStateAccess.mockReturnValue({
      async mutate(mutate: (draft: { state: T }) => unknown) {
        return mutate({ state })
      },
      async read(read: (current: T) => unknown) {
        return read(state)
      }
    })
  }

  /** Two open bills and fee collection switched on. */
  function configureCollection(): { port: { marker: string } } {
    const port = { marker: "stripe" }

    mocks.reconcileMissingPlatformFees.mockReturnValue([])
    mocks.openAllClosedPeriodInvoices.mockReturnValue([])
    mocks.listOpenHostInvoices.mockReturnValue([
      { id: "invoice-1", organizationId: "organization-1" },
      { id: "invoice-2", organizationId: "organization-2" }
    ])
    mocks.platformFeeCollectionEnabled.mockReturnValue(true)
    mocks.resolveStripeBilling.mockReturnValue({ ok: true, outcome: "ok", value: port })
    serveState({ notifications: [] })

    return { port }
  }

  it("does not cache scheduler configuration or authorization responses", async () => {
    vi.stubEnv("CRON_SECRET", "")

    const unconfigured = await GET(
      new Request("https://logloads.test/api/billing/cron")
    )

    expect(unconfigured.status).toBe(503)
    expect(unconfigured.headers.get("cache-control")).toBe(
      "private, no-store"
    )

    vi.stubEnv("CRON_SECRET", "cron-test-secret")

    const unauthorized = await GET(
      new Request("https://logloads.test/api/billing/cron", {
        headers: { authorization: "Bearer wrong-secret" }
      })
    )

    expect(unauthorized.status).toBe(401)
    expect(unauthorized.headers.get("cache-control")).toBe(
      "private, no-store"
    )
  })

  it("repairs missing fees before opening closed invoices, and charges nothing while collection is off", async () => {
    const state = { notifications: [] }
    const reconciliation = [
      {
        assignmentId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee91",
        eventId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa91",
        outcome: "accrued",
        reason: null
      }
    ]
    const opened = [{ outcome: "opened" }]

    mocks.reconcileMissingPlatformFees.mockReturnValue(reconciliation)
    mocks.openAllClosedPeriodInvoices.mockReturnValue(opened)
    mocks.listOpenHostInvoices.mockReturnValue([
      { id: "invoice-1", organizationId: "organization-1" }
    ])
    mocks.platformFeeCollectionEnabled.mockReturnValue(false)
    serveState(state)

    const response = await GET(cronRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(mocks.reconcileMissingPlatformFees).toHaveBeenCalledWith(
      state,
      expect.any(String)
    )
    expect(mocks.openAllClosedPeriodInvoices).toHaveBeenCalledWith(
      state,
      expect.any(String)
    )
    expect(
      mocks.reconcileMissingPlatformFees.mock.invocationCallOrder[0]
    ).toBeLessThan(mocks.openAllClosedPeriodInvoices.mock.invocationCallOrder[0]!)
    expect(body).toMatchObject({
      charges: [],
      collection: "disabled",
      feeReconciliation: {
        accrued: 1,
        errors: [],
        requiresReview: []
      },
      invoicesOpened: 1,
      invoicesReady: 1
    })
    expect(mocks.resolveStripeBilling).not.toHaveBeenCalled()
    expect(mocks.chargeHostInvoice).not.toHaveBeenCalled()
  })

  it("reports a per-host invoice-opening refusal without hiding the completed batch", async () => {
    const state = { notifications: [] }
    const blocked = {
      organizationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      outcome: "blocked_for_review",
      periodEnd: "2026-07-01T00:00:00.000Z",
      periodStart: "2026-06-01T00:00:00.000Z",
      reason: "Canonical ledger validation failed for this organization"
    }
    const opened = {
      invoice: {
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        organizationId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
      },
      outcome: "opened"
    }
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined)

    mocks.reconcileMissingPlatformFees.mockReturnValue([])
    mocks.openAllClosedPeriodInvoices.mockReturnValue([blocked, opened])
    mocks.listOpenHostInvoices.mockReturnValue([])
    mocks.platformFeeCollectionEnabled.mockReturnValue(false)
    serveState(state)

    const response = await GET(cronRequest())
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(body).toMatchObject({
      invoicesBlockedForReview: [blocked],
      invoicesOpened: 1
    })
    expect(error).toHaveBeenCalledWith(
      expect.stringMatching(/blocked.*host ledgers/i),
      { blockedOrganizationCount: 1 }
    )
    expect(JSON.stringify(error.mock.calls)).not.toContain(blocked.organizationId)
    error.mockRestore()
  })

  it("charges every open invoice, oldest first, once collection is enabled", async () => {
    const { port } = configureCollection()

    mocks.chargeHostInvoice.mockImplementation(async (input: { invoiceId: string }) => ({
      ok: true,
      outcome: "ok",
      value: {
        alreadyCharged: false,
        invoiceId: input.invoiceId,
        outcome: "charged",
        status: "paid",
        stripeInvoiceId: `in_${input.invoiceId}`,
        subtotalCents: 1_050
      }
    }))

    const response = await GET(cronRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(mocks.verifyExpectedStripeAccount).toHaveBeenCalledWith(port, process.env)
    expect(mocks.chargeHostInvoice.mock.calls.map(([input]) => [input.invoiceId, input.port]))
      .toEqual([
        ["invoice-1", port],
        ["invoice-2", port]
      ])
    expect(body).toMatchObject({
      charges: [
        { invoiceId: "invoice-1", outcome: "charged", status: "paid" },
        { invoiceId: "invoice-2", outcome: "charged", status: "paid" }
      ],
      collection: "enabled"
    })
    expect(body.invoicesReady).toBeUndefined()
  })

  it("reports a bill below the card minimum as held, not as a failure", async () => {
    configureCollection()
    mocks.listOpenHostInvoices.mockReturnValue([
      { id: "invoice-1", organizationId: "organization-1" }
    ])
    mocks.chargeHostInvoice.mockResolvedValue({
      ok: true,
      outcome: "ok",
      value: {
        invoiceId: "invoice-1",
        minimumChargeCents: 50,
        outcome: "below_card_minimum",
        status: "open",
        subtotalCents: 40
      }
    })

    const response = await GET(cronRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.charges).toEqual([
      { invoiceId: "invoice-1", outcome: "below_card_minimum", status: "open" }
    ])
  })

  it("answers 503 when a charge fails or throws, and keeps going to the next bill", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined)

    configureCollection()
    mocks.chargeHostInvoice
      .mockRejectedValueOnce(new Error("Stripe timed out"))
      .mockResolvedValueOnce({
        message: "Stripe is unavailable",
        ok: false,
        outcome: "unavailable",
        reason: "stripe_error"
      })

    const response = await GET(cronRequest())
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(mocks.chargeHostInvoice).toHaveBeenCalledTimes(2)
    expect(body.charges).toEqual([
      { invoiceId: "invoice-1", outcome: "failed", reason: "Stripe timed out" },
      { invoiceId: "invoice-2", outcome: "failed", reason: "Stripe is unavailable" }
    ])
    error.mockRestore()
  })

  it("reports a refused bill for operator action without failing the run", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)

    configureCollection()
    mocks.listOpenHostInvoices.mockReturnValue([
      { id: "invoice-1", organizationId: "organization-1" }
    ])
    mocks.chargeHostInvoice.mockResolvedValue({
      message: "This host has no card on file",
      ok: false,
      outcome: "refused"
    })

    const response = await GET(cronRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.charges).toEqual([
      { invoiceId: "invoice-1", outcome: "refused", reason: "This host has no card on file" }
    ])
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it("refuses collection when the Stripe account identity is not LogLoads", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined)

    configureCollection()
    mocks.verifyExpectedStripeAccount.mockRejectedValue(
      new Error("actual acct_other expected acct_logloads")
    )

    const response = await GET(cronRequest())
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(mocks.chargeHostInvoice).not.toHaveBeenCalled()
    expect(JSON.stringify(body)).not.toContain("acct_other")
    expect(JSON.stringify(body)).not.toContain("acct_logloads")
    error.mockRestore()
  })

  it("refuses collection without Stripe configured, and charges nothing", async () => {
    configureCollection()
    mocks.resolveStripeBilling.mockReturnValue({
      message: "Billing is not configured for this environment",
      ok: false,
      outcome: "unavailable",
      reason: "stripe_secret_missing"
    })

    const response = await GET(cronRequest())

    expect(response.status).toBe(503)
    expect(mocks.verifyExpectedStripeAccount).not.toHaveBeenCalled()
    expect(mocks.chargeHostInvoice).not.toHaveBeenCalled()
  })

  it("leaves queued billing email untouched when delivery configuration is disabled", async () => {
    const state = {
      notifications: [queuedBillingNotification()]
    }

    configureBillingEmailCron(state)
    mocks.isBillingNotificationEmailDeliveryEnabled.mockReturnValue(
      false
    )

    const response = await GET(
      new Request("https://logloads.test/api/billing/cron", {
        headers: { authorization: "Bearer cron-test-secret" }
      })
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(mocks.claimBillingNotificationEmail).not.toHaveBeenCalled()
    expect(
      mocks.deliverClaimedBillingNotificationEmail
    ).not.toHaveBeenCalled()
    expect(body.billingEmailNotifications).toMatchObject({
      attempted: [],
      configured: false,
      degraded: true,
      queued: 1,
      ready: 1,
      state: "disabled"
    })
  })

  it("claims, delivers, and canonically completes one billing email exactly once", async () => {
    const state = {
      notifications: [queuedBillingNotification()]
    }

    configureBillingEmailCron(state)
    mocks.isBillingNotificationEmailDeliveryEnabled.mockReturnValue(true)
    mocks.deliverClaimedBillingNotificationEmail.mockResolvedValue({
      outcome: "delivered",
      providerMessageId: "email_provider_1"
    })
    const request = () =>
      new Request("https://logloads.test/api/billing/cron", {
        headers: { authorization: "Bearer cron-test-secret" }
      })

    const first = await GET(request())
    const firstBody = await first.json()
    const second = await GET(request())
    const secondBody = await second.json()

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(
      mocks.deliverClaimedBillingNotificationEmail
    ).toHaveBeenCalledTimes(1)
    expect(mocks.markBillingNotificationEmailDelivered).toHaveBeenCalledTimes(
      1
    )
    expect(firstBody.billingEmailNotifications.attempted)
      .toEqual([
        {
          attemptCount: 1,
          notificationId: BILLING_NOTIFICATION_ID,
          outcome: "delivered"
        }
      ])
    expect(secondBody.billingEmailNotifications).toMatchObject({
      attempted: [],
      queued: 0,
      ready: 0
    })
  })

  it("delivers host-invoice email only, and leaves other billing notifications in-app", async () => {
    const hostInvoiceNotificationId =
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa72"
    const agreementNotificationId =
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa73"
    const state = {
      notifications: [
        queuedBillingNotification({
          id: hostInvoiceNotificationId,
          relatedEntityType: "host_invoice"
        }),
        queuedBillingNotification({
          id: agreementNotificationId,
          relatedEntityType: "host_fee_agreement"
        })
      ]
    }

    configureBillingEmailCron(state)
    mocks.isBillingNotificationEmailDeliveryEnabled.mockReturnValue(true)
    mocks.deliverClaimedBillingNotificationEmail.mockResolvedValue({
      outcome: "delivered",
      providerMessageId: "email_provider_host_invoice"
    })

    const response = await GET(
      new Request("https://logloads.test/api/billing/cron", {
        headers: { authorization: "Bearer cron-test-secret" }
      })
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(mocks.claimBillingNotificationEmail).toHaveBeenCalledTimes(1)
    expect(mocks.claimBillingNotificationEmail).toHaveBeenCalledWith(
      state,
      expect.objectContaining({ notificationId: hostInvoiceNotificationId }),
      expect.any(String)
    )
    expect(
      state.notifications.find(
        (notification) => notification.id === hostInvoiceNotificationId
      )?.emailDeliveryState
    ).toBe("delivered")
    expect(
      state.notifications.find(
        (notification) => notification.id === agreementNotificationId
      )?.emailDeliveryState
    ).toBe("pending")
    expect(body.billingEmailNotifications).toMatchObject({
      configured: true,
      queued: 1,
      ready: 1,
      state: "enabled"
    })
  })

  it("sends no billing email while fee collection is switched off", async () => {
    const state = { notifications: [queuedBillingNotification()] }

    configureBillingEmailCron(state)
    mocks.platformFeeCollectionEnabled.mockReturnValue(false)
    mocks.isBillingNotificationEmailDeliveryEnabled.mockReturnValue(true)

    const response = await GET(
      new Request("https://logloads.test/api/billing/cron", {
        headers: { authorization: "Bearer cron-test-secret" }
      })
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(mocks.claimBillingNotificationEmail).not.toHaveBeenCalled()
    expect(body.billingEmailNotifications).toMatchObject({
      attempted: [],
      degraded: false,
      queued: 1,
      state: "collection_disabled"
    })
  })

  it("retries provider failures but never exceeds five canonical attempts", async () => {
    const state = {
      notifications: [
        queuedBillingNotification({
          emailAttemptCount: 3,
          emailDeliveryState: "failed"
        })
      ]
    }

    configureBillingEmailCron(state)
    mocks.isBillingNotificationEmailDeliveryEnabled.mockReturnValue(true)
    mocks.deliverClaimedBillingNotificationEmail.mockResolvedValue({
      outcome: "failed",
      reason: "The billing email provider is temporarily unavailable."
    })
    const request = () =>
      new Request("https://logloads.test/api/billing/cron", {
        headers: { authorization: "Bearer cron-test-secret" }
      })

    const fourthAttempt = await GET(request())
    const fifthAttempt = await GET(request())
    const exhausted = await GET(request())
    const exhaustedBody = await exhausted.json()

    expect(fourthAttempt.status).toBe(503)
    expect(fifthAttempt.status).toBe(503)
    expect(exhausted.status).toBe(503)
    expect(
      mocks.deliverClaimedBillingNotificationEmail
    ).toHaveBeenCalledTimes(2)
    expect(mocks.markBillingNotificationEmailFailed).toHaveBeenCalledTimes(2)
    expect(state.notifications[0]?.emailAttemptCount).toBe(5)
    expect(exhaustedBody.billingEmailNotifications)
      .toMatchObject({
        attempted: [],
        exhausted: 1,
        queued: 1,
        ready: 0
      })
  })

  it("denies a stale claim whose recipient no longer has active billing authority", async () => {
    const state = {
      notifications: [
        queuedBillingNotification({
          emailAttemptCount: 1,
          emailClaimToken: "stale-worker",
          emailClaimedAt: "2026-07-27T00:00:00.000Z",
          emailDeliveryState: "claimed"
        })
      ]
    }

    configureBillingEmailCron(state, false)
    mocks.billingNotificationEmailIsClaimable.mockReturnValue(true)
    mocks.isBillingNotificationEmailDeliveryEnabled.mockReturnValue(true)

    const response = await GET(
      new Request("https://logloads.test/api/billing/cron", {
        headers: { authorization: "Bearer cron-test-secret" }
      })
    )
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(
      mocks.deliverClaimedBillingNotificationEmail
    ).not.toHaveBeenCalled()
    expect(mocks.markBillingNotificationEmailFailed).toHaveBeenCalledWith(
      state,
      expect.objectContaining({
        notificationId: BILLING_NOTIFICATION_ID,
        reason:
          "The billing notification recipient is no longer authorized."
      }),
      expect.any(String)
    )
    expect(body.billingEmailNotifications.attempted)
      .toEqual([
        {
          attemptCount: 2,
          notificationId: BILLING_NOTIFICATION_ID,
          outcome: "denied",
          reason:
            "The billing notification recipient is no longer authorized."
        }
      ])
  })
})
