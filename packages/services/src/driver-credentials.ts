import {
  CREDENTIAL_ASSURANCE_STATEMENT,
  auditEventSchema,
  credentialGateFor,
  credentialIsValidAt,
  credentialKindSchema,
  credentialReviewDecisionSchema,
  credentialReviewSchema,
  credentialReviewerSchema,
  deterministicUuidV5,
  driverCredentialSchema,
  credentialExtractionSchema,
  hostVisibleCredential,
  mediaReferenceSchema,
  organizationRoleCan,
  type AssignmentStatus,
  type CredentialGate,
  type CredentialKind,
  type CredentialReview,
  type DriverCredential,
  type DriverProfile,
  type HostVisibleCredential,
  type MediaReference
} from "@logloads/contracts"
import type { LogLoadsDatabaseState } from "@logloads/db"
import { z } from "zod"

import {
  activeDriverProfileForOrganization
} from "./driver-access"
import { organizationOperationallyAccessible } from "./organization-access"
import {
  assertEquipmentProfileUnitNumberUnambiguous,
  equipmentProfileUnitNumberIsUnambiguous
} from "./equipment-unit-numbers"
import {
  assertDomainCondition as assertCondition,
  assertDomainFound as assertFound,
  createUuid,
  nowIso
} from "./utils"

const HOST_CREDENTIAL_ASSIGNMENT_STATUSES = new Set<AssignmentStatus>([
  "accepted",
  "checked_in",
  "loading",
  "hauled",
  "completed"
])

/**
 * ── The driver credential vault ───────────────────────────────────────────────
 *
 * The four things a driver must have on file before they may accept ANY load —
 * insurance, CDL, truck, trailer — live here: how they get submitted, how a
 * review decides them, who may read them, and the one answer to "may this driver
 * accept work".
 *
 * WHAT THIS MODULE CLAIMS, AND WHAT IT DOES NOT. A document was submitted, read,
 * checked for consistency and expiry, and approved or refused. Nothing here
 * certifies that a driver is legally entitled to operate: LogLoads is
 * orchestration, and legitimacy sits between the host and the driver. So no
 * function is named "verify", nothing returns a verdict about legal standing, and
 * the only sentence a host-facing surface may attach is the frozen
 * `CREDENTIAL_ASSURANCE_STATEMENT` from the contracts package.
 *
 * THE HOST BOUNDARY IS STRUCTURAL, NOT EDITORIAL. A host receives status, expiry,
 * and the truck and trailer photos. A host never receives the CDL image, the
 * insurance certificate image, the policy or licence number, or the review notes.
 * That is not enforced by remembering to strip fields: `hostCredentialSummary`
 * returns `HostVisibleCredential[]`, a four-field shape with no expression for any
 * of those, and it is the ONLY path that a host-audience read can reach. Adding a
 * field to the stored row cannot leak it to a host without somebody first adding a
 * field to that shape.
 *
 * WHY EVERY WRITE IS IDEMPOTENT ON A DETERMINISTIC ID. The whole database is one
 * JSONB row read and written whole under a version compare-and-swap. On conflict
 * the caller's mutation is REPLAYED against a fresh draft, and clients retry
 * requests whose response they lost. There is no unique index, no foreign key and
 * no CHECK constraint behind this store, so a deterministic id plus an explicit
 * "is it already there?" check made INSIDE the same mutation as the write is the
 * entire defence against a driver's vault sprouting duplicate rows and a review
 * trail recording one decision twice.
 *
 * WHY IT PERFORMS NO I/O. Every function takes the draft state and the instant,
 * mutates the draft, and returns. No upload, no model call, no hidden
 * `Date.now()`. That is what lets the guards be tested, and what lets a caller
 * run them inside the compare-and-swap mutator where they have to run to mean
 * anything — in particular `driverCredentialGate`, which is only a real block if
 * it is evaluated in the same mutation that writes the acceptance.
 */

// ── Where a credential document lives ─────────────────────────────────────────

/**
 * The namespace every credential id is derived under. FROZEN FOREVER.
 *
 * Changing it re-mints the id of every credential ever submitted, so the
 * "already submitted?" check would stop recognising records that exist and a
 * retried submission would write a second row for one document.
 */
const DRIVER_CREDENTIAL_NAMESPACE = "8b1f0c46-2a7d-4e59-9c31-5f6a2d8e41b7"

/** The namespace every review id is derived under. FROZEN FOREVER, same reason. */
const CREDENTIAL_REVIEW_NAMESPACE = "4e2a9d17-63c5-4b08-8f7e-1c9b3a5d20e6"
const EXPIRING_CREDENTIAL_KINDS: ReadonlySet<CredentialKind> = new Set(["insurance", "cdl"])

/**
 * The media namespace a credential document must be stored under.
 *
 * Keyed on the DRIVER PROFILE and not on the organization, unlike the truck and
 * trailer photo prefixes in driver-profile.ts. A licence and an insurance
 * certificate belong to the driver: they follow them when they change outfits, and
 * filing them under whichever organization happened to be dispatching that week
 * would make one outfit's folder the home of another outfit's driver's documents.
 *
 * Exported because the upload-target surface must derive the prefix it signs from
 * the same function `submitCredential` checks against. Two spellings of this path
 * means every upload is refused, or worse, that the check passes on a path the
 * uploader never actually writes to.
 */
export function credentialDocumentPublicIdPrefix(
  driverProfileId: string,
  kind: CredentialKind,
  equipmentProfileId?: string | null
): string {
  const equipmentSegment = equipmentProfileId ? `/${equipmentProfileId}` : ""

  return `logloads/driver-credentials/${driverProfileId}/${kind}${equipmentSegment}`
}

/**
 * The id of a credential record. Same driver, same kind, same stored document —
 * same id, forever.
 *
 * Derived from the DOCUMENT rather than from a counter. A submission is "this
 * driver handed over this file for this kind", so two requests carrying the same
 * upload are the same submission and must collapse onto one row. A counter would
 * not: on a compare-and-swap replay the draft already holds the row the other
 * writer committed, the count would differ, and the replay would mint a second id
 * for the same document.
 */
export function driverCredentialId(
  driverProfileId: string,
  kind: CredentialKind,
  documentPublicId: string
): string {
  return deterministicUuidV5(
    DRIVER_CREDENTIAL_NAMESPACE,
    `${driverProfileId.toLowerCase()}:${kind}:${documentPublicId}`
  )
}

