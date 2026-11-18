import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import type { MarketplaceDb } from "../normalized-db"
import { MarketplaceRefusalError, MarketplaceStoreError } from "../port"
import { normalizedDisclosure } from "./normalized"

/**
 * #403: the phone reveal's calls on the normalized store, against a recording fake. Show and hide go through
 * respond_to_interest with the share flag, inside one transaction that first checks the inquiry is the active
 * business's own. Staff calls and the two views are read-only where they only read. A drifted row never leaks its
 * contents (which may hold a phone) into an error.
 */

const PERSON = { audience: "logloads-app", issuer: "https://clerk.reveal.test", subject: "reveal_person" }
const ORG = "11111111-1111-4111-8111-111111111111"
const INTEREST = "22222222-2222-4222-8222-222222222222"
const JOB = "33333333-3333-4333-8333-333333333333"
const PAUSE = "44444444-4444-4444-8444-444444444444"
const REPORT = "55555555-5555-4555-8555-555555555555"
const LANDING = "66666666-6666-4666-8666-666666666666"

type Reply = (fn: string, args: Record<string, unknown>) => unknown[]

function fakeDb(reply: Reply) {
  const calls: Array<{ args: Record<string, unknown>; fn: string }> = []
  const transactions: Array<{ principal: unknown; readOnly: boolean }> = []
  const db = {
    asAnon: async () => {
      throw new Error("the phone reveal never runs as anon")
    },
    asUser: async (
      principal: unknown,
      work: (calls: { call: (fn: string, args: Record<string, unknown>) => Promise<unknown[]> }) => Promise<unknown>,
      options?: { readOnly?: boolean }
    ) => {
      transactions.push({ principal, readOnly: options?.readOnly !== false })
      return work({
        call: async (fn, args) => {
          calls.push({ args, fn })
          return reply(fn, args)
        }
      })
    },
    close: async () => undefined
  }

  return { calls, db: db as unknown as MarketplaceDb, transactions }
}

const disclosureRow = (sharedAt: string | null) => ({
  interest_id: INTEREST,
  interest_status: "replied",
  shared_at: sharedAt,
  site_contact_phone: "+15415550188"
})

describe("normalized disclosure: Show my number and Hide my number", () => {
  it("shows the number through respond_to_interest on the active business's own inquiry, in one write transaction", async () => {
    let shared: string | null = null
    const { calls, db, transactions } = fakeDb((fn, args) => {
      if (fn === "respond_to_interest") shared = args.p_share_private_details === true ? "2026-11-18T22:00:00.000Z" : null
      return fn === "landing_interest_disclosure" ? [disclosureRow(shared)] : []
    })

    await expect(normalizedDisclosure(db).sharePhone(PERSON, ORG, { interestId: INTEREST }, true)).resolves.toEqual({ shared: true })
    expect(calls).toEqual([
      { args: { p_interest_id: INTEREST, p_org_id: ORG }, fn: "landing_interest_disclosure" },
      { args: { p_interest_id: INTEREST, p_share_private_details: true, p_status: "viewed" }, fn: "respond_to_interest" },
      { args: { p_interest_id: INTEREST, p_org_id: ORG }, fn: "landing_interest_disclosure" }
    ])
    expect(transactions).toEqual([{ principal: PERSON, readOnly: false }])

    await expect(normalizedDisclosure(db).sharePhone(PERSON, ORG, { interestId: INTEREST }, false)).resolves.toEqual({ shared: false })
    expect(calls[4]).toEqual({ args: { p_interest_id: INTEREST, p_share_private_details: false, p_status: "viewed" }, fn: "respond_to_interest" })
  })

  it("reports a withheld share as not shared, without an error and without a reason", async () => {
    const { db } = fakeDb((fn) => (fn === "landing_interest_disclosure" ? [disclosureRow(null)] : []))

    await expect(normalizedDisclosure(db).sharePhone(PERSON, ORG, { interestId: INTEREST }, true)).resolves.toEqual({ shared: false })
  })

  it("refuses an inquiry that is not the active landing business's own before changing anything", async () => {
    const { calls, db } = fakeDb(() => [])

    await expect(normalizedDisclosure(db).sharePhone(PERSON, ORG, { interestId: INTEREST }, true)).rejects.toMatchObject({
      code: "42501",
      message: "Inquiry not found",
      name: "MarketplaceRefusalError"
    })
    expect(calls.map((call) => call.fn)).toEqual(["landing_interest_disclosure"])
  })

  it("refuses a malformed inquiry or business before reaching the store", async () => {
    const { calls, db } = fakeDb(() => [])
    const disclosure = normalizedDisclosure(db)

    await expect(disclosure.sharePhone(PERSON, ORG, { interestId: "nope" }, true)).rejects.toBeInstanceOf(MarketplaceRefusalError)
    await expect(disclosure.sharePhone(PERSON, "", { interestId: INTEREST }, true)).rejects.toMatchObject({ code: "42501" })
    await expect(disclosure.inquiryDisclosure(PERSON, ORG, "nope")).resolves.toBeNull()
    await expect(disclosure.haulerJobAccess(PERSON, ORG, "nope")).resolves.toBeNull()
    expect(calls).toEqual([])
  })

  it("reads the landing's own disclosure state in a read-only transaction", async () => {
    const { calls, db, transactions } = fakeDb(() => [disclosureRow("2026-11-18 22:00:00+00")])

    await expect(normalizedDisclosure(db).inquiryDisclosure(PERSON, ORG, INTEREST)).resolves.toEqual({
      interestId: INTEREST,
      phone: "+15415550188",
      shared: true,
      sharedAt: "2026-11-18T22:00:00.000Z",
      status: "replied"
    })
    expect(calls).toEqual([{ args: { p_interest_id: INTEREST, p_org_id: ORG }, fn: "landing_interest_disclosure" }])
    expect(transactions).toEqual([{ principal: PERSON, readOnly: true }])
  })
})

