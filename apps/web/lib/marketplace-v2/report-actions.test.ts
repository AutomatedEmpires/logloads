import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * "Report this listing" (UX-07, #130): identity from the session only, the contract's validation before the port, a
 * per-person rate limit, and an honest answer when the store keeps no reports, with the person's input kept.
 */

const mocks = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  enabled: vi.fn(() => true),
  getSessionActor: vi.fn(),
  reportListing: vi.fn()
}))

vi.mock("server-only", () => ({}))
vi.mock("../rate-limit", () => ({ checkRateLimit: mocks.checkRateLimit }))
vi.mock("./v2-session", () => ({ getV2SessionActor: mocks.getSessionActor }))
vi.mock("./flag", () => ({ marketplaceV2Enabled: mocks.enabled }))
vi.mock("./pilot-adapter", () => ({ pilotMarketplaceV2: { reportListing: mocks.reportListing } }))

import { MarketplaceOperationUnavailableError, MarketplaceRefusalError } from "./port"
import { reportListingAction } from "./report-actions"
import { REPORT_LISTING_IDLE } from "./report-state"

const ORG = "33333333-bbbb-4bbb-8bbb-333333333333"
const USER = "55555555-dddd-4ddd-8ddd-555555555555"
const JOB = "11111111-1111-4111-8111-111111111111"

function form(fields: Record<string, string>): FormData {
  const data = new FormData()
  for (const [name, value] of Object.entries(fields)) data.set(name, value)
  return data
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.enabled.mockReturnValue(true)
  mocks.getSessionActor.mockResolvedValue({ activeOrganization: { id: ORG }, profile: { id: USER }, workspaceSelectionInvalid: false })
  mocks.checkRateLimit.mockResolvedValue(undefined)
  mocks.reportListing.mockResolvedValue({ alreadyReported: false, reportId: "22222222-eeee-4eee-8eee-eeeeeeeeeeee", reportedAt: "2026-11-03T12:00:00.000Z" })
})

describe("reportListingAction", () => {
  it("reports as the session's person and business, whatever the form claims, after the rate limit", async () => {
    const state = await reportListingAction(
      REPORT_LISTING_IDLE,
      form({ details: " Pay was $400 ", jobId: JOB, organizationId: "x", reason: "inaccurate_pay", userId: "someone-else" })
    )

    expect(state).toEqual({ alreadyReported: false, reportedAt: "2026-11-03T12:00:00.000Z", status: "sent" })
    expect(mocks.checkRateLimit).toHaveBeenCalledWith("marketplace-report", USER, 10, 3_600_000)
    expect(mocks.reportListing).toHaveBeenCalledWith({ organizationId: ORG, userId: USER }, { details: "Pay was $400", jobId: JOB, reason: "inaccurate_pay" })
  })

  it("says reporting isn't available on a store without reports, and keeps the reason and the words", async () => {
    mocks.reportListing.mockRejectedValueOnce(new MarketplaceOperationUnavailableError("Reporting a listing"))

    await expect(reportListingAction(REPORT_LISTING_IDLE, form({ details: "Filled last week", jobId: JOB, reason: "stale" }))).resolves.toEqual({
      details: "Filled last week",
      reason: "stale",
      status: "unavailable"
    })
  })

  it("refuses without a reason before reaching the store, and never echoes an unknown reason", async () => {
    const state = await reportListingAction(REPORT_LISTING_IDLE, form({ details: "words", jobId: JOB, reason: "<script>" }))

    expect(state).toEqual({ details: "words", message: "Choose why you are reporting this listing", reason: "", status: "error" })
    expect(mocks.reportListing).not.toHaveBeenCalled()
  })

  it("asks a visitor to sign in, and a person without a business to choose one", async () => {
    mocks.getSessionActor.mockResolvedValueOnce(null)
    expect(await reportListingAction(REPORT_LISTING_IDLE, form({ jobId: JOB, reason: "stale" }))).toMatchObject({ message: "Sign in to report this listing.", status: "error" })

    mocks.getSessionActor.mockResolvedValueOnce({ activeOrganization: null, profile: { id: USER }, workspaceSelectionInvalid: false })
    expect(await reportListingAction(REPORT_LISTING_IDLE, form({ jobId: JOB, reason: "stale" }))).toMatchObject({ status: "error" })
    expect(mocks.reportListing).not.toHaveBeenCalled()
  })

  it("shows a store refusal in its own words, keeping the input", async () => {
    mocks.reportListing.mockRejectedValueOnce(new MarketplaceRefusalError("Listing not found", "P0002"))

    await expect(reportListingAction(REPORT_LISTING_IDLE, form({ jobId: JOB, reason: "fake_work" }))).resolves.toEqual({
      details: "",
      message: "Listing not found",
      reason: "fake_work",
      status: "error"
    })
  })

  it("does nothing while V2 is off", async () => {
    mocks.enabled.mockReturnValueOnce(false)

    expect(await reportListingAction(REPORT_LISTING_IDLE, form({ jobId: JOB, reason: "stale" }))).toMatchObject({ status: "error" })
    expect(mocks.getSessionActor).not.toHaveBeenCalled()
  })
})
