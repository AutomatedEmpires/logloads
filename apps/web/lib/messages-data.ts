import "server-only"

import { persistState, services } from "./services"
import { requireCockpitActor, type SessionActor } from "./session"

export type MessagesCockpit = "driver" | "fleet" | "host"

export interface ThreadMessageView {
  id: string
  body: string
  authorUserId: string
  authorName: string
  createdAt: string
}

export interface SelectedThreadView {
  id: string
  subject: string
  contextLabel: string
  participants: Array<{ userId: string; name: string }>
  messages: ThreadMessageView[]
}

export interface MessageCounterparty {
  key: string
  userId: string
  name: string
  roleLabel: string
  contextLabel: string
  loadPostingId: string | null
  assignmentId: string | null
}

export interface MessagesData {
  viewerUserId: string
  selectedThread: SelectedThreadView | null
  threadNotFound: boolean
  counterparties: MessageCounterparty[]
  unreadByThread: Record<string, number>
}

const ACTIVE_ASSIGNMENT_STATUSES = new Set(["requested", "offered", "accepted", "checked_in", "loading", "hauled"])

/** Publishing-side roles a hauler can reasonably reach about an assigned load. */
const PUBLISHER_CONTACT_ROLES = new Set(["owner", "admin", "dispatcher", "landing_manager", "destination_manager"])

const MAX_COUNTERPARTIES = 24

function roleLabel(role: string): string {
  const human = role.replaceAll("_", " ")

  return human.charAt(0).toUpperCase() + human.slice(1)
}

function activeAssignments() {
  return services.state.assignments.filter((assignment) => ACTIVE_ASSIGNMENT_STATUSES.has(assignment.status))
}

/**
 * People the viewer can start a conversation with, derived from live assignment
 * records: haulers reach the organization that published their assigned load,
 * publishers reach the drivers committed to their loads, and fleet dispatch
 * reaches both sides of its drivers' active work.
 */
function deriveCounterparties(actor: SessionActor, cockpit: MessagesCockpit): MessageCounterparty[] {
  const state = services.state
  const viewerUserId = actor.profile.id
  const organizationId = actor.activeOrganization?.id ?? null
  const entries: MessageCounterparty[] = []
  const seen = new Set<string>()

  function push(entry: MessageCounterparty): void {
    if (entry.userId === viewerUserId || seen.has(entry.key) || entries.length >= MAX_COUNTERPARTIES) {
      return
    }

    seen.add(entry.key)
    entries.push(entry)
  }

  function pushPublisherContacts(loadPostingId: string, assignmentId: string): void {
    const load = state.loadPostings.find((candidate) => candidate.id === loadPostingId)

    if (!load || (organizationId && load.companyId === organizationId)) {
      return
    }

    const contacts = state.organizationMemberships.filter(
      (membership) =>
        membership.organizationId === load.companyId &&
        membership.status === "active" &&
        PUBLISHER_CONTACT_ROLES.has(membership.role)
    )

    for (const contact of contacts) {
      const profile = state.profiles.find((candidate) => candidate.id === contact.userId && candidate.isActive)

      if (!profile) {
        continue
      }

      push({
        assignmentId,
        contextLabel: `Assignment - ${load.title}`,
        key: `${profile.id}:${load.id}`,
        loadPostingId: load.id,
        name: profile.fullName,
        roleLabel: roleLabel(contact.role),
        userId: profile.id
      })
    }
  }

  function pushAssignedDriver(driverProfileId: string, loadPostingId: string, assignmentId: string): void {
    const load = state.loadPostings.find((candidate) => candidate.id === loadPostingId)
    const driver = state.driverProfiles.find((candidate) => candidate.id === driverProfileId)
    const profile = driver ? state.profiles.find((candidate) => candidate.id === driver.userId && candidate.isActive) : undefined

    if (!load || !profile) {
      return
    }

    push({
      assignmentId,
      contextLabel: `Assignment - ${load.title}`,
      key: `${profile.id}:${load.id}`,
      loadPostingId: load.id,
      name: profile.fullName,
      roleLabel: "Driver",
      userId: profile.id
    })
  }

  if (cockpit === "driver" && actor.driverProfileId) {
    for (const assignment of activeAssignments()) {
      if (assignment.driverProfileId === actor.driverProfileId) {
        pushPublisherContacts(assignment.loadPostingId, assignment.id)
      }
    }
  }

  if (cockpit === "fleet" && organizationId) {
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
    const fleetDriverProfileIds = new Set(
      state.driverProfiles
        .filter(
          (driver) =>
            driver.companyId === organizationId || combinationDriverIds.has(driver.id) || memberUserIds.has(driver.userId)
        )
        .map((driver) => driver.id)
    )

    for (const assignment of activeAssignments()) {
      if (!fleetDriverProfileIds.has(assignment.driverProfileId)) {
        continue
      }

      pushPublisherContacts(assignment.loadPostingId, assignment.id)
      pushAssignedDriver(assignment.driverProfileId, assignment.loadPostingId, assignment.id)
    }
  }

  if (cockpit === "host" && organizationId) {
    const ownedLoadIds = new Set(
      state.loadPostings.filter((load) => load.companyId === organizationId).map((load) => load.id)
    )

    for (const assignment of activeAssignments()) {
      if (ownedLoadIds.has(assignment.loadPostingId)) {
        pushAssignedDriver(assignment.driverProfileId, assignment.loadPostingId, assignment.id)
      }
    }
  }

  return entries
}

/**
 * Server data for the messages page: the selected thread's full history (only
 * for participants) plus the counterparties available for a new conversation.
 */
export async function getMessagesData(cockpit: MessagesCockpit, threadId: string | null): Promise<MessagesData> {
  const actor = await requireCockpitActor(cockpit)
  const viewerUserId = actor.profile.id

  let selectedThread: SelectedThreadView | null = null
  let threadNotFound = false

  if (threadId) {
    const meta = services.listThreadsForUser(viewerUserId).find((thread) => thread.id === threadId)

    if (meta) {
      try {
        selectedThread = {
          contextLabel: meta.contextLabel,
          id: meta.id,
          messages: services.listThreadMessages(meta.id, viewerUserId),
          participants: meta.participants,
          subject: meta.subject
        }

        if (services.markThreadRead({ threadId: meta.id, userId: viewerUserId }) > 0) {
          persistState()
        }
      } catch {
        threadNotFound = true
      }
    } else {
      threadNotFound = true
    }
  }

  return {
    counterparties: deriveCounterparties(actor, cockpit),
    selectedThread,
    threadNotFound,
    unreadByThread: services.unreadThreadCounts(viewerUserId),
    viewerUserId
  }
}
