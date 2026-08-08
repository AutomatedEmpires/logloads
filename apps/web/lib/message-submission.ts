export interface MessageSubmissionIntent {
  fingerprint: string
  submissionId: string
}

export interface MessageSubmissionDraft {
  body: string
  intent: MessageSubmissionIntent | null
  subject: string | null
}

export type MessageDraftCockpit = "driver" | "fleet" | "host"

export interface MessageDraftScope {
  cockpit: MessageDraftCockpit
  organizationId: string
  viewerUserId: string
}

export interface MessageSubmissionStorage {
  getItem(key: string): string | null
  removeItem(key: string): void
  setItem(key: string, value: string): void
}

const MESSAGE_DRAFT_STORAGE_PREFIX = "logloads:message-draft:v1"
const MESSAGE_DRAFT_TTL_MS = 24 * 60 * 60 * 1000
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

interface StoredMessageSubmissionDraft extends MessageSubmissionDraft {
  scope: MessageDraftScope
  updatedAtMs: number
  version: 1
}

function isMessageSubmissionIntent(value: unknown): value is MessageSubmissionIntent {
  if (!value || typeof value !== "object") {
    return false
  }

  const candidate = value as Partial<MessageSubmissionIntent>

  return (
    typeof candidate.fingerprint === "string" &&
    typeof candidate.submissionId === "string" &&
    UUID_PATTERN.test(candidate.submissionId)
  )
}

function draftScopeStorageKey(scope: MessageDraftScope): string {
  return [scope.viewerUserId, scope.organizationId, scope.cockpit]
    .map((segment) => encodeURIComponent(segment))
    .join(":")
}

function sameDraftScope(left: MessageDraftScope, right: MessageDraftScope): boolean {
  return (
    left.cockpit === right.cockpit &&
    left.organizationId === right.organizationId &&
    left.viewerUserId === right.viewerUserId
  )
}

function isSemanticallyEmptyDraft(draft: MessageSubmissionDraft): boolean {
  return (
    !draft.intent &&
    draft.body.trim().length === 0 &&
    (draft.subject === null || draft.subject.trim().length === 0)
  )
}

export function replyDraftStorageKey(scope: MessageDraftScope, threadId: string): string {
  return `${MESSAGE_DRAFT_STORAGE_PREFIX}:${draftScopeStorageKey(scope)}:reply:${encodeURIComponent(threadId)}`
}

export function threadDraftStorageKey(scope: MessageDraftScope, counterpartyKey: string): string {
  return `${MESSAGE_DRAFT_STORAGE_PREFIX}:${draftScopeStorageKey(scope)}:thread:${encodeURIComponent(counterpartyKey)}`
}

export function readMessageSubmissionDraft(
  storage: MessageSubmissionStorage | null,
  key: string,
  expectedScope: MessageDraftScope,
  nowMs = Date.now()
): MessageSubmissionDraft | null {
  if (!storage) {
    return null
  }

  try {
    const serialized = storage.getItem(key)

    if (!serialized) {
      return null
    }

    const candidate = JSON.parse(serialized) as Partial<StoredMessageSubmissionDraft>

    if (
      candidate.version !== 1 ||
      !candidate.scope ||
      !sameDraftScope(candidate.scope, expectedScope) ||
      typeof candidate.updatedAtMs !== "number" ||
      !Number.isFinite(candidate.updatedAtMs) ||
      candidate.updatedAtMs > nowMs + 60_000 ||
      nowMs - candidate.updatedAtMs > MESSAGE_DRAFT_TTL_MS ||
      typeof candidate.body !== "string" ||
      candidate.body.length > 4000 ||
      (candidate.subject !== null && typeof candidate.subject !== "string") ||
      (typeof candidate.subject === "string" && candidate.subject.length > 140)
    ) {
      removeMessageSubmissionDraft(storage, key)
      return null
    }

    const draft: MessageSubmissionDraft = {
      body: candidate.body,
      intent: isMessageSubmissionIntent(candidate.intent) ? candidate.intent : null,
      subject: candidate.subject ?? null
    }

    if (isSemanticallyEmptyDraft(draft)) {
      removeMessageSubmissionDraft(storage, key)
      return null
    }

    return draft
  } catch {
    removeMessageSubmissionDraft(storage, key)
    return null
  }
}

export function writeMessageSubmissionDraft(
  storage: MessageSubmissionStorage | null,
  key: string,
  scope: MessageDraftScope,
  draft: MessageSubmissionDraft,
  nowMs = Date.now()
): boolean {
  if (!storage) {
    return false
  }

  if (isSemanticallyEmptyDraft(draft)) {
    removeMessageSubmissionDraft(storage, key)
    return true
  }

  try {
    const storedDraft: StoredMessageSubmissionDraft = {
      ...draft,
      scope,
      updatedAtMs: nowMs,
      version: 1
    }

    storage.setItem(key, JSON.stringify(storedDraft))
    return true
  } catch {
    // A failed replacement must not leave an older draft masquerading as the
    // current uncertain send after reload. The in-memory retry path remains.
    removeMessageSubmissionDraft(storage, key)
    return false
  }
}

export function removeMessageSubmissionDraft(
  storage: MessageSubmissionStorage | null,
  key: string
): void {
  if (!storage) {
    return
  }

  try {
    storage.removeItem(key)
  } catch {
    // A confirmed server response still clears the in-memory intent below.
  }
}

export function ensureMessageSubmissionIntent(
  current: MessageSubmissionIntent | null,
  fingerprint: string,
  createId: () => string = () => crypto.randomUUID()
): MessageSubmissionIntent {
  if (current?.fingerprint === fingerprint) {
    return current
  }

  return {
    fingerprint,
    submissionId: createId()
  }
}

export function replySubmissionFingerprint(input: {
  body: string
  threadId: string
}): string {
  return JSON.stringify(["reply", input.threadId, input.body])
}

export function threadSubmissionFingerprint(input: {
  assignmentId: string | null
  body: string
  loadPostingId: string | null
  participantUserIds: string[]
  subject: string
}): string {
  return JSON.stringify([
    "thread",
    input.assignmentId,
    input.loadPostingId,
    [...input.participantUserIds].sort(),
    input.subject,
    input.body
  ])
}
