import { readFileSync } from "node:fs"

import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { validateMarketplaceJobDraft } from "@logloads/contracts"

import { createNormalizedMarketplaceV2 } from "./normalized-adapter"
import type { MarketplaceCalls, MarketplaceDb, MarketplaceFunctionName, MarketplaceInquiryParties, MarketplacePrincipal } from "./normalized-db"
import { MarketplaceRefusalError, type MarketplaceV2Viewer } from "./port"

/**
 * The normalized adapter over a recording fake of the store. Proves what the adapter itself adds on top of the
 * database's checks: identity from the injected session resolver, anonymous discovery, the active-business binding
 * for every write, the attestation rules, and input validation before anything reaches the store. The database's
 * own behaviour is proven against PostgreSQL 17 by `normalized-adapter.contract.test.ts` in CI.
 */

const NOW = new Date("2026-11-03T12:00:00.000Z")
const LAND = "33333333-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const HAUL = "44444444-cccc-4ccc-8ccc-cccccccccccc"
const OTHER = "88888888-cccc-4ccc-8ccc-cccccccccccc"
const USER = "55555555-dddd-4ddd-8ddd-dddddddddddd"
const JOB = "11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const INTEREST = "66666666-eeee-4eee-8eee-eeeeeeeeeeee"
const LANDING = "77777777-ffff-4fff-8fff-ffffffffffff"
const REPLY = "99999999-dddd-4ddd-8ddd-dddddddddddd"
const PRINCIPAL: MarketplacePrincipal = { audience: "logloads-test-audience", issuer: "https://clerk.logloads.test", subject: "user_test_subject" }

const landingViewer: MarketplaceV2Viewer = { organizationId: LAND, userId: USER }
const haulerViewer: MarketplaceV2Viewer = { organizationId: HAUL, userId: USER }

interface Recorded { session: "anon" | "user"; principal?: MarketplacePrincipal; readOnly?: boolean; fn: string; args: Record<string, unknown> }

function jobRow(overrides: Record<string, unknown> = {}) {
  return {
    accepting_interest: true, destination_label: null, ends_on: null, equipment_codes: ["log_truck"], est_one_way_miles: null,
    estimated_daily_loads: null, estimated_loads_per_truck_per_day: null, estimated_tons_per_load: null, expires_at: null,
    job_id: JOB, last_confirmed_at: null, last_modified_at: "2026-11-03T11:00:00+00:00", origin_label: "Near Vida, OR",
    origin_lat: 44.2, origin_lng: -122.5, origin_state_code: "OR", pay_amount_cents: 9100, pay_note: null, pay_unit: "per_ton",
    poster_name: "Adapter Timber", poster_organization_id: LAND, poster_verified: false, product: "Saw logs",
    public_access_requirements: [], public_road_notes: null, schedule_note: null, slug: JOB, sponsored: false,
    starts_on: "2026-12-01", status: "active", title: "Adapter Sawlog Run", trucks_per_day: null, trucks_total: 3,
    ...overrides
  }
}

function interestRow(overrides: Record<string, unknown> = {}) {
  return {
    available_from: null, available_until: null, contact_preference: "in_app", created_at: "2026-11-03T11:00:00+00:00",
    equipment: [], hauler_org_id: HAUL, hauler_org_name: "Adapter Hauling", hauler_org_type: "fleet", id: INTEREST,
    job_accepting_interest: true, job_id: JOB, job_slug: JOB, job_status: "active", job_title: "Adapter Sawlog Run",
    landing_org_id: LAND, landing_org_name: "Adapter Timber", message: null, replies: [], status: "submitted",
    submitted_by_name: "Haul Owner", submitted_by_user_id: USER, trucks_offered: 2, updated_at: "2026-11-03T11:00:00+00:00",
    ...overrides
  }
}

let recorded: Recorded[]
let responses: Partial<Record<MarketplaceFunctionName, unknown[]>>
let parties: MarketplaceInquiryParties | null
let inquiryJobs: unknown[]
let principal: ReturnType<typeof vi.fn>

