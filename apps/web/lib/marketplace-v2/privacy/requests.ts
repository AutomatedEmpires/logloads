import "server-only"

import { randomUUID } from "node:crypto"

import {
  marketplacePrivacyCloseInputSchema,
  marketplacePrivacyEmailIntakeSchema,
  marketplacePrivacyIdentityCodeInputSchema,
  marketplacePrivacyRequestInputSchema,
  type MarketplaceAdminAccess,
  type MarketplacePrivacyQueueEntry,
  type MarketplacePrivacyRequestReceipt,
  type MarketplacePrivacyRequestRecord
} from "@logloads/contracts"
import {
  assertPrivacyRelease,
  checkPrivacyIdentityCode,
  DomainRefusalError,
  issuePrivacyIdentityCode,
  planEmailedPrivacyRequest,
  planInAppPrivacyRequest,
  planPrivacyClose,
  privacyQueueEntries,
  privacyReceipt,
  privacyRequestDedupes,
  privacyStaffAuthorize,
  type PrivacyIdentityCheckOutcome
} from "@logloads/services"
import { z, type ZodType, type ZodTypeDef } from "zod"

import { MarketplaceRefusalError } from "../port"
import type { PrivacyRequestStore } from "./store"

/**
 * The privacy request operations (#343, legal review §6.6 item 1) over a `PrivacyRequestStore`. The rules are
 * packages/services/src/v2/privacy; this module reads and writes the store around them.
 *
 * - A person in the app asks about themselves only: the person is the session's, passed in by the caller, never read
 *   from the input. Their session verifies them, so the request is in progress at once.
 * - Support staff record a request that arrived by email. It waits for an identity code, which goes to the address
 *   the request is about, and is checked when the requester sends it back.
 * - Every write is one store transaction with its audit row. A request is in the staff queue from the moment it is
 *   stored. Completing a request, and reading it for release, pass `assertPrivacyRelease`: identity verified first.
 *
 * Refusals are `MarketplaceRefusalError`s with words for the person and a SQLSTATE-like code, as the store's are.
 */

export interface PrivacyPerson {
  userId: string
}

/** A LogLoads staff member, with the staff roles the store read for them (`platform_admins`). */
export interface PrivacyStaff {
  userId: string
  access: MarketplaceAdminAccess
}

export interface PrivacyOperationOptions {
  now?: Date
  /** A new request id (tests pass a fixed one). */
  newId?: () => string
}

/** Sends the identity code to the address a request is about. The message holds the code and its expiry, nothing else. */
export interface PrivacyIdentityCodeSender {
  send(message: { to: string; code: string; expiresAt: string }): Promise<void>
}

export const PRIVACY_QUEUE_LIMIT = 100
export const PRIVACY_OWN_REQUESTS_LIMIT = 50

const STALE = "This request changed since the page loaded. Refresh and try again."
const NOT_FOUND = "We couldn't find that privacy request."

function parse<T>(schema: ZodType<T, ZodTypeDef, unknown>, input: unknown): T {
  const parsed = schema.safeParse(input)

  if (!parsed.success) {
    throw new MarketplaceRefusalError(parsed.error.issues[0]?.message ?? "Check the request and try again.", "22023")
  }

  return parsed.data
}

/** A shared rule's refusal keeps its words. */
function ruled<T>(work: () => T): T {
  try {
    return work()
  } catch (error) {
    if (error instanceof DomainRefusalError) throw new MarketplaceRefusalError(error.message, "23514")
    throw error
  }
}

function requireStaff(staff: PrivacyStaff): void {
  const decision = privacyStaffAuthorize(staff.access)

  if (!decision.ok) throw new MarketplaceRefusalError(decision.message, "42501")
}

const requestIdSchema = z.string().uuid("Choose a request.").transform((value) => value.toLowerCase())

async function load(store: PrivacyRequestStore, requestId: unknown): Promise<MarketplacePrivacyRequestRecord> {
  const record = await store.get(parse(requestIdSchema, requestId))

  if (!record) throw new MarketplaceRefusalError(NOT_FOUND, "P0002")

  return record
}

// ---------------------------------------------------------------------------
// The person
// ---------------------------------------------------------------------------

export interface PrivacySubmission {
  receipt: MarketplacePrivacyRequestReceipt
  /** A new request was stored (and audited). */
  created: boolean
  /** The person already had an open request of this kind; that one is answered instead. */
  alreadyOpen: boolean
}

/** A request from the signed-in `person`, about themselves. A retried form returns the request it already made. */
export async function submitPrivacyRequest(
  store: PrivacyRequestStore,
  person: PrivacyPerson,
  input: unknown,
  options: PrivacyOperationOptions = {}
): Promise<PrivacySubmission> {
  const parsed = parse(marketplacePrivacyRequestInputSchema, input)
  const planned = planInAppPrivacyRequest({ input: parsed, now: options.now ?? new Date(), requestId: (options.newId ?? randomUUID)(), subjectUserId: person.userId })
  const result = await store.receive(planned.record, planned.audit, { dedupeOpen: privacyRequestDedupes(parsed.kind) })

  // The same form id with other answers, or another person's form id: never merged, and never the other request.
  if (!result.created && result.reason === "same_submission" && result.request.fingerprint !== planned.record.fingerprint) {
    throw new MarketplaceRefusalError("That form was already sent with different answers. Reload the page to make a new request.", "40001")
  }

  return { alreadyOpen: !result.created && result.reason === "already_open", created: result.created, receipt: privacyReceipt(result.request) }
}

