import { randomUUID } from "node:crypto"

import {
  CREDENTIAL_ASSURANCE_STATEMENT,
  CREDENTIAL_EXPIRY_WARNING_DAYS,
  HOST_VISIBLE_CREDENTIAL_PHOTO_KINDS,
  MANDATORY_CREDENTIAL_KINDS,
  credentialKindSchema,
  driverCredentialSchema,
  organizationMembershipSchema,
  organizationRoleCan,
  ORGANIZATION_ROLES,
  type CredentialKind,
  type MediaReference,
  type OrganizationRole
} from "@logloads/contracts"
import { seedDatabaseState } from "@logloads/db"
import { describe, expect, it } from "vitest"

import {
  applyCredentialReview,
  credentialDocumentPublicIdPrefix,
  credentialReviewId,
  driverCredentialGate,
  driverCredentialId,
  hostCredentialSummary,
  listDriverCredentials,
  submitCredential,
  type CredentialViewer,
  type DriverCredentialVaultView,
  type HostCredentialView
} from "./driver-credentials"

/**
 * The seeded cast this file works with. Every fact asserted about them is checked
 * against the seed by `expect` before it is relied on, so a seed change fails a
 * guard rather than silently turning a real test into a vacuous one.
 *
 * MAYA is the driver most of the host-boundary work runs through: her vault
 * already holds an approved CDL and a refused insurance certificate, and she has
 * completed hauls for organization 332 — an outfit that is NOT her own. That is the
 * only seeded pairing where a genuinely external host can read a driver whose
 * documents include something the host must never receive.
 */
const MAYA_DRIVER = "44444444-4444-4444-8444-444444444442"
const MAYA_USER = "22222222-2222-4222-8222-222222222222"
/** Maya's own outfit. Holds her roster row. */
const MAYA_ORG = "33333333-3333-4333-8333-333333333331"
/** A host Maya has hauled for, and not her own outfit. */
const EXTERNAL_HOST_ORG = "33333333-3333-4333-8333-333333333332"
/** An outfit with no work of Maya's at all. */
const UNRELATED_ORG = "33333333-3333-4333-8333-333333333334"

/** Empty vault, no assignments anywhere. The clean slate and the read negative. */
const RILEY_DRIVER = "44444444-4444-4444-8444-444444444444"
const RILEY_USER = "22222222-2222-4222-8222-222222222226"

/** Fully cleared by the seed. */
const HANK_DRIVER = "44444444-4444-4444-8444-444444444441"
const HANK_USER = "22222222-2222-4222-8222-222222222221"

/** Approved insurance that lapsed in January, with the renewal still pending. */
const TAYLOR_DRIVER = "44444444-4444-4444-8444-444444444445"
const TAYLOR_ORG = "33333333-3333-4333-8333-333333333332"
/** The identifier printed on Taylor's lapsed certificate. Must never reach a host. */
const TAYLOR_INSURANCE_IDENTIFIER = "CM-9920-117"

/** Maya's seeded CDL: the document and the licence number a host must never see. */
const MAYA_CDL_CREDENTIAL = "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c105"
const MAYA_CDL_DOCUMENT_PUBLIC_ID = "logloads/driver-credentials/maya-licence"
const MAYA_CDL_IDENTIFIER = "CDL-A-9002"
/** Maya's refused insurance. Its request for more evidence is not host business. */
const MAYA_REFUSED_INSURANCE = "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c106"
const MAYA_TRUCK_A = "77777777-7777-4777-8777-777777777772"
const MAYA_TRUCK_B = "77777777-7777-4777-8777-777777777775"
const HANK_TRUCK = "77777777-7777-4777-8777-777777777771"
const HANK_TRAILER = "88888888-8888-4888-8888-888888888881"

const PLATFORM_ADMIN_USER = "11111111-1111-4111-8111-111111111111"
/** An active member of Maya's outfit who holds manage_drivers. */
const DISPATCHER_USER = "22222222-2222-4222-8222-222222222224"
const MAYA_EXTERNAL_HOST_ASSIGNMENT = "ffffffff-ffff-4fff-8fff-ffffffffaaa1"
const TAYLOR_HOST_ASSIGNMENT = "ffffffff-ffff-4fff-8fff-fffffffffff5"

const SUBMITTED = "2026-07-01T09:00:00.000Z"
const REVIEWED = "2026-07-01T09:05:00.000Z"
const AT = "2026-07-01T12:00:00.000Z"
const MILLISECONDS_PER_DAY = 86_400_000

/**
 * The roles that do and do not hold the right to file another person's safety
 * documents, DERIVED from the role matrix. Naming "dispatcher" and
 * "landing_manager" here would leave these tests passing against a matrix that no
 * longer grants what they assume.
 */
const ROLE_WITH_MANAGE_DRIVERS: OrganizationRole | undefined = ORGANIZATION_ROLES.find((role) =>
  organizationRoleCan(role, "manage_drivers")
)
const ROLE_WITHOUT_MANAGE_DRIVERS: OrganizationRole | undefined = ORGANIZATION_ROLES.find(
  (role) => !organizationRoleCan(role, "manage_drivers") && organizationRoleCan(role, "view_network")
)

if (!ROLE_WITH_MANAGE_DRIVERS || !ROLE_WITHOUT_MANAGE_DRIVERS) {
  throw new Error("The role matrix no longer distinguishes who may file a driver's documents")
}

function freshState() {
  return structuredClone(seedDatabaseState)
}

type State = ReturnType<typeof freshState>

function instantAfter(days: number, from = AT): string {
  return new Date(Date.parse(from) + days * MILLISECONDS_PER_DAY).toISOString()
}

function addMember(state: State, organizationId: string, role: OrganizationRole): string {
  const userId = randomUUID()

  state.organizationMemberships.push(
    organizationMembershipSchema.parse({
      createdAt: SUBMITTED,
      id: randomUUID(),
      organizationId,
      role,
      status: "active",
      updatedAt: SUBMITTED,
      userId
    })
  )

  return userId
}

/**
 * A stored document as the server would have read it back after an upload into
 * this driver's own credential namespace. Built from
 * `credentialDocumentPublicIdPrefix` rather than a literal, so a change to the
 * namespace rule breaks these fixtures instead of leaving them testing a path
 * production no longer accepts.
 */
function credentialDocument(
  driverProfileId: string,
  kind: CredentialKind,
  equipmentProfileId?: string | null,
  overrides: Partial<MediaReference> = {}
): MediaReference {
  return {
    bytes: 412_000,
    format: "jpg",
    height: 1_754,
    provider: "cloudinary",
    publicId:
      `${credentialDocumentPublicIdPrefix(driverProfileId, kind, equipmentProfileId)}` +
      `/uploads/${randomUUID()}`,
    uploadedAt: SUBMITTED,
    version: 1_700_000_000,
    width: 1_240,
    ...overrides
  }
}

function file(
  state: State,
  input: {
    actorUserId: string
    documentMedia?: MediaReference
    driverProfileId: string
    expiresOn?: string | null
    identifier?: string | null
    kind: CredentialKind
    organizationId: string
    trailerProfileId?: string | null
    truckProfileId?: string | null
  },
  at = SUBMITTED
) {
  const expiresOn = input.expiresOn === undefined && ["insurance", "cdl"].includes(input.kind)
    ? instantAfter(365)
    : input.expiresOn ?? null
  let combination = state.equipmentCombinations.find(
    (candidate) =>
      candidate.assignedDriverProfileId === input.driverProfileId &&
      candidate.organizationId === input.organizationId
  )

  if ((input.kind === "truck" || input.kind === "trailer") && !combination) {
    const source = state.equipmentCombinations.find(
      (candidate) => candidate.organizationId === input.organizationId
    )

    if (!source) {
      throw new Error(`No equipment fixture exists for organization ${input.organizationId}`)
    }

    combination = {
      ...structuredClone(source),
      assignedDriverProfileId: input.driverProfileId,
      id: randomUUID(),
      label: `${source.label} test assignment`
    }
    state.equipmentCombinations.push(combination)
  }

  const truckProfileId =
    input.kind === "truck" ? input.truckProfileId ?? combination?.truckProfileId ?? null : null
  const trailerProfileId =
    input.kind === "trailer"
      ? input.trailerProfileId ?? combination?.trailerProfileId ?? null
      : null
  const equipmentProfileId =
    input.kind === "truck" ? truckProfileId : input.kind === "trailer" ? trailerProfileId : null

  return submitCredential(
    state,
    {
      actorUserId: input.actorUserId,
      documentMedia:
        input.documentMedia ??
        credentialDocument(input.driverProfileId, input.kind, equipmentProfileId),
      driverProfileId: input.driverProfileId,
      expiresOn,
      identifier: input.identifier ?? null,
      kind: input.kind,
      organizationId: input.organizationId,
      trailerProfileId,
      truckProfileId
    },
    at
  )
}

