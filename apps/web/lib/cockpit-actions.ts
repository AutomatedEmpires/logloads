"use server"

import {
  credentialKindSchema,
  formatMoney,
  rateTypeSchema,
  roadConditionSchema,
  type CredentialKind,
  type CredentialReviewDecision,
  type DeliveredQuantity,
  type DriverCredential,
  type HaulException,
  type OrganizationRole,
  type RoadCondition
} from "@logloads/contracts"
import { revalidatePath } from "next/cache"

import { captureServerEvent } from "./analytics"
import { parseStatedCredentialExpiry } from "./credential-date"
import { parseDriverPayCents } from "./driver-pay-input"
import { reviewCredentialDocument } from "./credential-reviewer"
import { checkRateLimit } from "./rate-limit"
import {
  mediaTarget,
  parseMediaKind,
  parseTripDocumentType,
  signedDocumentUrl,
  tripDocumentTarget,
  verifiedMediaReference,
  type MediaKind
} from "./media"
import { listActiveLoadsUsingCombination } from "@logloads/services"

import { mutateState, serializeError, services } from "./services"
import { getSessionActor, type SessionActor } from "./session"

export interface ActionResult {
  ok: boolean
  error: string | null
}

const OK: ActionResult = { error: null, ok: true }

function captureNetworkUsageAnalytics(
  actorUserId: string,
  usage: ReturnType<typeof services.recordCompletedNetworkUsage> | null
): void {
  if (usage?.outcome !== "recorded" || usage.event.internalBillingTest) {
    return
  }

  captureServerEvent("network_usage_recorded", actorUserId, {
    billingPeriodSummaryId: usage.summary.id,
    includedUnits: usage.summary.includedUnits,
    organizationId: usage.event.organizationId,
    overageUnits: usage.summary.overageUnits,
    planCode: usage.event.planCode,
    usedUnits: usage.summary.usedUnits
  })

  for (const threshold of usage.newlyEmittedThresholds) {
    captureServerEvent("network_allowance_threshold_reached", actorUserId, {
      billingPeriodSummaryId: usage.summary.id,
      organizationId: usage.event.organizationId,
      planCode: usage.event.planCode,
      threshold
    })
  }
}

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

function ensureDriverAvailabilityForSlot(
  draft: typeof services,
  input: {
    driverProfileId: string
    loadPostingId: string
    note: string
    organizationId: string
    truckSlotId: string
  }
) {
  const combination = draft.state.equipmentCombinations.find((candidate) =>
    candidate.organizationId === input.organizationId && candidate.assignedDriverProfileId === input.driverProfileId
  )

  if (!combination) {
    throw new Error("No equipment is assigned to this driver. Add or assign a truck before continuing.")
  }

  const slot = draft.state.truckSlots.find((candidate) => candidate.id === input.truckSlotId)

  if (!slot || slot.loadPostingId !== input.loadPostingId) {
    throw new Error("This haul window is no longer available. Pick another open load.")
  }

  const driverWindows = draft.state.availabilityWindows.filter(
    (window) => window.driverProfileId === input.driverProfileId
  )
  const coversSlot = driverWindows.some(
    (window) => window.status !== "unavailable" && window.startAt <= slot.startAt && window.endAt >= slot.endAt
  )

  if (!coversSlot) {
    const overlapsSlot = driverWindows.some(
      (window) => window.startAt < slot.endAt && window.endAt > slot.startAt
    )

    if (overlapsSlot) {
      throw new Error("The driver's posted availability does not cover this full haul window. Update availability, then try again.")
    }

    draft.upsertAvailabilityWindow({
      driverProfileId: input.driverProfileId,
      endAt: slot.endAt,
      notes: input.note,
      startAt: slot.startAt,
      status: "available",
      truckProfileId: combination.truckProfileId
    })
  }

  return combination
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
      const combination = ensureDriverAvailabilityForSlot(draft, {
        driverProfileId,
        loadPostingId: input.loadPostingId,
        note: "Confirmed while requesting this haul.",
        organizationId: actorOrganizationId(actor),
        truckSlotId: input.truckSlotId
      })

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

    const result = await commit(["/driver", "/fleet", "/host"], (draft) =>
      draft.progressTripStatus({
        actorUserId: actor.profile.id,
        nextStatus: input.nextStatus as Parameters<typeof services.progressTripStatus>[0]["nextStatus"],
        note: input.note ?? undefined,
        organizationId: actorOrganizationId(actor),
        source,
        tripId: input.tripId
      })
    )

    if (result.changed) {
      captureServerEvent("trip_progressed", actor.profile.id, { tripId: input.tripId, nextStatus: input.nextStatus })
    }

    captureNetworkUsageAnalytics(actor.profile.id, result.usage)

    return OK
  } catch (error) {
    return failure(error)
  }
}

