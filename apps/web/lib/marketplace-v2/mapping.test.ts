import { MARKETPLACE_EQUIPMENT_TYPES, MARKETPLACE_VERIFICATION_SCOPES } from "@logloads/contracts"
import { createInMemoryDatabase } from "@logloads/db"
import { marketplaceJobStatus } from "@logloads/services"
import { describe, expect, it } from "vitest"

import { buildNetworkView } from "../network"
import { marketplaceV2Enabled } from "./flag"
import { pilotJobEquipment, pilotPosterVerification, toInterestView, toJobDetailView } from "./mapping"

// Seed fixtures are dated June 2026; pin the clock inside that window.
const AT = new Date("2026-06-05T18:00:00.000Z")

function publicJobs() {
  const state = createInMemoryDatabase()
  const view = buildNetworkView(state, { kind: "public" }, AT)
  const jobs = view.loads.flatMap((networkLoad) => {
    const load = state.loadPostings.find((candidate) => candidate.id === networkLoad.id)
    return load ? [toJobDetailView(networkLoad, load, null, marketplaceJobStatus(load, AT.toISOString()))] : []
  })

  return { jobs, state }
}

describe("pilot poster verification (#150)", () => {
  const organization = { id: "11111111-1111-4111-8111-111111111111", verificationStatus: "verified" as const }
  const record = {
    createdAt: "2026-09-01T00:00:00.000Z",
    evidenceSummary: "Oregon SOS registry entry reviewed",
    expiresAt: null,
    id: "88888888-8888-4888-8888-888888888888",
    lastCheckedAt: "2026-10-14T16:20:00.000Z",
    reviewerUserId: "33333333-3333-4333-8333-333333333333",
    source: "official_record_reviewed" as const,
    status: "verified" as const,
    subjectId: organization.id,
    subjectType: "organization" as const,
    updatedAt: "2026-10-14T16:20:00.000Z",
    verificationType: "organization" as const,
    verifiedAt: "2026-10-14T16:20:00.000Z"
  }

  it("names business identity, with the review date from the organization's record", () => {
    expect(pilotPosterVerification(organization, [record])).toEqual({ reviewedOn: "2026-10-14", scope: "business_identity" })
  })

  it("uses the latest verified organization review and ignores other subjects and check types", () => {
    const earlier = { ...record, id: "44444444-4444-4444-8444-444444444444", verifiedAt: "2026-03-02T09:00:00.000Z" }
    const insurance = { ...record, id: "55555555-5555-4555-8555-555555555555", verificationType: "insurance_document" as const, verifiedAt: "2026-11-01T00:00:00.000Z" }
    const otherOrg = { ...record, id: "66666666-6666-4666-8666-666666666666", subjectId: "77777777-7777-4777-8777-777777777777", verifiedAt: "2026-11-01T00:00:00.000Z" }

    expect(pilotPosterVerification(organization, [earlier, insurance, otherOrg, record])?.reviewedOn).toBe("2026-10-14")
  })

  it("keeps the scope but claims no date when no review date is on record", () => {
    expect(pilotPosterVerification(organization, [])).toEqual({ reviewedOn: null, scope: "business_identity" })
  })

  it.each(["pending", "rejected", "suspended"] as const)("claims nothing for a %s organization", (verificationStatus) => {
    expect(pilotPosterVerification({ ...organization, verificationStatus }, [record])).toBeNull()
  })

  it("claims nothing for an unknown organization", () => {
    expect(pilotPosterVerification(undefined, [record])).toBeNull()
    expect(pilotPosterVerification(null, [record])).toBeNull()
  })

  it("only ever claims a scope from the fixed list", () => {
    const state = createInMemoryDatabase()

    for (const candidate of state.organizations) {
      const verification = pilotPosterVerification(candidate, state.verificationRecords)
      expect(verification === null || MARKETPLACE_VERIFICATION_SCOPES.includes(verification.scope)).toBe(true)
      if (candidate.verificationStatus !== "verified") expect(verification).toBeNull()
    }
  })
})