/**
 * The id of one decision on one credential.
 *
 * `attempt` is how many decisions this credential had taken before this one, so
 * the AI's decision and a later platform appeal of it get distinct ids on the
 * same append-only trail. It is NOT what makes a retry safe on its own — a retry
 * arriving after the first decision committed would compute a higher attempt — so
 * `applyCredentialReview` also refuses to write when the same decider already
 * recorded the same decision on this credential. Both halves are needed: the
 * derivation makes a replay inside one draft byte-identical, and the natural-key
 * check catches the retry that crosses a commit.
 */
export function credentialReviewId(credentialId: string, attempt: number): string {
  return deterministicUuidV5(
    CREDENTIAL_REVIEW_NAMESPACE,
    `${credentialId.toLowerCase()}:${attempt}`
  )
}

// ── Inputs ────────────────────────────────────────────────────────────────────

const submitCredentialInputSchema = z
  .object({
    actorUserId: z.string().uuid(),
    driverProfileId: z.string().uuid(),
    /**
     * Required. Submitting is the act of handing a document over to be read: a
     * record with nothing attached is one no reviewer can decide, and it would
     * occupy the driver's outstanding slot for that kind forever while the gate
     * refuses to count it. The row contract permits a null document because rows
     * arrive from places other than this service and `credentialIsValidAt` has to
     * fail closed on them — it is not a state this service creates.
     */
    documentMedia: mediaReferenceSchema,
    /**
     * Instants the DRIVER states, resolved from the dates printed on the document.
     * The reviewer checks the document against them; it never rewrites them (see
     * `applyCredentialReview`).
     */
    expiresOn: z.string().datetime().optional().nullable(),
    identifier: z.string().trim().min(1).max(120).optional().nullable(),
    issuedOn: z.string().datetime().optional().nullable(),
    issuer: z.string().trim().min(1).max(200).optional().nullable(),
    // Derived from the schema, never a hand-copied list of kinds.
    kind: credentialKindSchema,
    /** Exact equipment photographed. Required only for equipment evidence. */
    trailerProfileId: z.string().uuid().optional().nullable(),
    truckProfileId: z.string().uuid().optional().nullable(),
    /**
     * Required, and never defaulted. A web boundary forwards client JSON straight
     * into this input; a defaulted organization on a safety record would let a
     * member of one outfit file documents against a driver on another's roster.
     */
    organizationId: z.string().uuid()
  })
  .superRefine((input, context) => {
    const truckBound = Boolean(input.truckProfileId)
    const trailerBound = Boolean(input.trailerProfileId)

    if (input.kind === "truck" && (!truckBound || trailerBound)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A truck photo must name exactly one truck profile",
        path: ["truckProfileId"]
      })
    } else if (input.kind === "trailer" && (!trailerBound || truckBound)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A trailer photo must name exactly one trailer profile",
        path: ["trailerProfileId"]
      })
    } else if (
      (input.kind === "cdl" || input.kind === "insurance") &&
      (truckBound || trailerBound)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Identity and insurance records cannot be attached to equipment",
        path: ["kind"]
      })
    }
  })

export type SubmitCredentialInput = z.input<typeof submitCredentialInputSchema>

export interface SubmitCredentialResult {
  credential: DriverCredential
  /**
   * `submitted` wrote the row. `already_submitted` found this exact document
   * already on file and wrote nothing — the retry and compare-and-swap replay
   * path. Both mean "this document is in the vault", which is why neither is an
   * error.
   */
  outcome: "already_submitted" | "submitted"
  /** The records this submission replaced. Empty when nothing was outstanding. */
  superseded: DriverCredential[]
}

const credentialUploadTargetInputSchema = z
  .object({
    actorUserId: z.string().uuid(),
    driverProfileId: z.string().uuid(),
    equipmentProfileId: z.string().uuid().optional().nullable(),
    kind: credentialKindSchema,
    organizationId: z.string().uuid()
  })
  .strict()
  .superRefine((input, context) => {
    const equipmentBound = Boolean(input.equipmentProfileId)

    if ((input.kind === "truck" || input.kind === "trailer") && !equipmentBound) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `A ${input.kind} photo must name exactly one ${input.kind} profile`,
        path: ["equipmentProfileId"]
      })
    } else if (
      (input.kind === "cdl" || input.kind === "insurance") &&
      equipmentBound
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Identity and insurance records cannot be attached to equipment",
        path: ["equipmentProfileId"]
      })
    }
  })

export type CredentialUploadTargetInput = z.input<
  typeof credentialUploadTargetInputSchema
>

export interface CredentialUploadTarget {
  equipmentProfileId: string | null
  kind: CredentialKind
  organizationId: string
  publicIdPrefix: string
}

const applyCredentialReviewInputSchema = z.object({
  /**
   * Who to attribute the decision to in the audit log. REQUIRED for a
   * `platform_admin` decision and refused for an `ai` one — see
   * `assertDeciderMayDecide`.
   */
  actorUserId: z.string().uuid().optional().nullable(),
  /** The model's own confidence, 0–1. Never a threshold: the decision decides. */
  confidence: z.number().min(0).max(1).optional().nullable(),
  credentialId: z.string().uuid(),
  decidedBy: credentialReviewerSchema,
  /**
   * Executable authority derived by the authenticated platform boundary. A
   * stored admin role remains a second invariant, never the source of this bit.
   */
  platformAdminAuthorized: z.boolean().optional(),
  // Derived by subtraction in the contracts package: a reviewer cannot record
  // "pending", which would be a decision not to decide.
  decision: credentialReviewDecisionSchema,
  /** What the reviewer read off the page, as printed. Never normalized here. */
  extracted: credentialExtractionSchema.optional(),
  /** Machine-readable reasons ("expiry_unreadable", "kind_mismatch"). */
  findings: z.array(z.string().trim().min(1).max(300)).default([]),
  model: z.string().trim().min(1).max(120).optional().nullable(),
  /** The same reasons in plain language. This is what the driver reads. */
  rationale: z.string().trim().min(1).max(1000),
  requestedEvidence: z.array(z.string().trim().min(1).max(200)).default([])
})

export type ApplyCredentialReviewInput = z.input<typeof applyCredentialReviewInputSchema>

export interface ApplyCredentialReviewResult {
  credential: DriverCredential
  /**
   * `reviewed` wrote the decision. `already_reviewed` found this decider's same
   * decision already on the trail and wrote nothing — no second row, and no
   * second audit event claiming the credential was decided twice.
   */
  outcome: "already_reviewed" | "reviewed"
  review: CredentialReview
}

// ── Who may see and do what ───────────────────────────────────────────────────

