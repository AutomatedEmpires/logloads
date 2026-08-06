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
import { organizationOperationallyAccessible } from "./organization-access"

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
  organizationId: z.string().uuid(),
  threadId: z.string().uuid()
})

export const createThreadInputSchema = z.object({
  assignmentId: z.string().uuid().optional().nullable(),
  body: z.string().min(1).max(4000),
  creatorUserId: z.string().uuid(),
  loadPostingId: z.string().uuid().optional().nullable(),
  organizationId: z.string().uuid(),
  participantUserIds: z.array(z.string().uuid()).min(1),
  subject: z.string().min(1).max(140)
})

export function operationalOrganizationIdsForUser(
  state: LogLoadsDatabaseState,
  userId: string
): Set<string> {
  if (!state.profiles.some((profile) => profile.id === userId && profile.isActive)) {
    return new Set()
  }

  const accessibleOrganizationIds = new Set(
    state.organizations
      .filter(organizationOperationallyAccessible)
      .map((organization) => organization.id)
  )

  const membershipCounts = state.organizationMemberships.reduce<Map<string, number>>(
    (counts, membership) => {
      if (
        membership.userId === userId &&
        membership.status === "active" &&
        accessibleOrganizationIds.has(membership.organizationId)
      ) {
        counts.set(
          membership.organizationId,
          (counts.get(membership.organizationId) ?? 0) + 1
        )
      }

      return counts
    },
    new Map()
  )

  return new Set(
    Array.from(membershipCounts.entries())
      .filter(([, count]) => count === 1)
      .map(([organizationId]) => organizationId)
  )
}

function threadOrganizationIds(
  state: LogLoadsDatabaseState,
  thread: MessageThread
): Set<string> {
  const organizationIds = new Set<string>()
  const explicitAssignment = thread.assignmentId
    ? state.assignments.find((candidate) => candidate.id === thread.assignmentId)
    : undefined
  const loadPostingId = thread.loadPostingId ?? explicitAssignment?.loadPostingId
  const load = loadPostingId
    ? state.loadPostings.find((candidate) => candidate.id === loadPostingId)
    : undefined
  const assignments = explicitAssignment
    ? [explicitAssignment]
    : loadPostingId
      ? state.assignments.filter((assignment) => assignment.loadPostingId === loadPostingId)
      : []

  if (load?.companyId) {
    organizationIds.add(load.companyId)
  }

  for (const assignment of assignments) {
    const driver = state.driverProfiles.find(
      (candidate) => candidate.id === assignment.driverProfileId
    )
    const truck = state.truckProfiles.find(
      (candidate) => candidate.id === assignment.truckProfileId
    )

    for (const participantOrganizationId of [driver?.companyId, truck?.companyId]) {
      if (!participantOrganizationId) {
        continue
      }

      const participantIsOnAssignmentSide = thread.participantUserIds.some(
        (participantUserId) =>
          participantUserId === driver?.userId ||
          state.organizationMemberships.some(
            (membership) =>
              membership.userId === participantUserId &&
              membership.organizationId === participantOrganizationId &&
              membership.status === "active"
          )
      )

      if (participantIsOnAssignmentSide) {
        organizationIds.add(participantOrganizationId)
      }
    }
  }

  return organizationIds
}

function userCanOperateThread(
  state: LogLoadsDatabaseState,
  userId: string,
  organizationId: string,
  thread: MessageThread
): boolean {
  if (thread.archivedAt) {
    return false
  }

  if (!operationalOrganizationIdsForUser(state, userId).has(organizationId)) {
    return false
  }

  // The legacy schema has no durable organization authority for contextless
  // threads. Reconstructing one from today's memberships would let a later,
  // unrelated shared workspace become the key to historical private messages.
  // Keep those rows intact but fail closed until an explicit authority field can
  // be persisted and backfilled under a separately reviewed migration.
  if (!thread.assignmentId && !thread.loadPostingId) {
    return false
  }

  return threadOrganizationIds(state, thread).has(organizationId)
}

function userHasOperationalThreadAccess(
  state: LogLoadsDatabaseState,
  userId: string,
  thread: MessageThread
): boolean {
  if (thread.archivedAt || (!thread.assignmentId && !thread.loadPostingId)) {
    return false
  }

  const userOrganizationIds = operationalOrganizationIdsForUser(state, userId)

  return Array.from(threadOrganizationIds(state, thread)).some((organizationId) =>
    userOrganizationIds.has(organizationId)
  )
}

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