describe("Marketplace V2 public job mapping", () => {
  it("produces real seeded jobs only and never fabricates pay", () => {
    const { jobs, state } = publicJobs()

    expect(jobs.length).toBeGreaterThan(0)
    for (const job of jobs) {
      const load = state.loadPostings.find((candidate) => candidate.id === job.id)
      expect(load).toBeDefined()
      expect(job.pay).toEqual(load?.driverPayCents ? { amountCents: load.driverPayCents, note: null, unit: "per_load" } : { amountCents: null, note: null, unit: null })
      expect(job.estimatedDailyLoads).toBeNull()
      expect(job.estimatedLoadsPerTruckPerDay).toBeNull()
      expect(job.posterOrganizationId).toBe(load?.companyId)
    }
  })

  it("never presents a pilot edit as an availability confirmation", () => {
    const { jobs, state } = publicJobs()

    for (const job of jobs) {
      const load = state.loadPostings.find((candidate) => candidate.id === job.id)
      expect(job.lastConfirmedAt).toBeNull()
      expect(job.lastModifiedAt).toBe(load?.updatedAt)
      expect(job.expiresAt).toBeNull()
    }
  })

  it("keeps trucks per day separate from an unknown job total", () => {
    const { jobs, state } = publicJobs()

    for (const job of jobs) {
      const load = state.loadPostings.find((candidate) => candidate.id === job.id)
      // Pilot capacity counts truckloads, not trucks: the job's total truck count is unknown.
      expect(job.trucks).toEqual({ perDay: load?.dailyTruckCountNeeded ?? null, total: null })
    }
  })

  it("exposes only 0.1°-rounded coordinates (V2-DEC-01) and no private access or contact data", () => {
    const { jobs, state } = publicJobs()
    const serialized = JSON.stringify(jobs)
    const secrets = [
      ...state.richLandingDetails.flatMap((detail) => [detail.gateInstructions, detail.privateRoadNotes, detail.stagingInstructions, detail.communicationInstructions]),
      ...state.haulRoutes.map((route) => route.roadNotes),
      ...state.landings.map((landing) => landing.accessNotes),
      ...state.richLandingDetails.flatMap((detail) => [String(detail.entranceLat), String(detail.entranceLng)]),
      ...state.landings.flatMap((landing) => [String(landing.coordinates.lat), String(landing.coordinates.lng)])
    ].filter((value): value is string => typeof value === "string" && value.trim().length > 6)

    expect(secrets.length).toBeGreaterThan(0)
    for (const secret of secrets) {
      expect(serialized).not.toContain(secret)
    }

    const points = jobs.flatMap((job) => job.origin.approximatePoint ? [job.origin.approximatePoint] : [])
    expect(points.length).toBeGreaterThan(0)
    for (const point of points) {
      expect(JSON.stringify(point.lat)).toMatch(/^-?\d+(\.\d)?$/)
      expect(JSON.stringify(point.lng)).toMatch(/^-?\d+(\.\d)?$/)
    }
  })

  it("lists equipment as taxonomy codes only, and other pilot tags as requirements in words (#129)", () => {
    const { jobs, state } = publicJobs()
    const codes = new Set<string>(MARKETPLACE_EQUIPMENT_TYPES.map((type) => type.code))

    for (const job of jobs) {
      for (const code of job.equipment) expect(codes.has(code)).toBe(true)
      for (const requirement of job.publicAccessRequirements) expect(requirement).toMatch(/^[A-Z][^_-]*$/)
    }

    const saw = jobs.find((job) => job.title === "Oak saw-log morning run")
    expect(saw?.equipment).toEqual(["pole_trailer"])
    expect(state.loadPostings.some((load) => load.equipmentRequirements.includes("chains"))).toBe(true)
  })

  it("splits pilot tags without guessing a code for an unknown one", () => {
    expect(pilotJobEquipment(["pole-trailer", "chip-box", "chains", "pole_trailer", "snow kit"])).toEqual({
      codes: ["pole_trailer", "chip_van"],
      otherRequirements: ["Chains", "Snow kit"]
    })
  })

  it("marks only active jobs as accepting interest", () => {
    const { jobs } = publicJobs()

    for (const job of jobs) {
      expect(job.acceptingInterest).toBe(job.status === "active")
    }
    expect(jobs.some((job) => job.status === "active")).toBe(true)
  })

  it("builds inquiry views with names but no contact details", () => {
    const { state } = publicJobs()
    const job = state.loadPostings.find((candidate) => candidate.title === "Oak saw-log morning run")
    const hauler = state.organizations.find((organization) => organization.displayName === "New River Hauling")
    const submitter = state.profiles.find((profile) => profile.email === "emptyfleet@logloads.example")

    if (!job || !hauler || !submitter) throw new Error("seed fixture missing")

    const view = toInterestView(state, {
      availableFrom: null, availableUntil: null, contactPreference: "phone", createdAt: AT.toISOString(),
      equipment: [{ configurationKey: "log_truck|pole_trailer", count: 2, label: "Log truck + Pole trailer" }], haulerOrganizationId: hauler.id,
      id: "aaaaaaaa-0000-4000-8000-000000000009", jobOrganizationId: job.companyId, loadPostingId: job.id, message: null,
      replies: [], respondedAt: null, status: "submitted", submittedByUserId: submitter.id, trucksOffered: 2,
      updatedAt: AT.toISOString(), withdrawnAt: null
    }, (load) => marketplaceJobStatus(load, AT.toISOString()))

    expect(view).toMatchObject({
      equipment: [{ count: 2, label: "Log truck + Pole trailer" }],
      haulerOrganization: { name: "New River Hauling" },
      job: { acceptingInterest: true, title: job.title },
      trucksOffered: 2
    })
    expect(JSON.stringify(view)).not.toContain(submitter.phone)
  })
})

describe("Marketplace V2 flag", () => {
  it("is off unless explicitly enabled, and never on a hosted production deployment", () => {
    expect(marketplaceV2Enabled({})).toBe(false)
    expect(marketplaceV2Enabled({ LOGLOADS_MARKETPLACE_V2: "true" })).toBe(false)
    expect(marketplaceV2Enabled({ LOGLOADS_MARKETPLACE_V2: "enabled" })).toBe(true)
    expect(marketplaceV2Enabled({ LOGLOADS_MARKETPLACE_V2: "enabled", VERCEL_ENV: "preview" })).toBe(true)
    expect(marketplaceV2Enabled({ LOGLOADS_MARKETPLACE_V2: "enabled", VERCEL_ENV: "production" })).toBe(false)
  })
})
