import { randomUUID } from "node:crypto"

import {
  ORGANIZATION_ROLES,
  assignmentStatusSchema,
  messageEventSchema,
  messageThreadSchema,
  notificationSchema,
  organizationRoleCan,
  stateMachines,
  type Assignment,
  type LoadPosting,
  type MessageEvent,
  type MessageThread,
  type OrganizationRole
} from "@logloads/contracts"
import type { LogLoadsDatabaseState } from "@logloads/db"
import { z } from "zod"

import { isLoadVisibleToOrganization } from "./operating-network"

export interface ThreadView {
  id: string
  subject: string
  contextLabel: string
  loadPostingId: string | null
  assignmentId: string | null
  participants: Array<{ userId: string; name: string }>
  lastMessage: { body: string; authorName: string; at: string } | null
  updatedAt: string
}

export const postMessageInputSchema = z.object({
  authorUserId: z.string().uuid(),
  body: z.string().min(1).max(4000),
  threadId: z.string().uuid()
})

export const createThreadInputSchema = z.object({
  assignmentId: z.string().uuid().optional().nullable(),
  body: z.string().min(1).max(4000),
  creatorUserId: z.string().uuid(),
  loadPostingId: z.string().uuid().optional().nullable(),
  participantUserIds: z.array(z.string().uuid()).min(1),
  subject: z.string().min(1).max(140)
})

function threadContextLabel(state: LogLoadsDatabaseState, thread: MessageThread): string {
  if (thread.assignmentId) {
    const assignment = state.assignments.find((candidate) => candidate.id === thread.assignmentId)
    const load = assignment ? state.loadPostings.find((candidate) => candidate.id === assignment.loadPostingId) : undefined

    return load ? `Assignment - ${load.title}` : "Assignment"
  }

  if (thread.loadPostingId) {
    const load = state.loadPostings.find((candidate) => candidate.id === thread.loadPostingId)

    return load ? `Load - ${load.title}` : "Load"
  }

  return "Working relationship"
}

export function listThreadsForUser(state: LogLoadsDatabaseState, userId: string): ThreadView[] {
  return state.messageThreads
    .filter((thread) => thread.participantUserIds.includes(userId) && !thread.archivedAt)
    .map((thread) => {
      const events = state.messageEvents
        .filter((event) => event.threadId === thread.id)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      const last = events[0]
      const lastAuthor = last ? state.profiles.find((profile) => profile.id === last.authorUserId) : undefined

      return {
        assignmentId: thread.assignmentId ?? null,
        contextLabel: threadContextLabel(state, thread),
        id: thread.id,
        lastMessage: last
          ? { at: last.createdAt, authorName: lastAuthor?.fullName ?? "Participant", body: last.body }
          : null,
        loadPostingId: thread.loadPostingId ?? null,
        participants: thread.participantUserIds.map((participantId) => ({
          name: state.profiles.find((profile) => profile.id === participantId)?.fullName ?? "Participant",
          userId: participantId
        })),
        subject: thread.subject ?? "Operational thread",
        updatedAt: last?.createdAt ?? thread.updatedAt
      }
    })
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
}

export function listThreadMessages(
  state: LogLoadsDatabaseState,
  threadId: string,
  viewerUserId: string
): Array<{ id: string; body: string; authorUserId: string; authorName: string; createdAt: string }> {
  const thread = state.messageThreads.find((candidate) => candidate.id === threadId)

  if (!thread || !thread.participantUserIds.includes(viewerUserId)) {
    throw new Error("Conversation not found")
  }

  return state.messageEvents
    .filter((event) => event.threadId === threadId)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    .map((event) => ({
      authorName: state.profiles.find((profile) => profile.id === event.authorUserId)?.fullName ?? "Participant",
      authorUserId: event.authorUserId,
      body: event.body,
      createdAt: event.createdAt,
      id: event.id
    }))
}

export function postMessage(state: LogLoadsDatabaseState, rawInput: unknown): MessageEvent {
  const input = postMessageInputSchema.parse(rawInput)
  const thread = state.messageThreads.find((candidate) => candidate.id === input.threadId)

  if (!thread) {
    throw new Error("Conversation not found")
  }

  if (!thread.participantUserIds.includes(input.authorUserId)) {
    throw new Error("Only conversation participants can send messages")
  }

  const now = new Date().toISOString()
  const event = messageEventSchema.parse({
    authorUserId: input.authorUserId,
    body: input.body,
    createdAt: now,
    id: randomUUID(),
    threadId: thread.id,
    updatedAt: now
  })

  state.messageEvents.push(event)
  thread.lastMessageAt = now
  thread.updatedAt = now

  const author = state.profiles.find((profile) => profile.id === input.authorUserId)

  for (const participantId of thread.participantUserIds) {
    if (participantId === input.authorUserId) {
      continue
    }

    state.notifications.push(
      notificationSchema.parse({
        body: input.body.slice(0, 140),
        createdAt: now,
        id: randomUUID(),
        readAt: null,
        relatedEntityId: thread.id,
        relatedEntityType: "message_thread",
        title: `New message from ${author?.fullName ?? "a participant"}`,
        type: "message_received",
        updatedAt: now,
        userId: participantId
      })
    )
  }

  return event
}

