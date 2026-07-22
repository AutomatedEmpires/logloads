import { afterEach, describe, expect, it, vi } from "vitest"

import { createInMemoryDatabase } from "./store"
import {
  initializeRemoteOperatingState,
  loadRemoteOperatingState,
  mutateRemoteOperatingState,
  updateRemoteOperatingState,
  upgradeStateSnapshot,
  type RemoteSnapshotConfig
} from "./snapshot"
import type { LogLoadsDatabaseState } from "./types"

const config: RemoteSnapshotConfig = {
  key: "test-service-role-key",
  url: "https://logloads.test"
}

interface StoredRow {
  id: string
  schema_version: number
  state: LogLoadsDatabaseState
  version: number
}

class FakeOperatingStateApi {
  private row: StoredRow | null
  private injectConflict = false

  constructor(state: LogLoadsDatabaseState | null, version = 0) {
    this.row = state
      ? { id: "primary", schema_version: 2, state: structuredClone(state), version }
      : null
  }

  conflictOnNextPatch(): void {
    this.injectConflict = true
  }

  snapshot(): StoredRow | null {
    return this.row ? structuredClone(this.row) : null
  }

  fetch = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(String(input))
    const method = init.method ?? "GET"

    if (method === "GET") {
      return Response.json(this.row ? [this.row] : [])
    }

    if (method === "POST") {
      if (this.row) {
        return Response.json([])
      }

      const body = JSON.parse(String(init.body)) as StoredRow
      this.row = structuredClone(body)

      return Response.json([this.row], { status: 201 })
    }

    if (method === "PATCH") {
      const expectedVersion = Number(url.searchParams.get("version")?.replace("eq.", ""))

      if (this.injectConflict && this.row) {
        this.row.state.profiles[2]!.fullName = "Concurrent operator"
        this.row.version += 1
        this.injectConflict = false
      }

      // Yield once so two writers can both complete their initial read before
      // either compare-and-swap is evaluated.
      await Promise.resolve()

      if (!this.row || this.row.version !== expectedVersion) {
        return Response.json([])
      }

      const body = JSON.parse(String(init.body)) as Omit<StoredRow, "id">
      this.row = {
        id: "primary",
        schema_version: body.schema_version,
        state: structuredClone(body.state),
        version: body.version
      }

      return Response.json([this.row])
    }

    return new Response(null, { status: 405 })
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("canonical operating state", () => {
  it("awaits the canonical row during a cold start", async () => {
    const state = createInMemoryDatabase()
    let release: ((response: Response) => void) | undefined
    let settled = false

    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            release = resolve
          })
      )
    )

    const pending = loadRemoteOperatingState(config).then((snapshot) => {
      settled = true
      return snapshot
    })

    await Promise.resolve()
    expect(settled).toBe(false)

    release?.(
      Response.json([
        { id: "primary", schema_version: 2, state, version: 7 }
      ])
    )

