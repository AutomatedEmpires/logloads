import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("../v2-session", () => ({ normalizedSessionPrincipal: async () => null }))

import { MarketplaceRefusalError, MarketplaceStoreError } from "../port"
import {
  clearRevealPauseForSession,
  loadHaulerJobAccess,
  loadInquiryPhone,
  loadRevealPauses,
  sharePhoneForSession,
  type DisclosureDependencies
} from "./load"
import { pilotDisclosure } from "./pilot"
import type { DisclosureAdapter } from "./port"

/**
 * #403: who gets the phone reveal's state and actions. The pilot store offers none of it, a signed-out request acts
 * as no one, and a store failure is logged and hides the control instead of breaking the page. A withheld share is
 * `not_shared` with no reason.
 */

const PERSON = { audience: "logloads-app", issuer: "https://clerk.reveal.test", subject: "reveal_person" }
const ORG = "11111111-1111-4111-8111-111111111111"
const INTEREST = "77777777-7777-4777-8777-777777777777"
const JOB = "33333333-3333-4333-8333-333333333333"

function adapterWith(overrides: Partial<DisclosureAdapter>): DisclosureAdapter {
  return { ...pilotDisclosure(), ...overrides }
}

function deps(adapter: DisclosureAdapter, options: { kind?: "pilot" | "normalized"; signedIn?: boolean } = {}) {
  const reports: string[] = []
  const dependencies: DisclosureDependencies = {
    adapter: () => adapter,
    adapterKind: () => options.kind ?? "normalized",
    principal: async () => (options.signedIn === false ? null : PERSON),
    report: (_error, operation) => {
      reports.push(operation)
      return { requestId: "req_1" }
    }
  }

  return { dependencies, reports }
}

const disclosure = { interestId: INTEREST, phone: "+15415550188", shared: false, sharedAt: null, status: "replied" }