/** One credential, filed and then approved by the machine reviewer. */
function fileAndApprove(
  state: State,
  input: {
    actorUserId: string
    driverProfileId: string
    expiresOn?: string | null
    kind: CredentialKind
    organizationId: string
  }
) {
  const submission = file(state, input)

  return applyCredentialReview(
    state,
    {
      credentialId: submission.credential.id,
      decidedBy: "ai",
      decision: "approved",
      findings: ["kind_matches_document"],
      model: "test-reviewer",
      rationale: "The document matches the kind and reads clearly."
    },
    REVIEWED
  )
}

/** Every mandatory kind, filed and approved. Derived from the schema's kinds. */
function clearDriver(
  state: State,
  input: {
    actorUserId: string
    driverProfileId: string
    insuranceExpiresOn?: string | null
    organizationId: string
  }
) {
  for (const kind of MANDATORY_CREDENTIAL_KINDS) {
    fileAndApprove(state, {
      actorUserId: input.actorUserId,
      driverProfileId: input.driverProfileId,
      expiresOn:
        kind === "insurance"
          ? input.insuranceExpiresOn ?? instantAfter(365)
          : kind === "cdl"
            ? instantAfter(365)
            : null,
      kind,
      organizationId: input.organizationId
    })
  }
}

function selectionForDriver(state: State, driverProfileId: string) {
  const combination = state.equipmentCombinations.find(
    (candidate) =>
      candidate.assignedDriverProfileId === driverProfileId &&
      candidate.status !== "inactive"
  )

  if (!combination) {
    throw new Error(`No active equipment selection exists for driver ${driverProfileId}`)
  }

  return {
    trailerProfileId: combination.trailerProfileId ?? null,
    truckProfileId: combination.truckProfileId
  }
}

function gateForDriver(state: State, driverProfileId: string, at = AT) {
  return driverCredentialGate(
    state,
    driverProfileId,
    at,
    selectionForDriver(state, driverProfileId)
  )
}

function vaultView(
  state: State,
  driverProfileId: string,
  viewer: CredentialViewer,
  at = AT
): DriverCredentialVaultView {
  const view = listDriverCredentials(state, driverProfileId, viewer, at)

  if (view.audience === "host") {
    throw new Error("Expected a vault view, received a host view")
  }

  return view
}

function hostView(
  state: State,
  driverProfileId: string,
  viewer: CredentialViewer,
  at = AT
): HostCredentialView {
  const view = listDriverCredentials(state, driverProfileId, viewer, at)

  if (view.audience !== "host") {
    throw new Error("Expected a host view")
  }

  return view
}

function auditActions(state: State, action: string) {
  return state.auditEvents.filter((event) => event.action === action)
}

// ── The seed this file leans on ───────────────────────────────────────────────

describe("the seeded facts these tests rely on", () => {
  it("gives Maya a host that is not her own outfit", () => {
    const state = freshState()
    const hostOrgs = new Set(
      state.assignments
        .filter((assignment) => assignment.driverProfileId === MAYA_DRIVER)
        .map(
          (assignment) =>
            state.loadPostings.find((load) => load.id === assignment.loadPostingId)?.companyId
        )
    )

    expect(hostOrgs.has(EXTERNAL_HOST_ORG)).toBe(true)
    expect(EXTERNAL_HOST_ORG).not.toBe(MAYA_ORG)
    expect(state.driverProfiles.find((driver) => driver.id === MAYA_DRIVER)?.companyId).toBe(MAYA_ORG)
  })

  it("leaves Riley with no work anywhere, which is what makes the read negatives real", () => {
    const state = freshState()

    expect(
      state.assignments.filter((assignment) => assignment.driverProfileId === RILEY_DRIVER)
    ).toHaveLength(0)
    expect(
      state.driverCredentials.filter((row) => row.driverProfileId === RILEY_DRIVER)
    ).toHaveLength(0)
  })

  it("gives Maya an approved CDL carrying a licence number and a stored image", () => {
    const state = freshState()
    const cdl = state.driverCredentials.find((row) => row.id === MAYA_CDL_CREDENTIAL)

    expect(cdl?.status).toBe("approved")
    expect(cdl?.identifier).toBe(MAYA_CDL_IDENTIFIER)
    expect(cdl?.documentMedia?.publicId).toBe(MAYA_CDL_DOCUMENT_PUBLIC_ID)
  })
})

// ── Submission ────────────────────────────────────────────────────────────────

