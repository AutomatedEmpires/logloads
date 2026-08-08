import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  redirect: vi.fn()
}))

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect
}))

import Page from "@/app/host/page"

beforeEach(() => {
  mocks.redirect.mockReset()
  mocks.redirect.mockImplementation(() => {
    throw new Error("NEXT_REDIRECT")
  })
})

describe("host root route", () => {
  it("redirects to the canonical Command URL", () => {
    expect(() => Page()).toThrow("NEXT_REDIRECT")
    expect(mocks.redirect).toHaveBeenCalledOnce()
    expect(mocks.redirect).toHaveBeenCalledWith("/host/command")
  })
})
