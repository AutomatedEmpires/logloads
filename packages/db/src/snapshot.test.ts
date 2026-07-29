import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { createInMemoryDatabase } from "./store"
import {
  auditStateSnapshot,
  initializeRemoteOperatingState,
  loadRemoteOperatingState,
  mutateRemoteOperatingState,
  OPERATING_STATE_SCHEMA_VERSION,
  setOperatingStateDefectReporter,
  updateRemoteOperatingState,
  upgradeStateSnapshot,
  type OperatingStateReport,
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

/** Rows are only ever anonymous JSON here, so corruption is applied through this. */
function rowsOf(state: LogLoadsDatabaseState, table: string): Record<string, unknown>[] {
  return (state as unknown as Record<string, Record<string, unknown>[]>)[table]!
}

function fieldsOf(row: unknown): Record<string, unknown> {
  return row as Record<string, unknown>
}

let reports: OperatingStateReport[] = []

beforeEach(() => {
  // Installing a reporter also clears the once-per-signature filter, so every
  // test observes its own findings instead of inheriting an earlier test's.
  reports = []
  setOperatingStateDefectReporter((report) => {
    reports.push(report)
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  setOperatingStateDefectReporter(null)
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
    // Stored documents predate pre-trip inspections and support requests the
    // same way; an absent collection means none have happened, not corrupt
    // state.
    delete legacy.tripInspections
    delete legacy.supportRequests

    expect(upgradeStateSnapshot(legacy)).toMatchObject({
      profiles: expect.arrayContaining([expect.any(Object)]),
      supportRequests: [],
      tripInspections: [],
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

  it("backfills exact provider-settlement defaults on legacy billing adjustments", () => {
    const legacy = createInMemoryDatabase()

    legacy.billingAdjustments = [
      {
        actorUserId: legacy.profiles[0]!.id,
        amountDeltaCents: -1_000,
        billingPeriodSummaryId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        createdAt: "2026-07-28T16:00:00.000Z",
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        invoiceId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        organizationId: legacy.organizations[0]!.id,
        providerReference: "cn_legacy001",
        reason: "Legacy service credit",
        settlementIntent: "credit_note",
        type: "service_credit",
        unitDelta: 0,
        usageEventId: null
      }
    ] as unknown as LogLoadsDatabaseState["billingAdjustments"]

    const upgraded = upgradeStateSnapshot(legacy)

    expect(upgraded?.billingAdjustments[0]).toMatchObject({
      providerReference: "cn_legacy001",
      providerRevenueDeltaCents: 0,
      providerSettlementAmountCents: null,
      providerSettlementAttemptCount: 0,
      providerSettlementFailure: null,
      providerSettlementLastAttemptAt: null,
      providerSettlementRemainingCents: null,
      providerSettlementSettledAt: null,
      providerSettlementState: "not_started"
    })
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

  // This replaces "fails closed on a future snapshot schema", which asserted the
  // opposite and is deliberately reversed. `main` auto-deploys, so old and new
  // instances serve traffic simultaneously during every rollout; refusing a
  // higher schema version meant the newer instance's first write took the whole
  // older fleet down with "operating state is invalid" until the rollout
  // finished. Validity is decided by whether every required table is there, not
  // by a number. Nothing in this program bumps the version — this only makes the
  // eventual bump survivable.
  it("accepts a snapshot written by a newer deployment when every required table validates", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json([
          {
            id: "primary",
            schema_version: OPERATING_STATE_SCHEMA_VERSION + 1,
            state: createInMemoryDatabase(),
            version: 1
          }
        ])
      )
    )

    const snapshot = await loadRemoteOperatingState(config)

    expect(snapshot?.schemaVersion).toBe(OPERATING_STATE_SCHEMA_VERSION + 1)
    expect(snapshot?.state.loadPostings.length).toBeGreaterThan(0)
  })

  // Strengthened from asserting only the generic message. REQUIRED_TABLES is the
  // collection list of LogLoadsDatabaseState, so this is exactly what a deploy
  // that adds a collection without a backfill looks like from production: every
  // request fails and the database reports nothing. The name of the collection is
  // the whole diagnosis, so the error has to carry it.
  it("names the missing collection when a required table is absent, whatever the version claims", async () => {
    // The version is not the gate; the tables are. A document that happens to
    // carry a plausible version number must never become runtime state.
    const incomplete = createInMemoryDatabase() as Partial<LogLoadsDatabaseState>

    delete incomplete.truckSlots
    delete incomplete.opportunityCapacities

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json([
          {
            id: "primary",
            schema_version: OPERATING_STATE_SCHEMA_VERSION + 1,
            state: incomplete,
            version: 1
          }
        ])
      )
    )

    await expect(loadRemoteOperatingState(config)).rejects.toThrow(
      "Canonical operating state is invalid: collections missing or not an array: opportunityCapacities, truckSlots"
    )
    expect(reports.at(-1)?.missingCollections).toEqual(["opportunityCapacities", "truckSlots"])
  })

  it("names a collection that is present but is not an array", async () => {
    const malformed = createInMemoryDatabase() as unknown as Record<string, unknown>

    malformed.assignments = { "0": { id: "not-a-list" } }

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json([{ id: "primary", schema_version: 2, state: malformed, version: 1 }]))
    )

    await expect(loadRemoteOperatingState(config)).rejects.toThrow(
      "Canonical operating state is invalid: collections missing or not an array: assignments"
    )
  })

  it("still fails closed on a schema version below the first one", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json([
          { id: "primary", schema_version: 0, state: createInMemoryDatabase(), version: 1 }
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

describe("stored row validation", () => {
  // The negative control for every test below: the document the platform
  // actually ships must produce nothing. A failure here means the validator map
  // or the declared reference list is wrong, not that the seed is corrupt.
  it("finds nothing wrong with the shipped document", () => {
    const audit = auditStateSnapshot(createInMemoryDatabase())

    expect(audit.defects).toEqual([])
    expect(audit.missingCollections).toEqual([])
    expect(audit.withheldRows).toEqual({})
    expect(reports).toEqual([])
    // The state object is handed back, not rebuilt, when nothing was withheld.
    expect(audit.state?.truckSlots.length).toBeGreaterThan(0)
  })

  it("withholds a slot that claims more reservations than it has capacity", () => {
    const stored = createInMemoryDatabase()
    const slots = rowsOf(stored, "truckSlots")
    const corruptId = slots[0]!.id as string
    const storedSlotCount = slots.length

    slots[0]!.capacity = 1
    slots[0]!.reservedCount = 999

    const audit = auditStateSnapshot(stored)

    expect(audit.state?.truckSlots.map((slot) => slot.id)).not.toContain(corruptId)
    expect(audit.state?.truckSlots).toHaveLength(storedSlotCount - 1)
    expect(audit.withheldRows.truckSlots).toHaveLength(1)
    expect(audit.defects).toMatchObject([
      { collection: "truckSlots", kind: "invalid_row", rowId: corruptId, rowIndex: 0, withheld: true }
    ])
    expect(audit.defects[0]?.detail).toContain("Reserved count cannot exceed slot capacity")
  })

  it("withholds a capacity row that commits more truckloads than it holds", () => {
    const stored = createInMemoryDatabase()
    const capacities = rowsOf(stored, "opportunityCapacities")
    const corruptId = capacities[0]!.id as string

    capacities[0]!.committedTruckloads = 99999

    const audit = auditStateSnapshot(stored)

    expect(audit.state?.opportunityCapacities.map((row) => row.id)).not.toContain(corruptId)
    expect(audit.defects).toMatchObject([
      { collection: "opportunityCapacities", kind: "invalid_row", rowId: corruptId, withheld: true }
    ])
  })

  it("withholds a row that is not an object at all", () => {
    const stored = createInMemoryDatabase()
    const profiles = rowsOf(stored, "profiles")
    const storedProfileCount = profiles.length
    const replacedUserId = profiles[1]!.id as string

    profiles[1] = "not-an-object" as unknown as Record<string, unknown>

    const audit = auditStateSnapshot(stored)

    expect(audit.state?.profiles).toHaveLength(storedProfileCount - 1)
    expect(audit.state?.profiles).not.toContain("not-an-object")
    expect(audit.withheldRows.profiles).toEqual(["not-an-object"])
    expect(audit.defects[0]).toMatchObject({
      collection: "profiles",
      detail: "<row>: Expected object, received string",
      kind: "invalid_row",
      rowId: null,
      rowIndex: 1,
      withheld: true
    })
    // A row that is not an object carries no id, so the user really is absent
    // from the document and everything pointing at them really is dangling. That
    // is a report, not a second withholding.
    expect(audit.defects.slice(1).map((defect) => defect.kind)).toEqual([
      "missing_reference",
      "missing_reference"
    ])
    for (const defect of audit.defects.slice(1)) {
      expect(defect.detail).toBe(`userId ${replacedUserId} is not a stored profiles id`)
      expect(defect.withheld).toBe(false)
    }
  })

  it("withholds the second row that claims an id another row already claims", () => {
    const stored = createInMemoryDatabase()
    const assignments = rowsOf(stored, "assignments")
    const original = assignments[0]!
    const shadow = { ...structuredClone(original), dispatcherNotes: "shadow row" }

    assignments.push(shadow)

    const audit = auditStateSnapshot(stored)
    const survivors = audit.state?.assignments.filter((row) => row.id === original.id) ?? []

    // The first row wins, which is what every `find` in the application already
    // resolves; the shadow row is what inflates list scans and slot counts.
    expect(survivors).toHaveLength(1)
    expect(survivors[0]?.dispatcherNotes).not.toBe("shadow row")
    expect(audit.withheldRows.assignments).toEqual([shadow])
    expect(audit.defects).toMatchObject([
      {
        collection: "assignments",
        kind: "duplicate_id",
        rowId: original.id,
        rowIndex: assignments.length - 1,
        withheld: true
      }
    ])
  })

  it("reports a dangling driver reference and leaves the row readable", () => {
    const stored = createInMemoryDatabase()
    const assignments = rowsOf(stored, "assignments")
    const orphanedId = assignments[0]!.id as string

    assignments[0]!.driverProfileId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"

    const audit = auditStateSnapshot(stored)

    expect(audit.defects).toMatchObject([
      {
        collection: "assignments",
        kind: "missing_reference",
        rowId: orphanedId,
        rowIndex: 0,
        withheld: false
      }
    ])
    expect(audit.defects[0]?.detail).toBe(
      "driverProfileId dddddddd-dddd-4ddd-8ddd-dddddddddddd is not a stored driverProfiles id"
    )
    // Deliberate: withholding the assignment would delete a booking from the
    // operator's view while the driver stays missing anyway.
    expect(audit.state?.assignments.map((row) => row.id)).toContain(orphanedId)
    expect(audit.withheldRows).toEqual({})
  })

  it("does not cascade: withholding a driver row keeps the assignments that point at it", () => {
    const stored = createInMemoryDatabase()
    const drivers = rowsOf(stored, "driverProfiles")
    const driverId = drivers[0]!.id as string
    const referring = rowsOf(stored, "assignments").filter(
      (assignment) => assignment.driverProfileId === driverId
    )

    expect(referring.length).toBeGreaterThan(0)
    drivers[0]!.yearsExperience = -4

    const audit = auditStateSnapshot(stored)

    expect(audit.withheldRows.driverProfiles).toHaveLength(1)
    expect(audit.state?.assignments.map((row) => row.id)).toEqual(
      expect.arrayContaining(referring.map((assignment) => assignment.id as string))
    )
    // References resolve against every id in the stored document, withheld
    // included, so one bad parent cannot empty the collections beneath it.
    expect(audit.defects.filter((defect) => defect.kind === "missing_reference")).toEqual([])
  })

  it("reports every finding once, with the collection, row and consequence", () => {
    const stored = createInMemoryDatabase()

    rowsOf(stored, "truckSlots")[0]!.reservedCount = -1

    expect(upgradeStateSnapshot(stored)).not.toBeNull()
    expect(upgradeStateSnapshot(structuredClone(stored))).not.toBeNull()

    // Read once per request against one document: an unfiltered reporter would
    // repeat this line until it was worthless.
    expect(reports).toHaveLength(1)
    expect(reports[0]?.defects).toMatchObject([
      { collection: "truckSlots", kind: "invalid_row", withheld: true }
    ])
  })

  it("reports a missing collection instead of returning null in silence", () => {
    const incomplete = createInMemoryDatabase() as Partial<LogLoadsDatabaseState>

    delete incomplete.tripEvents

    expect(upgradeStateSnapshot(incomplete)).toBeNull()
    expect(reports).toMatchObject([{ missingCollections: ["tripEvents"] }])
  })
})

describe("forward compatibility of stored rows", () => {
  it("keeps a field this build has never heard of on a row it validates", () => {
    const forward = createInMemoryDatabase()

    fieldsOf(forward.loadPostings[1]).settlementTermsVersion = 3

    const upgraded = upgradeStateSnapshot(forward)

    expect(fieldsOf(upgraded?.loadPostings[1]).settlementTermsVersion).toBe(3)
    expect(reports).toEqual([])
  })

  // The load-bearing case for the previous test: a collection that lost a row is
  // the only one rebuilt, so it is the only place where handing back parser
  // output instead of the stored row would show. Rows are kept by identity —
  // parsed output would strip every field this build has not declared, and the
  // next compare-and-swap would persist the stripped document. That is the
  // rollout data loss PR #69 fixed for whole collections, one field at a time.
  it("keeps unknown fields on the surviving rows of a collection that lost one", () => {
    const forward = createInMemoryDatabase()
    const postings = rowsOf(forward, "loadPostings")

    expect(postings.length).toBeGreaterThan(1)
    postings[0]!.dailyTruckCountNeeded = 0
    postings[1]!.settlementTermsVersion = 3

    const audit = auditStateSnapshot(forward)

    expect(audit.withheldRows.loadPostings).toHaveLength(1)
    expect(fieldsOf(audit.state?.loadPostings[0]).settlementTermsVersion).toBe(3)
  })

  it("keeps a collection this build has never heard of", () => {
    const forward = createInMemoryDatabase() as unknown as Record<string, unknown>

    forward.settlementBatches = [{ id: "9f1d4c2a-0000-4000-8000-000000000001" }]

    const upgraded = upgradeStateSnapshot(forward as Partial<LogLoadsDatabaseState>)

    expect((upgraded as unknown as Record<string, unknown>).settlementBatches).toHaveLength(1)
  })

  it("keeps a row a strict contract rejects only for carrying unknown keys", () => {
    const stored = createInMemoryDatabase()
    const supportRequest = {
      appCommitSha: null,
      closedAt: null,
      closedByUserId: null,
      contentFingerprint: "a".repeat(64),
      createdAt: "2026-07-20T10:00:00.000Z",
      details: "The slot picker refused a window that is open.",
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
      impact: "blocked",
      kind: "problem",
      organizationId: null,
      pagePath: "/host/loads",
      reporterUserId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
      resolutionCode: null,
      resolutionNote: null,
      status: "open",
      submissionIds: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3"],
      title: "Slot picker refuses an open window",
      triagedAt: null,
      triagedByUserId: null,
      updatedAt: "2026-07-20T10:00:00.000Z"
    }

    rowsOf(stored, "supportRequests").push({ ...supportRequest })
    expect(auditStateSnapshot(structuredClone(stored)).defects).toEqual([])

    rowsOf(stored, "supportRequests")[0]!.escalationTier = "gold"

    const audit = auditStateSnapshot(stored)

    // supportRequestSchema is .strict(), so a newer deployment's field reads as a
    // rejection here. Withholding the row would hide a live ticket that the newer
    // instance is still writing, so the finding is reported and the row stays.
    expect(audit.defects).toMatchObject([
      { collection: "supportRequests", kind: "unknown_fields", withheld: false }
    ])
    expect(audit.withheldRows).toEqual({})
    expect(fieldsOf(audit.state?.supportRequests[0]).escalationTier).toBe("gold")
  })
})

describe("withheld rows and the compare-and-swap write", () => {
  function storedStateWithCorruptSlot(): { corruptId: string; state: LogLoadsDatabaseState } {
    const stored = createInMemoryDatabase()
    const slots = rowsOf(stored, "truckSlots")

    slots[0]!.capacity = 1
    slots[0]!.reservedCount = 999

    return { corruptId: slots[0]!.id as string, state: stored }
  }

  it("hides a withheld row from the mutation it would otherwise corrupt", async () => {
    const { corruptId, state } = storedStateWithCorruptSlot()
    const api = new FakeOperatingStateApi(state, 4)

    vi.stubGlobal("fetch", vi.fn(api.fetch))

    const initial = await loadRemoteOperatingState(config)

    expect(initial).not.toBeNull()
    if (!initial) {
      return
    }

    expect(initial.state.truckSlots.map((slot) => slot.id)).not.toContain(corruptId)
    expect(initial.withheldRows.truckSlots).toHaveLength(1)
    expect(initial.defects).toMatchObject([{ collection: "truckSlots", kind: "invalid_row" }])

    let seenByMutation: string[] = []

    await mutateRemoteOperatingState(config, initial, (draft) => {
      seenByMutation = draft.truckSlots.map((slot) => slot.id)
      draft.profiles[0]!.fullName = "Dispatch operator"
    })

    expect(seenByMutation).not.toContain(corruptId)
  })

  it("leaves a withheld row in the stored document after a mutation commits", async () => {
    const { corruptId, state } = storedStateWithCorruptSlot()
    const storedSlotCount = state.truckSlots.length
    const api = new FakeOperatingStateApi(state, 4)

    vi.stubGlobal("fetch", vi.fn(api.fetch))

    const initial = await loadRemoteOperatingState(config)

    expect(initial).not.toBeNull()
    if (!initial) {
      return
    }

    await mutateRemoteOperatingState(config, initial, (draft) => {
      draft.profiles[0]!.fullName = "Dispatch operator"
    })

    const persisted = api.snapshot()

    // State is read whole and written whole, so a row merely dropped at read time
    // would be deleted from Postgres by this write. The row must survive it.
    expect(persisted?.state.truckSlots).toHaveLength(storedSlotCount)
    expect(rowsOf(persisted!.state, "truckSlots").find((slot) => slot.id === corruptId)).toMatchObject({
      capacity: 1,
      reservedCount: 999
    })
    expect(persisted?.state.profiles[0]!.fullName).toBe("Dispatch operator")
  })

  it("does not multiply withheld rows across repeated commits", async () => {
    const { corruptId, state } = storedStateWithCorruptSlot()
    const api = new FakeOperatingStateApi(state, 4)

    vi.stubGlobal("fetch", vi.fn(api.fetch))

    for (let round = 0; round < 3; round += 1) {
      const snapshot = await loadRemoteOperatingState(config)

      expect(snapshot).not.toBeNull()
      if (!snapshot) {
        return
      }

      await mutateRemoteOperatingState(config, snapshot, (draft) => {
        draft.profiles[0]!.fullName = `Operator ${round}`
      })
    }

    const persisted = rowsOf(api.snapshot()!.state, "truckSlots")

    expect(persisted.filter((slot) => slot.id === corruptId)).toHaveLength(1)
  })

  it("refuses to treat an update response it cannot validate as a commit", async () => {
    const stored = createInMemoryDatabase()

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const broken = createInMemoryDatabase() as Partial<LogLoadsDatabaseState>

        delete broken.messageEvents

        return Response.json([{ id: "primary", schema_version: 2, state: broken, version: 5 }])
      })
    )

    await expect(updateRemoteOperatingState(config, stored, 4)).rejects.toThrow(
      "Canonical operating state update returned invalid data: collections missing or not an array: messageEvents"
    )
  })
})
