import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe("captureServerEvent", () => {
  it("is awaitable so redirecting onboarding actions keep the request alive", async () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "ph_test")
    let releaseFetch: ((response: Response) => void) | undefined
    const fetchPromise = new Promise<Response>((resolve) => {
      releaseFetch = resolve
    })
    const fetchMock = vi.fn(() => fetchPromise)
    vi.stubGlobal("fetch", fetchMock)

    const { captureServerEvent } = await import("./analytics")
    let settled = false
    const capture = captureServerEvent("onboarding_completed", "profile-1", {
      accountType: "owner_operator",
      path: "driver"
    }).then(() => {
      settled = true
    })

    await Promise.resolve()
    expect(settled).toBe(false)
    expect(fetchMock).toHaveBeenCalledWith(
      "https://us.i.posthog.com/capture/",
      expect.objectContaining({ method: "POST" })
    )

    releaseFetch?.(new Response(null, { status: 200 }))
    await capture
    expect(settled).toBe(true)
  })

  it("never makes a durable action fail when analytics is unavailable", async () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "ph_test")
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("offline")
    }))

    const { captureServerEvent } = await import("./analytics")

    await expect(
      captureServerEvent("account_created", "profile-1", { path: "host" })
    ).resolves.toBeUndefined()
  })
})