function fakeDb(): MarketplaceDb {
  function calls(session: Recorded["session"], extra: Partial<Recorded>): MarketplaceCalls {
    return {
      async call(fn, args) {
        recorded.push({ ...extra, args: args as Record<string, unknown>, fn, session })
        return responses[fn] ?? []
      },
      async inquiryParties() {
        recorded.push({ ...extra, args: {}, fn: "inquiryParties", session })
        return parties
      },
      async inquiryJobs(organizationId) {
        recorded.push({ ...extra, args: { organizationId }, fn: "inquiryJobs", session })
        return inquiryJobs
      }
    }
  }

  return {
    asAnon: (work) => work(calls("anon", {})),
    asUser: (identity, work, options) => work(calls("user", { principal: identity, readOnly: options?.readOnly !== false })),
    close: async () => undefined
  }
}

function adapter() {
  return createNormalizedMarketplaceV2({ db: fakeDb(), now: () => NOW, principal: principal as never })
}

function storeCalls() {
  return recorded.filter((call) => call.fn !== "inquiryParties" && call.fn !== "inquiryJobs").map((call) => call.fn)
}

function publishDraft() {
  const result = validateMarketplaceJobDraft({
    durationDays: "10", equipment: ["log_truck"], landingId: LANDING, payAmount: "91", payUnit: "per_ton",
    product: "Saw logs", startsOn: "2026-12-01", title: "Adapter Sawlog Run", trucksRequested: "3"
  })
  if (!result.ok) throw new Error("fixture draft must be valid")
  return result.draft
}

const publishAttestation = { action: "publish" as const, confirmedAt: NOW.toISOString() }
const reconfirmAttestation = { action: "reconfirm" as const, confirmedAt: NOW.toISOString() }

beforeEach(() => {
  recorded = []
  responses = {}
  parties = { haulerOrganizationId: HAUL, jobId: JOB, jobOrganizationId: LAND }
  inquiryJobs = []
  principal = vi.fn(async () => PRINCIPAL)
})

describe("normalized adapter: identity and discovery", () => {
  it("reports native publishing", () => {
    expect(adapter().supportsPublishing).toBe(true)
  })

  it("runs public discovery anonymously, with no identity", async () => {
    responses.list_marketplace_jobs = [jobRow()]
    responses.get_marketplace_job = [jobRow()]

    expect((await adapter().listJobs({ query: "saw" }))[0]?.id).toBe(JOB)
    expect((await adapter().getJob(JOB))?.title).toBe("Adapter Sawlog Run")
    expect(recorded.map((call) => call.session)).toEqual(["anon", "anon"])
    expect(principal).not.toHaveBeenCalled()
  })

  it("sends the filters the function takes, then applies the rest with the contract's rules (#185)", async () => {
    const other = "11111111-aaaa-4aaa-8aaa-aaaaaaaaaaa2"
    responses.list_marketplace_jobs = [jobRow(), jobRow({ job_id: other, pay_amount_cents: 52500, pay_unit: "per_load", product: "Pulpwood", slug: other })]

    expect((await adapter().listJobs({ product: "Pulpwood" })).map((job) => job.id)).toEqual([other])
    expect((await adapter().listJobs({ sort: "pay" })).map((job) => job.id)).toEqual([other, JOB])
    expect(recorded[0]?.args).toEqual({ p_accepting_only: true, p_equipment: null, p_limit: 200, p_pay_unit: null, p_query: null })
  })

  it("answers not-found for an id that cannot exist, without asking the store", async () => {
    expect(await adapter().getJob("not-a-job")).toBeNull()
    expect(await adapter().interestForJob(haulerViewer, "../etc")).toBeNull()
    expect(recorded).toEqual([])
  })

  it("acts as the session's person for every signed-in call, read-only for reads", async () => {
    responses.get_viewer_marketplace_access = [{
      capabilities: ["job.publish"], hauler_profile: false, landing_workspace_seat: true, organization_id: LAND, organization_name: "Adapter Timber", role: "owner"
    }]

    expect(await adapter().viewerAccess(landingViewer)).toEqual({ capabilities: ["job.publish"], organizationName: "Adapter Timber" })
    expect(principal).toHaveBeenCalledWith(landingViewer)
    expect(recorded).toEqual([{ args: { p_org_id: LAND }, fn: "get_viewer_marketplace_access", principal: PRINCIPAL, readOnly: true, session: "user" }])
  })

  it("refuses when the session resolver refuses, before reaching the store", async () => {
    principal.mockRejectedValueOnce(new MarketplaceRefusalError("Sign in again to continue."))

    await expect(adapter().listLandingInterests(landingViewer)).rejects.toThrow("Sign in again")
    expect(recorded).toEqual([])
  })

  it("refuses a viewer whose business id is malformed", async () => {
    await expect(adapter().viewerAccess({ organizationId: "x'; --", userId: USER })).rejects.toBeInstanceOf(MarketplaceRefusalError)
    expect(principal).not.toHaveBeenCalled()
  })
})

