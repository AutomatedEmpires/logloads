import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * The pilot adapter's port v3 surface (#244) over the REAL service layer (in-memory seed). The pilot store keeps none
 * of the records the new groups need, so every new method must refuse before reading or writing anything, and the
 * adapter must say so through `supports`. Its feature capabilities come from the same translated membership as its
 * store-reported ones.
 */

const hoisted = vi.hoisted(() => ({ mutateState: vi.fn(), readState: vi.fn() }))

vi.mock("server-only", () => ({}))
vi.mock("../services", async () => {
  const { createInMemoryDatabase } = await import("@logloads/db")
  const { createLogLoadsServices } = await import("@logloads/services")
  const { shiftSeedDates } = await import("../seed-dates")
  const services = createLogLoadsServices(shiftSeedDates(createInMemoryDatabase()))

  hoisted.readState.mockImplementation(async <T,>(read: (current: typeof services) => T) => read(services))

  return {
    mutateState: hoisted.mutateState,
    readState: hoisted.readState,
    serializeError: (error: unknown) => ({ error: error instanceof Error ? error.message : "Unknown error" }),
    services
  }
})

import { MARKETPLACE_V2_FEATURES, marketplaceFeatureCapabilities, marketplaceV2FeatureSupport } from "@logloads/contracts"
import { resolveMarketplaceActor } from "@logloads/services"

import { services } from "../services"
import { operatingStateMarketplaceV2, pilotMarketplaceV2 } from "./pilot-adapter"
import {
  MARKETPLACE_V2_FEATURE_OPERATIONS,
  MarketplaceFeatureUnavailableError,
  MarketplaceOperationUnavailableError,
  marketplaceV2FeatureMethods
} from "./port"

const state = services.state
const loader = state.profiles.find((profile) => profile.email === "loader@northpine.example")!
const northPine = state.organizations.find((organization) => organization.displayName === "North Pine Logging")!
const viewer = { organizationId: northPine.id, userId: loader.id }

beforeEach(() => {
  hoisted.mutateState.mockClear()
  hoisted.readState.mockClear()
})

describe("pilot adapter: port v3 groups (#244)", () => {
  it("supports no group, directly or through the V2 port", () => {
    expect(operatingStateMarketplaceV2.supports).toEqual(marketplaceV2FeatureSupport())
    expect(pilotMarketplaceV2.supports).toEqual(marketplaceV2FeatureSupport())
  })

  it("refuses every new method as unavailable on the pilot store, naming the operation, before touching it", async () => {
    let refused = 0

    for (const feature of MARKETPLACE_V2_FEATURES) {
      const operations: Readonly<Record<string, string>> = MARKETPLACE_V2_FEATURE_OPERATIONS[feature]

      for (const method of marketplaceV2FeatureMethods(feature)) {
        const call = operatingStateMarketplaceV2[method] as (...values: unknown[]) => Promise<unknown>
        const outcome = await call(viewer, "11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa", {}).then(
          () => null,
          (error: unknown) => error
        )

        expect(outcome, method).toBeInstanceOf(MarketplaceOperationUnavailableError)
        expect(outcome, method).not.toBeInstanceOf(MarketplaceFeatureUnavailableError)
        expect((outcome as Error).message).toBe(`${operations[method]} is not available until the normalized marketplace store is connected`)
        refused += 1
      }
    }

    expect(refused).toBe(51)
    expect(hoisted.readState).not.toHaveBeenCalled()
    expect(hoisted.mutateState).not.toHaveBeenCalled()
  })

  it("refuses through the V2 port every page uses, too", async () => {
    await expect(pilotMarketplaceV2.planAllowance(viewer)).rejects.toBeInstanceOf(MarketplaceOperationUnavailableError)
    await expect(pilotMarketplaceV2.inviteTeamMember(viewer, { email: "new@example.test" })).rejects.toBeInstanceOf(MarketplaceOperationUnavailableError)
    await expect(pilotMarketplaceV2.adminQueue({ userId: loader.id })).rejects.toBeInstanceOf(MarketplaceOperationUnavailableError)
    expect(hoisted.mutateState).not.toHaveBeenCalled()
  })
})

describe("pilot adapter: feature capabilities (#244)", () => {
  it("derives them from the same translated membership as the store-reported capabilities, for every seeded member", async () => {
    let checked = 0

    for (const membership of state.organizationMemberships.filter((candidate) => candidate.status === "active")) {
      const actor = { actorUserId: membership.userId, organizationId: membership.organizationId }
      let expected: ReturnType<typeof marketplaceFeatureCapabilities>

      try {
        expected = marketplaceFeatureCapabilities(resolveMarketplaceActor(state, actor).marketplace)
      } catch {
        continue
      }

      const capabilities = await operatingStateMarketplaceV2.viewerFeatureCapabilities({ organizationId: membership.organizationId, userId: membership.userId })

      expect(capabilities).toEqual(expected)
      checked += 1
    }

    expect(checked).toBeGreaterThan(0)
  })

  it("leaves viewerAccess as it was, and gives the landing desk its own feature capabilities", async () => {
    expect(await operatingStateMarketplaceV2.viewerAccess(viewer)).toEqual({
      capabilities: expect.arrayContaining(["job.publish"]),
      organizationName: "North Pine Logging"
    })
    expect(Object.keys(await operatingStateMarketplaceV2.viewerAccess(viewer)).sort()).toEqual(["capabilities", "organizationName"])
    expect(await pilotMarketplaceV2.viewerFeatureCapabilities(viewer))
      .toEqual(expect.arrayContaining(["truck.search", "boost.estimate", "plan.view", "alert.manage"]))
  })

  it("still refuses a person outside the business", async () => {
    const stranger = state.organizations.find((organization) =>
      organization.id !== northPine.id &&
      !state.organizationMemberships.some((candidate) => candidate.organizationId === organization.id && candidate.userId === loader.id))!

    await expect(operatingStateMarketplaceV2.viewerFeatureCapabilities({ organizationId: stranger.id, userId: loader.id })).rejects.toThrow()
  })
})

