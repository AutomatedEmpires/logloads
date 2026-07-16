"use server"

import { revalidatePath } from "next/cache"

import { captureServerEvent } from "./analytics"
import { mediaTarget, parseMediaKind, verifiedMediaReference, type MediaKind } from "./media"
import { mutateState, serializeError, services } from "./services"
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

async function commit<T>(
  paths: string[],
  mutation: (draft: typeof services) => T
): Promise<T> {
  const value = await mutateState(mutation)

  for (const path of paths) {
    revalidatePath(path, "layout")
  }

  return value
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
    const canRequestForOtherDriver = ["owner", "admin", "dispatcher", "fleet_manager"].includes(
      actor.activeMembership?.role ?? ""
    )

    if (!driverProfileId) {
      throw new Error("Add a driver before requesting capacity")
    }

    if (driverProfileId !== actor.driverProfileId && !canRequestForOtherDriver) {
      throw new Error("You can only request a haul for your own driver profile")
    }

    await commit(["/driver", "/fleet", "/host"], (draft) => {
      const combination = draft.state.equipmentCombinations.find(
        (candidate) => candidate.assignedDriverProfileId === driverProfileId
      )

      if (!combination) {
        throw new Error("Add your truck first. Equipment powers matching and assignments.")
      }

      const slot = draft.state.truckSlots.find((candidate) => candidate.id === input.truckSlotId)

      if (!slot || slot.loadPostingId !== input.loadPostingId) {
        throw new Error("This haul window is no longer available. Pick another open load.")
      }

      const driverWindows = draft.state.availabilityWindows.filter(
        (window) => window.driverProfileId === driverProfileId
      )
      const coversSlot = driverWindows.some(
        (window) => window.status !== "unavailable" && window.startAt <= slot.startAt && window.endAt >= slot.endAt
      )

      if (!coversSlot) {
        const overlapsSlot = driverWindows.some(
          (window) => window.startAt < slot.endAt && window.endAt > slot.startAt
        )

        if (overlapsSlot) {
          throw new Error("Your posted availability does not cover this full haul window. Update availability, then request again.")
        }

        draft.upsertAvailabilityWindow({
          driverProfileId,
          endAt: slot.endAt,
          notes: "Confirmed while requesting this haul.",
          startAt: slot.startAt,
          status: "available",
          truckProfileId: combination.truckProfileId
        })
      }

      return draft.requestCapacityWithPolicy({
        actorUserId: actor.profile.id,
        dispatcherNotes: input.note ?? undefined,
        driverProfileId,
        loadPostingId: input.loadPostingId,
        organizationId: actorOrganizationId(actor),
        trailerProfileId: combination.trailerProfileId ?? null,
        truckProfileId: combination.truckProfileId,
        truckSlotId: input.truckSlotId
      })
    })

    captureServerEvent("capacity_requested", actor.profile.id, { loadPostingId: input.loadPostingId })

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

    await commit(["/driver", "/fleet", "/host"], (draft) =>
      draft.progressTripStatus({
        actorUserId: actor.profile.id,
        nextStatus: input.nextStatus as Parameters<typeof services.progressTripStatus>[0]["nextStatus"],
        note: input.note ?? undefined,
        organizationId: actorOrganizationId(actor),
        source,
        tripId: input.tripId
      })
    )

    captureServerEvent("trip_progressed", actor.profile.id, { tripId: input.tripId, nextStatus: input.nextStatus })

    return OK
  } catch (error) {
    return failure(error)
  }
}