describe("submitCredential", () => {
  it("files every submission as pending, never as approved", () => {
    const state = freshState()
    const result = file(state, {
      actorUserId: RILEY_USER,
      driverProfileId: RILEY_DRIVER,
      kind: "cdl",
      organizationId: MAYA_ORG
    })

    expect(result.outcome).toBe("submitted")
    expect(result.credential.status).toBe("pending")
    expect(result.credential.reviewedAt).toBeNull()
    expect(state.credentialReviews.filter((row) => row.credentialId === result.credential.id)).toHaveLength(0)
  })

  it("ignores a status a caller tries to smuggle in with the submission", () => {
    // The self-certification hole from the writing side. There is no input that
    // sets a status, so a caller who sends one gets a pending record anyway.
    const state = freshState()
    const result = submitCredential(
      state,
      {
        actorUserId: RILEY_USER,
        documentMedia: credentialDocument(RILEY_DRIVER, "cdl"),
        driverProfileId: RILEY_DRIVER,
        expiresOn: instantAfter(365),
        kind: "cdl",
        organizationId: MAYA_ORG,
        reviewedAt: REVIEWED,
        reviewNotes: "Looks fine to me",
        status: "approved"
      } as unknown as Parameters<typeof submitCredential>[1],
      SUBMITTED
    )

    expect(result.credential.status).toBe("pending")
    expect(result.credential.reviewNotes).toBeNull()
    expect(result.credential.reviewedAt).toBeNull()
  })

  it("leaves a driver blocked when all four kinds are on file but nobody has decided them", () => {
    // A pending credential counts for nothing. Without this the vault would be a
    // paperwork exercise a driver clears by uploading four photographs.
    const state = freshState()

    for (const kind of MANDATORY_CREDENTIAL_KINDS) {
      file(state, {
        actorUserId: RILEY_USER,
        driverProfileId: RILEY_DRIVER,
        kind,
        organizationId: MAYA_ORG
      })
    }

    const gate = gateForDriver(state, RILEY_DRIVER)

    expect(gate.satisfied).toBe(false)
    expect(gate.missing).toEqual([...MANDATORY_CREDENTIAL_KINDS])
  })

  it("refuses a document stored under another driver's namespace", () => {
    const state = freshState()
    const before = state.driverCredentials.length

    expect(() =>
      file(state, {
        actorUserId: RILEY_USER,
        documentMedia: credentialDocument(HANK_DRIVER, "cdl"),
        driverProfileId: RILEY_DRIVER,
        kind: "cdl",
        organizationId: MAYA_ORG
      })
    ).toThrow(/must be stored under/)
    expect(state.driverCredentials).toHaveLength(before)
  })

  it("refuses a document filed under the wrong kind's folder", () => {
    const state = freshState()

    expect(() =>
      file(state, {
        actorUserId: RILEY_USER,
        documentMedia: credentialDocument(RILEY_DRIVER, "truck"),
        driverProfileId: RILEY_DRIVER,
        kind: "trailer",
        organizationId: MAYA_ORG
      })
    ).toThrow(/must be stored under/)
  })

  it("refuses a public id that only looks like it is under the uploads path", () => {
    // Prefix matching without the trailing segment would accept
    // ".../cdl-something-else", which is a different folder.
    const state = freshState()

    expect(() =>
      file(state, {
        actorUserId: RILEY_USER,
        documentMedia: credentialDocument(RILEY_DRIVER, "cdl", null, {
          publicId: `${credentialDocumentPublicIdPrefix(RILEY_DRIVER, "cdl")}-elsewhere/uploads/x`
        }),
        driverProfileId: RILEY_DRIVER,
        kind: "cdl",
        organizationId: MAYA_ORG
      })
    ).toThrow(/must be stored under/)
  })

  it("requires equipment evidence to name its exact assigned profile", () => {
    const state = freshState()

    expect(() =>
      submitCredential(
        state,
        {
          actorUserId: MAYA_USER,
          documentMedia: credentialDocument(MAYA_DRIVER, "truck"),
          driverProfileId: MAYA_DRIVER,
          kind: "truck",
          organizationId: MAYA_ORG
        },
        SUBMITTED
      )
    ).toThrow(/must name exactly one truck profile/)
  })

  it("refuses an equipment profile that is not assigned to this driver", () => {
    const state = freshState()
    const unassignedTruck = randomUUID()

    expect(() =>
      file(state, {
        actorUserId: MAYA_USER,
        documentMedia: credentialDocument(MAYA_DRIVER, "truck", unassignedTruck),
        driverProfileId: MAYA_DRIVER,
        kind: "truck",
        organizationId: MAYA_ORG,
        truckProfileId: unassignedTruck
      })
    ).toThrow(/currently assigned/)
  })

  it("refuses equipment bytes signed for a different assigned unit", () => {
    const state = freshState()

    expect(() =>
      file(state, {
        actorUserId: MAYA_USER,
        documentMedia: credentialDocument(MAYA_DRIVER, "truck", MAYA_TRUCK_A),
        driverProfileId: MAYA_DRIVER,
        kind: "truck",
        organizationId: MAYA_ORG,
        truckProfileId: MAYA_TRUCK_B
      })
    ).toThrow(/must be stored under/)
  })

  it("binds review to the canonical selected unit number, never a caller assertion", () => {
    const state = freshState()
    const selectedTruck = state.truckProfiles.find(
      (candidate) => candidate.id === MAYA_TRUCK_A
    )

    expect(selectedTruck).toBeDefined()

    const result = file(state, {
      actorUserId: MAYA_USER,
      driverProfileId: MAYA_DRIVER,
      identifier: "CALLER-SPOOFED-UNIT",
      kind: "truck",
      organizationId: MAYA_ORG,
      truckProfileId: MAYA_TRUCK_A
    })

    expect(result.credential.identifier).toBe(selectedTruck?.unitNumber)
    expect(result.credential.identifier).not.toBe("CALLER-SPOOFED-UNIT")
  })

  it("refuses equipment evidence when two assigned trucks share a normalized unit number", () => {
    const state = freshState()
    const truckA = state.truckProfiles.find((candidate) => candidate.id === MAYA_TRUCK_A)
    const truckB = state.truckProfiles.find((candidate) => candidate.id === MAYA_TRUCK_B)

    if (!truckA || !truckB) {
      throw new Error("Maya two-rig fixture missing")
    }
    truckB.unitNumber = ` ${truckA.unitNumber.toLowerCase().replace("-", " ")} `
    const before = structuredClone(state.driverCredentials)

    expect(() =>
      file(state, {
        actorUserId: MAYA_USER,
        driverProfileId: MAYA_DRIVER,
        kind: "truck",
        organizationId: MAYA_ORG,
        truckProfileId: MAYA_TRUCK_B
      })
    ).toThrow(/truck unit number is not unique/)
    expect(state.driverCredentials).toEqual(before)
  })

  it("lets a driver file their own licence even though the driver role cannot manage drivers", () => {
    // A negative control on the authorization rule itself: gating submission on
    // manage_drivers would leave every driver unable to work.
    expect(organizationRoleCan("driver", "manage_drivers")).toBe(false)

    const state = freshState()
    const result = file(state, {
      actorUserId: RILEY_USER,
      driverProfileId: RILEY_DRIVER,
      kind: "cdl",
      organizationId: MAYA_ORG
    })

    expect(result.outcome).toBe("submitted")
  })

  it("refuses a driver filing documents against another driver", () => {
    const state = freshState()

    expect(() =>
      file(state, {
        actorUserId: MAYA_USER,
        driverProfileId: RILEY_DRIVER,
        kind: "cdl",
        organizationId: MAYA_ORG
      })
    ).toThrow(/cannot manage drivers/)
  })

  it("refuses a member who can view the network but cannot manage drivers", () => {
    const state = freshState()
    const actorUserId = addMember(state, MAYA_ORG, ROLE_WITHOUT_MANAGE_DRIVERS as OrganizationRole)

    expect(() =>
      file(state, {
        actorUserId,
        driverProfileId: RILEY_DRIVER,
        kind: "cdl",
        organizationId: MAYA_ORG
      })
    ).toThrow(/cannot manage drivers/)
  })

  it("refuses a manage_drivers member filing against a driver on another roster", () => {
    // The dispatcher genuinely holds manage_drivers in this organization. The
    // refusal is about the ROSTER: a host who books a driver must not be able to
    // write into that driver's safety record.
    const state = freshState()

    expect(
      state.organizationMemberships.some(
        (membership) =>
          membership.userId === DISPATCHER_USER &&
          membership.organizationId === MAYA_ORG &&
          membership.status === "active" &&
          organizationRoleCan(membership.role, "manage_drivers")
      )
    ).toBe(true)
    expect(state.driverProfiles.find((driver) => driver.id === TAYLOR_DRIVER)?.companyId).not.toBe(
      MAYA_ORG
    )

    expect(() =>
      file(state, {
        actorUserId: DISPATCHER_USER,
        driverProfileId: TAYLOR_DRIVER,
        kind: "cdl",
        organizationId: MAYA_ORG
      })
    ).toThrow(/not on your roster/)
  })

  it("refuses anyone who is not an active member of the organization they file under", () => {
    const state = freshState()

    expect(() =>
      file(state, {
        actorUserId: randomUUID(),
        driverProfileId: RILEY_DRIVER,
        kind: "cdl",
        organizationId: MAYA_ORG
      })
    ).toThrow(/not an active member/)
  })

  it("refuses a submission against a driver profile that does not exist", () => {
    const state = freshState()

    expect(() =>
      file(state, {
        actorUserId: RILEY_USER,
        driverProfileId: randomUUID(),
        kind: "cdl",
        organizationId: MAYA_ORG
      })
    ).toThrow(/was not found/)
  })
})

