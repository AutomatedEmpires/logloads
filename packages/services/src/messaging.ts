import { randomUUID } from "node:crypto"

import {
  messageEventSchema,
  messageThreadSchema,
  notificationSchema,
  type MessageEvent,
  type MessageThread
} from "@logloads/contracts"
import type { LogLoadsDatabaseState } from "@logloads/db"
import { z } from "zod"

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

export function createThread(state: LogLoadsDatabaseState, rawInput: unknown): MessageThread {
  const input = createThreadInputSchema.parse(rawInput)
  const participantUserIds = Array.from(new Set([input.creatorUserId, ...input.participantUserIds]))

  if (participantUserIds.length < 2) {
    throw new Error("A conversation needs at least two participants")
  }

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