export async function cancelAssignmentAction(input: {
  assignmentId: string
  reason?: string | null
}): Promise<ActionResult> {
  try {
    const actor = await requireActor()

    await commit(["/driver", "/fleet", "/host"], (draft) =>
      draft.cancelAssignmentWithPolicy({
        actorUserId: actor.profile.id,
        assignmentId: input.assignmentId,
        organizationId: actorOrganizationId(actor),
        reason: input.reason?.trim() || null
      })
    )

    // Event only — the free-text reason stays out of analytics.
    captureServerEvent("assignment_cancelled", actor.profile.id, { assignmentId: input.assignmentId })

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

    await commit(["/driver", "/fleet", "/host"], (draft) =>
      draft.attachTripDocument({
        actorUserId: actor.profile.id,
        contentType,
        filename: input.filename,
        organizationId: actorOrganizationId(actor),
        storageKey: `trips/${input.tripId}/${Date.now()}-${input.filename}`,
        storageProvider: "external",
        tripId: input.tripId,
        type: input.type as Parameters<typeof services.attachTripDocument>[0]["type"]
      })
    )

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

    await commit(["/driver", "/fleet"], (draft) =>
      draft.upsertAvailabilityWindow({
        driverProfileId: actor.driverProfileId,
        endAt: input.endAt,
        notes: input.notes ?? undefined,
        startAt: input.startAt,
        status: input.status
      })
    )

    return OK
  } catch (error) {
    return failure(error)
  }
}

export async function updateDriverEconomicsAction(input: {
  fuelEconomyMpg: number
  fuelPriceCentsPerGallon: number
}): Promise<ActionResult> {
  try {
    const actor = await requireActor()
    const organizationId = actorOrganizationId(actor)

    if (!actor.driverProfileId) {
      throw new Error("Add a driver profile before saving fuel assumptions")
    }

    await commit(["/driver"], (draft) => draft.updateDriverEconomics({
      actorUserId: actor.profile.id,
      driverProfileId: actor.driverProfileId,
      fuelEconomyMpg: input.fuelEconomyMpg,
      fuelPriceCentsPerGallon: input.fuelPriceCentsPerGallon,
      organizationId
    }))

    return OK
  } catch (error) {
    return failure(error)
  }
}