describe("normalized disclosure: the hauler's view of released details", () => {
  it("returns the access notes, gate details and phone only when the store returns a live release", async () => {
    const live = fakeDb(() => [{
      directions: "County road 12, second left",
      gate_instructions: "Code at the gate",
      landing_id: LANDING,
      shared_at: "2026-11-18T22:00:00Z",
      site_contact_name: "Pat",
      site_contact_phone: "+15415550188"
    }])

    await expect(normalizedDisclosure(live.db).haulerJobAccess(PERSON, ORG, JOB)).resolves.toEqual({
      directions: "County road 12, second left",
      gateInstructions: "Code at the gate",
      landingId: LANDING,
      sharedAt: "2026-11-18T22:00:00.000Z",
      siteContactName: "Pat",
      siteContactPhone: "+15415550188"
    })
    expect(live.calls).toEqual([{ args: { p_job_id: JOB, p_org_id: ORG }, fn: "hauler_job_access" }])
    expect(live.transactions).toEqual([{ principal: PERSON, readOnly: true }])

    const none = fakeDb(() => [])
    await expect(normalizedDisclosure(none.db).haulerJobAccess(PERSON, ORG, JOB)).resolves.toBeNull()
  })

  it("refuses a drifted row without putting its contents in the error", async () => {
    const { db } = fakeDb(() => [{ landing_id: LANDING, site_contact_phone: "+15415550188" }])
    const error = await normalizedDisclosure(db).haulerJobAccess(PERSON, ORG, JOB).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(MarketplaceStoreError)
    expect(JSON.stringify(error)).not.toContain("5415550188")
    expect(String((error as Error).message)).not.toContain("5415550188")
    expect((error as MarketplaceStoreError).cause).toBeUndefined()
  })
})

describe("normalized disclosure: staff", () => {
  it("lists the open pauses read-only and maps each one", async () => {
    const { calls, db, transactions } = fakeDb(() => [{
      landings_in_window: 5,
      opened_at: "2026-11-18T21:00:00Z",
      pause_id: PAUSE,
      report_id: REPORT,
      report_status: "open",
      subject_id: ORG,
      subject_kind: "organization",
      subject_name: "Granite Creek Hauling"
    }])

    await expect(normalizedDisclosure(db).revealPauses(PERSON)).resolves.toEqual([{
      id: PAUSE,
      landingsInWindow: 5,
      openedAt: "2026-11-18T21:00:00.000Z",
      reportId: REPORT,
      reportStatus: "open",
      subjectId: ORG,
      subjectKind: "organization",
      subjectName: "Granite Creek Hauling"
    }])
    expect(calls).toEqual([{ args: {}, fn: "list_reveal_pauses" }])
    expect(transactions).toEqual([{ principal: PERSON, readOnly: true }])
  })

  it("clears one pause by id with the reason, and refuses a short reason before the store", async () => {
    const { calls, db, transactions } = fakeDb(() => [])
    const disclosure = normalizedDisclosure(db)

    await disclosure.clearRevealPause(PERSON, { pauseId: PAUSE, reason: "  Staff reviewed the hauler  " })
    expect(calls).toEqual([{ args: { p_pause_id: PAUSE, p_reason: "Staff reviewed the hauler" }, fn: "admin_clear_reveal_pause" }])
    expect(transactions).toEqual([{ principal: PERSON, readOnly: false }])

    await expect(disclosure.clearRevealPause(PERSON, { pauseId: PAUSE, reason: "ok" })).rejects.toMatchObject({
      code: "22023",
      message: "Give a reason of at least 5 characters."
    })
    expect(calls).toHaveLength(1)
  })
})
