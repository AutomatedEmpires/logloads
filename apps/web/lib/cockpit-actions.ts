"use server"

import { revalidatePath } from "next/cache"

import { captureServerEvent } from "./analytics"
import { persistState, serializeError, services } from "./services"
import { getSessionActor, type SessionActor } from "./session"

export interface ActionResult {
  ok: boolean
  error: string | null
}

const OK: ActionResult = { error: null, ok: true }

function failure(error: unknown): ActionResult {
  return { error: serializeError(error).error, ok: false }
}

async function requireActor(): Promise<SessionActor> {
  const actor = await getSessionActor()

  if (!actor) {
    throw new Error("Sign in to continue")
  }

  return actor
}

function actorOrganizationId(actor: SessionActor): string {
  const organizationId = actor.activeOrganization?.id

  if (!organizationId) {
    throw new Error("Finish onboarding before using this feature")
  }

  return organizationId
}

function commit(paths: string[]): void {
  persistState()

  for (const path of paths) {
    revalidatePath(path, "layout")
  }
}

// --- Driver / hauling side -------------------------------------------------

export async function requestCapacityAction(input: {
  loadPostingId: string
  truckSlotId: string
  driverProfileId?: string | null
  note?: string | null
}): Promise<ActionResult> {
  try {
    const actor = await requireActor()
    const driverProfileId = input.driverProfileId ?? actor.driverProfileId

    if (!driverProfileId) {
      throw new Error("Add a driver before requesting capacity")
    }

    const combination = services.state.equipmentCombinations.find(
      (candidate) => candidate.assignedDriverProfileId === driverProfileId
    )

    if (!combination) {
      throw new Error("Add your truck first. Equipment powers matching and assignments.")
    }

    services.requestCapacityWithPolicy({
      actorUserId: actor.profile.id,
      dispatcherNotes: input.note ?? undefined,
      driverProfileId,
      loadPostingId: input.loadPostingId,
      organizationId: actorOrganizationId(actor),
      trailerProfileId: combination.trailerProfileId ?? null,
      truckProfileId: combination.truckProfileId,
      truckSlotId: input.truckSlotId
    })

    captureServerEvent("capacity_requested", actor.profile.id, { loadPostingId: input.loadPostingId })
    commit(["/driver", "/fleet", "/host"])

    return OK
  } catch (error) {
    return failure(error)
  }
}

export async function progressTripAction(input: {
  tripId: string
  nextStatus: string
  note?: string | null
}): Promise<ActionResult> {
  try {
    const actor = await requireActor()
    const source = actor.driverProfileId
      ? "driver"
      : actor.activeOrganization?.type === "landing_source"
        ? "landing"
        : "dispatcher"

    services.progressTripStatus({
      actorUserId: actor.profile.id,
      nextStatus: input.nextStatus as Parameters<typeof services.progressTripStatus>[0]["nextStatus"],
      note: input.note ?? undefined,
      organizationId: actorOrganizationId(actor),
      source,
      tripId: input.tripId
    })

    captureServerEvent("trip_progressed", actor.profile.id, { tripId: input.tripId, nextStatus: input.nextStatus })
    commit(["/driver", "/fleet", "/host"])

    return OK
  } catch (error) {
    return failure(error)
  }
}

export async function attachTripDocumentAction(input: {
  tripId: string
  type: string
  filename: string
}): Promise<ActionResult> {
  try {
    const actor = await requireActor()
    const extension = input.filename.split(".").pop()?.toLowerCase() ?? "jpg"
    const contentType = extension === "pdf" ? "application/pdf" : `image/${extension === "jpg" ? "jpeg" : extension}`

    services.attachTripDocument({
      actorUserId: actor.profile.id,
      contentType,
      filename: input.filename,
      organizationId: actorOrganizationId(actor),
      storageKey: `trips/${input.tripId}/${Date.now()}-${input.filename}`,
      storageProvider: "external",
      tripId: input.tripId,
      type: input.type as Parameters<typeof services.attachTripDocument>[0]["type"]
    })

    commit(["/driver", "/fleet", "/host"])

    return OK
  } catch (error) {
    return failure(error)
  }
}

