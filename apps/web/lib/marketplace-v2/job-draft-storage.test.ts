import { MARKETPLACE_PUBLISH_ATTESTATION_FIELDS } from "@logloads/contracts"
import { describe, expect, it } from "vitest"

import {
  clearStoredJobDraft,
  jobDraftStorageKey,
  readStoredJobDraft,
  restoredJobDraftHref,
  restoreJobDraft,
  serializeJobDraft,
  storableDraftValues,
  writeStoredJobDraft,
  type StoredJobDraft
} from "./job-draft-storage"

const SCOPE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const ATTESTED = Object.fromEntries(MARKETPLACE_PUBLISH_ATTESTATION_FIELDS.map((name) => [name, "confirmed"]))

const DRAFT: StoredJobDraft = {
  step: "pay",
  values: {
    equipment: ["log_truck", "pole_trailer"],
    text: { landingId: "66666666-6666-4666-8666-666666666666", payUnit: "per_load", product: "Saw logs", title: "Oak saw logs to Cascade Mill" }
  }
}

/** An in-memory Storage. */
function memoryStorage(): Storage & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    clear: () => data.clear(),
    data,
    getItem: (key) => data.get(key) ?? null,
    key: (index) => Array.from(data.keys())[index] ?? null,
    get length() {
      return data.size
    },
    removeItem: (key) => {
      data.delete(key)
    },
    setItem: (key, item) => {
      data.set(key, item)
    }
  }
}

/** A Storage whose every call throws, as in a locked-down or full browser. */
const brokenStorage = new Proxy({} as Storage, {
  get: () => () => {
    throw new Error("SecurityError")
  }
})

describe("job draft serialize and restore", () => {
  it("round-trips the draft fields, equipment and step", () => {
    expect(restoreJobDraft(serializeJobDraft(DRAFT))).toEqual(DRAFT)
  })

  it("never stores the publish statements", () => {
    const withStatements = { equipment: DRAFT.values.equipment, text: { ...DRAFT.values.text, ...ATTESTED } }

    expect(Object.keys(storableDraftValues(withStatements).text)).not.toEqual(expect.arrayContaining([...MARKETPLACE_PUBLISH_ATTESTATION_FIELDS]))
    const stored = serializeJobDraft({ step: "review", values: withStatements as StoredJobDraft["values"] })
    for (const name of MARKETPLACE_PUBLISH_ATTESTATION_FIELDS) expect(stored).not.toContain(name)
  })

  it("never restores the publish statements, even when storage was tampered with", () => {
    const tampered = JSON.stringify({ equipment: ["log_truck"], step: "review", text: { ...ATTESTED, title: "Oak saw logs" }, v: 1 })
    const restored = restoreJobDraft(tampered)

    expect(restored?.values.text).toEqual({ title: "Oak saw logs" })
    expect(restored ? restoredJobDraftHref(restored) : "").not.toMatch(/attest/)
  })

  it("keeps only non-sensitive draft fields and known equipment codes", () => {
    const values = storableDraftValues({
      equipment: ["log_truck", "jet_pack", 7, "log_truck"],
      text: {
        description: "Call 541-555-0100 for the gate",
        lastConfirmedAt: "2026-11-01T00:00:00.000Z",
        payNote: "email dispatch@example.com",
        publicRoadNotes: "Gate code 4521",
        title: "Oak saw logs",
        unknownField: "x"
      }
    })

    expect(values).toEqual({ equipment: ["log_truck"], text: { title: "Oak saw logs" } })
  })

  it("returns nothing for missing, malformed, foreign or empty records", () => {
    expect(restoreJobDraft(null)).toBeNull()
    expect(restoreJobDraft("")).toBeNull()
    expect(restoreJobDraft("{not json")).toBeNull()
    expect(restoreJobDraft("[]")).toBeNull()
    expect(restoreJobDraft(JSON.stringify({ ...JSON.parse(serializeJobDraft(DRAFT)), v: 2 }))).toBeNull()
    expect(restoreJobDraft(JSON.stringify({ equipment: [], step: "pay", text: {}, v: 1 }))).toBeNull()
  })

  it("falls back to the first step for an unknown step", () => {
    const raw = JSON.stringify({ ...JSON.parse(serializeJobDraft(DRAFT)), step: "dispatch" })
    expect(restoreJobDraft(raw)?.step).toBe("basics")
  })

  it("reopens a restored draft on its step of the editor, marked as restored", () => {
    const href = restoredJobDraftHref(DRAFT)
    const url = new URL(href, "http://test.invalid")

    expect(url.pathname).toBe("/v2/landing/jobs/new")
    expect(url.searchParams.get("step")).toBe("pay")
    expect(url.searchParams.get("restored")).toBe("1")
    expect(url.searchParams.get("title")).toBe("Oak saw logs to Cascade Mill")
    expect(url.searchParams.getAll("equipment")).toEqual(["log_truck", "pole_trailer"])
  })
})

describe("job draft session storage", () => {
  it("writes, reads and clears under a key scoped to the business", () => {
    const storage = memoryStorage()

    writeStoredJobDraft(SCOPE, DRAFT, storage)
    expect(Array.from(storage.data.keys())).toEqual([jobDraftStorageKey(SCOPE)])
    expect(readStoredJobDraft(SCOPE, storage)).toEqual(DRAFT)
    expect(readStoredJobDraft("another-business", storage)).toBeNull()

    clearStoredJobDraft(SCOPE, storage)
    expect(readStoredJobDraft(SCOPE, storage)).toBeNull()
  })

  it("forgets the draft when nothing worth keeping is left", () => {
    const storage = memoryStorage()

    writeStoredJobDraft(SCOPE, DRAFT, storage)
    writeStoredJobDraft(SCOPE, { step: "basics", values: { equipment: [], text: { ...ATTESTED } } }, storage)
    expect(storage.data.size).toBe(0)
  })

  it("never throws when storage is unavailable or refuses access", () => {
    expect(() => writeStoredJobDraft(SCOPE, DRAFT, brokenStorage)).not.toThrow()
    expect(readStoredJobDraft(SCOPE, brokenStorage)).toBeNull()
    expect(() => clearStoredJobDraft(SCOPE, brokenStorage)).not.toThrow()
    expect(() => writeStoredJobDraft(SCOPE, DRAFT, null)).not.toThrow()
    expect(readStoredJobDraft(SCOPE, null)).toBeNull()
    // Outside a browser there is no sessionStorage at all.
    expect(readStoredJobDraft(SCOPE)).toBeNull()
  })
})
