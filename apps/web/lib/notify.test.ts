import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { deliverEmail } from "./notify"

const emailEnvironmentVariables = [
  "LOGLOADS_EMAIL_FROM",
  "LOGLOADS_EMAIL_REPLY_TO",
  "RESEND_API_KEY",
  "RESEND_FROM",
  "RESEND_REPLY_TO",
  "SUPPORT_EMAIL"
] as const

function successfulRequest(): typeof fetch {
  return vi.fn(async () => new Response(null, { status: 202 })) as unknown as typeof fetch
}

function requestBody(request: typeof fetch): Record<string, unknown> {
  const [, init] = vi.mocked(request).mock.calls[0]!

  return JSON.parse(String(init?.body)) as Record<string, unknown>
}

describe("deliverEmail", () => {
  beforeEach(() => {
    for (const name of emailEnvironmentVariables) {
      vi.stubEnv(name, undefined)
    }
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it("uses the safe LogLoads sender and reply-to identities by default", async () => {
    const request = successfulRequest()
    vi.stubEnv("RESEND_API_KEY", "test-api-key")
    vi.stubGlobal("fetch", request)

    await expect(
      deliverEmail({
        subject: "New inquiry",
        text: "A shipper submitted a contact request.",
        to: "operator@example.com"
      })
    ).resolves.toBe(true)

    expect(requestBody(request)).toEqual(
      expect.objectContaining({
        from: "LogLoads <notifications@logloads.com>",
        reply_to: "support@logloads.com"
      })
    )
  })

  it("prefers canonical Resend identities over legacy LogLoads variables", async () => {
    const request = successfulRequest()
    vi.stubEnv("RESEND_API_KEY", "test-api-key")
    vi.stubEnv("RESEND_FROM", "  LogLoads <notifications@logloads.com>  ")
    vi.stubEnv("RESEND_REPLY_TO", "  support@logloads.com  ")
    vi.stubEnv("LOGLOADS_EMAIL_FROM", "LogLoads <legacy@logloads.com>")
    vi.stubEnv("LOGLOADS_EMAIL_REPLY_TO", "legacy-replies@logloads.com")
    vi.stubGlobal("fetch", request)

    await deliverEmail({ subject: "Test", text: "Test", to: "operator@example.com" })

    expect(requestBody(request)).toEqual(
      expect.objectContaining({
        from: "LogLoads <notifications@logloads.com>",
        reply_to: "support@logloads.com"
      })
    )
  })

  it("uses the canonical support identity before the legacy reply-to variable", async () => {
    const request = successfulRequest()
    vi.stubEnv("RESEND_API_KEY", "test-api-key")
    vi.stubEnv("SUPPORT_EMAIL", "  support@logloads.com  ")
    vi.stubEnv("LOGLOADS_EMAIL_REPLY_TO", "legacy-replies@logloads.com")
    vi.stubGlobal("fetch", request)

    await deliverEmail({ subject: "Test", text: "Test", to: "operator@example.com" })

    expect(requestBody(request).reply_to).toBe("support@logloads.com")
  })

  it("keeps legacy identity variables as fallbacks", async () => {
    const request = successfulRequest()
    vi.stubEnv("RESEND_API_KEY", "test-api-key")
    vi.stubEnv("LOGLOADS_EMAIL_FROM", "  LogLoads <legacy@logloads.com>  ")
    vi.stubEnv("LOGLOADS_EMAIL_REPLY_TO", "  legacy-replies@logloads.com  ")
    vi.stubGlobal("fetch", request)

    await deliverEmail({ subject: "Test", text: "Test", to: "operator@example.com" })

    expect(requestBody(request)).toEqual(
      expect.objectContaining({
        from: "LogLoads <legacy@logloads.com>",
        reply_to: "legacy-replies@logloads.com"
      })
    )
  })

  it("returns false without issuing a request when the API key is absent", async () => {
    const request = successfulRequest()
    vi.stubGlobal("fetch", request)

    await expect(
      deliverEmail({ subject: "Test", text: "Test", to: "operator@example.com" })
    ).resolves.toBe(false)
    expect(request).not.toHaveBeenCalled()
  })
})