describe("normalized adapter: inquiries stay inside the active business", () => {
  it("returns the stored inquiry after submitting it for the viewer's own hauling business", async () => {
    responses.submit_expression_of_interest = [{ created: true, interest_id: INTEREST }]
    responses.list_marketplace_interests = [interestRow()]

    const view = await adapter().expressInterest(haulerViewer, { loadPostingId: JOB, trucksOffered: "2" })

    expect(view.id).toBe(INTEREST)
    expect(recorded[0]).toMatchObject({ args: { p_hauler_org_id: HAUL, p_job_id: JOB, p_trucks_offered: 2 }, readOnly: false })
    expect(recorded[1]).toMatchObject({ args: { p_job_id: JOB, p_org_id: HAUL, p_side: "hauler" }, fn: "list_marketplace_interests" })
  })

  it("refuses to withdraw or reply to an inquiry of another business, even one the person also belongs to", async () => {
    parties = { haulerOrganizationId: OTHER, jobId: JOB, jobOrganizationId: LAND }

    await expect(adapter().withdrawInterest(haulerViewer, INTEREST)).rejects.toThrow("Inquiry not found")
    await expect(adapter().postHaulerReply(haulerViewer, { body: "Hello", interestId: INTEREST, replyId: REPLY })).rejects.toThrow("Inquiry not found")
    expect(storeCalls()).toEqual([])
  })

  it("refuses a landing response from the wrong side or another landing business", async () => {
    await expect(adapter().respondToInterest(haulerViewer, { decision: "viewed", interestId: INTEREST })).rejects.toThrow("Inquiry not found")

    parties = { haulerOrganizationId: HAUL, jobId: JOB, jobOrganizationId: OTHER }
    await expect(adapter().respondToInterest(landingViewer, { decision: "viewed", interestId: INTEREST })).rejects.toThrow("Inquiry not found")

    parties = null
    await expect(adapter().respondToInterest(landingViewer, { decision: "viewed", interestId: INTEREST })).rejects.toThrow("Inquiry not found")
    expect(storeCalls()).toEqual([])
  })

  it("responds, replies and withdraws for the right business, never sharing private details", async () => {
    await adapter().respondToInterest(landingViewer, { body: "Call us", decision: "replied", interestId: INTEREST, replyId: REPLY })
    await adapter().postHaulerReply(haulerViewer, { body: "On our way to quote", interestId: INTEREST, replyId: REPLY })
    await adapter().withdrawInterest(haulerViewer, INTEREST)

    expect(storeCalls()).toEqual(["respond_to_interest", "post_hauler_interest_reply", "withdraw_interest"])
    const respond = recorded.find((call) => call.fn === "respond_to_interest")
    expect(respond?.args).toEqual({ p_body: "Call us", p_interest_id: INTEREST, p_reply_id: REPLY, p_status: "replied" })
    expect(Object.keys(respond?.args ?? {})).not.toContain("p_share_private_details")
  })

  it("validates the form input before reaching the store", async () => {
    await expect(adapter().respondToInterest(landingViewer, { decision: "replied", interestId: INTEREST, replyId: REPLY })).rejects.toThrow("A reply needs a message")
    await expect(adapter().withdrawInterest(haulerViewer, "nope")).rejects.toBeInstanceOf(MarketplaceRefusalError)
    expect(recorded).toEqual([])
  })
})