export async function updateDriverAvailabilityAction(input: {
  status: "available" | "limited" | "unavailable"
  startAt: string
  endAt: string
  notes?: string | null
}): Promise<ActionResult> {
  try {
    const actor = await requireActor()

    if (!actor.driverProfileId) {
      throw new Error("Add a driver profile before setting availability")
    }

    services.upsertAvailabilityWindow({
      driverProfileId: actor.driverProfileId,
      endAt: input.endAt,
      notes: input.notes ?? undefined,
      startAt: input.startAt,
      status: input.status
    })

    commit(["/driver", "/fleet"])

    return OK
  } catch (error) {
    return failure(error)
  }
}

// --- Equipment ---------------------------------------------------------------

export async function addEquipmentAction(input: {
  label: string
  unitNumber: string
  truckType: string
  trailerType?: string | null
  maxPayloadTons: number
  truckMake?: string | null
  truckModel?: string | null
  assignToSelf?: boolean
}): Promise<ActionResult> {
  try {
    const actor = await requireActor()

    services.addEquipmentCombination({
      assignedDriverProfileId: input.assignToSelf ? actor.driverProfileId : null,
      homeRegion: actor.activeOrganization?.primaryRegion ?? "Unspecified",
      label: input.label,
      maxPayloadTons: input.maxPayloadTons,
      organizationId: actorOrganizationId(actor),
      ownerUserId: actor.profile.id,
      trailerType: input.trailerType || null,
      truckMake: input.truckMake ?? null,
      truckModel: input.truckModel ?? null,
      truckType: input.truckType,
      unitNumber: input.unitNumber
    })

    commit(["/driver", "/fleet"])

    return OK
  } catch (error) {
    return failure(error)
  }
}

export async function updateEquipmentStatusAction(input: {
  combinationId: string
  status: string
}): Promise<ActionResult> {
  try {
    const actor = await requireActor()

    services.updateEquipmentStatus({
      combinationId: input.combinationId,
      organizationId: actorOrganizationId(actor),
      status: input.status
    })

    commit(["/driver", "/fleet"])

    return OK
  } catch (error) {
    return failure(error)
  }
}

export async function assignDriverToEquipmentAction(input: {
  combinationId: string
  driverProfileId: string | null
}): Promise<ActionResult> {
  try {
    const actor = await requireActor()

    services.assignDriverToEquipment({
      combinationId: input.combinationId,
      driverProfileId: input.driverProfileId,
      organizationId: actorOrganizationId(actor)
    })

    commit(["/fleet", "/driver"])

    return OK
  } catch (error) {
    return failure(error)
  }
}

// --- Host / publishing side --------------------------------------------------

export async function createLoadPostingAction(input: Record<string, unknown>): Promise<ActionResult> {
  try {
    const actor = await requireActor()

    services.createLoadPosting({
      ...input,
      companyId: actorOrganizationId(actor)
    })

    commit(["/host", "/fleet", "/driver", "/loads", "/"])

    return OK
  } catch (error) {
    return failure(error)
  }
}

export async function approveCapacityRequestAction(input: {
  assignmentId: string
  approve: boolean
  reason?: string | null
}): Promise<ActionResult> {
  try {
    const actor = await requireActor()

    if (input.approve) {
      services.approveCapacityRequest({
        actorUserId: actor.profile.id,
        assignmentId: input.assignmentId,
        organizationId: actorOrganizationId(actor)
      })
    } else {
      services.cancelAssignment(input.assignmentId, input.reason?.trim() || "Declined by the publishing organization")
    }

    captureServerEvent(input.approve ? "capacity_approved" : "capacity_declined", actor.profile.id, {
      assignmentId: input.assignmentId
    })
    commit(["/host", "/fleet", "/driver"])

    return OK
  } catch (error) {
    return failure(error)
  }
}

export async function createDirectOfferAction(input: {
  loadPostingId: string
  offeredToOrganizationId: string
  offeredTruckloads: number
  expiresAt?: string | null
}): Promise<ActionResult> {
  try {
    const actor = await requireActor()

    services.createDirectOffer({
      actorUserId: actor.profile.id,
      expiresAt: input.expiresAt ?? new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
      loadPostingId: input.loadPostingId,
      offeredToOrganizationId: input.offeredToOrganizationId,
      offeredTruckloads: input.offeredTruckloads,
      organizationId: actorOrganizationId(actor)
    })

    commit(["/host", "/fleet"])

    return OK
  } catch (error) {
    return failure(error)
  }
}