export function listThreadsForUser(
  state: LogLoadsDatabaseState,
  userId: string,
  organizationId: string
): ThreadView[] {
  return state.messageThreads
    .filter(
      (thread) =>
        thread.participantUserIds.includes(userId) &&
        !thread.archivedAt &&
        userCanOperateThread(state, userId, organizationId, thread)
    )
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
  viewerUserId: string,
  organizationId: string
): Array<{ id: string; body: string; authorUserId: string; authorName: string; createdAt: string }> {
  const thread = state.messageThreads.find((candidate) => candidate.id === threadId)

  if (
    !thread ||
    !thread.participantUserIds.includes(viewerUserId) ||
    !userCanOperateThread(state, viewerUserId, organizationId, thread)
  ) {
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

  if (!userCanOperateThread(state, input.authorUserId, input.organizationId, thread)) {
    throw new Error("Conversation not found")
  }

  const recipientUserIds = thread.participantUserIds.filter(
    (participantId) =>
      participantId !== input.authorUserId &&
      userHasOperationalThreadAccess(state, participantId, thread)
  )

  if (recipientUserIds.length === 0) {
    throw new Error("No conversation participants are currently available")
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

  for (const participantId of recipientUserIds) {
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
export function unreadThreadCounts(
  state: LogLoadsDatabaseState,
  userId: string,
  organizationId: string
): Record<string, number> {
  const counts: Record<string, number> = {}

  for (const notification of state.notifications) {
    if (
      notification.userId === userId &&
      notification.type === "message_received" &&
      !notification.readAt &&
      notification.relatedEntityType === "message_thread" &&
      notification.relatedEntityId &&
      state.messageThreads.some(
        (thread) =>
          thread.id === notification.relatedEntityId &&
          thread.participantUserIds.includes(userId) &&
          userCanOperateThread(state, userId, organizationId, thread)
      )
    ) {
      counts[notification.relatedEntityId] = (counts[notification.relatedEntityId] ?? 0) + 1
    }
  }

  return counts
}

/** Marks the viewer's message notifications for a thread as read. */
export function markThreadRead(
  state: LogLoadsDatabaseState,
  input: { organizationId: string; threadId: string; userId: string }
): number {
  const thread = state.messageThreads.find((candidate) => candidate.id === input.threadId)

  if (
    !thread ||
    !thread.participantUserIds.includes(input.userId) ||
    !userCanOperateThread(state, input.userId, input.organizationId, thread)
  ) {
    throw new Error("Conversation not found")
  }

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
  dispatchOrganizationIds: Set<string>
}

/** One person the creator may write to, and the single piece of work it is about. */
interface ReachableContact {
  userId: string
  loadPostingId: string
  assignmentId: string
}

function threadCreatorContext(
  state: LogLoadsDatabaseState,
  creatorUserId: string,
  organizationId: string
): ThreadCreatorContext {
  const organizationIds = operationalOrganizationIdsForUser(state, creatorUserId).has(organizationId)
    ? new Set([organizationId])
    : new Set<string>()

  return {
    driverProfileIds: new Set(
      state.driverProfiles
        .filter(
          (driver) =>
            driver.userId === creatorUserId &&
            Boolean(driver.companyId && organizationIds.has(driver.companyId))
        )
        .map((driver) => driver.id)
    ),
    dispatchOrganizationIds: new Set(
      state.organizationMemberships
        .filter(
          (membership) =>
            membership.userId === creatorUserId &&
            membership.status === "active" &&
            organizationIds.has(membership.organizationId) &&
            organizationRoleCan(membership.role, "assign_capacity")
        )
        .map((membership) => membership.organizationId)
    ),
    organizationIds
  }
}

/** Driver profiles an organization dispatches: its own, its rigs', and its members'. */
function fleetDriverProfileIds(state: LogLoadsDatabaseState, context: ThreadCreatorContext): Set<string> {
  const fleetDriverIds = new Set<string>()

  for (const organizationId of context.dispatchOrganizationIds) {
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
function reachableContacts(
  state: LogLoadsDatabaseState,
  creatorUserId: string,
  organizationId: string
): ReachableContact[] {
  const context = threadCreatorContext(state, creatorUserId, organizationId)
  const fleetDriverIds = fleetDriverProfileIds(state, context)
  const contacts: ReachableContact[] = []

  function pushContact(
    userId: string,
    participantOrganizationId: string,
    loadPostingId: string,
    assignmentId: string
  ): void {
    if (
      userId === creatorUserId ||
      !state.profiles.some((profile) => profile.id === userId && profile.isActive) ||
      !operationalOrganizationIdsForUser(state, userId).has(participantOrganizationId)
    ) {
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
        pushContact(membership.userId, load.companyId, load.id, assignmentId)
      }
    }
  }

  for (const assignment of state.assignments) {
    if (!ACTIVE_ASSIGNMENT_STATUSES.has(assignment.status)) {
      continue
    }

    const load = state.loadPostings.find((candidate) => candidate.id === assignment.loadPostingId)

    const publisher = load
      ? state.organizations.find((organization) => organization.id === load.companyId)
      : undefined

    if (!load || !organizationOperationallyAccessible(publisher)) {
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
      const driverOrganizationId = driver?.companyId
      const driverOrganization = driverOrganizationId
        ? state.organizations.find((organization) => organization.id === driverOrganizationId)
        : undefined

      if (driver && driverOrganizationId && organizationOperationallyAccessible(driverOrganization)) {
        pushContact(driver.userId, driverOrganizationId, load.id, assignment.id)
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
  input: {
    assignmentId?: string | null
    creatorUserId: string
    loadPostingId?: string | null
    organizationId: string
  },
  participantUserIds: string[]
): void {
  if (!input.assignmentId && !input.loadPostingId) {
    throw new Error("A conversation must identify shared work")
  }

  const contacts = reachableContacts(state, input.creatorUserId, input.organizationId)

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

  const context = threadCreatorContext(state, input.creatorUserId, input.organizationId)
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

  if (!userCanOperateThread(state, input.creatorUserId, input.organizationId, thread)) {
    throw new Error("Conversation not found")
  }

  if (!existing) {
    state.messageThreads.push(thread)
  }

  postMessage(state, {
    authorUserId: input.creatorUserId,
    body: input.body,
    organizationId: input.organizationId,
    threadId: thread.id
  })

  return thread
}