/** The person's own requests, newest first. */
export async function myPrivacyRequests(store: PrivacyRequestStore, person: PrivacyPerson): Promise<MarketplacePrivacyRequestReceipt[]> {
  return (await store.listForSubject(person.userId, PRIVACY_OWN_REQUESTS_LIMIT)).map(privacyReceipt)
}

// ---------------------------------------------------------------------------
// Support staff
// ---------------------------------------------------------------------------

export interface RecordedEmailRequest {
  request: MarketplacePrivacyRequestRecord
  created: boolean
  alreadyOpen: boolean
  /** An account uses the sender's address. For staff only: the requester is never told whether one does. */
  accountMatched: boolean
}

/** A request that arrived by email, recorded by support staff. Recording the same email twice records one request. */
export async function recordEmailedPrivacyRequest(
  store: PrivacyRequestStore,
  staff: PrivacyStaff,
  input: unknown,
  options: PrivacyOperationOptions = {}
): Promise<RecordedEmailRequest> {
  requireStaff(staff)

  const intake = parse(marketplacePrivacyEmailIntakeSchema, input)
  const account = await store.accountForEmail(intake.fromAddress)
  const planned = ruled(() =>
    planEmailedPrivacyRequest({ account, intake, now: options.now ?? new Date(), requestId: (options.newId ?? randomUUID)(), staffUserId: staff.userId })
  )
  const result = await store.receive(planned.record, planned.audit, { dedupeOpen: privacyRequestDedupes(intake.kind) })

  if (!result.created && result.reason === "same_submission" && result.request.fingerprint !== planned.record.fingerprint) {
    throw new MarketplaceRefusalError("That email was already recorded with different answers. Open the request that has it.", "40001")
  }

  return {
    accountMatched: account !== null,
    alreadyOpen: !result.created && result.reason === "already_open",
    created: result.created,
    request: result.request
  }
}

/**
 * A new identity code for a request waiting for its check, sent to the address it is about. The code's hash is stored
 * first, so a code that was sent always matches what is stored; a failed send is answered by sending a new one.
 */
export async function sendPrivacyIdentityCode(
  store: PrivacyRequestStore,
  staff: PrivacyStaff,
  requestId: unknown,
  sender: PrivacyIdentityCodeSender,
  options: PrivacyOperationOptions = {}
): Promise<{ sentTo: string; expiresAt: string }> {
  requireStaff(staff)

  const record = await load(store, requestId)
  const issued = ruled(() => issuePrivacyIdentityCode(record, options.now ?? new Date(), staff.userId))

  if (!(await store.update(issued.record, record.updatedAt, [issued.audit]))) {
    throw new MarketplaceRefusalError(STALE, "40001")
  }

  const expiresAt = issued.record.identityChallenge?.expiresAt ?? ""

  await sender.send({ code: issued.code, expiresAt, to: issued.recipient })

  return { expiresAt, sentTo: issued.recipient }
}

/** The code the requester sent back, as staff enter it. */
export async function checkPrivacyIdentity(
  store: PrivacyRequestStore,
  staff: PrivacyStaff,
  input: unknown,
  options: PrivacyOperationOptions = {}
): Promise<{ outcome: PrivacyIdentityCheckOutcome; request: MarketplacePrivacyRequestRecord }> {
  requireStaff(staff)

  const parsed = parse(marketplacePrivacyIdentityCodeInputSchema, input)
  const record = await load(store, parsed.requestId)
  const check = ruled(() => checkPrivacyIdentityCode(record, parsed.code, options.now ?? new Date(), staff.userId))

  if (check.record === null || check.audit === null) {
    return { outcome: check.outcome, request: record }
  }

  // The outcome is told only once it is stored, so two checks of one code can never both count.
  if (!(await store.update(check.record, record.updatedAt, [check.audit]))) {
    throw new MarketplaceRefusalError(STALE, "40001")
  }

  return { outcome: check.outcome, request: check.record }
}

/**
 * A request, read for its release: building an access report or an export, or making a correction or a deletion.
 * Only an open request whose identity is verified is returned; anything else is refused before any data is read.
 */
export async function openPrivacyRequestForRelease(store: PrivacyRequestStore, staff: PrivacyStaff, requestId: unknown): Promise<MarketplacePrivacyRequestRecord> {
  requireStaff(staff)

  const record = await load(store, requestId)

  ruled(() => assertPrivacyRelease(record))

  return record
}

/** Completes or refuses a request against the version the page showed. Completing needs verified identity. */
export async function closePrivacyRequest(
  store: PrivacyRequestStore,
  staff: PrivacyStaff,
  input: unknown,
  options: PrivacyOperationOptions = {}
): Promise<MarketplacePrivacyRequestRecord> {
  requireStaff(staff)

  const parsed = parse(marketplacePrivacyCloseInputSchema, input)
  const record = await load(store, parsed.requestId)
  const planned = ruled(() => planPrivacyClose(record, parsed, staff.userId, options.now ?? new Date()))

  if (!(await store.update(planned.record, parsed.expectedUpdatedAt, [planned.audit]))) {
    throw new MarketplaceRefusalError(STALE, "40001")
  }

  return planned.record
}

/** The staff queue: open requests, the earliest due first, with days left and no address or details. */
export async function privacyStaffQueue(store: PrivacyRequestStore, staff: PrivacyStaff, options: PrivacyOperationOptions = {}): Promise<MarketplacePrivacyQueueEntry[]> {
  requireStaff(staff)

  return privacyQueueEntries(await store.listOpen(PRIVACY_QUEUE_LIMIT), options.now ?? new Date())
}
