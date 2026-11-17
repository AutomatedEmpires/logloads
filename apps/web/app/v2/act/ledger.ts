import type { OneTapAction } from "./statements"

/**
 * The press record (#292). #338's attestation registry is not in the tree yet; this ledger is the record the
 * route keeps, keyed by the token id, with the version of the statement the page showed. A later registry can
 * read {@link OneTapAttestation} without changing the link.
 */
export interface OneTapAttestation {
  action: OneTapAction
  jobId: string | null
  organizationId: string
  recordedAt: string
  statementText: string
  statementVersion: string
  tokenId: string
  userId: string
}

type Slot = { record: OneTapAttestation; state: "pending" | "committed" }

export interface OneTapLedger {
  attestations(): OneTapAttestation[]
  begin(record: OneTapAttestation): { status: "claimed" } | { status: "pending" } | { status: "used"; record: OneTapAttestation }
  commit(tokenId: string): void
  read(tokenId: string): OneTapAttestation | null
  release(tokenId: string): void
  /** A read. It does not claim the token. */
  state(tokenId: string): "free" | "pending" | "committed"
}

export function createOneTapLedger(): OneTapLedger {
  const slots = new Map<string, Slot>()

  return {
    attestations() {
      return [...slots.values()].filter((slot) => slot.state === "committed").map((slot) => slot.record)
    },
    begin(record) {
      const slot = slots.get(record.tokenId)

      if (slot?.state === "committed") return { record: slot.record, status: "used" }
      if (slot?.state === "pending") return { status: "pending" }
      slots.set(record.tokenId, { record, state: "pending" })
      return { status: "claimed" }
    },
    commit(tokenId) {
      const slot = slots.get(tokenId)

      if (slot?.state === "pending") slot.state = "committed"
    },
    read(tokenId) {
      const slot = slots.get(tokenId)

      return slot?.state === "committed" ? slot.record : null
    },
    state(tokenId) {
      return slots.get(tokenId)?.state ?? "free"
    },
    release(tokenId) {
      const slot = slots.get(tokenId)

      if (slot?.state === "pending") slots.delete(tokenId)
    }
  }
}

const globalLedger = globalThis as typeof globalThis & { __logloadsOneTapLedger?: OneTapLedger }

/** One ledger per server process. A press is single-use on this process; a failed press releases the claim. */
export function oneTapLedger(): OneTapLedger {
  return globalLedger.__logloadsOneTapLedger ??= createOneTapLedger()
}

export function resetOneTapLedger(): void {
  globalLedger.__logloadsOneTapLedger = createOneTapLedger()
}