/**
 * Who is asking.
 *
 * A discriminated union rather than a bag of optional flags, because the audience
 * decides the SHAPE of what comes back: a host audience cannot be handed the
 * vault view, and the compiler is what says so.
 */
export type CredentialViewer =
  /** The driver, reading their own vault. Everything, including the images. */
  | {
      actorUserId: string
      audience: "driver"
      /**
       * Binds the vault to the organization active in the session. Older
       * in-process callers may omit it; the service then uses the profile's
       * current organization and still requires that exact active identity.
       */
      organizationId?: string
    }
  /**
   * The outfit that dispatches this driver, through a member holding
   * manage_drivers. They submit these documents on the driver's behalf, so they
   * see what they filed.
   */
  | { actorUserId: string; audience: "fleet"; organizationId: string }
  /** A host this driver hauls for. Status, expiry, selected-rig photos. Nothing else. */
  | {
      actorUserId: string
      assignmentId: string
      audience: "host"
      organizationId: string
    }

export interface DriverCredentialVaultView {
  audience: "driver" | "fleet"
  /** Every record ever filed for this driver, newest submission first. */
  credentials: DriverCredential[]
  driverProfileId: string
  /** Exact truck/trailer profiles this driver may file equipment evidence for. */
  equipmentOptions: CredentialEquipmentOption[]
  /** Exact assigned combinations the profile UI reports readiness against. */
  equipmentSelections: CredentialEquipmentSelectionOption[]
  /** The whole decision trail, newest decision first. Why they were refused. */
  reviews: CredentialReview[]
}

export interface HostCredentialSummary {
  /** The only claim a host-facing surface may make. Frozen in the contracts package. */
  assurance: string
  /**
   * One entry per mandatory kind the driver CURRENTLY holds valid, in schema
   * order. A refused, pending or superseded record never appears: a host needs to
   * know the driver is cleared, not that they once photographed a page badly.
   */
  credentials: HostVisibleCredential<MediaReference>[]
  driverProfileId: string
  /** Kinds lapsing inside the warning window. Kinds and dates, no identifiers. */
  expiring: CredentialGate["expiring"]
  /** Kinds the driver does not hold valid. Why an acceptance would be refused. */
  missing: CredentialKind[]
  satisfied: boolean
}

export interface HostCredentialView extends HostCredentialSummary {
  audience: "host"
}

export type DriverCredentialView = DriverCredentialVaultView | HostCredentialView

export interface CredentialEquipmentOption {
  kind: "trailer" | "truck"
  label: string
  profileId: string
}

export interface CredentialEquipmentSelection {
  trailerProfileId: string | null
  truckProfileId: string
}

export interface CredentialEquipmentSelectionOption extends CredentialEquipmentSelection {
  combinationId: string
  equipmentUnitNumbersUnique: boolean
  label: string
}

const credentialEquipmentSelectionSchema = z
  .object({
    trailerProfileId: z.string().uuid().nullable(),
    truckProfileId: z.string().uuid()
  })
  .strict()

// ── Local helpers ─────────────────────────────────────────────────────────────

function findDriver(state: LogLoadsDatabaseState, driverProfileId: string): DriverProfile {
  return assertFound(
    state.driverProfiles.find((candidate) => candidate.id === driverProfileId),
    `Driver profile ${driverProfileId} was not found`
  )
}

function requireActiveDriverProfile(
  state: LogLoadsDatabaseState,
  driver: DriverProfile,
  organizationId: string | null | undefined
): DriverProfile {
  const exactOrganizationId = assertFound(
    organizationId ?? undefined,
    "This driver profile is not active in an organization"
  )
  const activeDriver = activeDriverProfileForOrganization(
    state,
    driver.userId,
    exactOrganizationId
  )

  return assertFound(
    activeDriver?.id === driver.id ? activeDriver : undefined,
    "This driver profile is not active in this organization"
  )
}

function equipmentOptionsForDriver(
  state: LogLoadsDatabaseState,
  driverProfileId: string,
  organizationId?: string
): CredentialEquipmentOption[] {
  const options = new Map<string, CredentialEquipmentOption>()
  const driver = findDriver(state, driverProfileId)
  const combinations = state.equipmentCombinations.filter(
    (combination) =>
      combination.assignedDriverProfileId === driverProfileId &&
      (!driver.companyId || combination.organizationId === driver.companyId) &&
      (organizationId === undefined || combination.organizationId === organizationId) &&
      combination.status !== "inactive"
  )

  for (const combination of combinations) {
    const truck = state.truckProfiles.find(
      (candidate) => candidate.id === combination.truckProfileId && !candidate.archivedAt
    )

    if (truck) {
      options.set(`truck:${truck.id}`, {
        kind: "truck",
        label: `${combination.label} · truck ${truck.unitNumber}`,
        profileId: truck.id
      })
    }

    if (combination.trailerProfileId) {
      const trailer = state.trailerProfiles.find(
        (candidate) => candidate.id === combination.trailerProfileId
      )

      if (trailer) {
        options.set(`trailer:${trailer.id}`, {
          kind: "trailer",
          label: `${combination.label} · trailer ${trailer.unitNumber}`,
          profileId: trailer.id
        })
      }
    }
  }

  return [...options.values()].sort(
    (left, right) => left.kind.localeCompare(right.kind) || left.label.localeCompare(right.label)
  )
}

function equipmentSelectionsForDriver(
  state: LogLoadsDatabaseState,
  driverProfileId: string,
  organizationId?: string
): CredentialEquipmentSelectionOption[] {
  const driver = findDriver(state, driverProfileId)

  return state.equipmentCombinations
    .filter(
      (combination) =>
        combination.assignedDriverProfileId === driverProfileId &&
        (!driver.companyId || combination.organizationId === driver.companyId) &&
        (organizationId === undefined || combination.organizationId === organizationId) &&
        combination.status !== "inactive"
    )
    .map((combination) => {
      const trailerProfileId = combination.trailerProfileId ?? null

      return {
        combinationId: combination.id,
        equipmentUnitNumbersUnique:
          equipmentProfileUnitNumberIsUnambiguous(
            state,
            combination.organizationId,
            "truck",
            combination.truckProfileId
          ) &&
          (
            trailerProfileId === null ||
            equipmentProfileUnitNumberIsUnambiguous(
              state,
              combination.organizationId,
              "trailer",
              trailerProfileId
            )
          ),
        label: combination.label,
        trailerProfileId,
        truckProfileId: combination.truckProfileId
      }
    })
    .sort(
      (left, right) =>
        left.label.localeCompare(right.label) ||
        left.combinationId.localeCompare(right.combinationId)
    )
}