export async function saveDriverMediaAction(input: {
  kind: MediaKind
  publicId: string
}): Promise<ActionResult> {
  try {
    const actor = await requireActor()
    const organizationId = actorOrganizationId(actor)
    const kind = parseMediaKind(input.kind)
    const target = mediaTarget(services.state, actor, organizationId, kind)

    if (!input.publicId.startsWith(`${target.publicIdPrefix}/uploads/`)) {
      throw new Error("The uploaded photo does not belong to this profile")
    }

    const photo = await verifiedMediaReference(input.publicId)

    await commit(["/driver"], (draft) => draft.saveDriverMediaReference({
      actorUserId: actor.profile.id,
      driverProfileId: actor.driverProfileId,
      kind,
      organizationId,
      photo
    }))

    captureServerEvent("driver_media_saved", actor.profile.id, { kind })
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

    await commit(["/driver", "/fleet"], (draft) =>
      draft.addEquipmentCombination({
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
    )

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

    await commit(["/driver", "/fleet"], (draft) =>
      draft.updateEquipmentStatus({
        combinationId: input.combinationId,
        organizationId: actorOrganizationId(actor),
        status: input.status
      })
    )

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

    await commit(["/fleet", "/driver"], (draft) =>
      draft.assignDriverToEquipment({
        combinationId: input.combinationId,
        driverProfileId: input.driverProfileId,
        organizationId: actorOrganizationId(actor)
      })
    )

    return OK
  } catch (error) {
    return failure(error)
  }
}

// --- Host / publishing side --------------------------------------------------

export async function createLoadPostingAction(input: Record<string, unknown>): Promise<ActionResult> {
  try {
    const actor = await requireActor()

    const created = await commit(["/host", "/fleet", "/driver", "/loads", "/"], (draft) =>
      draft.createLoadPostingWithPolicy({
        ...input,
        actorUserId: actor.profile.id,
        organizationId: actorOrganizationId(actor)
      })
    )

    captureServerEvent(created.status === "draft" ? "load_drafted" : "load_published", actor.profile.id, {
      loadPostingId: created.id
    })

    return OK
  } catch (error) {
    return failure(error)
  }
}

export async function publishDraftAction(input: {
  loadPostingId: string
  visibilityMode?: string
}): Promise<ActionResult> {
  try {
    const actor = await requireActor()

    await commit(["/host", "/fleet", "/driver", "/loads", "/"], (draft) =>
      draft.openDraftLoadPosting({
        actorUserId: actor.profile.id,
        loadPostingId: input.loadPostingId,
        organizationId: actorOrganizationId(actor),
        visibilityMode: input.visibilityMode
      })
    )

    captureServerEvent("load_published", actor.profile.id, { loadPostingId: input.loadPostingId })

    return OK
  } catch (error) {
    return failure(error)
  }
}

export async function closeLoadAction(input: {
  loadPostingId: string
  reason?: string | null
}): Promise<ActionResult> {
  try {
    const actor = await requireActor()

    await commit(["/host", "/fleet", "/driver", "/loads", "/"], (draft) =>
      draft.closeLoadPosting({
        actorUserId: actor.profile.id,
        loadPostingId: input.loadPostingId,
        organizationId: actorOrganizationId(actor),
        reason: input.reason?.trim() || null
      })
    )

    // Event only — the free-text reason stays out of analytics.
    captureServerEvent("load_closed", actor.profile.id, { loadPostingId: input.loadPostingId })

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

    await commit(["/host", "/fleet", "/driver"], (draft) => {
      if (input.approve) {
        return draft.approveCapacityRequest({
          actorUserId: actor.profile.id,
          assignmentId: input.assignmentId,
          organizationId: actorOrganizationId(actor)
        })
      }

      return draft.declineCapacityRequest({
        actorUserId: actor.profile.id,
        assignmentId: input.assignmentId,
        organizationId: actorOrganizationId(actor),
        reason: input.reason?.trim() || null
      })
    })

    captureServerEvent(input.approve ? "capacity_approved" : "capacity_declined", actor.profile.id, {
      assignmentId: input.assignmentId
    })
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

    await commit(["/host", "/fleet"], (draft) =>
      draft.createDirectOffer({
        actorUserId: actor.profile.id,
        expiresAt: input.expiresAt ?? new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
        loadPostingId: input.loadPostingId,
        offeredToOrganizationId: input.offeredToOrganizationId,
        offeredTruckloads: input.offeredTruckloads,
        organizationId: actorOrganizationId(actor)
      })
    )

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

    await commit(["/fleet", "/host"], (draft) =>
      draft.publishFutureAvailability({
        actorUserId: actor.profile.id,
        endsAt: input.endsAt,
        equipmentCombinationId: input.equipmentCombinationId,
        notes: input.notes ?? undefined,
        organizationId: actorOrganizationId(actor),
        startsAt: input.startsAt,
        status: input.status ?? "available"
      })
    )

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

    await commit(["/host", "/fleet", "/driver"], (draft) =>
      draft.createOperationalNotice({
        actorUserId: actor.profile.id,
        body: input.body,
        organizationId: actorOrganizationId(actor),
        relatedLoadId: input.relatedLoadId ?? undefined,
        severity: input.severity,
        title: input.title
      })
    )

    return OK
  } catch (error) {
    return failure(error)
  }
}

// --- Messages ------------------------------------------------------------------

export async function sendMessageAction(input: { threadId: string; body: string }): Promise<ActionResult> {
  try {
    const actor = await requireActor()

    await commit(["/driver/messages", "/fleet/messages", "/host/messages"], (draft) =>
      draft.postMessage({
        authorUserId: actor.profile.id,
        body: input.body,
        threadId: input.threadId
      })
    )

    // Event only — never the message body (PII/content stays out of analytics).
    captureServerEvent("message_sent", actor.profile.id, { threadId: input.threadId })
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

    const thread = await commit(
      ["/driver/messages", "/fleet/messages", "/host/messages"],
      (draft) =>
        draft.createThread({
          assignmentId: input.assignmentId ?? null,
          body: input.body,
          creatorUserId: actor.profile.id,
          loadPostingId: input.loadPostingId ?? null,
          participantUserIds: input.participantUserIds,
          subject: input.subject
        })
    )

    return { ...OK, threadId: thread.id }
  } catch (error) {
    return { ...failure(error), threadId: null }
  }
}

// --- Notifications ---------------------------------------------------------------

export async function markNotificationReadAction(input: { notificationId: string }): Promise<ActionResult> {
  try {
    const actor = await requireActor()

    await commit(["/driver", "/fleet", "/host", "/admin"], (draft) =>
      draft.markNotificationRead({ notificationId: input.notificationId, userId: actor.profile.id })
    )

    return OK
  } catch (error) {
    return failure(error)
  }
}

export async function markAllNotificationsReadAction(): Promise<ActionResult> {
  try {
    const actor = await requireActor()

    await commit(["/driver", "/fleet", "/host", "/admin"], (draft) =>
      draft.markAllNotificationsRead(actor.profile.id)
    )

    return OK
  } catch (error) {
    return failure(error)
  }
}

// --- Verification (self-service) -------------------------------------------------

export async function submitVerificationAction(input: {
  subjectType: "person" | "organization"
  verificationType: string
  evidenceSummary: string
}): Promise<ActionResult> {
  try {
    const actor = await requireActor()
    // Coerce to exactly the two supported subjects at the boundary — a crafted
    // request can't create a mislabeled record. Subject is always the actor or
    // their own org, derived from the session, never on behalf of someone else.
    const subjectType = input.subjectType === "organization" ? "organization" : "person"
    const subjectId = subjectType === "person" ? actor.profile.id : actorOrganizationId(actor)

    await commit(["/driver", "/fleet", "/host", "/admin"], (draft) =>
      draft.submitVerificationRecord({
        evidenceSummary: input.evidenceSummary,
        subjectId,
        subjectType,
        submittedByUserId: actor.profile.id,
        verificationType: input.verificationType
      })
    )

    captureServerEvent("verification_submitted", actor.profile.id, {
      subjectType: input.subjectType,
      verificationType: input.verificationType
    })
    return OK
  } catch (error) {
    return failure(error)
  }
}

// --- Reviews (post-haul reputation) ----------------------------------------------

export async function submitTripReviewAction(input: {
  tripId: string
  direction: "host_rates_hauler" | "hauler_rates_host"
  stars: number
  tags: string[]
  note?: string | null
}): Promise<ActionResult> {
  try {
    const actor = await requireActor()
    // The rating side (rater org/user) is the session's; the subject is derived
    // in the service from the trip. A member can only rate the other side of a
    // completed haul their org took part in.
    await commit(["/driver", "/fleet", "/host", "/admin"], (draft) =>
      draft.submitTripReview({
        direction: input.direction,
        note: input.note ?? null,
        raterOrganizationId: actorOrganizationId(actor),
        raterUserId: actor.profile.id,
        stars: input.stars,
        tags: input.tags,
        tripId: input.tripId
      })
    )

    captureServerEvent("trip_reviewed", actor.profile.id, { direction: input.direction, stars: input.stars })
    return OK
  } catch (error) {
    return failure(error)
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

    await commit(["/admin"], (draft) =>
      draft.reviewVerificationRecord({
        decision: input.decision,
        note: input.note ?? null,
        recordId: input.recordId,
        reviewerUserId: actor.profile.id
      })
    )

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

    await commit(["/admin"], (draft) =>
      draft.reviewOrganization({
        decision: input.decision,
        organizationId: input.organizationId,
        reviewerUserId: actor.profile.id
      })
    )

    return OK
  } catch (error) {
    return failure(error)
  }
}

export async function resolveNoticeAction(input: { noticeId: string }): Promise<ActionResult> {
  try {
    const actor = await requireAdmin()

    await commit(["/admin", "/host", "/fleet", "/driver"], (draft) =>
      draft.resolveOperationalNotice({
        noticeId: input.noticeId,
        reviewerUserId: actor.profile.id
      })
    )

    return OK
  } catch (error) {
    return failure(error)
  }
}
