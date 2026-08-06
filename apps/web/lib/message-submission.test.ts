import { randomUUID } from "node:crypto"

import { describe, expect, it, vi } from "vitest"

import {
  ensureMessageSubmissionIntent,
  readMessageSubmissionDraft,
  removeMessageSubmissionDraft,
  replyDraftStorageKey,
  replySubmissionFingerprint,
  threadDraftStorageKey,
  threadSubmissionFingerprint,
  writeMessageSubmissionDraft,
  type MessageSubmissionStorage
} from "./message-submission"

class MemoryStorage implements MessageSubmissionStorage {
  readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

describe("message submission intent", () => {
  it("retains one id for an exact retry and mints another when the intent changes", () => {
    const createId = vi
      .fn<() => string>()
      .mockReturnValueOnce("submission-one")
      .mockReturnValueOnce("submission-two")
    const firstFingerprint = replySubmissionFingerprint({
      body: "At entrance",
      threadId: "thread-one"
    })
    const first = ensureMessageSubmissionIntent(null, firstFingerprint, createId)
    const retry = ensureMessageSubmissionIntent(first, firstFingerprint, createId)
    const changed = ensureMessageSubmissionIntent(
      retry,
      replySubmissionFingerprint({
        body: "At the east entrance",
        threadId: "thread-one"
      }),
      createId
    )

    expect(retry).toBe(first)
    expect(changed.submissionId).not.toBe(first.submissionId)
    expect(createId).toHaveBeenCalledTimes(2)
  })

  it("binds a new-conversation id to its complete visible work context", () => {
    const base = {
      assignmentId: "assignment-one",
      body: "Scale house closes at four.",
      loadPostingId: "load-one",
      participantUserIds: ["participant-one"],
      subject: "Scale hours"
    }

    expect(threadSubmissionFingerprint(base)).toBe(
      threadSubmissionFingerprint({ ...base, participantUserIds: [...base.participantUserIds] })
    )
    expect(threadSubmissionFingerprint(base)).not.toBe(
      threadSubmissionFingerprint({ ...base, subject: "Arrival window" })
    )
    expect(threadSubmissionFingerprint(base)).not.toBe(
      threadSubmissionFingerprint({ ...base, assignmentId: null })
    )
  })

  it("recovers an uncertain reply intent and draft from session-scoped storage", () => {
    const storage = new MemoryStorage()
    const scope = {
      cockpit: "driver" as const,
      organizationId: "carrier-one",
      viewerUserId: "driver-one"
    }
    const key = replyDraftStorageKey(scope, "thread/one")
    const draft = {
      body: "At the east entrance.",
      intent: {
        fingerprint: replySubmissionFingerprint({
          body: "At the east entrance.",
          threadId: "thread/one"
        }),
        submissionId: randomUUID()
      },
      subject: null
    }

    writeMessageSubmissionDraft(storage, key, scope, draft, 1_000)

    expect(readMessageSubmissionDraft(storage, key, scope, 1_000)).toEqual(draft)
    expect(key).toContain(encodeURIComponent("thread/one"))

    removeMessageSubmissionDraft(storage, key)
    expect(readMessageSubmissionDraft(storage, key, scope, 1_000)).toBeNull()
  })

  it("isolates new-conversation drafts per recipient and ignores corrupt state", () => {
    const storage = new MemoryStorage()
    const scope = {
      cockpit: "host" as const,
      organizationId: "host-one",
      viewerUserId: "dispatcher-one"
    }
    const firstKey = threadDraftStorageKey(scope, "driver-one:assignment-one")
    const secondKey = threadDraftStorageKey(scope, "driver-two:assignment-two")
    const firstDraft = {
      body: "Use the east landing.",
      intent: null,
      subject: "Gate access"
    }

    writeMessageSubmissionDraft(storage, firstKey, scope, firstDraft, 2_000)

    expect(readMessageSubmissionDraft(storage, firstKey, scope, 2_000)).toEqual(firstDraft)
    expect(readMessageSubmissionDraft(storage, secondKey, scope, 2_000)).toBeNull()

    storage.setItem(secondKey, "not-json")
    expect(readMessageSubmissionDraft(storage, secondKey, scope, 2_000)).toBeNull()
    expect(storage.getItem(secondKey)).toBeNull()
  })

  it("keeps drafts scoped to the exact viewer, organization, and cockpit and expires them", () => {
    const storage = new MemoryStorage()
    const scope = {
      cockpit: "fleet" as const,
      organizationId: "fleet-one",
      viewerUserId: "dispatcher-one"
    }
    const otherScope = {
      ...scope,
      viewerUserId: "dispatcher-two"
    }
    const key = replyDraftStorageKey(scope, "thread-one")
    const draft = {
      body: "Loaded and rolling.",
      intent: null,
      subject: null
    }

    writeMessageSubmissionDraft(storage, key, scope, draft, 10_000)

    expect(readMessageSubmissionDraft(storage, key, otherScope, 10_000)).toBeNull()
    expect(storage.getItem(key)).toBeNull()

    writeMessageSubmissionDraft(storage, key, scope, draft, 10_000)
    expect(readMessageSubmissionDraft(storage, key, scope, 86_410_001)).toBeNull()
    expect(replyDraftStorageKey(scope, "thread-one")).not.toBe(
      replyDraftStorageKey(otherScope, "thread-one")
    )
    expect(replyDraftStorageKey(scope, "thread-one")).not.toBe(
      replyDraftStorageKey({ ...scope, organizationId: "fleet-two" }, "thread-one")
    )
    expect(replyDraftStorageKey(scope, "thread-one")).not.toBe(
      replyDraftStorageKey({ ...scope, cockpit: "host" }, "thread-one")
    )
  })

  it("falls back without throwing when browser storage is unavailable", () => {
    const unavailableStorage: MessageSubmissionStorage = {
      getItem: () => {
        throw new Error("Storage disabled")
      },
      removeItem: () => {
        throw new Error("Storage disabled")
      },
      setItem: () => {
        throw new Error("Storage disabled")
      }
    }
    const scope = {
      cockpit: "driver" as const,
      organizationId: "carrier-one",
      viewerUserId: "driver-one"
    }
    const key = replyDraftStorageKey(scope, "thread-one")

    expect(readMessageSubmissionDraft(unavailableStorage, key, scope)).toBeNull()
    expect(writeMessageSubmissionDraft(unavailableStorage, key, scope, {
      body: "Waiting at the landing.",
      intent: null,
      subject: null
    })).toBe(false)
    expect(() => removeMessageSubmissionDraft(unavailableStorage, key)).not.toThrow()
  })

  it("removes an older draft when replacing it fails", () => {
    const storage = new MemoryStorage()
    const scope = {
      cockpit: "driver" as const,
      organizationId: "carrier-one",
      viewerUserId: "driver-one"
    }
    const key = replyDraftStorageKey(scope, "thread-one")

    writeMessageSubmissionDraft(storage, key, scope, {
      body: "Older draft.",
      intent: null,
      subject: null
    })
    vi.spyOn(storage, "setItem").mockImplementation(() => {
      throw new Error("Quota exceeded")
    })

    expect(writeMessageSubmissionDraft(storage, key, scope, {
      body: "Current uncertain send.",
      intent: null,
      subject: null
    })).toBe(false)
    expect(storage.getItem(key)).toBeNull()
  })
})