function equipmentProfileIdForCredential(
  credential: Pick<DriverCredential, "kind" | "trailerProfileId" | "truckProfileId">
): string | null {
  if (credential.kind === "truck") {
    return credential.truckProfileId ?? null
  }

  if (credential.kind === "trailer") {
    return credential.trailerProfileId ?? null
  }

  return null
}

function credentialsForSelection(
  credentials: readonly DriverCredential[],
  selection: CredentialEquipmentSelection
): DriverCredential[] {
  return credentials.filter((credential) => {
    if (credential.kind === "truck") {
      return credential.truckProfileId === selection.truckProfileId
    }

    if (credential.kind === "trailer") {
      return (
        selection.trailerProfileId !== null &&
        credential.trailerProfileId === selection.trailerProfileId
      )
    }

    return true
  })
}

/**
 * Project the credential gate for one concrete rig selection.
 *
 * The web vault receives credential rows and service-produced equipment
 * selections separately. Keeping the row-to-rig binding here prevents that
 * presentation layer from growing a second definition of which truck and
 * trailer evidence belongs to a selection.
 */
export function credentialGateForEquipmentSelection(
  credentials: readonly DriverCredential[],
  driverProfileId: string | null,
  selection: CredentialEquipmentSelection,
  at: string
): CredentialGate {
  const driverCredentials =
    driverProfileId === null
      ? []
      : credentials.filter(
          (credential) => credential.driverProfileId === driverProfileId
        )

  return credentialGateFor(credentialsForSelection(driverCredentials, selection), at)
}

function requireCredentialEquipmentSelection(
  state: LogLoadsDatabaseState,
  driver: DriverProfile,
  rawSelection: unknown
): CredentialEquipmentSelection {
  const result = credentialEquipmentSelectionSchema.safeParse(rawSelection)
  const selection = assertFound(
    result.data,
    "Choose an exact truck and trailer combination before checking credentials"
  )
  const combination = assertFound(
    state.equipmentCombinations.find(
      (candidate) =>
        candidate.assignedDriverProfileId === driver.id &&
        candidate.status !== "inactive" &&
        candidate.truckProfileId === selection.truckProfileId &&
        (candidate.trailerProfileId ?? null) === selection.trailerProfileId &&
        (!driver.companyId || candidate.organizationId === driver.companyId)
    ),
    "Choose an active equipment combination assigned to this driver before checking credentials"
  )
  const organizationId = combination.organizationId

  assertEquipmentProfileUnitNumberUnambiguous(
    state,
    organizationId,
    "truck",
    selection.truckProfileId
  )
  if (selection.trailerProfileId) {
    assertEquipmentProfileUnitNumberUnambiguous(
      state,
      organizationId,
      "trailer",
      selection.trailerProfileId
    )
  }

  return selection
}

interface ResolvedCredentialUploadTarget extends CredentialUploadTarget {
  unitNumber: string | null
}

/**
 * Resolve the one storage target that both upload signing and filing accept.
 *
 * The organization constraint is part of the equipment lookup rather than a
 * caller-supplied label on the result. That matters for independent drivers:
 * their profile has no company, so the active assigned combination is the
 * canonical source of the equipment organization.
 */
function resolveCredentialUploadTarget(
  state: LogLoadsDatabaseState,
  driver: DriverProfile,
  input: {
    equipmentProfileId: string | null
    kind: CredentialKind
    organizationId: string
  }
): ResolvedCredentialUploadTarget {
  if (input.kind !== "truck" && input.kind !== "trailer") {
    assertCondition(
      input.equipmentProfileId === null,
      "Identity and insurance records cannot be attached to equipment"
    )

    return {
      equipmentProfileId: null,
      kind: input.kind,
      organizationId: input.organizationId,
      publicIdPrefix: credentialDocumentPublicIdPrefix(driver.id, input.kind),
      unitNumber: null
    }
  }

  const equipmentProfileId = assertFound(
    input.equipmentProfileId ?? undefined,
    `Choose a ${input.kind} currently assigned to this driver before filing its photo`
  )
  const combination = state.equipmentCombinations.find(
    (candidate) =>
      candidate.assignedDriverProfileId === driver.id &&
      candidate.organizationId === input.organizationId &&
      candidate.status !== "inactive" &&
      (!driver.companyId || candidate.organizationId === driver.companyId) &&
      (input.kind === "truck"
        ? candidate.truckProfileId === equipmentProfileId
        : candidate.trailerProfileId === equipmentProfileId)
  )

  assertCondition(
    Boolean(combination),
    `Choose a ${input.kind} currently assigned to this driver before filing its photo`
  )

  const profile =
    input.kind === "truck"
      ? state.truckProfiles.find(
          (candidate) => candidate.id === equipmentProfileId && !candidate.archivedAt
        )
      : state.trailerProfiles.find((candidate) => candidate.id === equipmentProfileId)
  const selectedProfile = assertFound(
    profile,
    `Choose a ${input.kind} currently assigned to this driver before filing its photo`
  )
  const organizationId = assertFound(
    combination?.organizationId,
    "The selected equipment organization could not be established"
  )

  assertEquipmentProfileUnitNumberUnambiguous(
    state,
    organizationId,
    input.kind,
    selectedProfile.id
  )

  return {
    equipmentProfileId: selectedProfile.id,
    kind: input.kind,
    organizationId,
    publicIdPrefix: credentialDocumentPublicIdPrefix(
      driver.id,
      input.kind,
      selectedProfile.id
    ),
    unitNumber: selectedProfile.unitNumber
  }
}

function activeMembership(
  state: LogLoadsDatabaseState,
  actorUserId: string,
  organizationId: string
) {
  assertFound(
    state.profiles.find((candidate) => candidate.id === actorUserId && candidate.isActive),
    `User ${actorUserId} is not active`
  )
  assertFound(
    state.organizations.find(
      (candidate) =>
        candidate.id === organizationId &&
        organizationOperationallyAccessible(candidate)
    ),
    `Organization ${organizationId} is not active`
  )
  const memberships = state.organizationMemberships.filter(
    (candidate) =>
      candidate.organizationId === organizationId &&
      candidate.status === "active" &&
      candidate.userId === actorUserId
  )

  return assertFound(
    memberships.length === 1 ? memberships[0] : undefined,
    `User ${actorUserId} is not an active member of organization ${organizationId}`
  )
}

/**
 * Authorize and resolve the private upload namespace for one driver credential.
 *
 * Signing is intentionally self-service only. Fleet managers may file a document
 * they already control through `submitCredential`, but they cannot ask the media
 * provider for a signature into another person's private vault. The later filing
 * re-runs the same target resolver inside the state mutation.
 */