/**
 * Unread message counts per thread for a user, derived from their undelivered
 * message notifications (postMessage writes one per recipient).
 */
export function unreadThreadCounts(state: LogLoadsDatabaseState, userId: string): Record<string, number> {
  const counts: Record<string, number> = {}

  for (const notification of state.notifications) {
    if (
      notification.userId === userId &&
      notification.type === "message_received" &&
      !notification.readAt &&
      notification.relatedEntityType === "message_thread" &&
      notification.relatedEntityId
    ) {
      counts[notification.relatedEntityId] = (counts[notification.relatedEntityId] ?? 0) + 1
    }
  }

  return counts
}

/** Marks the viewer's message notifications for a thread as read. */
export function markThreadRead(state: LogLoadsDatabaseState, input: { threadId: string; userId: string }): number {
  const now = new Date().toISOString()
  let marked = 0

  for (const notification of state.notifications) {
    if (
      notification.userId === input.userId &&
      notification.type === "message_received" &&
      !notification.readAt &&
      notification.relatedEntityType === "message_thread" &&
      notification.relatedEntityId === input.threadId
    ) {
      notification.readAt = now
      notification.updatedAt = now
      marked += 1
    }
  }

  return marked
}

/**
 * An assignment coordinates live work for as long as its status can still move.
 * Read off the assignment state machine rather than listed here so that adding a
 * status, or making an existing one terminal, cannot leave this gate open on
 * work that is over.
 */
const ACTIVE_ASSIGNMENT_STATUSES: ReadonlySet<Assignment["status"]> = new Set(
  assignmentStatusSchema.options.filter((status) => stateMachines.assignmentTransitions[status].length > 0)
)

/**
 * A hauler reaches the publishing side through whoever is trusted to post that
 * work or run the sites it moves between. Resolved through the permission matrix
 * so granting a role a new capability cannot quietly widen who a stranger is
 * allowed to write to, and so `billing`, `viewer`, and other back-office roles
 * are never exposed as an inbox.
 */
const PUBLISHER_CONTACT_ACTIONS = ["publish_load", "manage_landing", "manage_destination"] as const

const PUBLISHER_CONTACT_ROLES: ReadonlySet<OrganizationRole> = new Set(
  ORGANIZATION_ROLES.filter((role) => PUBLISHER_CONTACT_ACTIONS.some((action) => organizationRoleCan(role, action)))
)

interface ThreadCreatorContext {
  driverProfileIds: Set<string>
  organizationIds: Set<string>
}

/** One person the creator may write to, and the single piece of work it is about. */
interface ReachableContact {
  userId: string
  loadPostingId: string
  assignmentId: string
}

function threadCreatorContext(state: LogLoadsDatabaseState, creatorUserId: string): ThreadCreatorContext {
  return {
    driverProfileIds: new Set(
      state.driverProfiles.filter((driver) => driver.userId === creatorUserId).map((driver) => driver.id)
    ),
    organizationIds: new Set(
      state.organizationMemberships
        .filter((membership) => membership.userId === creatorUserId && membership.status === "active")
        .map((membership) => membership.organizationId)
    )
  }
}

/** Driver profiles an organization dispatches: its own, its rigs', and its members'. */
function fleetDriverProfileIds(state: LogLoadsDatabaseState, context: ThreadCreatorContext): Set<string> {
  const fleetDriverIds = new Set<string>()

  for (const organizationId of context.organizationIds) {
    const memberUserIds = new Set(
      state.organizationMemberships
        .filter((membership) => membership.organizationId === organizationId && membership.status === "active")
        .map((membership) => membership.userId)
    )
    const combinationDriverIds = new Set(
      state.equipmentCombinations
        .filter((combination) => combination.organizationId === organizationId)
        .map((combination) => combination.assignedDriverProfileId)
        .filter((value): value is string => Boolean(value))
    )

    for (const driver of state.driverProfiles) {
      if (
        driver.companyId === organizationId ||
        combinationDriverIds.has(driver.id) ||
        memberUserIds.has(driver.userId)
      ) {
        fleetDriverIds.add(driver.id)
      }
    }
  }

  return fleetDriverIds
}

/**
 * Who the creator may open a conversation with, and about which work.
 *
 * This is the authorization rule for a new thread, and it is derived here from
 * live assignment records instead of trusted from the request: haulers reach the
 * organization that published their assigned load, publishers and fleet dispatch
 * reach the drivers committed to their loads. The messages page derives the same
 * set to draw its people list, but a list is a convenience — without this
 * server-side derivation any signed-in user could name any user id and land text
 * in that person's notification bell.
 */
