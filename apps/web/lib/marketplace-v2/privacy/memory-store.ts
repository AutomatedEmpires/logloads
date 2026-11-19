import {
  MARKETPLACE_PRIVACY_OPEN_STATUSES,
  type MarketplacePrivacyAuditRow,
  type MarketplacePrivacyRequestRecord
} from "@logloads/contracts"
import { privacySubjectKey } from "@logloads/services"

import type { PrivacyReceiveResult, PrivacyRequestStore } from "./store"

/**
 * The reference `PrivacyRequestStore` (#343): the contract the tests run and the normalized store must match, held in
 * memory. It is never a production store: `privacyRequestStore()` (./index.ts) does not return it, and its rows vanish
 * with the process. Each method copies what it is given and what it returns, so a caller can never change a stored
 * row by holding on to an object.
 */

export interface MemoryPrivacyRequestStore extends PrivacyRequestStore {
  /** Every audit row written, in order (for tests). */
  readonly auditRows: readonly MarketplacePrivacyAuditRow[]
  /** Every stored request (for tests). */
  readonly requests: readonly MarketplacePrivacyRequestRecord[]
}

const copy = <T>(value: T): T => structuredClone(value)

const isOpen = (record: MarketplacePrivacyRequestRecord) => (MARKETPLACE_PRIVACY_OPEN_STATUSES as readonly string[]).includes(record.status)

export function memoryPrivacyRequestStore(options: { accounts?: Readonly<Record<string, string>> } = {}): MemoryPrivacyRequestStore {
  /** Sign-in address (lower case) to account id. */
  const accounts = new Map(Object.entries(options.accounts ?? {}).map(([email, userId]) => [email.toLowerCase(), userId]))
  const requests = new Map<string, MarketplacePrivacyRequestRecord>()
  const auditRows: MarketplacePrivacyAuditRow[] = []

  return {
    get auditRows() {
      return copy(auditRows)
    },

    get requests() {
      return copy([...requests.values()])
    },

    async accountForEmail(email) {
      const userId = accounts.get(email.toLowerCase())
      return userId === undefined ? null : { userId }
    },

    async receive(record, audit, { dedupeOpen }): Promise<PrivacyReceiveResult> {
      // Synchronous from here on: one "transaction", as two concurrent calls on one event loop interleave only at awaits.
      const sameKey = [...requests.values()].find((stored) => stored.channel === record.channel && stored.submissionKey === record.submissionKey)

      if (sameKey) return { created: false, reason: "same_submission", request: copy(sameKey) }

      if (dedupeOpen) {
        const subject = privacySubjectKey(record)
        const open = [...requests.values()].find((stored) => isOpen(stored) && stored.kind === record.kind && privacySubjectKey(stored) === subject)

        if (open) return { created: false, reason: "already_open", request: copy(open) }
      }

      if (requests.has(record.id)) {
        throw new Error("A privacy request with this id already exists")
      }

      requests.set(record.id, copy(record))
      auditRows.push(copy(audit))

      return { created: true, request: copy(record) }
    },

    async get(requestId) {
      const stored = requests.get(requestId)
      return stored === undefined ? null : copy(stored)
    },

    async update(next, expectedUpdatedAt, audit) {
      const stored = requests.get(next.id)

      if (!stored || stored.updatedAt !== expectedUpdatedAt) return false

      requests.set(next.id, copy(next))
      auditRows.push(...copy([...audit]))

      return true
    },

    async listOpen(limit) {
      return copy(
        [...requests.values()]
          .filter(isOpen)
          .sort((a, b) => a.dueAt.localeCompare(b.dueAt) || a.id.localeCompare(b.id))
          .slice(0, limit)
      )
    },

    async listForSubject(userId, limit) {
      return copy(
        [...requests.values()]
          .filter((stored) => stored.subjectUserId === userId)
          .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt) || b.id.localeCompare(a.id))
          .slice(0, limit)
      )
    }
  }
}
