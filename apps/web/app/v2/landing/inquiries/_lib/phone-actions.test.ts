import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * #403: Show my number and Hide my number as server actions. The person and the business come from the server
 * session; the form supplies only the inquiry id. The redirect carries a fixed code, never the number or a reason.
 */

const mocks = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  getV2SessionActor: vi.fn(),
  revalidatePath: vi.fn(),
  sharePhoneForSession: vi.fn()
}))

vi.mock("server-only", () => ({}))
vi.mock("next/navigation", () => ({
  redirect: (href: string) => {
    throw new Error(`NEXT_REDIRECT ${href}`)
  }
}))
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock("@/lib/marketplace-v2/flag", () => ({ marketplaceV2Enabled: () => true }))
vi.mock("@/lib/marketplace-v2/v2-session", () => ({ getV2SessionActor: mocks.getV2SessionActor }))
vi.mock("@/lib/marketplace-v2/disclosure/load", () => ({ sharePhoneForSession: mocks.sharePhoneForSession }))
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.checkRateLimit }))

import { hidePhoneAction, sharePhoneAction } from "../actions"

const LANDING_ORG = "22222222-aaaa-4aaa-8aaa-222222222222"
const INTEREST = "44444444-cccc-4ccc-8ccc-444444444444"
const USER = "55555555-dddd-4ddd-8ddd-555555555555"

function form(values: Record<string, string>): FormData {
  const data = new FormData()
  for (const [name, value] of Object.entries(values)) data.set(name, value)
  return data
}

async function redirectOf(run: Promise<void>): Promise<string> {
  const error = await run.then(() => null, (caught: unknown) => caught)
  const message = error instanceof Error ? error.message : ""

  expect(message.startsWith("NEXT_REDIRECT ")).toBe(true)
  return message.slice("NEXT_REDIRECT ".length)
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getV2SessionActor.mockResolvedValue({ activeOrganization: { id: LANDING_ORG }, profile: { id: USER }, workspaceSelectionInvalid: false })
  mocks.checkRateLimit.mockResolvedValue(undefined)
})

describe("Show my number and Hide my number (#403)", () => {
  it("shows the number for the session's business and says only that it is shown", async () => {
    mocks.sharePhoneForSession.mockResolvedValue({ kind: "shared" })
    const href = await redirectOf(sharePhoneAction(form({ interestId: INTEREST, organizationId: "someone-else", phone: "+15415550188" })))

    expect(mocks.sharePhoneForSession).toHaveBeenCalledWith(LANDING_ORG, INTEREST, true)
    expect(href).toBe(`/v2/landing/inquiries?inquiry=${INTEREST}&updated=phone_shared#conversation`)
    expect(href).not.toContain("5415550188")
  })

  it("says only that the number was not shared when it did not reach the hauler", async () => {
    mocks.sharePhoneForSession.mockResolvedValue({ kind: "not_shared" })

    expect(await redirectOf(sharePhoneAction(form({ interestId: INTEREST }))))
      .toBe(`/v2/landing/inquiries?inquiry=${INTEREST}&updated=phone_not_shared#conversation`)
  })

  it("hides the number", async () => {
    mocks.sharePhoneForSession.mockResolvedValue({ kind: "hidden" })

    expect(await redirectOf(hidePhoneAction(form({ interestId: INTEREST }))))
      .toBe(`/v2/landing/inquiries?inquiry=${INTEREST}&updated=phone_hidden#conversation`)
    expect(mocks.sharePhoneForSession).toHaveBeenCalledWith(LANDING_ORG, INTEREST, false)
  })

  it("answers a refusal or a fault with a fixed error code", async () => {
    mocks.sharePhoneForSession.mockResolvedValueOnce({ kind: "refused", message: "Inquiry not found" })
    expect(await redirectOf(sharePhoneAction(form({ interestId: INTEREST })))).toContain("error=inquiry_not_found")

    mocks.sharePhoneForSession.mockResolvedValueOnce({ kind: "refused", message: "Reply to this inquiry before sharing the landing's private details" })
    expect(await redirectOf(sharePhoneAction(form({ interestId: INTEREST })))).toContain("error=not_allowed")

    mocks.sharePhoneForSession.mockResolvedValueOnce({ kind: "failed", requestId: null })
    expect(await redirectOf(sharePhoneAction(form({ interestId: INTEREST })))).toContain("error=unexpected")
  })

  it("acts for no one without a session, a business or a well-formed inquiry id", async () => {
    mocks.getV2SessionActor.mockResolvedValueOnce(null)
    expect(await redirectOf(sharePhoneAction(form({ interestId: INTEREST })))).toBe("/sign-in?next=%2Fv2%2Flanding%2Finquiries")

    expect(await redirectOf(sharePhoneAction(form({ interestId: "not-an-id" })))).toContain("error=inquiry_not_found")

    mocks.getV2SessionActor.mockResolvedValueOnce({ activeOrganization: null, profile: { id: USER }, workspaceSelectionInvalid: false })
    expect(await redirectOf(sharePhoneAction(form({ interestId: INTEREST })))).toContain("error=choose_business")

    expect(mocks.sharePhoneForSession).not.toHaveBeenCalled()
  })
})
