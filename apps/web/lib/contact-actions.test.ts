import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  createNotification: vi.fn(),
  deliverEmail: vi.fn(),
  mutateState: vi.fn(),
  requestClientKey: vi.fn()
}))

vi.mock("./notify", () => ({ deliverEmail: mocks.deliverEmail }))
vi.mock("./rate-limit", () => ({
  checkRateLimit: mocks.checkRateLimit,
  requestClientKey: mocks.requestClientKey
}))
vi.mock("./services", () => ({
  mutateState: mocks.mutateState,
  serializeError: (error: unknown) => ({
    error: error instanceof Error ? error.message : "Request failed"
  })
}))

import { submitContactInquiryAction } from "./contact-actions"

function contactForm(interest?: string): FormData {
  const formData = new FormData()

  formData.set("name", "Pilot Operator")
  formData.set("email", "pilot@example.com")
  formData.set("organization", "Test Timber")
  formData.set("message", "We want to rehearse one operating lane.")
  if (interest !== undefined) formData.set("interest", interest)

  return formData
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requestClientKey.mockResolvedValue("pilot-client")
  mocks.checkRateLimit.mockResolvedValue(undefined)
  mocks.deliverEmail.mockResolvedValue({ delivered: false })
  mocks.createNotification.mockReturnValue({ id: "contact-notification" })
  mocks.mutateState.mockImplementation(async (
    mutate: (draft: { createNotification: typeof mocks.createNotification }) => unknown
  ) => mutate({ createNotification: mocks.createNotification }))
})

describe("contact pilot intent", () => {
  it("durably records and emails the selected role-specific intent", async () => {
    const result = await submitContactInquiryAction(
      { error: null, ok: false },
      contactForm("pilot_fleet")
    )

    expect(result).toEqual({ error: null, ok: true })
    expect(mocks.createNotification).toHaveBeenCalledTimes(1)
    expect(mocks.createNotification).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.stringContaining("Interest: Explore fleet operations"),
      relatedEntityType: "contact_inquiry"
    }))
    expect(mocks.deliverEmail).toHaveBeenCalledWith(expect.objectContaining({
      text: expect.stringContaining("Interest: Explore fleet operations")
    }))
  })

  it("rejects invented non-empty intent before rate limits, writes, or email", async () => {
    const result = await submitContactInquiryAction(
      { error: null, ok: false },
      contactForm("network_pilot_subscription")
    )

    expect(result).toEqual({
      error: "Choose what you want to explore so we can route your request.",
      ok: false
    })
    expect(mocks.checkRateLimit).not.toHaveBeenCalled()
    expect(mocks.mutateState).not.toHaveBeenCalled()
    expect(mocks.createNotification).not.toHaveBeenCalled()
    expect(mocks.deliverEmail).not.toHaveBeenCalled()
  })

  it("keeps legacy contact submissions without the new field general", async () => {
    const result = await submitContactInquiryAction(
      { error: null, ok: false },
      contactForm()
    )

    expect(result.ok).toBe(true)
    expect(mocks.createNotification).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.stringContaining("Interest: General question")
    }))
  })
})
