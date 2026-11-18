import { beforeEach, describe, expect, it, vi } from "vitest"

import { NOT_IN_YOUR_AREA_YET } from "@logloads/contracts"

/**
 * The share page asks `public_area_notice` only on the normalized store, and only with a job id (#287, #324).
 */

const mocks = vi.hoisted(() => ({
  areaNotice: vi.fn(),
  kind: "pilot" as "pilot" | "normalized"
}))

vi.mock("server-only", () => ({}))
vi.mock("@/lib/marketplace-v2/adapter", () => ({
  marketplaceV2AdapterKind: () => mocks.kind,
  normalizedAdapterConfiguration: () => ({ databaseUrl: "postgres://normalized.example/logloads" })
}))
vi.mock("@/lib/marketplace-v2/normalized-db", () => ({
  createPostgresMarketplaceDb: () => ({ kind: "db" })
}))
vi.mock("@/lib/marketplace-v2/basins/normalized", () => ({
  normalizedBasins: () => ({ areaNotice: (input: unknown) => mocks.areaNotice(input) })
}))

import { shareJobAreaNotice } from "@/lib/marketplace-v2/basins/notice"

const JOB_ID = "11111111-1111-4111-8111-111111111111"

describe("shareJobAreaNotice", () => {
  beforeEach(() => {
    mocks.kind = "pilot"
    mocks.areaNotice.mockReset()
    mocks.areaNotice.mockResolvedValue(null)
  })

  it("stays quiet on the pilot store", async () => {
    await expect(shareJobAreaNotice(JOB_ID)).resolves.toBeNull()
    expect(mocks.areaNotice).not.toHaveBeenCalled()
  })

  it("asks by job id and returns only the exact sentence", async () => {
    mocks.kind = "normalized"
    mocks.areaNotice.mockResolvedValue(NOT_IN_YOUR_AREA_YET)

    await expect(shareJobAreaNotice(JOB_ID)).resolves.toBe(NOT_IN_YOUR_AREA_YET)
    expect(mocks.areaNotice).toHaveBeenCalledWith({ jobId: JOB_ID })

    mocks.areaNotice.mockResolvedValue("jobs nearby")
    await expect(shareJobAreaNotice(JOB_ID)).resolves.toBeNull()
  })

  it("does not send an id that is not a job id", async () => {
    mocks.kind = "normalized"

    await expect(shareJobAreaNotice("not-a-job")).resolves.toBeNull()
    await expect(shareJobAreaNotice(`${JOB_ID};select`)).resolves.toBeNull()
    await expect(shareJobAreaNotice("")).resolves.toBeNull()
    expect(mocks.areaNotice).not.toHaveBeenCalled()
  })
})
