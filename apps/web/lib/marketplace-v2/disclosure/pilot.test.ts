import { describe, expect, it } from "vitest"

import { MarketplaceOperationUnavailableError } from "../port"
import { DISCLOSURE_PILOT_OPERATIONS, pilotDisclosure } from "./pilot"

const PRINCIPAL = { audience: "pilot", issuer: "https://clerk.pilot.test", subject: "pilot_person" }
const ORG = "11111111-1111-4111-8111-111111111111"
const ID = "77777777-7777-4777-8777-777777777777"

describe("the pilot disclosure adapter", () => {
  it("refuses every phone-reveal operation and does not need a store", async () => {
    const pilot = pilotDisclosure()
    const calls: Array<[keyof typeof DISCLOSURE_PILOT_OPERATIONS, () => Promise<unknown>]> = [
      ["clearHaulerRevealPause", () => pilot.clearHaulerRevealPause(PRINCIPAL, { haulerOrgId: ORG, reason: "Staff reviewed it" })],
      ["clearRevealPause", () => pilot.clearRevealPause(PRINCIPAL, { pauseId: ID, reason: "Staff reviewed it" })],
      ["revealPauses", () => pilot.revealPauses(PRINCIPAL)],
      ["inquiryDisclosure", () => pilot.inquiryDisclosure(PRINCIPAL, ORG, ID)],
      ["sharePhone", () => pilot.sharePhone(PRINCIPAL, ORG, { interestId: ID }, true)],
      ["haulerJobAccess", () => pilot.haulerJobAccess(PRINCIPAL, ORG, ID)]
    ]

    expect(calls.map(([name]) => name).sort()).toEqual(Object.keys(DISCLOSURE_PILOT_OPERATIONS).sort())

    for (const [name, call] of calls) {
      await expect(call()).rejects.toThrow(MarketplaceOperationUnavailableError)
      await expect(call()).rejects.toThrow(DISCLOSURE_PILOT_OPERATIONS[name])
    }
  })

  it("never returns an access detail or a phone, even for a well-formed request", async () => {
    const result = await pilotDisclosure().haulerJobAccess(PRINCIPAL, ORG, ID).catch((error: unknown) => error)

    expect(result).toBeInstanceOf(MarketplaceOperationUnavailableError)
    expect(String((result as Error).message)).not.toMatch(/\+?\d{7,}/)
  })
})