describe("renewal", () => {
  it("replaces the old record instead of rewriting it", () => {
    // The single most damaging thing that could happen to a safety record is an
    // expired document being edited into a valid one. Every field of the old row
    // except the pointer is asserted unchanged.
    const state = freshState()
    const before = structuredClone(
      state.driverCredentials.find((row) => row.id === MAYA_CDL_CREDENTIAL)
    )

    const result = file(
      state,
      {
        actorUserId: MAYA_USER,
        driverProfileId: MAYA_DRIVER,
        kind: "cdl",
        organizationId: MAYA_ORG
      },
      SUBMITTED
    )
    const after = state.driverCredentials.find((row) => row.id === MAYA_CDL_CREDENTIAL)

    expect(after).toEqual({
      ...before,
      supersededByCredentialId: result.credential.id,
      updatedAt: SUBMITTED
    })
    expect(after?.status).toBe("approved")
    expect(after?.reviewedAt).toBe(before?.reviewedAt)
    expect(result.superseded.map((row) => row.id)).toEqual([MAYA_CDL_CREDENTIAL])
  })

  it("does not punish a driver for renewing early", () => {
    // Being superseded is not being invalidated: an in-date certificate keeps
    // covering the driver while its replacement is under review.
    const state = freshState()

    expect(gateForDriver(state, HANK_DRIVER).satisfied).toBe(true)

    file(state, {
      actorUserId: HANK_USER,
      driverProfileId: HANK_DRIVER,
      kind: "insurance",
      organizationId: MAYA_ORG
    })

    expect(gateForDriver(state, HANK_DRIVER).satisfied).toBe(true)
  })

  it("supersedes every outstanding record of the kind, not just the newest", () => {
    // The store has no unique index, so two outstanding records of one kind can
    // exist. A renewal restores the invariant rather than leaving a stray record
    // that a later reader could treat as current.
    const state = freshState()
    const strayId = randomUUID()

    state.driverCredentials.push(
      driverCredentialSchema.parse({
        createdAt: "2026-06-15T09:00:00.000Z",
        documentMedia: credentialDocument(TAYLOR_DRIVER, "insurance"),
        driverProfileId: TAYLOR_DRIVER,
        id: strayId,
        kind: "insurance",
        status: "pending",
        submittedAt: "2026-06-15T09:00:00.000Z",
        updatedAt: "2026-06-15T09:00:00.000Z"
      })
    )

    const outstandingBefore = state.driverCredentials.filter(
      (row) =>
        row.driverProfileId === TAYLOR_DRIVER &&
        row.kind === "insurance" &&
        row.supersededByCredentialId === null
    )

    expect(outstandingBefore.length).toBeGreaterThan(1)

    const result = file(state, {
      actorUserId: DISPATCHER_USER,
      driverProfileId: TAYLOR_DRIVER,
      kind: "insurance",
      organizationId: TAYLOR_ORG
    })

    expect(new Set(result.superseded.map((row) => row.id))).toEqual(
      new Set(outstandingBefore.map((row) => row.id))
    )
    expect(
      state.driverCredentials.filter(
        (row) =>
          row.driverProfileId === TAYLOR_DRIVER &&
          row.kind === "insurance" &&
          row.supersededByCredentialId === null
      )
    ).toEqual([result.credential])
  })

  it("leaves an already superseded record pointing where it always pointed", () => {
    const state = freshState()
    const alreadySuperseded = state.driverCredentials.filter(
      (row) => row.driverProfileId === TAYLOR_DRIVER && row.supersededByCredentialId !== null
    )

    expect(alreadySuperseded.length).toBeGreaterThan(0)

    const before = structuredClone(alreadySuperseded)

    file(state, {
      actorUserId: DISPATCHER_USER,
      driverProfileId: TAYLOR_DRIVER,
      kind: "insurance",
      organizationId: TAYLOR_ORG
    })

    for (const row of before) {
      expect(state.driverCredentials.find((candidate) => candidate.id === row.id)).toEqual(row)
    }
  })

  it("does not touch another kind's outstanding record", () => {
    const state = freshState()
    const insuranceBefore = structuredClone(
      state.driverCredentials.find((row) => row.id === MAYA_REFUSED_INSURANCE)
    )

    file(state, {
      actorUserId: MAYA_USER,
      driverProfileId: MAYA_DRIVER,
      kind: "cdl",
      organizationId: MAYA_ORG
    })

    expect(state.driverCredentials.find((row) => row.id === MAYA_REFUSED_INSURANCE)).toEqual(
      insuranceBefore
    )
  })

  it("does not supersede rig A when filing the same kind for rig B", () => {
    const state = freshState()
    const rigA = file(state, {
      actorUserId: MAYA_USER,
      driverProfileId: MAYA_DRIVER,
      kind: "truck",
      organizationId: MAYA_ORG,
      truckProfileId: MAYA_TRUCK_A
    })
    const rigB = file(state, {
      actorUserId: MAYA_USER,
      driverProfileId: MAYA_DRIVER,
      kind: "truck",
      organizationId: MAYA_ORG,
      truckProfileId: MAYA_TRUCK_B
    })

    expect(rigB.superseded).toEqual([])
    expect(
      state.driverCredentials.find((candidate) => candidate.id === rigA.credential.id)
        ?.supersededByCredentialId
    ).toBeNull()
    expect(rigB.credential.truckProfileId).toBe(MAYA_TRUCK_B)
  })
})

describe("submitting the same document twice", () => {
  it("writes one row, supersedes nothing on the replay, and audits once", () => {
    // The retry and compare-and-swap replay path. A second row here would give the
    // driver two records for one document and would re-point records at a row the
    // replay did not write.
    const state = freshState()
    const documentMedia = credentialDocument(RILEY_DRIVER, "cdl")
    const first = file(state, {
      actorUserId: RILEY_USER,
      documentMedia,
      driverProfileId: RILEY_DRIVER,
      kind: "cdl",
      organizationId: MAYA_ORG
    })
    const second = file(state, {
      actorUserId: RILEY_USER,
      documentMedia,
      driverProfileId: RILEY_DRIVER,
      kind: "cdl",
      organizationId: MAYA_ORG
    })

    expect(first.outcome).toBe("submitted")
    expect(second.outcome).toBe("already_submitted")
    expect(second.credential.id).toBe(first.credential.id)
    expect(second.superseded).toEqual([])
    expect(
      state.driverCredentials.filter((row) => row.driverProfileId === RILEY_DRIVER)
    ).toHaveLength(1)
    expect(auditActions(state, "driver_credential_submitted")).toHaveLength(1)
  })

  it("does not resurrect a decided record when the same document is resubmitted", () => {
    // A driver who resubmits the identical file after a refusal must not thereby
    // reset the decision: the record is already on file and the decision stands.
    const state = freshState()
    const documentMedia = credentialDocument(RILEY_DRIVER, "cdl")
    const submission = file(state, {
      actorUserId: RILEY_USER,
      documentMedia,
      driverProfileId: RILEY_DRIVER,
      kind: "cdl",
      organizationId: MAYA_ORG
    })

    applyCredentialReview(
      state,
      {
        credentialId: submission.credential.id,
        decidedBy: "ai",
        decision: "denied",
        model: "test-reviewer",
        rationale: "The name on the licence is not the name on the profile."
      },
      REVIEWED
    )

    const replay = file(state, {
      actorUserId: RILEY_USER,
      documentMedia,
      driverProfileId: RILEY_DRIVER,
      kind: "cdl",
      organizationId: MAYA_ORG
    })

    expect(replay.outcome).toBe("already_submitted")
    expect(replay.credential.status).toBe("denied")
  })
})

describe("the submission audit event", () => {
  it("names the credential without copying the document reference or the licence number", () => {
    // Audit events are readable by every view_audit_log holder in an organization,
    // which is a wider audience than the vault. Copying identifiers into them would
    // quietly widen who can read them.
    const state = freshState()
    const documentMedia = credentialDocument(RILEY_DRIVER, "cdl")
    const result = file(state, {
      actorUserId: RILEY_USER,
      documentMedia,
      driverProfileId: RILEY_DRIVER,
      identifier: "CDL-A-SECRET-777",
      kind: "cdl",
      organizationId: MAYA_ORG
    })
    const [event] = auditActions(state, "driver_credential_submitted")
    const serialized = JSON.stringify(event)

    expect(event?.entityId).toBe(result.credential.id)
    expect(event?.entityType).toBe("driver_credential")
    expect(serialized).not.toContain(documentMedia.publicId)
    expect(serialized).not.toContain("CDL-A-SECRET-777")
    expect(event?.metadata).toMatchObject({ kind: "cdl", submittedByDriver: true })
  })

  it("records that somebody else filed it when a dispatcher does", () => {
    const state = freshState()

    file(state, {
      actorUserId: DISPATCHER_USER,
      driverProfileId: RILEY_DRIVER,
      kind: "cdl",
      organizationId: MAYA_ORG
    })

    const [event] = auditActions(state, "driver_credential_submitted")

    expect(event?.actorUserId).toBe(DISPATCHER_USER)
    expect(event?.metadata).toMatchObject({ submittedByDriver: false })
  })
})

// ── Review ────────────────────────────────────────────────────────────────────