describe("disclosure loaders", () => {
  it("offer nothing on the pilot store or without a signed-in person, and never reach the adapter", async () => {
    const touched = vi.fn()
    const adapter = adapterWith({ haulerJobAccess: touched, inquiryDisclosure: touched, revealPauses: touched, sharePhone: touched })

    for (const options of [{ kind: "pilot" as const }, { signedIn: false }]) {
      const { dependencies } = deps(adapter, options)
      await expect(loadInquiryPhone(ORG, INTEREST, dependencies)).resolves.toEqual({ kind: "unavailable" })
      await expect(loadHaulerJobAccess(ORG, JOB, dependencies)).resolves.toBeNull()
      await expect(sharePhoneForSession(ORG, INTEREST, true, dependencies)).resolves.toMatchObject({ kind: "refused" })
    }
    await expect(loadRevealPauses(deps(adapter, { kind: "pilot" }).dependencies)).resolves.toEqual({ kind: "unavailable" })
    await expect(loadRevealPauses(deps(adapter, { signedIn: false }).dependencies)).resolves.toEqual({ kind: "denied" })
    expect(touched).not.toHaveBeenCalled()
  })

  it("reads the landing's disclosure state as the session's person, for the business the page passes", async () => {
    const inquiryDisclosure = vi.fn(async () => disclosure)
    const { dependencies } = deps(adapterWith({ inquiryDisclosure }))

    await expect(loadInquiryPhone(ORG, INTEREST, dependencies)).resolves.toEqual({ disclosure, kind: "ready" })
    expect(inquiryDisclosure).toHaveBeenCalledWith(PERSON, ORG, INTEREST)
  })

  it("hides the control when the inquiry is not the business's own, and logs only a real failure", async () => {
    const none = deps(adapterWith({ inquiryDisclosure: async () => null }))
    await expect(loadInquiryPhone(ORG, INTEREST, none.dependencies)).resolves.toEqual({ kind: "unavailable" })

    const refused = deps(adapterWith({ inquiryDisclosure: async () => { throw new MarketplaceRefusalError("no", "42501") } }))
    await expect(loadInquiryPhone(ORG, INTEREST, refused.dependencies)).resolves.toEqual({ kind: "unavailable" })
    expect(refused.reports).toEqual([])

    const broken = deps(adapterWith({ inquiryDisclosure: async () => { throw new MarketplaceStoreError() } }))
    await expect(loadInquiryPhone(ORG, INTEREST, broken.dependencies)).resolves.toEqual({ kind: "unavailable" })
    expect(broken.reports).toEqual(["disclosure.inquiry_phone"])
  })

  it("says shown, not shared or hidden, and nothing about why a share was withheld", async () => {
    const shown = deps(adapterWith({ sharePhone: async () => ({ shared: true }) }))
    await expect(sharePhoneForSession(ORG, INTEREST, true, shown.dependencies)).resolves.toEqual({ kind: "shared" })

    const withheld = deps(adapterWith({ sharePhone: async () => ({ shared: false }) }))
    await expect(sharePhoneForSession(ORG, INTEREST, true, withheld.dependencies)).resolves.toEqual({ kind: "not_shared" })

    const hide = vi.fn(async () => ({ shared: false }))
    await expect(sharePhoneForSession(ORG, INTEREST, false, deps(adapterWith({ sharePhone: hide })).dependencies)).resolves.toEqual({ kind: "hidden" })
    expect(hide).toHaveBeenCalledWith(PERSON, ORG, { interestId: INTEREST }, false)
  })

  it("turns a refusal into its own words and a fault into a logged reference", async () => {
    const refused = deps(adapterWith({ sharePhone: async () => { throw new MarketplaceRefusalError("Inquiry not found", "42501") } }))
    await expect(sharePhoneForSession(ORG, INTEREST, true, refused.dependencies)).resolves.toEqual({ kind: "refused", message: "Inquiry not found" })

    const broken = deps(adapterWith({ sharePhone: async () => { throw new MarketplaceStoreError() } }))
    await expect(sharePhoneForSession(ORG, INTEREST, true, broken.dependencies)).resolves.toEqual({ kind: "failed", requestId: "req_1" })
    expect(broken.reports).toEqual(["disclosure.show_phone"])
  })

  it("returns the hauler's released details, or null on any refusal", async () => {
    const access = { directions: "Road", gateInstructions: "Gate", landingId: JOB, sharedAt: "2026-11-18T22:00:00.000Z", siteContactName: "Pat", siteContactPhone: "+15415550188" }
    const haulerJobAccess = vi.fn(async () => access)

    await expect(loadHaulerJobAccess(ORG, JOB, deps(adapterWith({ haulerJobAccess })).dependencies)).resolves.toEqual(access)
    expect(haulerJobAccess).toHaveBeenCalledWith(PERSON, ORG, JOB)
    await expect(loadHaulerJobAccess(ORG, JOB, deps(adapterWith({ haulerJobAccess: async () => { throw new MarketplaceRefusalError("no", "42501") } })).dependencies)).resolves.toBeNull()
  })

  it("lists pauses for staff, denies anyone the database refuses, and clears with the reason", async () => {
    const pause = { id: INTEREST, landingsInWindow: 5, openedAt: "2026-11-18T21:00:00.000Z", reportId: JOB, reportStatus: "open" as const, subjectId: ORG, subjectKind: "organization" as const, subjectName: "Granite Creek Hauling" }

    await expect(loadRevealPauses(deps(adapterWith({ revealPauses: async () => [pause] })).dependencies)).resolves.toEqual({ kind: "ready", pauses: [pause] })
    await expect(loadRevealPauses(deps(adapterWith({ revealPauses: async () => { throw new MarketplaceRefusalError("no", "42501") } })).dependencies)).resolves.toEqual({ kind: "denied" })

    const clearRevealPause = vi.fn(async () => undefined)
    await expect(clearRevealPauseForSession({ pauseId: INTEREST, reason: "Staff reviewed it" }, deps(adapterWith({ clearRevealPause })).dependencies)).resolves.toEqual({ kind: "cleared" })
    expect(clearRevealPause).toHaveBeenCalledWith(PERSON, { pauseId: INTEREST, reason: "Staff reviewed it" })

    const refused = deps(adapterWith({ clearRevealPause: async () => { throw new MarketplaceRefusalError("Reveal pause not found", "P0002") } }))
    await expect(clearRevealPauseForSession({ pauseId: INTEREST, reason: "Staff reviewed it" }, refused.dependencies)).resolves.toEqual({ code: "P0002", kind: "refused", message: "Reveal pause not found" })
  })
})
