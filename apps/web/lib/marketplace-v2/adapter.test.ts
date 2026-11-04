import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import {
  marketplaceV2AdapterKind,
  normalizedAdapterConfiguration,
  selectMarketplaceV2Port,
  sessionPrincipalResolver
} from "./adapter"
import { MarketplaceAdapterConfigurationError, MarketplaceRefusalError, type MarketplaceV2Port } from "./port"

const VIEWER = { organizationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }
const IDENTITY = { audience: "logloads-test-audience", issuer: "https://clerk.logloads.test" }

function spyPort(supportsPublishing: boolean): MarketplaceV2Port {
  const resolved = <T,>(value: T) => vi.fn(async () => value)

  return {
    authoringLandings: resolved([]),
    expressInterest: vi.fn(),
    getJob: resolved(null),
    haulerEquipment: resolved([]),
    haulerProfile: resolved({ organizationId: "org" }),
    interestForJob: resolved(null),
    listHaulerInterests: resolved([]),
    listJobs: resolved([]),
    listLandingInterests: resolved([]),
    postHaulerReply: resolved(undefined),
    publishJob: resolved({ jobId: "job" }),
    reconfirmJob: resolved(undefined),
    reportListing: resolved({ alreadyReported: false, reportId: "report", reportedAt: "2026-11-03T12:00:00.000Z" }),
    respondToInterest: resolved(undefined),
    saveHaulerProfile: resolved({ organizationId: "org" }),
    supportsHaulerProfile: supportsPublishing,
    supportsPublishing,
    viewerAccess: resolved({ capabilities: [], organizationName: "Test" }),
    withdrawInterest: resolved(undefined)
  } as unknown as MarketplaceV2Port
}

describe("marketplaceV2AdapterKind", () => {
  it("defaults to the pilot adapter", () => {
    expect(marketplaceV2AdapterKind({})).toBe("pilot")
    expect(marketplaceV2AdapterKind({ LOGLOADS_MARKETPLACE_V2_ADAPTER: "" })).toBe("pilot")
    expect(marketplaceV2AdapterKind({ LOGLOADS_MARKETPLACE_V2_ADAPTER: " Pilot " })).toBe("pilot")
  })

  it("selects the normalized adapter only when asked for by name", () => {
    expect(marketplaceV2AdapterKind({ LOGLOADS_MARKETPLACE_V2_ADAPTER: "normalized" })).toBe("normalized")
    expect(marketplaceV2AdapterKind({ LOGLOADS_MARKETPLACE_V2_ADAPTER: " NORMALIZED ", VERCEL_ENV: "preview" })).toBe("normalized")
  })

  it("is inert in production whatever the setting", () => {
    expect(marketplaceV2AdapterKind({ LOGLOADS_MARKETPLACE_V2_ADAPTER: "normalized", VERCEL_ENV: "production" })).toBe("pilot")
    expect(marketplaceV2AdapterKind({ LOGLOADS_MARKETPLACE_V2_ADAPTER: "typo", VERCEL_ENV: "production" })).toBe("pilot")
  })

  it("refuses an unknown value instead of guessing", () => {
    expect(() => marketplaceV2AdapterKind({ LOGLOADS_MARKETPLACE_V2_ADAPTER: "normalised" })).toThrow(MarketplaceAdapterConfigurationError)
  })
})

describe("normalizedAdapterConfiguration", () => {
  const complete = {
    LOGLOADS_NORMALIZED_DATABASE_URL: "postgresql://adapter_role@127.0.0.1:5432/example_marker_db",
    LOGLOADS_NORMALIZED_IDENTITY_AUDIENCE: IDENTITY.audience,
    LOGLOADS_NORMALIZED_IDENTITY_ISSUER: IDENTITY.issuer
  }

  it("reads the connection and the identity issuer and audience", () => {
    expect(normalizedAdapterConfiguration(complete)).toEqual({
      databaseUrl: complete.LOGLOADS_NORMALIZED_DATABASE_URL,
      identity: IDENTITY,
      identitySyncDatabaseUrl: null
    })
  })

  it("reads an optional identity-sync connection, which must be its own login (#213)", () => {
    const sync = "postgresql://identity_sync_role@127.0.0.1:5432/example_marker_db"

    expect(normalizedAdapterConfiguration({ ...complete, LOGLOADS_NORMALIZED_IDENTITY_SYNC_DATABASE_URL: ` ${sync} ` }).identitySyncDatabaseUrl).toBe(sync)
    expect(normalizedAdapterConfiguration({ ...complete, LOGLOADS_NORMALIZED_IDENTITY_SYNC_DATABASE_URL: " " }).identitySyncDatabaseUrl).toBeNull()
    expect(() => normalizedAdapterConfiguration({ ...complete, LOGLOADS_NORMALIZED_IDENTITY_SYNC_DATABASE_URL: "mysql://nope" }))
      .toThrow(/set LOGLOADS_NORMALIZED_IDENTITY_SYNC_DATABASE_URL$/)
    expect(() => normalizedAdapterConfiguration({
      ...complete,
      LOGLOADS_NORMALIZED_IDENTITY_SYNC_DATABASE_URL: complete.LOGLOADS_NORMALIZED_DATABASE_URL
    })).toThrow(MarketplaceAdapterConfigurationError)
  })

  it("names every missing setting and never prints a value", () => {
    const attempt = () => normalizedAdapterConfiguration({ LOGLOADS_NORMALIZED_DATABASE_URL: "mysql://nope" })

    expect(attempt).toThrow(MarketplaceAdapterConfigurationError)
    expect(attempt).toThrow(/LOGLOADS_NORMALIZED_DATABASE_URL, LOGLOADS_NORMALIZED_IDENTITY_ISSUER, LOGLOADS_NORMALIZED_IDENTITY_AUDIENCE/)
    expect(() => normalizedAdapterConfiguration({ ...complete, LOGLOADS_NORMALIZED_IDENTITY_AUDIENCE: " " })).toThrow(/AUDIENCE/)

    try {
      normalizedAdapterConfiguration({ ...complete, LOGLOADS_NORMALIZED_IDENTITY_ISSUER: "" })
    } catch (error) {
      expect(String(error)).not.toContain("example_marker_db")
    }
  })
})