describe("applyCredentialReview", () => {
  it("refuses to approve a credential with no stored document", () => {
    // THE SELF-CERTIFICATION HOLE. A row that says "approved" and holds no bytes
    // would clear a driver on nothing but its own say-so. Closed in the service,
    // because a screen can be bypassed by the next caller.
    const state = freshState()
    const credentialId = randomUUID()

    state.driverCredentials.push(
      driverCredentialSchema.parse({
        createdAt: SUBMITTED,
        documentMedia: null,
        driverProfileId: RILEY_DRIVER,
        id: credentialId,
        kind: "cdl",
        status: "pending",
        submittedAt: SUBMITTED,
        updatedAt: SUBMITTED
      })
    )

    expect(() =>
      applyCredentialReview(
        state,
        {
          credentialId,
          decidedBy: "ai",
          decision: "approved",
          model: "test-reviewer",
          rationale: "Approving it anyway."
        },
        REVIEWED
      )
    ).toThrow(/no stored document cannot be approved/)

    expect(state.credentialReviews.filter((row) => row.credentialId === credentialId)).toHaveLength(0)
    expect(state.driverCredentials.find((row) => row.id === credentialId)?.status).toBe("pending")
    expect(auditActions(state, "driver_credential_reviewed")).toHaveLength(0)
  })

  it("refuses to approve a document that has already lapsed", () => {
    // Approving a lapsed certificate would tell the driver they are cleared while
    // every acceptance refuses them — the one surface disagreeing with another that
    // the whole vault exists to prevent.
    const state = freshState()
    const submission = file(state, {
      actorUserId: RILEY_USER,
      driverProfileId: RILEY_DRIVER,
      expiresOn: "2026-06-30T00:00:00.000Z",
      kind: "insurance",
      organizationId: MAYA_ORG
    })

    expect(() =>
      applyCredentialReview(
        state,
        {
          credentialId: submission.credential.id,
          decidedBy: "ai",
          decision: "approved",
          model: "test-reviewer",
          rationale: "Approving a lapsed certificate."
        },
        REVIEWED
      )
    ).toThrow(/lapsed on/)

    expect(state.driverCredentials.find((row) => row.id === submission.credential.id)?.status).toBe(
      "pending"
    )
  })

  it("approves a document that lapses one instant after the decision", () => {
    // The boundary, in the direction that must still work. Refusing this would
    // block a driver renewing a certificate on its last day.
    const state = freshState()
    const submission = file(state, {
      actorUserId: RILEY_USER,
      driverProfileId: RILEY_DRIVER,
      expiresOn: new Date(Date.parse(REVIEWED) + 1).toISOString(),
      kind: "insurance",
      organizationId: MAYA_ORG
    })
    const result = applyCredentialReview(
      state,
      {
        credentialId: submission.credential.id,
        decidedBy: "ai",
        decision: "approved",
        model: "test-reviewer",
        rationale: "In date at the moment of the decision."
      },
      REVIEWED
    )

    expect(result.credential.status).toBe("approved")
  })

  it("refuses an approval that also asks for more evidence", () => {
    const state = freshState()
    const submission = file(state, {
      actorUserId: RILEY_USER,
      driverProfileId: RILEY_DRIVER,
      kind: "cdl",
      organizationId: MAYA_ORG
    })

    expect(() =>
      applyCredentialReview(
        state,
        {
          credentialId: submission.credential.id,
          decidedBy: "ai",
          decision: "approved",
          model: "test-reviewer",
          rationale: "Approved, but also send more.",
          requestedEvidence: ["The back of the card"]
        },
        REVIEWED
      )
    ).toThrow(/leaves nothing outstanding/)
  })

  it("refuses a request for more evidence that does not say what evidence", () => {
    const state = freshState()
    const submission = file(state, {
      actorUserId: RILEY_USER,
      driverProfileId: RILEY_DRIVER,
      kind: "cdl",
      organizationId: MAYA_ORG
    })

    expect(() =>
      applyCredentialReview(
        state,
        {
          credentialId: submission.credential.id,
          decidedBy: "ai",
          decision: "more_info_required",
          model: "test-reviewer",
          rationale: "We need more."
        },
        REVIEWED
      )
    ).toThrow(/Say what more the driver must supply/)
  })

  it("refuses an AI decision that cannot name the model that made it", () => {
    const state = freshState()
    const submission = file(state, {
      actorUserId: RILEY_USER,
      driverProfileId: RILEY_DRIVER,
      kind: "cdl",
      organizationId: MAYA_ORG
    })

    expect(() =>
      applyCredentialReview(
        state,
        {
          credentialId: submission.credential.id,
          decidedBy: "ai",
          decision: "denied",
          rationale: "Refused by something unnamed."
        },
        REVIEWED
      )
    ).toThrow(/model/)
  })

  it("refuses to attribute a machine decision to a person", () => {
    // An AI decision carrying a user id makes the audit log say somebody read a
    // document they never saw.
    const state = freshState()
    const submission = file(state, {
      actorUserId: RILEY_USER,
      driverProfileId: RILEY_DRIVER,
      kind: "cdl",
      organizationId: MAYA_ORG
    })

    expect(() =>
      applyCredentialReview(
        state,
        {
          actorUserId: PLATFORM_ADMIN_USER,
          credentialId: submission.credential.id,
          decidedBy: "ai",
          decision: "denied",
          model: "test-reviewer",
          rationale: "Refused."
        },
        REVIEWED
      )
    ).toThrow(/not attributable to a person/)
  })

  it("records an AI decision with no actor at all", () => {
    const state = freshState()
    const submission = file(state, {
      actorUserId: RILEY_USER,
      driverProfileId: RILEY_DRIVER,
      kind: "cdl",
      organizationId: MAYA_ORG
    })

    applyCredentialReview(
      state,
      {
        credentialId: submission.credential.id,
        decidedBy: "ai",
        decision: "denied",
        model: "test-reviewer",
        rationale: "Refused."
      },
      REVIEWED
    )

    expect(auditActions(state, "driver_credential_reviewed")[0]?.actorUserId).toBeNull()
  })

  it("refuses a platform decision that names nobody", () => {
    const state = freshState()
    const submission = file(state, {
      actorUserId: RILEY_USER,
      driverProfileId: RILEY_DRIVER,
      kind: "cdl",
      organizationId: MAYA_ORG
    })

    expect(() =>
      applyCredentialReview(
        state,
        {
          credentialId: submission.credential.id,
          decidedBy: "platform_admin",
          decision: "approved",
          rationale: "Approved on appeal."
        },
        REVIEWED
      )
    ).toThrow(/must name the administrator/)
  })

  it("refuses a platform decision from somebody who is not a platform administrator", () => {
    // Without this, the human appeal path is authorized by nothing but the caller
    // passing the string "platform_admin".
    const state = freshState()
    const submission = file(state, {
      actorUserId: RILEY_USER,
      driverProfileId: RILEY_DRIVER,
      kind: "cdl",
      organizationId: MAYA_ORG
    })

    expect(state.profiles.find((profile) => profile.id === MAYA_USER)?.role).not.toBe("admin")
    expect(() =>
      applyCredentialReview(
        state,
        {
          actorUserId: MAYA_USER,
          credentialId: submission.credential.id,
          decidedBy: "platform_admin",
          decision: "approved",
          rationale: "Approving my own licence."
        },
        REVIEWED
      )
    ).toThrow(/active LogLoads administrator/)
  })

  it("refuses a platform decision from a deactivated administrator", () => {
    const state = freshState()
    const submission = file(state, {
      actorUserId: RILEY_USER,
      driverProfileId: RILEY_DRIVER,
      kind: "cdl",
      organizationId: MAYA_ORG
    })

    state.profiles = state.profiles.map((profile) =>
      profile.id === PLATFORM_ADMIN_USER ? { ...profile, isActive: false } : profile
    )

    expect(() =>
      applyCredentialReview(
        state,
        {
          actorUserId: PLATFORM_ADMIN_USER,
          credentialId: submission.credential.id,
          decidedBy: "platform_admin",
          decision: "approved",
          rationale: "Approved on appeal."
        },
        REVIEWED
      )
    ).toThrow(/active LogLoads administrator/)
  })

  it("refuses a decision on a credential that does not exist", () => {
    const state = freshState()

    expect(() =>
      applyCredentialReview(
        state,
        {
          credentialId: randomUUID(),
          decidedBy: "ai",
          decision: "denied",
          model: "test-reviewer",
          rationale: "Refused."
        },
        REVIEWED
      )
    ).toThrow(/was not found/)
  })

  it("does not rewrite the dates the driver stated", () => {
    // If the document disagrees with what the driver stated, the honest outcome is
    // a refusal naming the mismatch. Substituting the platform's reading would make
    // LogLoads the author of a date nobody agreed to.
    const state = freshState()
    const statedExpiry = "2027-01-31T00:00:00.000Z"
    const submission = file(state, {
      actorUserId: RILEY_USER,
      driverProfileId: RILEY_DRIVER,
      expiresOn: statedExpiry,
      kind: "insurance",
      organizationId: MAYA_ORG
    })
    const result = applyCredentialReview(
      state,
      {
        credentialId: submission.credential.id,
        decidedBy: "ai",
        decision: "approved",
        extracted: { expiresOn: "01/31/2028", issuer: "Cascade Mutual Insurance" },
        model: "test-reviewer",
        rationale: "Consistent with the certificate."
      },
      REVIEWED
    )

    expect(result.credential.expiresOn).toBe(statedExpiry)
    expect(result.credential.issuer).toBeNull()
    // What the reviewer read is kept as printed, in its own place.
    expect(result.review.extracted.expiresOn).toBe("01/31/2028")
  })
})