describe("pilot adapter: the day-14 reconfirmation rule (#308, #321)", () => {
  // The rule hides a job until its poster reconfirms it. The pilot store records no "still available" confirmation and
  // cannot take one, so the rule would hide every pilot job for good; it belongs to the normalized store (see the
  // adapter's header). These pin both facts, so changing either one is a deliberate decision.
  it("has nothing to apply it to: no pilot job carries a confirmation, and the pilot cannot reconfirm one", async () => {
    const board = await operatingStateMarketplaceV2.listJobs({ acceptingOnly: false })

    expect(board.length).toBeGreaterThan(0)
    expect(board.filter((job) => job.lastConfirmedAt !== null)).toEqual([])
    await expect(operatingStateMarketplaceV2.reconfirmJob(viewer, board[0]!.id, { action: "reconfirm", confirmedAt: new Date().toISOString() }))
      .rejects.toBeInstanceOf(MarketplaceOperationUnavailableError)
    expect(hoisted.mutateState).not.toHaveBeenCalled()
  })

  it("so its board and new interest follow each job's status alone, and no job reads as expired or paused for want of one", async () => {
    const accepting = await operatingStateMarketplaceV2.listJobs({ acceptingOnly: true })

    expect(accepting.length).toBeGreaterThan(0)
    expect(accepting.filter((job) => job.status !== "active" || !job.acceptingInterest)).toEqual([])
    expect(await operatingStateMarketplaceV2.getJob(accepting[0]!.id)).toMatchObject({ acceptingInterest: true, lastConfirmedAt: null, status: "active" })
  })
})

describe("pilot adapter: one read of the document per page (#280)", () => {
  it("pages the public board in listJobs order, each page from one read, with an exact count", async () => {
    const filters = { acceptingOnly: false }
    const all = await operatingStateMarketplaceV2.listJobs(filters)
    expect(all.length).toBeGreaterThan(0)
    hoisted.readState.mockClear()

    const seen: string[] = []
    let after: string | null = null
    let pages = 0

    do {
      // One job a page, so the seed's small public board still takes a page per job.
      const page: Awaited<ReturnType<typeof pilotMarketplaceV2.listJobPage>> = await pilotMarketplaceV2.listJobPage(filters, { after, limit: 1 })
      pages += 1
      expect(page.total).toEqual({ count: all.length, exact: true })
      expect(page.start).toBe(seen.length)
      // Each job carries its public detail fields, so the page never reads a job on its own.
      for (const job of page.items) expect(job).toHaveProperty("publicAccessRequirements")
      seen.push(...page.items.map((job) => job.id))
      after = page.nextCursor
    } while (after !== null && pages < 100)

    expect(seen).toEqual(all.map((job) => job.id))
    expect(pages).toBe(all.length)
    expect(hoisted.readState).toHaveBeenCalledTimes(pages)
  })

  it("pages a landing's inquiries from one read, through the same authority, and never another landing's", async () => {
    const ownJob = state.loadPostings.find((load) => load.companyId === northPine.id && load.status !== "draft")!
    const otherJob = state.loadPostings.find((load) => load.companyId !== northPine.id)!
    const hauler = state.organizations.find((organization) => organization.id !== northPine.id && organization.id !== otherJob.companyId)!
    const record = (minute: number, job: typeof ownJob) => {
      const at = new Date(Date.UTC(2026, 10, 1, 0, minute)).toISOString()
      return {
        availableFrom: null, availableUntil: null, contactPreference: "in_app" as const, createdAt: at, equipment: [],
        haulerOrganizationId: hauler.id, id: crypto.randomUUID(), jobOrganizationId: job.companyId, loadPostingId: job.id,
        message: `Private note ${minute}`, replies: [], respondedAt: null, status: "submitted" as const, submittedByUserId: loader.id,
        trucksOffered: 1, updatedAt: at, withdrawnAt: null
      }
    }
    const own = [record(1, ownJob), record(3, ownJob), record(2, ownJob)]
    const rival = record(9, otherJob)
    state.marketplaceInterests.push(...own, rival)

    try {
      hoisted.readState.mockClear()
      const first = await pilotMarketplaceV2.listInterestPage(viewer, "landing", { limit: 2 })
      const second = await pilotMarketplaceV2.listInterestPage(viewer, "landing", { after: first.nextCursor, limit: 2 })

      expect([...first.items, ...second.items].map((interest) => interest.id)).toEqual([own[1]!.id, own[2]!.id, own[0]!.id])
      expect(first.total).toEqual({ count: 3, exact: true })
      expect(second.nextCursor).toBeNull()
      expect(hoisted.readState).toHaveBeenCalledTimes(2)

      const stranger = state.organizations.find((organization) =>
        !state.organizationMemberships.some((candidate) => candidate.organizationId === organization.id && candidate.userId === loader.id))!
      await expect(pilotMarketplaceV2.listInterestPage({ organizationId: stranger.id, userId: loader.id }, "landing")).rejects.toThrow()
    } finally {
      state.marketplaceInterests.splice(state.marketplaceInterests.length - 4, 4)
    }
  })
})