describe("selectMarketplaceV2Port", () => {
  it("passes every call to the pilot adapter by default and never builds the normalized one", async () => {
    const pilot = spyPort(false)
    const normalized = vi.fn(() => spyPort(true))
    const port = selectMarketplaceV2Port(pilot, { kind: () => "pilot", normalized })

    expect(port.supportsPublishing).toBe(false)
    await port.listJobs({ acceptingOnly: true })
    await port.viewerAccess(VIEWER)
    await port.withdrawInterest(VIEWER, "interest")

    expect(pilot.listJobs).toHaveBeenCalledWith({ acceptingOnly: true })
    expect(pilot.viewerAccess).toHaveBeenCalledWith(VIEWER)
    expect(pilot.withdrawInterest).toHaveBeenCalledWith(VIEWER, "interest")
    expect(normalized).not.toHaveBeenCalled()
  })

  it("routes every call to the normalized adapter when selected, so the pilot store is never written", async () => {
    const pilot = spyPort(false)
    const target = spyPort(true)
    const port = selectMarketplaceV2Port(pilot, { kind: () => "normalized", normalized: () => target })
    const attestation = { action: "publish" as const, confirmedAt: "2026-11-03T12:00:00.000Z" }

    expect(port.supportsPublishing).toBe(true)
    await port.publishJob(VIEWER, {} as never, attestation)
    await port.respondToInterest(VIEWER, { interestId: "x" })
    await port.getJob("job")
    await port.getJob("job", VIEWER)
    await port.reportListing(VIEWER, { jobId: "job", reason: "stale" })

    expect(target.publishJob).toHaveBeenCalledWith(VIEWER, {}, attestation)
    expect(target.respondToInterest).toHaveBeenCalledWith(VIEWER, { interestId: "x" })
    expect(target.getJob).toHaveBeenCalledWith("job", undefined)
    expect(target.getJob).toHaveBeenCalledWith("job", VIEWER)
    expect(target.reportListing).toHaveBeenCalledWith(VIEWER, { jobId: "job", reason: "stale" })

    for (const method of Object.values(pilot)) {
      if (typeof method === "function") expect(method).not.toHaveBeenCalled()
    }
  })

  it("routes the hauler profile methods (#125) like every other call", async () => {
    const pilot = spyPort(false)
    const target = spyPort(true)

    const viaPilot = selectMarketplaceV2Port(pilot, { kind: () => "pilot", normalized: () => target })
    expect(viaPilot.supportsHaulerProfile).toBe(false)
    await viaPilot.haulerProfile(VIEWER)
    expect(pilot.haulerProfile).toHaveBeenCalledWith(VIEWER)

    const viaNormalized = selectMarketplaceV2Port(pilot, { kind: () => "normalized", normalized: () => target })
    expect(viaNormalized.supportsHaulerProfile).toBe(true)
    await viaNormalized.saveHaulerProfile(VIEWER, { businessName: "x" })
    expect(target.saveHaulerProfile).toHaveBeenCalledWith(VIEWER, { businessName: "x" })
    expect(pilot.saveHaulerProfile).not.toHaveBeenCalled()
  })

  it("fails closed on a broken selection: calls reject and nothing claims to publish", async () => {
    const pilot = spyPort(false)
    const port = selectMarketplaceV2Port(pilot, {
      kind: () => "normalized",
      normalized: () => {
        throw new MarketplaceAdapterConfigurationError("not configured")
      }
    })

    expect(port.supportsPublishing).toBe(false)
    expect(port.supportsHaulerProfile).toBe(false)
    await expect(port.listJobs({})).rejects.toBeInstanceOf(MarketplaceAdapterConfigurationError)
    await expect(port.viewerAccess(VIEWER)).rejects.toBeInstanceOf(MarketplaceAdapterConfigurationError)
    expect(pilot.listJobs).not.toHaveBeenCalled()
  })
})

describe("sessionPrincipalResolver", () => {
  // The normalized V2 session's person (#213): their app_users id and the Clerk user id they resolve from.
  const session = (overrides: { userId?: string; subject?: string } = {}) => ({ subject: "user_test_clerk_subject", userId: VIEWER.userId, ...overrides })

  it("uses the session's Clerk user id with the configured issuer and audience", async () => {
    const resolve = sessionPrincipalResolver(IDENTITY, async () => session())

    await expect(resolve(VIEWER)).resolves.toEqual({ ...IDENTITY, subject: "user_test_clerk_subject" })
  })

  it("refuses a viewer that is not the session's own person", async () => {
    const resolve = sessionPrincipalResolver(IDENTITY, async () => session({ userId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }))

    await expect(resolve(VIEWER)).rejects.toBeInstanceOf(MarketplaceRefusalError)
  })

  it("refuses when there is no session or no Clerk user id", async () => {
    await expect(sessionPrincipalResolver(IDENTITY, async () => null)(VIEWER)).rejects.toBeInstanceOf(MarketplaceRefusalError)
    await expect(sessionPrincipalResolver(IDENTITY, async () => session({ subject: " " }))(VIEWER)).rejects.toBeInstanceOf(MarketplaceRefusalError)
  })
})