export function getCredentialUploadTarget(
  state: LogLoadsDatabaseState,
  rawInput: CredentialUploadTargetInput
): CredentialUploadTarget {
  const input = credentialUploadTargetInputSchema.parse(rawInput)
  const driver = findDriver(state, input.driverProfileId)

  assertCondition(
    driver.userId === input.actorUserId,
    "Only the driver who owns this profile may upload to its credential vault"
  )
  requireActiveDriverProfile(state, driver, input.organizationId)

  const target = resolveCredentialUploadTarget(state, driver, {
    equipmentProfileId: input.equipmentProfileId ?? null,
    kind: input.kind,
    organizationId: input.organizationId
  })

  return {
    equipmentProfileId: target.equipmentProfileId,
    kind: target.kind,
    organizationId: target.organizationId,
    publicIdPrefix: target.publicIdPrefix
  }
}

/**
 * Every record filed for one driver, newest submission first.
 *
 * Ordered by `submittedAt` and then by id, so a compare-and-swap replay and two
 * different readers see the same sequence rather than whatever order the JSONB
 * document happened to hold.
 */
function credentialsForDriver(
  state: LogLoadsDatabaseState,
  driverProfileId: string
): DriverCredential[] {
  return state.driverCredentials
    .filter((candidate) => candidate.driverProfileId === driverProfileId)
    .sort(
      (left, right) =>
        Date.parse(right.submittedAt) - Date.parse(left.submittedAt) ||
        right.id.localeCompare(left.id)
    )
}

function reviewsForCredential(
  state: LogLoadsDatabaseState,
  credentialId: string
): CredentialReview[] {
  return state.credentialReviews.filter((candidate) => candidate.credentialId === credentialId)
}

/**
 * A credential audit insert. Every submission and every decision records who did
 * it, to what, and enough to explain the outcome.
 *
 * WHAT IS DELIBERATELY ABSENT FROM THE METADATA: the media reference, the policy
 * or licence number, the extracted holder name, and the review rationale. Audit
 * events are readable by every `view_audit_log` holder in an organization, which
 * is a wider audience than the vault itself — copying a driver's identifiers into
 * a differently-permissioned collection would quietly widen who can read them.
 * The event names the credential id, and the credential is where those facts live.
 */
function insertCredentialAuditEvent(
  state: LogLoadsDatabaseState,
  input: {
    action: string
    actorUserId: string | null
    at: string
    entityId: string
    entityType: string
    metadata: Record<string, unknown>
  }
): void {
  state.auditEvents.push(
    auditEventSchema.parse({
      action: input.action,
      actorUserId: input.actorUserId,
      createdAt: input.at,
      entityId: input.entityId,
      entityType: input.entityType,
      id: createUuid(),
      metadata: input.metadata
    })
  )
}

/**
 * Whether this actor may file documents against this driver.
 *
 * TWO PATHS, and no third. The driver themselves, holding an active membership of
 * the organization they are filing under; or a member of the driver's own outfit
 * holding `manage_drivers`. The fleet path is deliberately narrow — the driver
 * must be on THAT organization's roster (`companyId`), not merely reachable
 * through a shared load — because a host who books a driver would otherwise be
 * able to write into that driver's safety record.
 *
 * The driver's own path does not require `manage_drivers`: the `driver` role does
 * not hold it, and a driver who could not file their own licence would be unable
 * to work at all.
 */
function assertMaySubmitFor(
  state: LogLoadsDatabaseState,
  driver: DriverProfile,
  input: { actorUserId: string; organizationId: string }
): void {
  const membership = activeMembership(state, input.actorUserId, input.organizationId)

  if (driver.userId === input.actorUserId) {
    requireActiveDriverProfile(state, driver, input.organizationId)
    return
  }

  assertCondition(
    organizationRoleCan(membership.role, "manage_drivers"),
    `${membership.role} cannot manage drivers, so cannot file this driver's documents`
  )
  assertCondition(
    driver.companyId === input.organizationId,
    "This driver is not on your roster, so you cannot file their documents"
  )
  requireActiveDriverProfile(state, driver, input.organizationId)
}

/**
 * Whether a host organization may read anything at all about this driver's
 * credentials.
 *
 * `view_network` is the action every member role holds, so it is how "a member,
 * any member" is expressed against the role matrix. The visibility test is an
 * ASSIGNMENT on one of this organization's own postings — the relationship the
 * founder's rule is about, since the summary travels with a load acceptance and
 * an acceptance is exactly what creates that assignment. Being able to see a
 * driver in a search result is not a reason to receive their documents.
 */
function assertHostMayRead(
  state: LogLoadsDatabaseState,
  driver: DriverProfile,
  input: { actorUserId: string; assignmentId: string; organizationId: string }
) {
  const membership = activeMembership(state, input.actorUserId, input.organizationId)

  assertCondition(
    organizationRoleCan(membership.role, "view_network"),
    `${membership.role} cannot view the network`
  )

  const assignment = state.assignments.find(
    (candidate) =>
      candidate.id === input.assignmentId && candidate.driverProfileId === driver.id
  )
  const authorizedAssignment = assertFound(
    assignment,
    "This driver is not hauling for your organization, so their credential summary is not yours to read"
  )

  assertCondition(
    HOST_CREDENTIAL_ASSIGNMENT_STATUSES.has(authorizedAssignment.status),
    "This driver is not hauling for your organization, so their credential summary is not yours to read"
  )
  const load = state.loadPostings.find(
    (candidate) => candidate.id === authorizedAssignment.loadPostingId
  )

  assertCondition(
    load?.companyId === input.organizationId,
    "This driver is not hauling for your organization, so their credential summary is not yours to read"
  )

  return authorizedAssignment
}

/**
 * Whether this decider is entitled to decide at all.
 *
 * `platform_admin` must carry explicit authority from the authenticated platform
 * boundary AND name a real, active platform administrator — the estate's existing
 * profile invariant, a `profiles` row with `role: "admin"` (see
 * apps/web/lib/session.ts). The stored role is deliberately only the second check:
 * a raw row cannot manufacture executable authority, and the authority bit cannot
 * turn a stale or non-admin profile into an administrator.
 *
 * `ai` must NOT name a user. Attributing a machine decision to a person makes the
 * audit log say somebody read a document they never saw, and it is the mirror of
 * the row contract's rule that only an AI decision carries a model.
 */