export async function recordPreTripInspectionAction(input: {
  tripId: string
  items: Array<{ key: string; status: "pass" | "fail"; note?: string | null }>
  note?: string | null
  rollOnPass?: boolean
}): Promise<ActionResult & { outcome?: "pass" | "fail" }> {
  try {
    const actor = await requireActor()

    // Record and roll are one tap for the driver, so they are ONE mutation
    // here: a client-side chain of two actions can lose its second half to
    // the revalidation refresh, leaving a passed inspection on a truck that
    // never rolled.
    const { inspection } = await commit(["/driver", "/fleet", "/host"], (draft) => {
      const recorded = draft.recordPreTripInspection({
        actorUserId: actor.profile.id,
        items: input.items,
        note: input.note ?? undefined,
        organizationId: actorOrganizationId(actor),
        tripId: input.tripId
      })

      if (input.rollOnPass && recorded.inspection.outcome === "pass") {
        draft.progressTripStatus({
          actorUserId: actor.profile.id,
          nextStatus: "en_route_to_landing",
          organizationId: actorOrganizationId(actor),
          source: "driver",
          tripId: input.tripId
        })
      }

      return recorded
    })

    captureServerEvent("pre_trip_inspection_recorded", actor.profile.id, {
      outcome: inspection.outcome,
      tripId: input.tripId
    })

    return { error: null, ok: true, outcome: inspection.outcome }
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

/**
 * Attaches proof the browser has already uploaded to private Supabase Storage.
 *
 * Order matters. Authorize against the trip first, so an unauthorized caller
 * never reaches the provider; check the public id against the namespace that
 * authorization returned, so we only ask about assets this trip could own; then
 * read the asset back, so the record describes a file that exists rather than
 * one the client asserted.
 */
export async function attachTripDocumentAction(input: {
  tripId: string
  type: string
  publicId: string
  filename: string
}): Promise<ActionResult> {
  try {
    const actor = await requireActor()
    const organizationId = actorOrganizationId(actor)
    const type = parseTripDocumentType(input.type)
    const target = tripDocumentTarget(services.state, actor, organizationId, input.tripId, "write")

    if (!input.publicId.startsWith(`${target.publicIdPrefix}/uploads/`)) {
      throw new Error("The uploaded document does not belong to this trip")
    }

    const media = await verifiedMediaReference(input.publicId)

    await commit(["/driver", "/fleet", "/host"], (draft) =>
      draft.attachTripDocument({
        actorUserId: actor.profile.id,
        filename: input.filename,
        media,
        organizationId,
        tripId: target.tripId,
        type
      })
    )

    captureServerEvent("trip_document_attached", actor.profile.id, { type })
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
    const organizationId = actorOrganizationId(actor)
    const driverProfileId = actor.driverProfileId

    if (!driverProfileId) {
      throw new Error("Add a driver profile before setting availability")
    }

    await commit(["/driver", "/fleet"], (draft) =>
      draft.setDriverAvailability({
        actorUserId: actor.profile.id,
        driverProfileId,
        endAt: input.endAt,
        notes: input.notes ?? undefined,
        organizationId,
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

// --- Driver credential vault ---------------------------------------------------

/**
 * The record kind, validated at the boundary against the schema itself rather than
 * a hand-kept list. The kind decides which of the four mandatory records a document
 * satisfies, and whether a host is ever sent its photo, so a caller must not be
 * able to invent one.
 */
function parseCredentialKind(value: unknown): CredentialKind {
  const parsed = credentialKindSchema.safeParse(value)

  if (!parsed.success) {
    throw new Error("Choose one of the four required records")
  }

  return parsed.data
}

/**
 * Runs the binding review on one submitted document, then records the decision.
 *
 * WHY IT IS TWO COMMITS AND NOT ONE. Reading the document and asking the model are
 * network calls, and the operating state is written inside a synchronous
 * compare-and-swap. So the record is filed first, the decision lands second. Both
 * halves are idempotent by construction — `submitCredential` collapses the same
 * document onto the same id, and `applyCredentialReview` refuses a second row for
 * the same decider and decision — so a retry or a replay cannot double-decide.
 *
 * NOTHING IS WRITTEN WHEN THE CHECK CANNOT RUN. `reviewCredentialDocument` returns
 * `unavailable` with no decision field at all, and this returns `not_checked`: the
 * credential stays pending, which blocks the driver, and no review row claims a
 * verdict nobody reached. Inventing an approval on a provider timeout is the one
 * failure this whole path exists to make impossible.
 *
 * THE IMAGE NEVER LEAVES THIS SERVER except to the model. The bytes are read here
 * and passed as bytes, never as a URL: a signed delivery URL that leaks is a leaked
 * licence.
 */
async function reviewSubmittedCredential(
  actorUserId: string,
  holderName: string,
  credential: DriverCredential
): Promise<CredentialReviewDecision | "not_checked"> {
  if (!credential.documentMedia) {
    return "not_checked"
  }

  const url = await signedDocumentUrl(credential.documentMedia)
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) })

  if (!response.ok) {
    return "not_checked"
  }

  const bytes = Buffer.from(await response.arrayBuffer()).toString("base64")
  const outcome = await reviewCredentialDocument({
    claimedKind: credential.kind,
    document: { base64Data: bytes, format: credential.documentMedia.format },
    holderName,
    statedExpiresOn: credential.expiresOn ?? null,
    statedIdentifier: credential.identifier ?? null,
    statedIssuer: credential.issuer ?? null
  })

  if (outcome.status === "unavailable") {
    captureServerEvent("credential_review_unavailable", actorUserId, {
      kind: credential.kind,
      reason: outcome.reason
    })

    return "not_checked"
  }

  await commit(["/driver", "/fleet", "/host"], (draft) =>
    draft.applyCredentialReview({
      confidence: outcome.confidence,
      credentialId: credential.id,
      // No actorUserId: the service refuses to attribute a machine decision to a
      // person, because the audit log would then say somebody read a document they
      // never saw.
      decidedBy: "ai",
      decision: outcome.decision,
      extracted: outcome.extracted,
      findings: outcome.findings,
      model: outcome.model,
      rationale: outcome.rationale,
      requestedEvidence: outcome.requestedEvidence
    })
  )

  return outcome.decision
}

export interface CredentialActionResult extends ActionResult {
  /**
   * What the review decided, or `not_checked` when it could not run. Absent when
   * the action failed before any document was read.
   */
  outcome?: CredentialReviewDecision | "not_checked"
}

/**
 * Files one document in the driver's own vault and has it checked.
 *
 * THE DRIVER PROFILE COMES FROM THE SESSION, never from the client: a driver may
 * only file their own records, and the service authorizes the write against the
 * organization as well.
 *
 * The expiry and the issuer are the DRIVER's statement about their own document.
 * The review reads the page and refuses when the two disagree, which is why they are
 * collected rather than derived: an expiry the platform inferred and stored silently
 * would be a date nobody agreed to, and the driver would later be refused over it.
 * The licence or policy number is deliberately NOT collected here — the reviewer
 * skips that cross-check when it is absent, and asking a driver to type an identity
 * number into a phone puts it in more places for very little.
 */
export async function submitDriverCredentialAction(input: {
  equipmentProfileId?: string | null
  expiresOn?: string | null
  issuer?: string | null
  kind: string
  publicId: string
}): Promise<CredentialActionResult> {
  try {
    const actor = await requireActor()
    const organizationId = actorOrganizationId(actor)
    const kind = parseCredentialKind(input.kind)
    const driverProfileId = actor.driverProfileId

    if (!driverProfileId) {
      throw new Error("Add a driver profile before sending your records")
    }

    const equipmentProfileId = input.equipmentProfileId?.trim() || null
    const target = services.getCredentialUploadTarget({
      actorUserId: actor.profile.id,
      driverProfileId,
      equipmentProfileId,
      kind,
      organizationId
    })

    // Checked before the provider round trip against the same authorized target
    // resolver the upload-signature route and write-time service use.
    const expectedPrefix = `${target.publicIdPrefix}/uploads/`

    if (!input.publicId.startsWith(expectedPrefix)) {
      throw new Error("That document was not uploaded to your vault")
    }

    // Bytes first. The record is written only once the document is known to exist —
    // the same order trip proof follows — because a row naming a document that was
    // never stored is exactly what the gate refuses to count, and it would leave a
    // driver reading "in review" about nothing.
    const documentMedia = await verifiedMediaReference(input.publicId)
    const { credential } = await commit(["/driver", "/fleet", "/host"], (draft) =>
      draft.submitCredential({
        actorUserId: actor.profile.id,
        documentMedia,
        driverProfileId,
        expiresOn: parseStatedCredentialExpiry(input.expiresOn),
        issuer: input.issuer?.trim() ? input.issuer.trim() : null,
        kind,
        organizationId,
        trailerProfileId: kind === "trailer" ? equipmentProfileId : null,
        truckProfileId: kind === "truck" ? equipmentProfileId : null
      })
    )

    captureServerEvent("driver_credential_submitted", actor.profile.id, {
      equipmentProfileId,
      kind
    })

    // The record is filed either way. A review that cannot run leaves it pending,
    // which blocks the driver — the safe direction — and they can ask for another
    // look once the check is available again.
    const outcome = await reviewSubmittedCredential(
      actor.profile.id,
      actor.profile.fullName,
      credential
    )

    return { ...OK, outcome }
  } catch (error) {
    return failure(error)
  }
}

/**
 * Asks for another look at a record that was refused or sent back for more.
 *
 * The credential is named by id and nothing else. Whose it is comes from the service:
 * `listDriverCredentials` refuses a vault that is not this actor's, so a crafted id
 * cannot put another driver's licence back through the model — and cannot be used to
 * find out whether one exists.
 *
 * A re-review is the SAME document read again, so the answer may well be the same.
 * That is honest: `applyCredentialReview` writes no second row for a decision this
 * decider already recorded, and the driver is told the answer stands rather than
 * being shown invented progress.
 */
export async function requestCredentialReviewAction(input: {
  credentialId: string
}): Promise<CredentialActionResult> {
  try {
    const actor = await requireActor()
    const driverProfileId = actor.driverProfileId

    if (!driverProfileId) {
      throw new Error("Add a driver profile before asking for another look")
    }

    const vault = services.listDriverCredentials(driverProfileId, {
      actorUserId: actor.profile.id,
      audience: "driver"
    })

    if (vault.audience === "host") {
      throw new Error("A host cannot ask for a re-review of a driver's records")
    }

    const credential = vault.credentials.find((candidate) => candidate.id === input.credentialId)

    if (!credential) {
      throw new Error("That record is not in your vault")
    }

    if (!["denied", "more_info_required"].includes(credential.status)) {
      throw new Error("Only a record that needs correction or was refused can be reviewed again")
    }

    await checkRateLimit("credential-rereview", actor.profile.id, 3, 60 * 60_000)

    const outcome = await reviewSubmittedCredential(
      actor.profile.id,
      actor.profile.fullName,
      credential
    )

    captureServerEvent("credential_review_requested", actor.profile.id, {
      kind: credential.kind,
      outcome
    })

    return { ...OK, outcome }
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
    const assignedDriverProfileId = input.assignToSelf ? actor.driverProfileId : null

    if (input.assignToSelf && !assignedDriverProfileId) {
      throw new Error("Finish your driver profile before adding personal equipment")
    }

    await commit(["/driver", "/fleet"], (draft) =>
      draft.addEquipmentCombination({
        actorUserId: actor.profile.id,
        assignedDriverProfileId,
        homeRegion: actor.activeOrganization?.primaryRegion ?? "Unspecified",
        label: input.label,
        maxPayloadTons: input.maxPayloadTons,
        organizationId: actorOrganizationId(actor),
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
}): Promise<ActionResult & { flaggedLoads?: number }> {
  try {
    const actor = await requireActor()

    // Counted inside the same mutation that applies the change, so the number
    // reported back is the number of loads the service actually flagged.
    const flaggedLoads = await commit(["/driver", "/fleet", "/host"], (draft) => {
      const combination = draft.state.equipmentCombinations.find(
        (candidate) => candidate.id === input.combinationId
      )
      const impacted =
        combination && input.status === "maintenance" && combination.status !== "maintenance"
          ? listActiveLoadsUsingCombination(draft.state, combination).length
          : 0

      draft.updateEquipmentStatus({
        actorUserId: actor.profile.id,
        combinationId: input.combinationId,
        organizationId: actorOrganizationId(actor),
        status: input.status
      })

      return impacted
    })

    return { error: null, flaggedLoads, ok: true }
  } catch (error) {
    return failure(error)
  }
}

export async function createOrganizationInvitationAction(input: {
  invitedEmail: string
  invitedRole: string
}): Promise<ActionResult> {
  try {
    const actor = await requireActor()

    await commit(["/fleet", "/host"], (draft) =>
      draft.createOrganizationInvitation({
        actorUserId: actor.profile.id,
        invitedEmail: input.invitedEmail,
        invitedRole: input.invitedRole,
        organizationId: actorOrganizationId(actor)
      })
    )

    captureServerEvent("invitation_created", actor.profile.id, { invitedRole: input.invitedRole })

    return OK
  } catch (error) {
    return failure(error)
  }
}

export async function revokeOrganizationInvitationAction(input: { invitationId: string }): Promise<ActionResult> {
  try {
    const actor = await requireActor()

    await commit(["/fleet", "/host"], (draft) =>
      draft.revokeOrganizationInvitation({
        actorUserId: actor.profile.id,
        invitationId: input.invitationId,
        organizationId: actorOrganizationId(actor)
      })
    )

    captureServerEvent("invitation_revoked", actor.profile.id, { invitationId: input.invitationId })

    return OK
  } catch (error) {
    return failure(error)
  }
}

export async function changeOrganizationMemberRoleAction(input: {
  memberUserId: string
  role: OrganizationRole
}): Promise<ActionResult> {
  try {
    const actor = await requireActor()

    await commit(["/fleet", "/host"], (draft) =>
      draft.changeOrganizationMemberRole({
        actorUserId: actor.profile.id,
        memberUserId: input.memberUserId,
        organizationId: actorOrganizationId(actor),
        role: input.role
      })
    )

    return OK
  } catch (error) {
    return failure(error)
  }
}

export async function suspendOrganizationMemberAction(input: {
  memberUserId: string
}): Promise<ActionResult> {
  try {
    const actor = await requireActor()

    await commit(["/fleet", "/host"], (draft) =>
      draft.suspendOrganizationMember({
        actorUserId: actor.profile.id,
        memberUserId: input.memberUserId,
        organizationId: actorOrganizationId(actor)
      })
    )

    return OK
  } catch (error) {
    return failure(error)
  }
}

export async function reactivateOrganizationMemberAction(input: {
  memberUserId: string
}): Promise<ActionResult> {
  try {
    const actor = await requireActor()

    await commit(["/fleet", "/host"], (draft) =>
      draft.reactivateOrganizationMember({
        actorUserId: actor.profile.id,
        memberUserId: input.memberUserId,
        organizationId: actorOrganizationId(actor)
      })
    )

    return OK
  } catch (error) {
    return failure(error)
  }
}

export async function removeOrganizationMemberAction(input: {
  memberUserId: string
}): Promise<ActionResult> {
  try {
    const actor = await requireActor()

    await commit(["/fleet", "/host"], (draft) =>
      draft.removeOrganizationMember({
        actorUserId: actor.profile.id,
        memberUserId: input.memberUserId,
        organizationId: actorOrganizationId(actor)
      })
    )

    return OK
  } catch (error) {
    return failure(error)
  }
}

export async function featureTruckPhotoAction(input: { featured: boolean }): Promise<ActionResult> {
  try {
    const actor = await requireActor()

    if (!actor.driverProfileId) {
      throw new Error("Only a driver can feature a truck photo")
    }

    await commit(["/driver", "/fleet"], (draft) =>
      draft.setFeaturedTruckPhoto({
        actorUserId: actor.profile.id,
        driverProfileId: actor.driverProfileId,
        featured: input.featured,
        organizationId: actorOrganizationId(actor)
      })
    )

    captureServerEvent("truck_photo_feature_toggled", actor.profile.id, { featured: input.featured })

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
        actorUserId: actor.profile.id,
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

    // `driverPayCents` — what the host states one truckload pays the driver —
    // travels through here to the service, which refuses to publish work without
    // it and stores it on the posting. It is money, so it arrives as whole cents
    // or not at all: a dollars string or a fractional cent would otherwise reach
    // the fee base as a zod error from three layers down, and the builder's own
    // parse is not a guarantee about what a client sends.
    const statedPay = input.driverPayCents

    if (statedPay !== undefined && statedPay !== null && !Number.isSafeInteger(statedPay)) {
      throw new Error("Driver pay must be sent as a whole number of cents.")
    }

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

// --- Host workspace setup ---------------------------------------------------
// The records publishing requires. Until these existed in-product, a real host
// organization could never post work at all: the builder refused without a
// landing, a lane, and a rate, and told them to contact a support desk that
// does not exist for records onboarding never created.

const HOST_SETUP_PATHS = ["/host", "/host/landings", "/host/opportunities", "/loads", "/"]

/**
 * Validated against the domain enum rather than cast. A road condition a driver
 * is quoted has to be one the matching rules actually understand.
 */
function parseRoadCondition(value: string | null | undefined): RoadCondition | null {
  return value ? roadConditionSchema.parse(value) : null
}

export async function createLandingAction(input: {
  name: string
  addressLine1: string
  city: string
  state: string
  postalCode: string
  lat: number
  lng: number
  contactName: string
  contactPhone: string
  contactEmail?: string | null
  roadCondition?: string | null
  accessNotes?: string | null
}): Promise<ActionResult> {
  try {
    const actor = await requireActor()
    const landing = await commit(HOST_SETUP_PATHS, (draft) =>
      draft.createLanding({
        accessNotes: input.accessNotes ?? null,
        actorUserId: actor.profile.id,
        addressLine1: input.addressLine1,
        city: input.city,
        contact: {
          email: input.contactEmail || null,
          name: input.contactName,
          phone: input.contactPhone
        },
        coordinates: { lat: input.lat, lng: input.lng },
        name: input.name,
        organizationId: actorOrganizationId(actor),
        postalCode: input.postalCode,
        roadCondition: parseRoadCondition(input.roadCondition),
        state: input.state
      })
    )

    captureServerEvent("landing_created", actor.profile.id, { landingId: landing.id })
    return OK
  } catch (error) {
    return failure(error)
  }
}

export async function updateLandingAction(input: {
  landingId: string
  name: string
  addressLine1: string
  city: string
  state: string
  postalCode: string
  lat: number
  lng: number
  contactName: string
  contactPhone: string
  contactEmail?: string | null
  roadCondition?: string | null
  accessNotes?: string | null
}): Promise<ActionResult> {
  try {
    const actor = await requireActor()

    await commit(HOST_SETUP_PATHS, (draft) =>
      draft.updateLanding({
        accessNotes: input.accessNotes ?? null,
        actorUserId: actor.profile.id,
        addressLine1: input.addressLine1,
        city: input.city,
        contact: {
          email: input.contactEmail || null,
          name: input.contactName,
          phone: input.contactPhone
        },
        coordinates: { lat: input.lat, lng: input.lng },
        landingId: input.landingId,
        name: input.name,
        organizationId: actorOrganizationId(actor),
        postalCode: input.postalCode,
        roadCondition: parseRoadCondition(input.roadCondition),
        state: input.state
      })
    )

    captureServerEvent("landing_updated", actor.profile.id, { landingId: input.landingId })
    return OK
  } catch (error) {
    return failure(error)
  }
}

export async function upsertLandingDetailsAction(input: {
  landingId: string
  publicApproximateArea: string
  entranceLat: number
  entranceLng: number
  privateRoadNotes: string | null
  gateInstructions: string | null
  loadingEquipment: string[]
  turnaroundConstraints: string[]
  stagingInstructions: string | null
  communicationInstructions: string | null
  safetyRequirements: string[]
}): Promise<ActionResult> {
  try {
    const actor = await requireActor()

    await commit(HOST_SETUP_PATHS, (draft) =>
      draft.upsertLandingDetails({
        ...input,
        actorUserId: actor.profile.id,
        organizationId: actorOrganizationId(actor)
      })
    )

    captureServerEvent("landing_details_verified", actor.profile.id, {
      landingId: input.landingId
    })
    return OK
  } catch (error) {
    return failure(error)
  }
}

/**
 * Retires or restores a landing without touching anything else about it. The
 * page cannot send a stale copy of the record back, because it does not send
 * the record at all.
 */
export async function setLandingActiveAction(input: {
  landingId: string
  isActive: boolean
}): Promise<ActionResult> {
  try {
    const actor = await requireActor()

    await commit(HOST_SETUP_PATHS, (draft) =>
      draft.setLandingActive({
        actorUserId: actor.profile.id,
        isActive: input.isActive,
        landingId: input.landingId,
        organizationId: actorOrganizationId(actor)
      })
    )

    captureServerEvent(input.isActive ? "landing_restored" : "landing_retired", actor.profile.id, {
      landingId: input.landingId
    })
    return OK
  } catch (error) {
    return failure(error)
  }
}

export async function createMillAction(input: {
  name: string
  addressLine1: string
  city: string
  state: string
  postalCode: string
  lat: number
  lng: number
  contactName: string
  contactPhone: string
  contactEmail?: string | null
  accessNotes?: string | null
}): Promise<ActionResult> {
  try {
    const actor = await requireActor()
    const mill = await commit(HOST_SETUP_PATHS, (draft) =>
      draft.createMill({
        accessNotes: input.accessNotes ?? null,
        actorUserId: actor.profile.id,
        addressLine1: input.addressLine1,
        city: input.city,
        contact: {
          email: input.contactEmail || null,
          name: input.contactName,
          phone: input.contactPhone
        },
        coordinates: { lat: input.lat, lng: input.lng },
        name: input.name,
        organizationId: actorOrganizationId(actor),
        postalCode: input.postalCode,
        state: input.state
      })
    )

    captureServerEvent("mill_created", actor.profile.id, { millId: mill.id })
    return OK
  } catch (error) {
    return failure(error)
  }
}

export async function createHaulRouteAction(input: {
  landingId: string
  millId: string
  routeName: string
  estimatedDistanceMiles: number
  estimatedRunTimeMinutes: number
  roadCondition: string
  roadNotes?: string | null
}): Promise<ActionResult> {
  try {
    const actor = await requireActor()
    const route = await commit(HOST_SETUP_PATHS, (draft) =>
      draft.createHaulRoute({
        actorUserId: actor.profile.id,
        estimatedDistanceMiles: input.estimatedDistanceMiles,
        estimatedRunTimeMinutes: input.estimatedRunTimeMinutes,
        landingId: input.landingId,
        millId: input.millId,
        organizationId: actorOrganizationId(actor),
        roadCondition: roadConditionSchema.parse(input.roadCondition),
        roadNotes: input.roadNotes ?? null,
        routeName: input.routeName
      })
    )

    captureServerEvent("haul_route_created", actor.profile.id, { routeId: route.id })
    return OK
  } catch (error) {
    return failure(error)
  }
}

export async function createRateAction(input: {
  rateType: string
  amountCents: number
  fuelSurchargeCents?: number
  effectiveDate: string
  notes?: string | null
}): Promise<ActionResult> {
  try {
    const actor = await requireActor()
    const rate = await commit(HOST_SETUP_PATHS, (draft) =>
      draft.createRate({
        actorUserId: actor.profile.id,
        amountCents: input.amountCents,
        effectiveDate: input.effectiveDate,
        fuelSurchargeCents: input.fuelSurchargeCents ?? 0,
        notes: input.notes ?? null,
        organizationId: actorOrganizationId(actor),
        rateType: rateTypeSchema.parse(input.rateType)
      })
    )

    captureServerEvent("rate_created", actor.profile.id, { rateId: rate.id })
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

export async function submitHaulCompletionAction(input: {
  tripId: string
  quantityValue?: number | null
  quantityUnit?: string | null
  ticketNumber?: string | null
  exceptionType?: string | null
  exceptionNote?: string | null
}): Promise<ActionResult> {
  try {
    const actor = await requireActor()

    const result = await commit(["/driver", "/fleet", "/host"], (draft) =>
      // The unit and exception type are narrowed here only to satisfy the
      // boundary; the service parses both through zod, so an invalid value is
      // refused server-side rather than trusted.
      draft.submitHaulCompletion({
        actorUserId: actor.profile.id,
        deliveredQuantity: input.quantityValue != null
          ? {
              ticketNumber: input.ticketNumber?.trim() || null,
              unit: (input.quantityUnit ?? "tons") as DeliveredQuantity["unit"],
              value: input.quantityValue
            }
          : null,
        exception: input.exceptionType && input.exceptionNote?.trim()
          ? { note: input.exceptionNote.trim(), type: input.exceptionType as HaulException["type"] }
          : null,
        organizationId: actorOrganizationId(actor),
        tripId: input.tripId
      })
    )

    if (result.changed) {
      captureServerEvent("haul_completion_submitted", actor.profile.id, { tripId: input.tripId })
    }

    return OK
  } catch (error) {
    return failure(error)
  }
}

export async function settleHaulCompletionAction(input: {
  tripId: string
  decision: "confirm" | "dispute"
  reason?: string | null
}): Promise<ActionResult> {
  try {
    const actor = await requireActor()

    const result = await commit(["/driver", "/fleet", "/host"], (draft) =>
      draft.settleHaulCompletion({
        actorUserId: actor.profile.id,
        decision: input.decision,
        organizationId: actorOrganizationId(actor),
        reason: input.reason?.trim() || null,
        tripId: input.tripId
      })
    )

    captureNetworkUsageAnalytics(actor.profile.id, result.usage)

    // Event only — the dispute reason stays out of analytics.
    captureServerEvent(
      input.decision === "confirm" ? "haul_completion_confirmed" : "haul_completion_disputed",
      actor.profile.id,
      { tripId: input.tripId }
    )

    return OK
  } catch (error) {
    return failure(error)
  }
}

export async function markDriverPaymentSentAction(input: {
  assignmentId: string
}): Promise<ActionResult> {
  try {
    const actor = await requireActor()

    const result = await commit(["/driver", "/fleet", "/host"], (draft) =>
      draft.markDriverPaymentSent({
        actorUserId: actor.profile.id,
        assignmentId: input.assignmentId,
        organizationId: actorOrganizationId(actor)
      })
    )

    if (result.changed) {
      captureServerEvent("driver_payment_sent", actor.profile.id, {
        assignmentId: input.assignmentId
      })
    }

    return OK
  } catch (error) {
    return failure(error)
  }
}

export async function confirmDriverPaymentReceivedAction(input: {
  amount: string
  assignmentId: string
  currency: string
}): Promise<
  ActionResult & {
    matchesExpected: boolean | null
    receivedPayLabel: string | null
  }
> {
  try {
    const actor = await requireActor()
    const amountCents = parseDriverPayCents(input.amount)

    if (amountCents === null) {
      throw new Error("Enter the amount that actually reached you, in dollars and cents")
    }

    const currency = input.currency.trim().toUpperCase()

    if (!/^[A-Z]{3}$/.test(currency)) {
      throw new Error("Enter a three-letter payment currency such as USD")
    }

    const result = await commit(["/driver", "/fleet", "/host"], (draft) =>
      draft.confirmDriverPaymentReceived({
        actorUserId: actor.profile.id,
        amountCents,
        assignmentId: input.assignmentId,
        currency,
        organizationId: actorOrganizationId(actor)
      })
    )

    if (result.changed) {
      captureServerEvent("driver_payment_received", actor.profile.id, {
        amountCents,
        assignmentId: input.assignmentId,
        currency,
        platformFeeOutcome: result.platformFeeOutcome
      })
    }

    return {
      ...OK,
      matchesExpected: result.matchesExpected,
      receivedPayLabel: formatMoney(result.receivedPay)
    }
  } catch (error) {
    return {
      ...failure(error),
      matchesExpected: null,
      receivedPayLabel: null
    }
  }
}

export interface RefreshRoutePackResult extends ActionResult {
  changed: boolean
  version: number | null
}

/**
 * Re-issues an assignment's Route Pack from the load's current instructions.
 * A material change mints a new version and alerts the driver; an immaterial
 * one changes nothing, so routine edits never cry wolf at someone driving.
 */
export async function refreshRoutePackAction(input: {
  assignmentId: string
}): Promise<RefreshRoutePackResult> {
  try {
    const actor = await requireActor()

    const result = await commit(["/host", "/fleet", "/driver"], (draft) =>
      draft.refreshRoutePackForAssignment({
        actorUserId: actor.profile.id,
        assignmentId: input.assignmentId,
        organizationId: actorOrganizationId(actor)
      })
    )

    captureServerEvent("route_pack_refreshed", actor.profile.id, {
      assignmentId: input.assignmentId,
      changed: result.changed
    })

    return { ...OK, changed: result.changed, version: result.routePack.version }
  } catch (error) {
    return { ...failure(error), changed: false, version: null }
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

export async function claimDirectOfferAction(input: {
  directOfferId: string
  equipmentCombinationId: string
  truckSlotId: string
}): Promise<ActionResult> {
  try {
    const actor = await requireActor()

    await commit(["/fleet", "/host", "/driver"], (draft) =>
      draft.claimDirectOffer({
        actorUserId: actor.profile.id,
        directOfferId: input.directOfferId,
        equipmentCombinationId: input.equipmentCombinationId,
        organizationId: actorOrganizationId(actor),
        truckSlotId: input.truckSlotId
      })
    )

    captureServerEvent("direct_offer_claimed", actor.profile.id, { directOfferId: input.directOfferId })

    return OK
  } catch (error) {
    return failure(error)
  }
}

export async function declineDirectOfferAction(input: { directOfferId: string }): Promise<ActionResult> {
  try {
    const actor = await requireActor()

    await commit(["/fleet", "/host"], (draft) =>
      draft.declineDirectOffer({
        actorUserId: actor.profile.id,
        directOfferId: input.directOfferId,
        organizationId: actorOrganizationId(actor)
      })
    )

    captureServerEvent("direct_offer_declined", actor.profile.id, { directOfferId: input.directOfferId })

    return OK
  } catch (error) {
    return failure(error)
  }
}

export async function revokeDirectOfferAction(input: { directOfferId: string }): Promise<ActionResult> {
  try {
    const actor = await requireActor()

    await commit(["/host", "/fleet"], (draft) =>
      draft.revokeDirectOffer({
        actorUserId: actor.profile.id,
        directOfferId: input.directOfferId,
        organizationId: actorOrganizationId(actor)
      })
    )

    captureServerEvent("direct_offer_revoked", actor.profile.id, { directOfferId: input.directOfferId })

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