describe("the review trail is append-only", () => {
  it("writes one row when the same decision is retried", () => {
    const state = freshState()
    const submission = file(state, {
      actorUserId: RILEY_USER,
      driverProfileId: RILEY_DRIVER,
      kind: "cdl",
      organizationId: MAYA_ORG
    })
    const decision = {
      credentialId: submission.credential.id,
      decidedBy: "ai" as const,
      decision: "denied" as const,
      findings: ["holder_name_mismatch"],
      model: "test-reviewer",
      rationale: "The name on the licence is not the name on the profile."
    }
    const first = applyCredentialReview(state, decision, REVIEWED)
    const second = applyCredentialReview(state, decision, "2026-07-01T09:30:00.000Z")

    expect(first.outcome).toBe("reviewed")
    expect(second.outcome).toBe("already_reviewed")
    expect(second.review.id).toBe(first.review.id)
    expect(state.credentialReviews).toHaveLength(
      seedDatabaseState.credentialReviews.length + 1
    )
    expect(auditActions(state, "driver_credential_reviewed")).toHaveLength(1)
    // The retry must not restamp the credential either.
    expect(state.driverCredentials.find((row) => row.id === submission.credential.id)?.updatedAt).toBe(
      REVIEWED
    )
  })

  it("never edits an earlier decision when a later one reverses it", () => {
    const state = freshState()
    const submission = file(state, {
      actorUserId: RILEY_USER,
      driverProfileId: RILEY_DRIVER,
      kind: "cdl",
      organizationId: MAYA_ORG
    })
    const machine = applyCredentialReview(
      state,
      {
        credentialId: submission.credential.id,
        decidedBy: "ai",
        decision: "denied",
        model: "test-reviewer",
        rationale: "The expiry date is not legible."
      },
      REVIEWED
    )
    const machineRow = structuredClone(machine.review)

    const appeal = applyCredentialReview(
      state,
      {
        actorUserId: PLATFORM_ADMIN_USER,
        credentialId: submission.credential.id,
        decidedBy: "platform_admin",
        decision: "approved",
        rationale: "Read the certificate by hand; the expiry is legible on the reverse."
      },
      "2026-07-02T10:00:00.000Z"
    )

    expect(state.credentialReviews.find((row) => row.id === machineRow.id)).toEqual(machineRow)
    expect(appeal.review.id).not.toBe(machineRow.id)
    expect(appeal.credential.status).toBe("approved")
    expect(
      state.credentialReviews.filter((row) => row.credentialId === submission.credential.id)
    ).toHaveLength(2)
  })

  it("lets one decider record two different decisions, on distinct rows", () => {
    // What makes the derived attempt load-bearing: two decisions from the same
    // decider must not collide on one id.
    const state = freshState()
    const submission = file(state, {
      actorUserId: RILEY_USER,
      driverProfileId: RILEY_DRIVER,
      kind: "cdl",
      organizationId: MAYA_ORG
    })
    const first = applyCredentialReview(
      state,
      {
        actorUserId: PLATFORM_ADMIN_USER,
        credentialId: submission.credential.id,
        decidedBy: "platform_admin",
        decision: "denied",
        rationale: "Refused on first reading."
      },
      REVIEWED
    )
    const second = applyCredentialReview(
      state,
      {
        actorUserId: PLATFORM_ADMIN_USER,
        credentialId: submission.credential.id,
        decidedBy: "platform_admin",
        decision: "approved",
        rationale: "Reversed after the driver supplied context by phone."
      },
      "2026-07-02T10:00:00.000Z"
    )

    expect(first.review.id).toBe(credentialReviewId(submission.credential.id, 1))
    expect(second.review.id).toBe(credentialReviewId(submission.credential.id, 2))
    expect(state.credentialReviews.find((row) => row.id === first.review.id)?.decision).toBe("denied")
  })

  it("does not move the credential back when an earlier decision is retried", () => {
    const state = freshState()
    const submission = file(state, {
      actorUserId: RILEY_USER,
      driverProfileId: RILEY_DRIVER,
      kind: "cdl",
      organizationId: MAYA_ORG
    })
    const denial = {
      credentialId: submission.credential.id,
      decidedBy: "ai" as const,
      decision: "denied" as const,
      model: "test-reviewer",
      rationale: "The expiry date is not legible."
    }

    applyCredentialReview(state, denial, REVIEWED)
    applyCredentialReview(
      state,
      {
        actorUserId: PLATFORM_ADMIN_USER,
        credentialId: submission.credential.id,
        decidedBy: "platform_admin",
        decision: "approved",
        rationale: "Read by hand on appeal."
      },
      "2026-07-02T10:00:00.000Z"
    )

    const replay = applyCredentialReview(state, denial, "2026-07-03T10:00:00.000Z")

    expect(replay.outcome).toBe("already_reviewed")
    expect(replay.credential.status).toBe("approved")
    expect(state.driverCredentials.find((row) => row.id === submission.credential.id)?.status).toBe(
      "approved"
    )
  })
})

describe("the review audit event", () => {
  it("carries the reason codes but not the rationale or what was read off the page", () => {
    const state = freshState()
    const submission = file(state, {
      actorUserId: RILEY_USER,
      driverProfileId: RILEY_DRIVER,
      kind: "cdl",
      organizationId: MAYA_ORG
    })

    applyCredentialReview(
      state,
      {
        credentialId: submission.credential.id,
        decidedBy: "ai",
        decision: "denied",
        extracted: { holderName: "Riley Private", identifier: "CDL-A-SECRET-999" },
        findings: ["holder_name_mismatch"],
        model: "test-reviewer",
        rationale: "The licence is issued to somebody else entirely."
      },
      REVIEWED
    )

    const [event] = auditActions(state, "driver_credential_reviewed")
    const serialized = JSON.stringify(event)

    expect(event?.entityType).toBe("credential_review")
    expect(event?.metadata).toMatchObject({
      attempt: 1,
      decidedBy: "ai",
      decision: "denied",
      findings: ["holder_name_mismatch"],
      previousStatus: "pending"
    })
    expect(serialized).not.toContain("CDL-A-SECRET-999")
    expect(serialized).not.toContain("Riley Private")
    expect(serialized).not.toContain("issued to somebody else")
  })
})

// ── The gate ──────────────────────────────────────────────────────────────────

