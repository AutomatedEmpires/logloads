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

  it("upgrades a legacy mirror without dropping existing data", async () => {
    const legacy = createInMemoryDatabase() as Partial<LogLoadsDatabaseState>
    const originalProfiles = legacy.profiles?.length ?? 0

    delete legacy.tripReviews

    expect(upgradeStateSnapshot(legacy)).toMatchObject({
      profiles: expect.arrayContaining([expect.any(Object)]),
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
    expect(snapshot?.state.profiles).toHaveLength(originalProfiles)
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