describe("normalized adapter: inquiry conversations (UX-09, #132)", () => {
  const access = (capabilities: string[]) => [{
    capabilities, hauler_profile: false, landing_workspace_seat: true, organization_id: LAND, organization_name: "Adapter Timber", role: "owner"
  }]

  it("withdraws with the hauler's reason in one write: the reason first, then the withdrawal", async () => {
    responses.list_marketplace_interests = [interestRow()]

    await adapter().withdrawInterestWithReason(haulerViewer, { interestId: INTEREST, reason: " Booked elsewhere ", replyId: REPLY })

    expect(storeCalls()).toEqual(["list_marketplace_interests", "post_hauler_interest_reply", "withdraw_interest"])
    expect(new Set(recorded.map((call) => call.readOnly))).toEqual(new Set([false]))
    expect(recorded.find((call) => call.fn === "list_marketplace_interests")?.args).toEqual({ p_job_id: JOB, p_org_id: HAUL, p_side: "hauler" })
    expect(recorded.find((call) => call.fn === "post_hauler_interest_reply")?.args).toEqual({ p_body: "Booked elsewhere", p_interest_id: INTEREST, p_reply_id: REPLY })
  })

  it("withdraws without a message when there is no reason, and does nothing more for a withdrawn inquiry", async () => {
    responses.list_marketplace_interests = [interestRow()]
    await adapter().withdrawInterestWithReason(haulerViewer, { interestId: INTEREST, reason: "", replyId: REPLY })
    expect(storeCalls()).toEqual(["list_marketplace_interests", "withdraw_interest"])

    recorded = []
    responses.list_marketplace_interests = [interestRow({ status: "withdrawn" })]
    await adapter().withdrawInterestWithReason(haulerViewer, { interestId: INTEREST, reason: "Again", replyId: REPLY })
    expect(storeCalls()).toEqual(["list_marketplace_interests"])
  })

  it("refuses a declined inquiry with the landing's closure, before writing a reason (#194 HF-03)", async () => {
    responses.list_marketplace_interests = [interestRow({ status: "declined" })]

    await expect(adapter().withdrawInterestWithReason(haulerViewer, { interestId: INTEREST, reason: "Never mind", replyId: REPLY }))
      .rejects.toThrow("The landing has closed this inquiry")
    expect(storeCalls()).toEqual(["list_marketplace_interests"])
  })

  it("refuses another business's inquiry, and a reason without a reply id, before reaching the store", async () => {
    parties = { haulerOrganizationId: OTHER, jobId: JOB, jobOrganizationId: LAND }
    await expect(adapter().withdrawInterestWithReason(haulerViewer, { interestId: INTEREST, reason: "x", replyId: REPLY })).rejects.toThrow("Inquiry not found")
    await expect(adapter().withdrawInterestWithReason(haulerViewer, { interestId: INTEREST, reason: "x" })).rejects.toBeInstanceOf(MarketplaceRefusalError)
    expect(storeCalls()).toEqual([])
  })

  it("reads the landing's own inquiry jobs read-only, once inquiry.respond is confirmed", async () => {
    responses.get_viewer_marketplace_access = access(["inquiry.respond", "job.publish"])
    inquiryJobs = [
      { equipment_codes: ["log_truck", "pole_trailer"], job_id: JOB, landing_id: LANDING, landing_name: "Upper Spur" },
      { equipment_codes: null, job_id: INTEREST, landing_id: null, landing_name: null }
    ]

    expect(await adapter().landingInquiryJobs(landingViewer)).toEqual([
      { equipmentCodes: ["log_truck", "pole_trailer"], jobId: JOB, landing: { id: LANDING, name: "Upper Spur" } },
      { equipmentCodes: [], jobId: INTEREST, landing: null }
    ])
    expect(recorded.map((call) => [call.fn, call.readOnly])).toEqual([["get_viewer_marketplace_access", true], ["inquiryJobs", true]])
    expect(recorded[1]?.args).toEqual({ organizationId: LAND })
  })

  it("refuses the job context to a role without inquiry.respond: a cross-organization read is refused", async () => {
    responses.get_viewer_marketplace_access = access(["interest.express", "interest.reply"])

    await expect(adapter().landingInquiryJobs(haulerViewer)).rejects.toThrow("Inquiry not found")
    expect(recorded.map((call) => call.fn)).toEqual(["get_viewer_marketplace_access"])
  })
})