function assertDeciderMayDecide(
  state: LogLoadsDatabaseState,
  input: {
    actorUserId?: string | null
    decidedBy: "ai" | "platform_admin"
    platformAdminAuthorized?: boolean
  }
): string | null {
  if (input.decidedBy === "ai") {
    assertCondition(
      input.platformAdminAuthorized !== true,
      "An AI decision cannot carry platform administrator authority"
    )
    assertCondition(
      !input.actorUserId,
      "An AI decision is not attributable to a person; leave actorUserId unset"
    )

    return null
  }

  const actorUserId = input.actorUserId

  assertCondition(
    typeof actorUserId === "string" && actorUserId.length > 0,
    "A platform decision must name the administrator who made it"
  )
  assertCondition(
    input.platformAdminAuthorized === true,
    "A platform decision requires explicit authenticated platform administrator authorization"
  )

  const profile = assertFound(
    state.profiles.find((candidate) => candidate.id === actorUserId),
    `User ${String(actorUserId)} was not found`
  )

  assertCondition(
    profile.role === "admin" && profile.isActive,
    "Only an active LogLoads administrator may decide a credential"
  )

  return profile.id
}

// ── Submission ────────────────────────────────────────────────────────────────

/**
 * Files one document into a driver's vault. ALWAYS `pending`.
 *
 * A SUBMISSION IS NEVER SELF-APPROVING. There is no input here that can set a
 * status, and the row is parsed with `status: "pending"` written literally. The
 * only way a credential becomes `approved` is `applyCredentialReview`, which
 * refuses to approve a record with no document. Those two facts together are what
 * close the self-certification hole: a driver cannot hand themselves clearance,
 * and a reviewer cannot clear nothing.
 *
 * A RENEWAL REPLACES, IT DOES NOT REWRITE. Every outstanding record of the same
 * kind is pointed at this new row through `supersededByCredentialId` and left
 * otherwise untouched — the old row keeps saying what was approved, when, and on
 * what basis. Mutating an expired credential into a valid one is the single most
 * damaging thing that could happen to a safety record, and it is impossible here
 * because the only fields written on an existing record are that pointer and
 * `updatedAt` — never the status, the document, the dates or the decision.
 *
 * Superseding EVERY outstanding record of the kind, rather than just the newest,
 * is what restores the at-most-one-outstanding-record invariant in a store with
 * no unique index to enforce it. Being superseded does not invalidate anything:
 * `credentialIsValidAt` ignores the pointer, so an in-date certificate keeps
 * covering the driver while its replacement is under review, and renewing early is
 * never punished.
 *
 * THE DOCUMENT MUST LIVE UNDER THIS DRIVER'S OWN MEDIA NAMESPACE. Without that
 * check any caller could attach any stored asset — another driver's licence, or an
 * asset belonging to an entirely different product's media account — to a safety
 * record, and the review would then decide a document the driver never uploaded.
 */
export function submitCredential(
  state: LogLoadsDatabaseState,
  rawInput: SubmitCredentialInput,
  at = nowIso()
): SubmitCredentialResult {
  const input = submitCredentialInputSchema.parse(rawInput)
  const driver = findDriver(state, input.driverProfileId)

  assertMaySubmitFor(state, driver, input)
  const requestedEquipmentProfileId =
    input.kind === "truck"
      ? input.truckProfileId ?? null
      : input.kind === "trailer"
        ? input.trailerProfileId ?? null
        : null
  const uploadTarget = resolveCredentialUploadTarget(state, driver, {
    equipmentProfileId: requestedEquipmentProfileId,
    kind: input.kind,
    organizationId: input.organizationId
  })
  const equipmentProfileId = uploadTarget.equipmentProfileId

  assertCondition(
    !EXPIRING_CREDENTIAL_KINDS.has(input.kind) || Boolean(input.expiresOn),
    `${input.kind === "cdl" ? "CDL" : "Insurance"} documents require the expiry date printed on the document`
  )

  const expectedPrefix = `${uploadTarget.publicIdPrefix}/uploads/`

  assertCondition(
    input.documentMedia.publicId.startsWith(expectedPrefix),
    `A credential document must be stored under ${expectedPrefix}`
  )

  const credentialId = driverCredentialId(driver.id, input.kind, input.documentMedia.publicId)
  const existing = state.driverCredentials.find((candidate) => candidate.id === credentialId)

  // The retry and compare-and-swap replay path. Returned BEFORE anything is
  // superseded, so a replay cannot re-point records at a row it did not write.
  if (existing) {
    return { credential: existing, outcome: "already_submitted", superseded: [] }
  }

  const credential = driverCredentialSchema.parse({
    createdAt: at,
    documentMedia: input.documentMedia,
    driverProfileId: driver.id,
    expiresOn: input.expiresOn ?? null,
    id: credentialId,
    // Equipment identity is canonical state, never a caller assertion. The
    // reviewer receives this unit number only as a yes/no matching target and
    // never returns or stores a value read from the image.
    identifier: uploadTarget.unitNumber ?? input.identifier ?? null,
    issuedOn: input.issuedOn ?? null,
    issuer: input.issuer ?? null,
    kind: input.kind,
    requestedEvidence: [],
    reviewNotes: null,
    reviewedAt: null,
    // Written literally, not taken from the input. There is no submission that
    // arrives already decided.
    status: "pending",
    submittedAt: at,
    supersededByCredentialId: null,
    trailerProfileId: input.trailerProfileId ?? null,
    truckProfileId: input.truckProfileId ?? null,
    updatedAt: at
  })

  const outstanding = state.driverCredentials.filter(
    (candidate) =>
      candidate.driverProfileId === driver.id &&
      candidate.kind === input.kind &&
      equipmentProfileIdForCredential(candidate) === equipmentProfileId &&
      candidate.supersededByCredentialId === null
  )
  const superseded = outstanding.map((candidate) =>
    // Re-parsed through the row contract, so a pointer written here has to satisfy
    // the storage invariants (a record cannot supersede itself) at write time
    // rather than only on the next read.
    driverCredentialSchema.parse({
      ...candidate,
      supersededByCredentialId: credential.id,
      // `updatedAt` moves because this row changed; `reviewedAt` does not, because
      // no new decision was taken on it. A renewal arriving is not a re-review.
      updatedAt: at
    })
  )
  const replacements = new Map(superseded.map((row) => [row.id, row]))

  state.driverCredentials = [
    ...state.driverCredentials.map((candidate) => replacements.get(candidate.id) ?? candidate),
    credential
  ]

  insertCredentialAuditEvent(state, {
    action: "driver_credential_submitted",
    actorUserId: input.actorUserId,
    at,
    entityId: credential.id,
    entityType: "driver_credential",
    metadata: {
      driverProfileId: driver.id,
      equipmentProfileId,
      kind: credential.kind,
      // Whether the driver stated an expiry, never the identifiers on the page.
      statesExpiry: credential.expiresOn !== null,
      supersededCredentialIds: superseded.map((row) => row.id),
      // Attribution matters here: a document filed by a dispatcher on a driver's
      // behalf is a different event from one the driver filed themselves.
      submittedByDriver: driver.userId === input.actorUserId
    }
  })

  return { credential, outcome: "submitted", superseded }
}