    await expect(pending).resolves.toMatchObject({ schemaVersion: 2, version: 7 })
  })

  it("retries one transient network failure and returns canonical state", async () => {
    const state = createInMemoryDatabase()
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("connection timed out"))
      .mockResolvedValueOnce(
        Response.json([{ id: "primary", schema_version: 2, state, version: 9 }])
      )

    vi.stubGlobal("fetch", fetchMock)

    await expect(loadRemoteOperatingState(config)).resolves.toMatchObject({
      schemaVersion: 2,
      version: 9
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("retries one transient HTTP response and returns canonical state", async () => {
    const state = createInMemoryDatabase()
    let responseBodyCanceled = false
    const transientResponse = new Response(
      new ReadableStream({
        cancel() {
          responseBodyCanceled = true
        }
      }),
      { status: 503 }
    )
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(transientResponse)
      .mockResolvedValueOnce(
        Response.json([{ id: "primary", schema_version: 2, state, version: 10 }])
      )

    vi.stubGlobal("fetch", fetchMock)

    await expect(loadRemoteOperatingState(config)).resolves.toMatchObject({
      schemaVersion: 2,
      version: 10
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(responseBodyCanceled).toBe(true)
  })

  it("fails closed after two transient read failures", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("connection timed out"))

    vi.stubGlobal("fetch", fetchMock)

    await expect(loadRemoteOperatingState(config)).rejects.toThrow(
      "Canonical operating state could not be reached: connection timed out"
    )
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("upgrades a legacy mirror without dropping existing data", async () => {
    const legacy = createInMemoryDatabase() as Partial<LogLoadsDatabaseState>
    const originalProfiles = legacy.profiles?.length ?? 0

    delete legacy.tripReviews
    delete legacy.supportRequests

    expect(upgradeStateSnapshot(legacy)).toMatchObject({
      profiles: expect.arrayContaining([expect.any(Object)]),
      supportRequests: [],
      tripReviews: []
    })

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json([{ id: "primary", state: legacy }]))
    )

    const snapshot = await loadRemoteOperatingState(config)

    expect(snapshot?.schemaVersion).toBe(1)
    expect(snapshot?.version).toBe(0)
    expect(snapshot?.state.tripReviews).toEqual([])
    expect(snapshot?.state.supportRequests).toEqual([])
    expect(snapshot?.state.profiles).toHaveLength(originalProfiles)
  })

  it("normalizes route packs stored before assignment snapshots existed", () => {
    const legacy = createInMemoryDatabase() as Partial<LogLoadsDatabaseState>

    // A document written before packs were per-assignment: no assignmentId,
    // no version, no snapshot. Readers must not receive undefined for fields
    // the contract types as present.
    legacy.routePacks = (legacy.routePacks ?? []).map((pack) => {
      const stored: Record<string, unknown> = { ...pack }

      delete stored.assignmentId
      delete stored.version
      delete stored.snapshot
      delete stored.supersededAt

      return stored as (typeof pack)
    })

    const upgraded = upgradeStateSnapshot(legacy)
    const first = upgraded?.routePacks[0]

    expect(upgraded?.routePacks.length).toBeGreaterThan(0)
    // No assignmentId means it is the host's load-level source, version 1.
    expect(first?.assignmentId).toBeNull()
    expect(first?.version).toBe(1)
    expect(first?.snapshot).toBeNull()
    expect(first?.supersededAt).toBeNull()
    // Existing operational content is untouched.
    expect(first?.calculatedRouteSummary).toBeTruthy()
  })

  it("keeps an assignment pack's own version and snapshot on upgrade", () => {
    const legacy = createInMemoryDatabase() as Partial<LogLoadsDatabaseState>
    const [pack] = legacy.routePacks ?? []

    expect(pack).toBeDefined()
    if (!pack) return

    legacy.routePacks = [{ ...pack, assignmentId: "ffffffff-ffff-4fff-8fff-fffffffffff1", version: 3 }]

    const upgraded = upgradeStateSnapshot(legacy)

    expect(upgraded?.routePacks[0]?.assignmentId).toBe("ffffffff-ffff-4fff-8fff-fffffffffff1")
    expect(upgraded?.routePacks[0]?.version).toBe(3)
  })

  it("backfills landing safety and destination completion evidence", () => {
    const legacy = createInMemoryDatabase() as Partial<LogLoadsDatabaseState>

    legacy.richLandingDetails = (legacy.richLandingDetails ?? []).map((details) => {
      const stored: Record<string, unknown> = { ...details }
      delete stored.safetyRequirements
      return stored as (typeof details)
    })
    legacy.destinationFacilities = (legacy.destinationFacilities ?? []).map((facility) => {
      const stored: Record<string, unknown> = { ...facility }
      delete stored.completionEvidence
      return stored as (typeof facility)
    })

    const upgraded = upgradeStateSnapshot(legacy)

    expect(upgraded?.richLandingDetails[0]?.safetyRequirements).toEqual([])
    expect(upgraded?.destinationFacilities[0]?.completionEvidence).toEqual([])
  })

  it("fails closed on a future snapshot schema", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json([
          { id: "primary", schema_version: 3, state: createInMemoryDatabase(), version: 1 }
        ])
      )
    )

    await expect(loadRemoteOperatingState(config)).rejects.toThrow(
      "Canonical operating state is invalid"
    )
  })

  it("rejects a stale version instead of overwriting canonical state", async () => {
    const api = new FakeOperatingStateApi(createInMemoryDatabase(), 3)
    const stale = createInMemoryDatabase()

    stale.profiles[0]!.fullName = "Stale writer"
    vi.stubGlobal("fetch", vi.fn(api.fetch))

    await expect(updateRemoteOperatingState(config, stale, 2)).resolves.toBeNull()
    expect(api.snapshot()?.version).toBe(3)
    expect(api.snapshot()?.state.profiles[0]!.fullName).not.toBe("Stale writer")
  })

  it("reloads and replays a deterministic mutation after a conflict", async () => {
    const api = new FakeOperatingStateApi(createInMemoryDatabase(), 4)

    api.conflictOnNextPatch()
    vi.stubGlobal("fetch", vi.fn(api.fetch))

    const initial = await loadRemoteOperatingState(config)
    expect(initial).not.toBeNull()
    if (!initial) {
      return
    }

    const result = await mutateRemoteOperatingState(config, initial, (state) => {
      state.profiles[0]!.fullName = "Retried writer"
      return state.profiles[0]!.id
    })

    expect(result.attempts).toBe(2)
    expect(result.snapshot.version).toBe(6)
    expect(result.snapshot.state.profiles[0]!.fullName).toBe("Retried writer")
    expect(result.snapshot.state.profiles[2]!.fullName).toBe("Concurrent operator")
  })

  it("preserves independent concurrent mutations", async () => {
    const api = new FakeOperatingStateApi(createInMemoryDatabase())

    vi.stubGlobal("fetch", vi.fn(api.fetch))

    const [leftInitial, rightInitial] = await Promise.all([
      loadRemoteOperatingState(config),
      loadRemoteOperatingState(config)
    ])

    expect(leftInitial).not.toBeNull()
    expect(rightInitial).not.toBeNull()
    if (!leftInitial || !rightInitial) {
      return
    }

    await Promise.all([
      mutateRemoteOperatingState(config, leftInitial, (state) => {
        state.profiles[0]!.fullName = "Left writer"
      }),
      mutateRemoteOperatingState(config, rightInitial, (state) => {
        state.profiles[1]!.fullName = "Right writer"
      })
    ])

    expect(api.snapshot()?.version).toBe(2)
    expect(api.snapshot()?.state.profiles[0]!.fullName).toBe("Left writer")
    expect(api.snapshot()?.state.profiles[1]!.fullName).toBe("Right writer")
  })

  it("makes concurrent empty-store bootstrap idempotent", async () => {
    const api = new FakeOperatingStateApi(null)
    const seed = createInMemoryDatabase()

    vi.stubGlobal("fetch", vi.fn(api.fetch))

    const [left, right] = await Promise.all([
      initializeRemoteOperatingState(config, seed),
      initializeRemoteOperatingState(config, seed)
    ])

    expect(left.version).toBe(0)
    expect(right.version).toBe(0)
    expect(api.snapshot()?.version).toBe(0)
    expect(api.snapshot()?.state.profiles).toHaveLength(seed.profiles.length)
  })
})