describe("normalized adapter: publishing and reconfirmation", () => {
  beforeEach(() => {
    responses.list_authoring_landings = [{ area_label: "Near Vida, OR", id: LANDING, name: "Upper Spur", state_code: "OR" }]
    responses.publish_job_posting = [JOB]
    responses.get_marketplace_job = [jobRow()]
  })

  it("publishes at one of the active business's own landings with the explicit attestation", async () => {
    await expect(adapter().publishJob(landingViewer, publishDraft(), publishAttestation)).resolves.toEqual({ jobId: JOB })

    expect(storeCalls()).toEqual(["list_authoring_landings", "publish_job_posting"])
    expect(recorded[0]?.args).toEqual({ p_org_id: LAND })
    expect(recorded[1]).toMatchObject({ args: { p_attest_available: true, p_landing_id: LANDING, p_pay_amount_cents: 9100 }, readOnly: false })
  })

  it("refuses a landing that is not one of the active business's own", async () => {
    responses.list_authoring_landings = []

    await expect(adapter().publishJob(landingViewer, publishDraft(), publishAttestation)).rejects.toThrow("Choose one of your organization's landings")
    expect(storeCalls()).toEqual(["list_authoring_landings"])
  })

  it("refuses without a fresh publish attestation, and never publishes a reconfirmation", async () => {
    await expect(adapter().publishJob(landingViewer, publishDraft(), reconfirmAttestation)).rejects.toBeInstanceOf(MarketplaceRefusalError)
    await expect(adapter().publishJob(landingViewer, publishDraft(), { action: "publish", confirmedAt: "2026-11-03T11:00:00.000Z" })).rejects.toBeInstanceOf(MarketplaceRefusalError)
    await expect(adapter().publishJob(landingViewer, publishDraft(), null as never)).rejects.toBeInstanceOf(MarketplaceRefusalError)
    expect(recorded).toEqual([])
  })

  it("refuses a draft that does not meet the publication rules", async () => {
    const draft = { ...publishDraft(), product: undefined }

    await expect(adapter().publishJob(landingViewer, draft, publishAttestation)).rejects.toThrow("Fix the highlighted fields")
    expect(recorded).toEqual([])
  })

  it("reconfirms only the active business's own job", async () => {
    await adapter().reconfirmJob(landingViewer, JOB, reconfirmAttestation)
    expect(storeCalls()).toEqual(["get_marketplace_job", "reconfirm_job_posting"])

    recorded = []
    responses.get_marketplace_job = [jobRow({ poster_organization_id: OTHER })]
    await expect(adapter().reconfirmJob(landingViewer, JOB, reconfirmAttestation)).rejects.toThrow("own job postings")
    expect(storeCalls()).toEqual(["get_marketplace_job"])
  })

  it("refuses a reconfirmation without its own attestation", async () => {
    await expect(adapter().reconfirmJob(landingViewer, JOB, publishAttestation)).rejects.toThrow("availability confirmation")
    expect(recorded).toEqual([])
  })
})

describe("normalized adapter: no path to the pilot store", () => {
  it("imports nothing that reads or writes operating_state, loads, slots or the pilot services", () => {
    for (const file of ["normalized-adapter.ts", "normalized-db.ts", "normalized-mapping.ts"]) {
      const source = readFileSync(new URL(`./${file}`, import.meta.url), "utf8")
      const imports = [...source.matchAll(/from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g)].map((match) => match[1] ?? match[2])

      expect(imports.filter((target) => /services|@logloads\/db|pilot-adapter|\.\/mapping$|network|session/.test(target ?? ""))).toEqual([])
    }
  })
})