// ── Review ────────────────────────────────────────────────────────────────────

/**
 * Records one decision on one credential and moves the credential to it.
 *
 * THE DECISION IS BINDING. The founder made review AI-first and made the machine's
 * answer binding, so `denied` and `more_info_required` block a driver exactly as
 * hard as `pending` does — there is no advisory decision here and no threshold
 * that turns a low confidence into a soft pass. `confidence` is recorded and
 * never consulted.
 *
 * APPROVING A CREDENTIAL WITH NO STORED DOCUMENT IS REFUSED. This is the
 * self-certification hole and it is closed in the service, loudly, rather than in
 * a screen: a screen can be bypassed by the next caller. It throws rather than
 * returning a refusal a caller might log and move past, because approving nothing
 * is a bug in the reviewer and not a state a driver can reach.
 *
 * APPROVING AN ALREADY-LAPSED DOCUMENT IS REFUSED for the same reason it matters
 * that only one module decides validity: the gate would block the driver anyway,
 * so an approval here would tell them they are cleared while every acceptance
 * refuses them. A document that has already expired is `denied` or
 * `more_info_required`, naming the date.
 *
 * A REVIEW DOES NOT REWRITE WHAT THE DRIVER STATED. `issuedOn` and `expiresOn`
 * stay exactly as submitted, and what the reviewer read off the page is kept
 * separately in `extracted`, as printed. If the document disagrees with the
 * driver's dates, the honest outcome is a refusal naming the mismatch — silently
 * substituting the platform's reading would make LogLoads the author of a date
 * nobody agreed to, and the driver would later be refused over it.
 *
 * APPEND-ONLY. An existing review row is never edited. A different decision is a
 * new row on the same trail, which is what keeps "why was I refused in March"
 * answerable in June.
 */
export function applyCredentialReview(
  state: LogLoadsDatabaseState,
  rawInput: ApplyCredentialReviewInput,
  at = nowIso()
): ApplyCredentialReviewResult {
  const input = applyCredentialReviewInputSchema.parse(rawInput)
  const actorUserId = assertDeciderMayDecide(state, input)
  const credential = assertFound(
    state.driverCredentials.find((candidate) => candidate.id === input.credentialId),
    `Driver credential ${input.credentialId} was not found`
  )

  // Matched on the natural key — this decider, this decision, this credential —
  // and not only on the derived id. A retry that arrives after the first decision
  // committed computes a higher attempt and therefore a different id, so the id
  // alone would let it write a second row claiming the same decision twice.
  const alreadyRecorded = reviewsForCredential(state, credential.id).find(
    (candidate) => candidate.decidedBy === input.decidedBy && candidate.decision === input.decision
  )

  if (alreadyRecorded) {
    return { credential, outcome: "already_reviewed", review: alreadyRecorded }
  }

  if (input.decision === "approved") {
    assertCondition(
      Boolean(credential.documentMedia),
      "A credential with no stored document cannot be approved — there is nothing to have checked"
    )
    assertCondition(
      input.requestedEvidence.length === 0,
      "An approval leaves nothing outstanding; refuse or ask for more, not both"
    )
    assertCondition(
      credential.expiresOn === null || Date.parse(credential.expiresOn) > Date.parse(at),
      `This document lapsed on ${String(credential.expiresOn)} and cannot be approved; ask for the current one`
    )
  }

  if (input.decision === "more_info_required") {
    assertCondition(
      input.requestedEvidence.length > 0,
      "Say what more the driver must supply; 'we need more' with no list is a dead end"
    )
  }

  const attempt = reviewsForCredential(state, credential.id).length + 1
  const review = credentialReviewSchema.parse({
    confidence: input.confidence ?? null,
    createdAt: at,
    credentialId: credential.id,
    decidedAt: at,
    decidedBy: input.decidedBy,
    decision: input.decision,
    driverProfileId: credential.driverProfileId,
    extracted: input.extracted ?? {},
    findings: input.findings,
    id: credentialReviewId(credential.id, attempt),
    model: input.model ?? null,
    rationale: input.rationale,
    requestedEvidence: input.requestedEvidence,
    // Equal to createdAt by contract: the row schema refuses a review whose
    // updatedAt has moved, which is how append-only is enforced at the storage
    // boundary rather than by everyone remembering not to edit one.
    updatedAt: at
  })

  const decided = driverCredentialSchema.parse({
    ...credential,
    requestedEvidence: input.requestedEvidence,
    reviewNotes: input.rationale,
    reviewedAt: at,
    status: input.decision,
    updatedAt: at
  })

  state.credentialReviews.push(review)
  state.driverCredentials = state.driverCredentials.map((candidate) =>
    candidate.id === credential.id ? decided : candidate
  )

  insertCredentialAuditEvent(state, {
    action: "driver_credential_reviewed",
    actorUserId,
    at,
    entityId: review.id,
    entityType: "credential_review",
    metadata: {
      attempt,
      confidence: review.confidence,
      credentialId: credential.id,
      decidedBy: review.decidedBy,
      decision: review.decision,
      driverProfileId: credential.driverProfileId,
      // Machine reason codes only. The rationale and the extracted fields stay on
      // the review row, which is read by the driver and the platform rather than
      // by every audit-log reader in an organization.
      findings: review.findings,
      kind: credential.kind,
      model: review.model,
      previousStatus: credential.status
    }
  })

  return { credential: decided, outcome: "reviewed", review }
}

// ── The gate ──────────────────────────────────────────────────────────────────

/**
 * May this driver accept work? The one answer, and the only one an acceptance
 * guard should ask.
 *
 * EXPIRY IS EVALUATED AT READ TIME. There is no scheduler in this product and
 * nothing sweeps the vault, so a credential must stop counting the instant it
 * lapses without anybody having written a row to say so. `credentialGateFor`
 * compares against the `at` the caller passes, which means an expired document
 * blocks on the very next request.
 *
 * Delegated to `credentialGateFor` rather than reimplemented: a second opinion
 * about what "currently valid" means is a second safety rule, and the two would
 * disagree the first time one was edited. This function's whole job is to find
 * the driver's rows and hand them over.
 *
 * A missing driver THROWS rather than returning `satisfied: false`. Returning a
 * refusal would be safe but would let an acceptance path quietly carry a broken
 * driver reference forever.
 */