describe("driverCredentialGate", () => {
  it("clears a driver holding all four kinds, approved and in date", () => {
    const state = freshState()

    clearDriver(state, {
      actorUserId: RILEY_USER,
      driverProfileId: RILEY_DRIVER,
      insuranceExpiresOn: instantAfter(400),
      organizationId: MAYA_ORG
    })

    const gate = gateForDriver(state, RILEY_DRIVER)

    expect(gate.satisfied).toBe(true)
    expect(gate.missing).toEqual([])
    expect(gate.expiring).toEqual([])
  })

  it("blocks a driver one kind short", () => {
    const state = freshState()

    for (const kind of MANDATORY_CREDENTIAL_KINDS.filter((candidate) => candidate !== "trailer")) {
      fileAndApprove(state, {
        actorUserId: RILEY_USER,
        driverProfileId: RILEY_DRIVER,
        kind,
        organizationId: MAYA_ORG
      })
    }

    const gate = gateForDriver(state, RILEY_DRIVER)

    expect(gate.satisfied).toBe(false)
    expect(gate.missing).toEqual(["trailer"])
  })

  it("never lets historical unbound equipment evidence clear a selected rig", () => {
    const state = freshState()

    state.driverCredentials = state.driverCredentials.map((credential) => {
      if (credential.driverProfileId !== HANK_DRIVER) {
        return credential
      }

      if (credential.kind === "truck") {
        return driverCredentialSchema.parse({ ...credential, truckProfileId: null })
      }

      if (credential.kind === "trailer") {
        return driverCredentialSchema.parse({ ...credential, trailerProfileId: null })
      }

      return credential
    })

    const gate = driverCredentialGate(state, HANK_DRIVER, AT, {
      trailerProfileId: HANK_TRAILER,
      truckProfileId: HANK_TRUCK
    })

    expect(gate.satisfied).toBe(false)
    expect(gate.missing).toEqual(["truck", "trailer"])
  })

  it("stops clearing a driver the instant a credential lapses, with nothing written in between", () => {
    // There is no scheduler in this product. Expiry has to be read-time or an
    // expired document keeps clearing drivers until somebody runs a sweep.
    const state = freshState()

    clearDriver(state, {
      actorUserId: RILEY_USER,
      driverProfileId: RILEY_DRIVER,
      insuranceExpiresOn: instantAfter(10),
      organizationId: MAYA_ORG
    })

    const rowsAfterClearing = structuredClone(state.driverCredentials)
    const before = gateForDriver(state, RILEY_DRIVER, instantAfter(5))
    const after = gateForDriver(state, RILEY_DRIVER, instantAfter(20))

    expect(before.satisfied).toBe(true)
    expect(before.expiring).toEqual([{ expiresOn: instantAfter(10), kind: "insurance" }])
    expect(after.satisfied).toBe(false)
    expect(after.missing).toEqual(["insurance"])
    // Neither read wrote anything: the gate is a read, and the answer changed
    // because the clock moved.
    expect(state.driverCredentials).toEqual(rowsAfterClearing)
  })

  it("blocks a driver whose only approved certificate lapsed, with the renewal pending", () => {
    // Taylor, straight from the seed: approved and lapsed, replacement under
    // review. Neither record counts, and the reasons are different.
    const state = freshState()
    const gate = gateForDriver(state, TAYLOR_DRIVER)

    expect(gate.satisfied).toBe(false)
    expect(gate.missing).toEqual([...MANDATORY_CREDENTIAL_KINDS])
  })

  it("reports what a partly filed driver is missing in schema order", () => {
    const state = freshState()
    const gate = gateForDriver(state, MAYA_DRIVER)

    expect(gate.satisfied).toBe(false)
    expect(gate.missing).toEqual(["insurance", "truck", "trailer"])
  })

  it("warns before it blocks", () => {
    const state = freshState()

    clearDriver(state, {
      actorUserId: RILEY_USER,
      driverProfileId: RILEY_DRIVER,
      insuranceExpiresOn: instantAfter(CREDENTIAL_EXPIRY_WARNING_DAYS - 1),
      organizationId: MAYA_ORG
    })

    const gate = gateForDriver(state, RILEY_DRIVER)

    expect(gate.satisfied).toBe(true)
    expect(gate.expiring.map((entry) => entry.kind)).toEqual(["insurance"])
  })

  it("throws for a driver profile that does not exist", () => {
    const state = freshState()

    expect(() =>
      driverCredentialGate(state, randomUUID(), AT, {
        trailerProfileId: null,
        truckProfileId: randomUUID()
      })
    ).toThrow(/was not found/)
  })

  it("fails closed when runtime callers omit or malform the exact equipment selection", () => {
    const state = freshState()

    expect(() =>
      driverCredentialGate(state, HANK_DRIVER, AT, undefined as never)
    ).toThrow(/exact truck and trailer combination/)
    expect(() =>
      hostCredentialSummary(state, HANK_DRIVER, AT, {
        trailerProfileId: undefined,
        truckProfileId: HANK_TRUCK
      } as never)
    ).toThrow(/exact truck and trailer combination/)
  })

  it("rejects a schema-valid truck and trailer pair that is not one assigned rig", () => {
    const state = freshState()
    const rigA = state.equipmentCombinations.find(
      (candidate) =>
        candidate.assignedDriverProfileId === MAYA_DRIVER &&
        candidate.truckProfileId === MAYA_TRUCK_A
    )
    const rigB = state.equipmentCombinations.find(
      (candidate) =>
        candidate.assignedDriverProfileId === MAYA_DRIVER &&
        candidate.truckProfileId === MAYA_TRUCK_B
    )

    if (!rigA?.trailerProfileId || !rigB?.trailerProfileId) {
      throw new Error("Maya two-rig trailer fixtures missing")
    }

    const fabricatedSelection = {
      trailerProfileId: rigB.trailerProfileId,
      truckProfileId: rigA.truckProfileId
    }
    expect(
      state.equipmentCombinations.some(
        (candidate) =>
          candidate.assignedDriverProfileId === MAYA_DRIVER &&
          candidate.truckProfileId === fabricatedSelection.truckProfileId &&
          (candidate.trailerProfileId ?? null) === fabricatedSelection.trailerProfileId
      )
    ).toBe(false)

    expect(() =>
      driverCredentialGate(state, MAYA_DRIVER, AT, fabricatedSelection)
    ).toThrow(/active equipment combination assigned to this driver/)
    expect(() =>
      hostCredentialSummary(state, MAYA_DRIVER, AT, fabricatedSelection)
    ).toThrow(/active equipment combination assigned to this driver/)
  })

  it("fails the gate when two assigned rigs share a normalized unit number", () => {
    const state = freshState()
    const truckA = state.truckProfiles.find((candidate) => candidate.id === MAYA_TRUCK_A)
    const truckB = state.truckProfiles.find((candidate) => candidate.id === MAYA_TRUCK_B)
    const rigA = state.equipmentCombinations.find(
      (candidate) =>
        candidate.assignedDriverProfileId === MAYA_DRIVER &&
        candidate.truckProfileId === MAYA_TRUCK_A
    )

    if (!truckA || !truckB || !rigA) {
      throw new Error("Maya two-rig fixture missing")
    }
    truckB.unitNumber = truckA.unitNumber.toLowerCase()
    const view = vaultView(state, MAYA_DRIVER, {
      actorUserId: MAYA_USER,
      audience: "driver"
    })

    expect(
      view.equipmentSelections.find((selection) => selection.combinationId === rigA.id)
        ?.equipmentUnitNumbersUnique
    ).toBe(false)

    expect(() =>
      driverCredentialGate(state, MAYA_DRIVER, AT, {
        trailerProfileId: rigA.trailerProfileId ?? null,
        truckProfileId: MAYA_TRUCK_A
      })
    ).toThrow(/truck unit number is not unique/)
  })
})

// ── What the host receives ────────────────────────────────────────────────────

describe("the host boundary", () => {
  /** Maya, cleared through the real service path, read by an external host. */
  function clearedMaya() {
    const state = freshState()

    for (const kind of ["insurance", "truck", "trailer"] as const) {
      fileAndApprove(state, {
        actorUserId: MAYA_USER,
        driverProfileId: MAYA_DRIVER,
        expiresOn: kind === "insurance" ? instantAfter(400) : null,
        kind,
        organizationId: MAYA_ORG
      })
    }

    expect(gateForDriver(state, MAYA_DRIVER).satisfied).toBe(true)

    return state
  }

  const hostViewer: CredentialViewer = {
    actorUserId: DISPATCHER_USER,
    assignmentId: MAYA_EXTERNAL_HOST_ASSIGNMENT,
    audience: "host",
    organizationId: EXTERNAL_HOST_ORG
  }

  it("never hands a host the CDL image or the insurance certificate image", () => {
    const state = clearedMaya()
    const view = hostView(state, MAYA_DRIVER, hostViewer)
    const byKind = new Map(view.credentials.map((entry) => [entry.kind, entry]))

    expect(byKind.get("cdl")?.photo).toBeNull()
    expect(byKind.get("insurance")?.photo).toBeNull()
    expect(byKind.get("truck")?.photo).not.toBeNull()
    expect(byKind.get("trailer")?.photo).not.toBeNull()
  })

  it("shares a photo for exactly the kinds the contract says a host may see", () => {
    const state = clearedMaya()
    const view = hostView(state, MAYA_DRIVER, hostViewer)

    expect(view.credentials).toHaveLength(MANDATORY_CREDENTIAL_KINDS.length)

    for (const entry of view.credentials) {
      // Derived from the contract rather than restated, so a founder decision to
      // share a third kind is made in one place.
      expect(entry.photo !== null).toBe(HOST_VISIBLE_CREDENTIAL_PHOTO_KINDS.includes(entry.kind))
    }
  })

  it("gives each entry exactly four fields", () => {
    const state = clearedMaya()
    const view = hostView(state, MAYA_DRIVER, hostViewer)

    for (const entry of view.credentials) {
      expect(Object.keys(entry).sort()).toEqual(["expiresOn", "kind", "photo", "status"])
    }
  })

  it("leaks nothing about the driver's licence anywhere in the response", () => {
    // The whole serialized response, not just the fields the test remembered to
    // look at. This is what catches a field added to the stored row later.
    const state = clearedMaya()
    const serialized = JSON.stringify(hostView(state, MAYA_DRIVER, hostViewer))

    expect(serialized).not.toContain(MAYA_CDL_DOCUMENT_PUBLIC_ID)
    expect(serialized).not.toContain(MAYA_CDL_IDENTIFIER)
    expect(serialized).not.toContain(MAYA_USER)
  })

  it("never shows a host a refusal or a resubmission", () => {
    // Maya's seeded insurance was refused with a list of what to rephotograph. A
    // host learns she is cleared and until when, not that a page was cut off.
    const state = clearedMaya()
    const view = hostView(state, MAYA_DRIVER, hostViewer)
    const serialized = JSON.stringify(view)

    expect(view.credentials.every((entry) => entry.status === "approved")).toBe(true)
    expect(serialized).not.toContain("the bottom of the page is cut off")
    expect(serialized).not.toContain(MAYA_REFUSED_INSURANCE)
  })

  it("shows a host nothing at all for a driver who is not cleared", () => {
    const state = freshState()
    const view = hostView(state, TAYLOR_DRIVER, {
      actorUserId: DISPATCHER_USER,
      assignmentId: TAYLOR_HOST_ASSIGNMENT,
      audience: "host",
      organizationId: TAYLOR_ORG
    })
    const serialized = JSON.stringify(view)

    expect(view.satisfied).toBe(false)
    expect(view.credentials).toEqual([])
    expect(view.missing).toEqual([...MANDATORY_CREDENTIAL_KINDS])
    expect(serialized).not.toContain(TAYLOR_INSURANCE_IDENTIFIER)
  })

  it("makes only the claim LogLoads can stand behind", () => {
    const state = clearedMaya()
    const view = hostView(state, MAYA_DRIVER, hostViewer)

    expect(view.assurance).toBe(CREDENTIAL_ASSURANCE_STATEMENT)
    // LogLoads is orchestration. It must never be read as certifying a driver's
    // legal right to operate.
    expect(view.assurance).not.toMatch(/verif/i)
    expect(view.assurance).toMatch(/does not certify/)
  })

  it("refuses a host organization that has no work of this driver's", () => {
    const state = clearedMaya()
    const actorUserId = addMember(state, UNRELATED_ORG, ROLE_WITH_MANAGE_DRIVERS as OrganizationRole)

    expect(() =>
      listDriverCredentials(state, MAYA_DRIVER, {
        actorUserId,
        assignmentId: MAYA_EXTERNAL_HOST_ASSIGNMENT,
        audience: "host",
        organizationId: UNRELATED_ORG
      })
    ).toThrow(/not hauling for your organization/)
  })

  it("refuses somebody who is not an active member of the host organization", () => {
    const state = clearedMaya()

    expect(() =>
      listDriverCredentials(state, MAYA_DRIVER, {
        actorUserId: randomUUID(),
        assignmentId: MAYA_EXTERNAL_HOST_ASSIGNMENT,
        audience: "host",
        organizationId: EXTERNAL_HOST_ORG
      })
    ).toThrow(/not an active member/)
  })

  it("builds the same summary for the acceptance path, which holds no viewer", () => {
    const state = clearedMaya()
    const view = hostView(state, MAYA_DRIVER, hostViewer)
    const { audience, ...projection } = view

    expect(audience).toBe("host")
    expect(
      hostCredentialSummary(
        state,
        MAYA_DRIVER,
        AT,
        selectionForDriver(state, MAYA_DRIVER)
      )
    ).toEqual(projection)
  })
})