export async function publishFutureAvailabilityAction(input: {
  equipmentCombinationId: string
  startsAt: string
  endsAt: string
  status?: "available" | "tentative" | "held" | "unavailable"
  notes?: string | null
}): Promise<ActionResult> {
  try {
    const actor = await requireActor()

    services.publishFutureAvailability({
      actorUserId: actor.profile.id,
      endsAt: input.endsAt,
      equipmentCombinationId: input.equipmentCombinationId,
      notes: input.notes ?? undefined,
      organizationId: actorOrganizationId(actor),
      startsAt: input.startsAt,
      status: input.status ?? "available"
    })

    commit(["/fleet", "/host"])

    return OK
  } catch (error) {
    return failure(error)
  }
}

export async function createOperationalNoticeAction(input: {
  title: string
  body: string
  severity: "info" | "watch" | "critical"
  relatedLoadId?: string | null
}): Promise<ActionResult> {
  try {
    const actor = await requireActor()

    services.createOperationalNotice({
      actorUserId: actor.profile.id,
      body: input.body,
      organizationId: actorOrganizationId(actor),
      relatedLoadId: input.relatedLoadId ?? undefined,
      severity: input.severity,
      title: input.title
    })

    commit(["/host", "/fleet", "/driver"])

    return OK
  } catch (error) {
    return failure(error)
  }
}

// --- Messages ------------------------------------------------------------------

export async function sendMessageAction(input: { threadId: string; body: string }): Promise<ActionResult> {
  try {
    const actor = await requireActor()

    services.postMessage({
      authorUserId: actor.profile.id,
      body: input.body,
      threadId: input.threadId
    })

    commit(["/driver/messages", "/fleet/messages", "/host/messages"])

    return OK
  } catch (error) {
    return failure(error)
  }
}

export interface StartThreadResult extends ActionResult {
  threadId: string | null
}

export async function startThreadAction(input: {
  participantUserIds: string[]
  subject: string
  body: string
  loadPostingId?: string | null
  assignmentId?: string | null
}): Promise<StartThreadResult> {
  try {
    const actor = await requireActor()

    const thread = services.createThread({
      assignmentId: input.assignmentId ?? null,
      body: input.body,
      creatorUserId: actor.profile.id,
      loadPostingId: input.loadPostingId ?? null,
      participantUserIds: input.participantUserIds,
      subject: input.subject
    })

    commit(["/driver/messages", "/fleet/messages", "/host/messages"])

    return { ...OK, threadId: thread.id }
  } catch (error) {
    return { ...failure(error), threadId: null }
  }
}

// --- Admin -----------------------------------------------------------------------

async function requireAdmin(): Promise<SessionActor> {
  const actor = await requireActor()

  if (!actor.isPlatformAdmin) {
    throw new Error("Platform access required")
  }

  return actor
}

export async function reviewVerificationAction(input: {
  recordId: string
  decision: "verified" | "rejected" | "suspended"
  note?: string | null
}): Promise<ActionResult> {
  try {
    const actor = await requireAdmin()

    services.reviewVerificationRecord({
      decision: input.decision,
      note: input.note ?? null,
      recordId: input.recordId,
      reviewerUserId: actor.profile.id
    })

    commit(["/admin"])

    return OK
  } catch (error) {
    return failure(error)
  }
}

export async function reviewOrganizationAction(input: {
  organizationId: string
  decision: "verified" | "rejected" | "suspended"
}): Promise<ActionResult> {
  try {
    const actor = await requireAdmin()

    services.reviewOrganization({
      decision: input.decision,
      organizationId: input.organizationId,
      reviewerUserId: actor.profile.id
    })

    commit(["/admin"])

    return OK
  } catch (error) {
    return failure(error)
  }
}

export async function resolveNoticeAction(input: { noticeId: string }): Promise<ActionResult> {
  try {
    const actor = await requireAdmin()

    services.resolveOperationalNotice({
      noticeId: input.noticeId,
      reviewerUserId: actor.profile.id
    })

    commit(["/admin", "/host", "/fleet", "/driver"])

    return OK
  } catch (error) {
    return failure(error)
  }
}