export function driverCredentialGate(
  state: LogLoadsDatabaseState,
  driverProfileId: string,
  at: string | undefined,
  equipment: CredentialEquipmentSelection
): CredentialGate {
  const driver = findDriver(state, driverProfileId)
  const selection = requireCredentialEquipmentSelection(state, driver, equipment)
  const credentials = credentialsForSelection(credentialsForDriver(state, driver.id), selection)

  return credentialGateFor(credentials, at ?? nowIso())
}

// ── What the host receives ────────────────────────────────────────────────────

/**
 * The summary that travels with a load acceptance. STATUS, EXPIRY, AND THE TRUCK
 * AND TRAILER PHOTOS. Nothing else, by construction.
 *
 * Only the records CURRENTLY CLEARING the driver appear — for each mandatory kind,
 * the valid credential with the furthest expiry, which is the same record
 * `credentialGateFor` counted. A host learns that the driver is cleared and until
 * when; they do not learn that a page was photographed badly in March, that a
 * submission was denied, or that a renewal is under review. Routing a driver's
 * refusals to every booking host would be exposure with nothing behind it.
 *
 * Every entry goes through `hostVisibleCredential`, which builds a fixed
 * four-field result field by field. There is no expression in that shape for the
 * CDL image, the insurance certificate image, the policy or licence number, the
 * review notes or the driver's user id — so a field added to the stored row later
 * cannot reach a host through this function.
 *
 * `missing` and `expiring` are kinds and dates. A host booking a three-day haul is
 * entitled to know the driver's insurance lapses on day two; that is not a
 * personal identifier.
 *
 * NOT AUTHORIZATION. This is the projection. `listDriverCredentials` is where a
 * host's right to read it is asserted; this is exported separately so the
 * acceptance path can build the summary inside the same mutation that writes the
 * acceptance, where it holds a draft state rather than a viewer.
 */
export function hostCredentialSummary(
  state: LogLoadsDatabaseState,
  driverProfileId: string,
  at: string | undefined,
  equipment: CredentialEquipmentSelection
): HostCredentialSummary {
  const driver = findDriver(state, driverProfileId)
  const selection = requireCredentialEquipmentSelection(state, driver, equipment)
  const credentials = credentialsForSelection(credentialsForDriver(state, driver.id), selection)
  const evaluatedAt = at ?? nowIso()
  const gate = credentialGateFor(credentials, evaluatedAt)
  const clearing: HostVisibleCredential<MediaReference>[] = []

  for (const kind of credentialKindSchema.options) {
    if (gate.missing.includes(kind)) {
      continue
    }

    // The furthest-expiring valid record of the kind — the one that decides how
    // long this driver stays cleared, and therefore the one a host needs. A record
    // with no expiry wins outright: it cannot lapse at all.
    let best: DriverCredential | undefined
    let bestExpiresAt = Number.NEGATIVE_INFINITY

    for (const candidate of credentials) {
      if (candidate.kind !== kind || !credentialIsValidAt(candidate, evaluatedAt)) {
        continue
      }

      const expiresAt =
        candidate.expiresOn === null ? Number.POSITIVE_INFINITY : Date.parse(candidate.expiresOn)

      if (expiresAt > bestExpiresAt) {
        bestExpiresAt = expiresAt
        best = candidate
      }
    }

    if (best) {
      clearing.push(hostVisibleCredential(best))
    }
  }

  return {
    assurance: CREDENTIAL_ASSURANCE_STATEMENT,
    credentials: clearing,
    driverProfileId: driver.id,
    expiring: gate.expiring,
    missing: gate.missing,
    satisfied: gate.satisfied
  }
}

/**
 * A driver's credentials, shaped by who is asking.
 *
 * The host branch cannot return an image of a licence or a certificate: it returns
 * `hostCredentialSummary`, whose entries are `HostVisibleCredential` and have no
 * field for one. The vault branch is never reachable for a host audience, because
 * the audience is a discriminated tag and the two branches are separate returns —
 * there is no shared object that a host response is filtered out of, which is the
 * arrangement that leaks the first time somebody adds a field.
 *
 * The DRIVER's own read requires ownership plus the exact active organization
 * profile. A suspended or removed membership revokes the private vault immediately;
 * historical rows remain intact for audit and a future authorized reactivation.
 */
export function listDriverCredentials(
  state: LogLoadsDatabaseState,
  driverProfileId: string,
  viewer: CredentialViewer,
  at = nowIso()
): DriverCredentialView {
  const driver = findDriver(state, driverProfileId)

  if (viewer.audience === "host") {
    requireActiveDriverProfile(state, driver, driver.companyId)
    const assignment = assertHostMayRead(state, driver, viewer)

    return {
      audience: "host",
      ...hostCredentialSummary(state, driver.id, at, {
        trailerProfileId: assignment.trailerProfileId ?? null,
        truckProfileId: assignment.truckProfileId
      })
    }
  }

  if (viewer.audience === "driver") {
    assertCondition(
      driver.userId === viewer.actorUserId,
      "You can only read your own credential vault"
    )
    requireActiveDriverProfile(
      state,
      driver,
      viewer.organizationId ?? driver.companyId
    )
  } else {
    const membership = activeMembership(state, viewer.actorUserId, viewer.organizationId)

    assertCondition(
      organizationRoleCan(membership.role, "manage_drivers"),
      `${membership.role} cannot manage drivers, so cannot read this driver's documents`
    )
    assertCondition(
      driver.companyId === viewer.organizationId,
      "This driver is not on your roster, so their documents are not yours to read"
    )
    requireActiveDriverProfile(state, driver, viewer.organizationId)
  }

  const credentials = credentialsForDriver(state, driver.id)
  const credentialIds = new Set(credentials.map((candidate) => candidate.id))

  return {
    audience: viewer.audience,
    credentials,
    driverProfileId: driver.id,
    equipmentOptions: equipmentOptionsForDriver(
      state,
      driver.id,
      viewer.organizationId
    ),
    equipmentSelections: equipmentSelectionsForDriver(
      state,
      driver.id,
      viewer.organizationId
    ),
    reviews: state.credentialReviews
      .filter((review) => credentialIds.has(review.credentialId))
      .sort(
        (left, right) =>
          Date.parse(right.decidedAt) - Date.parse(left.decidedAt) ||
          right.id.localeCompare(left.id)
      )
  }
}