function reachableContacts(state: LogLoadsDatabaseState, creatorUserId: string): ReachableContact[] {
  const context = threadCreatorContext(state, creatorUserId)
  const fleetDriverIds = fleetDriverProfileIds(state, context)
  const contacts: ReachableContact[] = []

  function pushContact(userId: string, loadPostingId: string, assignmentId: string): void {
    if (userId === creatorUserId || !state.profiles.some((profile) => profile.id === userId && profile.isActive)) {
      return
    }

    contacts.push({ assignmentId, loadPostingId, userId })
  }

  function pushPublisherContacts(load: LoadPosting, assignmentId: string): void {
    for (const membership of state.organizationMemberships) {
      if (
        membership.organizationId === load.companyId &&
        membership.status === "active" &&
        PUBLISHER_CONTACT_ROLES.has(membership.role)
      ) {
        pushContact(membership.userId, load.id, assignmentId)
      }
    }
  }

  for (const assignment of state.assignments) {
    if (!ACTIVE_ASSIGNMENT_STATUSES.has(assignment.status)) {
      continue
    }

    const load = state.loadPostings.find((candidate) => candidate.id === assignment.loadPostingId)

    if (!load) {
      continue
    }

    const haulsIt = context.driverProfileIds.has(assignment.driverProfileId)
    const dispatchesIt = fleetDriverIds.has(assignment.driverProfileId)
    const publishesIt = context.organizationIds.has(load.companyId)

    if (haulsIt || dispatchesIt) {
      pushPublisherContacts(load, assignment.id)
    }

    if (dispatchesIt || publishesIt) {
      const driver = state.driverProfiles.find((candidate) => candidate.id === assignment.driverProfileId)

      if (driver) {
        pushContact(driver.userId, load.id, assignment.id)
      }
    }
  }

  return contacts
}

/**
 * Refuses a thread whose participants or work context the creator has no claim
 * to. The context check is not decoration: `threadContextLabel` renders the
 * load's title straight back to the creator, so an unchecked `loadPostingId`
 * reads out the title of any load in the estate, including private ones.
 */
function assertThreadContextPermitted(
  state: LogLoadsDatabaseState,
  input: { assignmentId?: string | null; creatorUserId: string; loadPostingId?: string | null },
  participantUserIds: string[]
): void {
  const contacts = reachableContacts(state, input.creatorUserId)

  for (const participantUserId of participantUserIds) {
    if (participantUserId === input.creatorUserId) {
      continue
    }

    if (!contacts.some((contact) => contact.userId === participantUserId)) {
      throw new Error("You can only start a conversation with people you share active work with")
    }

    if (input.assignmentId && !contacts.some(
      (contact) => contact.userId === participantUserId && contact.assignmentId === input.assignmentId
    )) {
      throw new Error("That assignment is not shared work between you and this person")
    }
  }

  if (!input.loadPostingId) {
    return
  }

  const load = state.loadPostings.find((candidate) => candidate.id === input.loadPostingId)

  if (!load) {
    throw new Error("Load not found")
  }

  if (input.assignmentId) {
    const assignment = state.assignments.find((candidate) => candidate.id === input.assignmentId)

    // The assignment already cleared the participant check above, so its own load
    // is work the creator is party to. Coherence is what is left to prove: a label
    // naming one load while the thread points at another assignment's load would
    // misdescribe the work to everyone in the conversation.
    if (!assignment || assignment.loadPostingId !== load.id) {
      throw new Error("That load does not belong to that assignment")
    }

    return
  }

  const context = threadCreatorContext(state, input.creatorUserId)
  const readable =
    contacts.some((contact) => contact.loadPostingId === load.id) ||
    Array.from(context.organizationIds).some((organizationId) =>
      isLoadVisibleToOrganization(state, load, organizationId)
    )

  if (!readable) {
    throw new Error("Load not found")
  }
}

export function createThread(state: LogLoadsDatabaseState, rawInput: unknown): MessageThread {
  const input = createThreadInputSchema.parse(rawInput)
  const participantUserIds = Array.from(new Set([input.creatorUserId, ...input.participantUserIds]))

  if (participantUserIds.length < 2) {
    throw new Error("A conversation needs at least two participants")
  }

  // Before any write: a refused thread must leave no thread, no message, and no
  // notification behind.
  assertThreadContextPermitted(state, input, participantUserIds)

  const existing = state.messageThreads.find((thread) =>
    !thread.archivedAt &&
    (thread.assignmentId ?? null) === (input.assignmentId ?? null) &&
    (thread.loadPostingId ?? null) === (input.loadPostingId ?? null) &&
    thread.participantUserIds.length === participantUserIds.length &&
    participantUserIds.every((participantId) => thread.participantUserIds.includes(participantId))
  )

  const now = new Date().toISOString()
  const thread = existing ?? messageThreadSchema.parse({
    archivedAt: null,
    assignmentId: input.assignmentId ?? null,
    createdAt: now,
    id: randomUUID(),
    lastMessageAt: null,
    loadPostingId: input.loadPostingId ?? null,
    participantUserIds,
    subject: input.subject,
    updatedAt: now
  })

  if (!existing) {
    state.messageThreads.push(thread)
  }

  postMessage(state, {
    authorUserId: input.creatorUserId,
    body: input.body,
    threadId: thread.id
  })

  return thread
}