// ── Who may read the vault ────────────────────────────────────────────────────

describe("listDriverCredentials", () => {
  it("shows a driver everything about their own records, images included", () => {
    const state = freshState()
    const view = vaultView(state, MAYA_DRIVER, { actorUserId: MAYA_USER, audience: "driver" })
    const cdl = view.credentials.find((row) => row.id === MAYA_CDL_CREDENTIAL)

    expect(cdl?.documentMedia?.publicId).toBe(MAYA_CDL_DOCUMENT_PUBLIC_ID)
    expect(cdl?.identifier).toBe(MAYA_CDL_IDENTIFIER)
    expect(view.equipmentSelections).not.toHaveLength(0)
  })

  it("shows a driver why they were refused", () => {
    const state = freshState()
    const view = vaultView(state, MAYA_DRIVER, { actorUserId: MAYA_USER, audience: "driver" })
    const refusal = view.reviews.find((row) => row.credentialId === MAYA_REFUSED_INSURANCE)

    expect(refusal?.decision).toBe("more_info_required")
    expect(refusal?.requestedEvidence.length).toBeGreaterThan(0)
  })

  it("lets a driver with no active membership anywhere still read their own vault", () => {
    // A driver between outfits must not lose sight of their own documents.
    const state = freshState()

    state.organizationMemberships = state.organizationMemberships.filter(
      (membership) => membership.userId !== MAYA_USER
    )

    const view = vaultView(state, MAYA_DRIVER, { actorUserId: MAYA_USER, audience: "driver" })

    expect(view.credentials.length).toBeGreaterThan(0)
  })

  it("refuses a driver reading another driver's vault", () => {
    const state = freshState()

    expect(() =>
      listDriverCredentials(state, MAYA_DRIVER, { actorUserId: HANK_USER, audience: "driver" })
    ).toThrow(/only read your own/)
  })

  it("lets the outfit that dispatches the driver read what it filed", () => {
    const state = freshState()
    const view = vaultView(state, MAYA_DRIVER, {
      actorUserId: DISPATCHER_USER,
      audience: "fleet",
      organizationId: MAYA_ORG
    })

    expect(view.audience).toBe("fleet")
    expect(view.credentials.length).toBeGreaterThan(0)
  })

  it("refuses a member of the driver's own outfit who cannot manage drivers", () => {
    const state = freshState()
    const actorUserId = addMember(state, MAYA_ORG, ROLE_WITHOUT_MANAGE_DRIVERS as OrganizationRole)

    expect(() =>
      listDriverCredentials(state, MAYA_DRIVER, {
        actorUserId,
        audience: "fleet",
        organizationId: MAYA_ORG
      })
    ).toThrow(/cannot manage drivers/)
  })

  it("refuses a manage_drivers member of an outfit the driver is not on", () => {
    // The host who books Maya holds manage_drivers in their own outfit. That must
    // not be a route to her licence image through the fleet audience.
    const state = freshState()

    expect(() =>
      listDriverCredentials(state, MAYA_DRIVER, {
        actorUserId: DISPATCHER_USER,
        audience: "fleet",
        organizationId: EXTERNAL_HOST_ORG
      })
    ).toThrow(/not on your roster/)
  })

  it("orders the vault newest submission first and the trail newest decision first", () => {
    const state = freshState()

    file(
      state,
      {
        actorUserId: MAYA_USER,
        driverProfileId: MAYA_DRIVER,
        kind: "truck",
        organizationId: MAYA_ORG
      },
      SUBMITTED
    )

    const view = vaultView(state, MAYA_DRIVER, { actorUserId: MAYA_USER, audience: "driver" })
    const submittedAt = view.credentials.map((row) => Date.parse(row.submittedAt))
    const decidedAt = view.reviews.map((row) => Date.parse(row.decidedAt))

    expect(submittedAt).toEqual([...submittedAt].sort((left, right) => right - left))
    expect(decidedAt).toEqual([...decidedAt].sort((left, right) => right - left))
  })

  it("never reports another driver's records or reviews in a vault read", () => {
    const state = freshState()
    const view = vaultView(state, MAYA_DRIVER, { actorUserId: MAYA_USER, audience: "driver" })

    expect(view.credentials.every((row) => row.driverProfileId === MAYA_DRIVER)).toBe(true)
    expect(view.reviews.every((row) => row.driverProfileId === MAYA_DRIVER)).toBe(true)
    expect(view.credentials.length).toBeLessThan(state.driverCredentials.length)
  })
})

// ── The frozen derivations ────────────────────────────────────────────────────

describe("deterministic ids", () => {
  it("mints the same credential id for the same driver, kind and document", () => {
    const publicId = `${credentialDocumentPublicIdPrefix(RILEY_DRIVER, "cdl")}/uploads/fixed`

    expect(driverCredentialId(RILEY_DRIVER, "cdl", publicId)).toBe(
      driverCredentialId(RILEY_DRIVER, "cdl", publicId)
    )
    expect(driverCredentialId(RILEY_DRIVER, "cdl", publicId)).not.toBe(
      driverCredentialId(RILEY_DRIVER, "truck", publicId)
    )
    expect(driverCredentialId(RILEY_DRIVER, "cdl", publicId)).not.toBe(
      driverCredentialId(HANK_DRIVER, "cdl", publicId)
    )
  })

  it("pins the namespaces, which are frozen forever", () => {
    // A literal is the only thing that fails when somebody edits a namespace
    // constant. Changing one re-mints every id ever written, so the duplicate
    // checks stop recognising records that exist and start writing second rows.
    expect(
      driverCredentialId(RILEY_DRIVER, "cdl", "logloads/driver-credentials/pinned/uploads/fixed")
    ).toBe("24c83238-2715-5c53-bcba-e60ae7ef753f")
    expect(credentialReviewId("11111111-1111-4111-8111-111111111111", 1)).toBe(
      "0987251c-2e2c-5f94-8e39-f59b6df29013"
    )
  })

  it("keeps every kind in the schema mandatory, and every one derivable here", () => {
    expect([...MANDATORY_CREDENTIAL_KINDS]).toEqual([...credentialKindSchema.options])
  })
})
