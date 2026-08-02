import { describe, expect, it } from "vitest"

import {
  CREDENTIAL_ASSURANCE_STATEMENT,
  CREDENTIAL_EXPIRY_WARNING_DAYS,
  HOST_VISIBLE_CREDENTIAL_PHOTO_KINDS,
  MANDATORY_CREDENTIAL_KINDS,
  credentialGateFor,
  credentialIsValidAt,
  credentialKindSchema,
  credentialReviewDecisionSchema,
  credentialReviewerSchema,
  credentialStatusSchema,
  hostVisibleCredential,
  missingCredentialKinds,
  type CredentialFacts,
  type CredentialKind,
  type CredentialStatus
} from "./credentials"
import { credentialReviewSchema, driverCredentialSchema } from "./schemas"

const AT = "2026-07-01T12:00:00.000Z"
const MILLISECONDS_PER_DAY = 86_400_000

/** A stand-in for the stored document. Only its presence is ever read. */
const DOCUMENT = { publicId: "logloads/driver-credentials/test" }

function credential(
  kind: CredentialKind,
  overrides: Partial<CredentialFacts<typeof DOCUMENT>> = {}
): CredentialFacts<typeof DOCUMENT> {
  return {
    documentMedia: DOCUMENT,
    expiresOn: null,
    kind,
    status: "approved",
    ...overrides
  }
}

/** A complete, valid vault, built from the schema's kinds rather than a fixed list. */
function completeVault(): CredentialFacts<typeof DOCUMENT>[] {
  return credentialKindSchema.options.map((kind) => credential(kind))
}

function instantAfter(days: number): string {
  return new Date(Date.parse(AT) + days * MILLISECONDS_PER_DAY).toISOString()
}

describe("what the vault must contain", () => {
  it("makes every kind the schema declares mandatory", () => {
    // Derived, not copied: this is what stops a fifth kind from arriving as an
    // optional extra that no acceptance guard ever checks.
    expect(MANDATORY_CREDENTIAL_KINDS).toEqual(credentialKindSchema.options)
  })

  it("holds the four the founder decided, and no others", () => {
    // Pinned as literals on purpose. If a kind is added or removed, this test
    // fails and somebody has to say so out loud rather than discovering it later.
    expect([...MANDATORY_CREDENTIAL_KINDS]).toEqual(["insurance", "cdl", "truck", "trailer"])
  })
})

describe("credentialIsValidAt", () => {
  it("counts an approved credential with a document and no expiry", () => {
    expect(credentialIsValidAt(credential("cdl"), AT)).toBe(true)
  })

  it("refuses an approved credential with no document", () => {
    // The self-certification hole. Without this, a row asserting approval and
    // holding no bytes would clear a driver to haul on nothing but its own say-so.
    expect(credentialIsValidAt(credential("cdl", { documentMedia: null }), AT)).toBe(false)
  })

  it("refuses a credential whose document key is absent rather than null", () => {
    // What a row written before the field existed looks like from here. `undefined`
    // must fail closed exactly as `null` does.
    const missingKey = { expiresOn: null, kind: "cdl", status: "approved" } as unknown as CredentialFacts

    expect(credentialIsValidAt(missingKey, AT)).toBe(false)
  })

  it("counts nothing short of approved, for every other status the schema has", () => {
    // Driven by the schema's options, so a new status is invalid by default and a
    // future "provisionally_accepted" cannot slip through as a soft yes.
    const notApproved = credentialStatusSchema.options.filter((status) => status !== "approved")

    expect(notApproved.length).toBeGreaterThan(0)

    for (const status of notApproved) {
      expect(credentialIsValidAt(credential("cdl", { status }), AT), status).toBe(false)
    }
  })

  it("refuses a credential that expired, and one expiring at this very instant", () => {
    expect(credentialIsValidAt(credential("insurance", { expiresOn: instantAfter(-1) }), AT)).toBe(false)
    // Strictly after: an expiry that has arrived is not a grace period.
    expect(credentialIsValidAt(credential("insurance", { expiresOn: AT }), AT)).toBe(false)
    expect(
      credentialIsValidAt(credential("insurance", { expiresOn: new Date(Date.parse(AT) + 1).toISOString() }), AT)
    ).toBe(true)
  })

  it("treats an unreadable expiry as lapsed, not as unexpiring", () => {
    expect(credentialIsValidAt(credential("insurance", { expiresOn: "not a date" }), AT)).toBe(false)
  })

  it("refuses to guess when the caller's clock is unparsable", () => {
    expect(() => credentialIsValidAt(credential("cdl"), "yesterday")).toThrow(/parsable instant/)
    expect(() => credentialGateFor([], "yesterday")).toThrow(/parsable instant/)
  })
})

describe("missingCredentialKinds", () => {
  it("names all four for an empty vault, in schema order", () => {
    expect(missingCredentialKinds([], AT)).toEqual([...credentialKindSchema.options])
  })

  it("names nothing for a complete vault", () => {
    expect(missingCredentialKinds(completeVault(), AT)).toEqual([])
  })

  it("names the one kind that lapsed", () => {
    const vault = completeVault().map((entry) =>
      entry.kind === "insurance" ? { ...entry, expiresOn: instantAfter(-2) } : entry
    )

    expect(missingCredentialKinds(vault, AT)).toEqual(["insurance"])
  })

  it("lets a valid renewal cover the kind while an older record is still on file", () => {
    // A kind is satisfied by ANY valid credential of that kind. Requiring exactly
    // one would block a driver for the crime of renewing early.
    const vault = [
      ...completeVault(),
      credential("insurance", { expiresOn: instantAfter(-2) })
    ]

    expect(missingCredentialKinds(vault, AT)).toEqual([])
  })
})

describe("credentialGateFor", () => {
  it("is satisfied only when nothing is missing", () => {
    expect(credentialGateFor(completeVault(), AT)).toEqual({
      expiring: [],
      missing: [],
      satisfied: true
    })

    const gate = credentialGateFor([credential("cdl")], AT)

    expect(gate.satisfied).toBe(false)
    expect(gate.missing).toEqual(["insurance", "truck", "trailer"])
  })

  it("warns inside the window and stays quiet outside it", () => {
    const soon = instantAfter(CREDENTIAL_EXPIRY_WARNING_DAYS - 1)
    const later = instantAfter(CREDENTIAL_EXPIRY_WARNING_DAYS + 1)

    const warned = credentialGateFor(
      completeVault().map((entry) => (entry.kind === "cdl" ? { ...entry, expiresOn: soon } : entry)),
      AT
    )

    expect(warned.satisfied).toBe(true)
    expect(warned.expiring).toEqual([{ expiresOn: soon, kind: "cdl" }])

    const quiet = credentialGateFor(
      completeVault().map((entry) => (entry.kind === "cdl" ? { ...entry, expiresOn: later } : entry)),
      AT
    )

    expect(quiet.expiring).toEqual([])
  })

  it("includes the exact boundary, so the last warnable day still warns", () => {
    const boundary = instantAfter(CREDENTIAL_EXPIRY_WARNING_DAYS)
    const gate = credentialGateFor(
      completeVault().map((entry) => (entry.kind === "truck" ? { ...entry, expiresOn: boundary } : entry)),
      AT
    )

    expect(gate.expiring).toEqual([{ expiresOn: boundary, kind: "truck" }])
  })

  it("does not warn about a kind that is already blocking the driver", () => {
    // Already missing is a hard stop. Telling the driver it also expires soon is
    // noise stacked on top of a wall.
    const gate = credentialGateFor([credential("insurance", { expiresOn: instantAfter(-1) })], AT)

    expect(gate.missing).toContain("insurance")
    expect(gate.expiring).toEqual([])
  })

  it("stops warning once a renewal on file carries the kind past the window", () => {
    // The reason `expiring` is computed per KIND: the driver replaced the
    // certificate, so they are not about to be blocked, so they must not be told
    // they are. A per-credential warning would nag about a record already replaced.
    const nearlyDue = credential("insurance", { expiresOn: instantAfter(3) })
    const vault = completeVault().map((entry) => (entry.kind === "insurance" ? nearlyDue : entry))

    expect(credentialGateFor(vault, AT).expiring).toEqual([
      { expiresOn: nearlyDue.expiresOn as string, kind: "insurance" }
    ])

    const renewed = [...vault, credential("insurance", { expiresOn: instantAfter(400) })]

    expect(credentialGateFor(renewed, AT).expiring).toEqual([])

    const renewedForever = [...vault, credential("insurance")]

    expect(credentialGateFor(renewedForever, AT).expiring).toEqual([])
  })

  it("reports missing kinds in schema order regardless of vault order", () => {
    const shuffled = [credential("trailer"), credential("cdl")]

    expect(credentialGateFor(shuffled, AT).missing).toEqual(["insurance", "truck"])
  })
})

describe("what a host receives", () => {
  it("hands over the equipment photo and withholds the identity document, for every kind", () => {
    // Driven by the schema's option list: a kind added later is covered by this
    // test the moment it exists, so a new document type cannot quietly bypass it.
    for (const kind of credentialKindSchema.options) {
      const visible = hostVisibleCredential(credential(kind, { expiresOn: instantAfter(10) }))
      const shared = kind === "truck" || kind === "trailer"

      expect(visible.photo, kind).toEqual(shared ? DOCUMENT : null)
      expect(visible.kind).toBe(kind)
      expect(visible.status).toBe("approved")
      expect(visible.expiresOn).toBe(instantAfter(10))
    }
  })

  it("never leaks the CDL or insurance image, whatever the credential's status", () => {
    for (const kind of ["cdl", "insurance"] as const) {
      for (const status of credentialStatusSchema.options) {
        expect(hostVisibleCredential(credential(kind, { status })).photo, `${kind}/${status}`).toBeNull()
      }
    }
  })

  it("withholds the image for a kind nobody has ruled on", () => {
    // Data that arrived from storage can carry a kind this build does not know.
    // The lookup fails closed rather than sharing an unclassified document.
    const rogue = { ...credential("truck"), kind: "passport" as unknown as CredentialKind }

    expect(hostVisibleCredential(rogue).photo).toBeNull()
  })

  it("carries exactly four fields, so nothing else can ride along", () => {
    // The structural guarantee. The returned object is built field by field, so a
    // field added to the stored credential row later cannot reach a host through
    // this function by default.
    const leaky = {
      ...credential("truck"),
      driverProfileId: "44444444-4444-4444-8444-444444444441",
      identifier: "CM-4471-002",
      reviewNotes: "Approved.",
      supersededByCredentialId: null
    }

    const visible = hostVisibleCredential(leaky)

    expect(Object.keys(visible).sort()).toEqual(["expiresOn", "kind", "photo", "status"])
    expect(JSON.stringify(visible)).not.toContain("CM-4471-002")
  })

  it("derives the shareable-kind list from the same decision the function uses", () => {
    for (const kind of credentialKindSchema.options) {
      const shares = hostVisibleCredential(credential(kind)).photo !== null

      expect(HOST_VISIBLE_CREDENTIAL_PHOTO_KINDS.includes(kind), kind).toBe(shares)
    }

    expect([...HOST_VISIBLE_CREDENTIAL_PHOTO_KINDS]).toEqual(["truck", "trailer"])
  })

  it("claims a document was checked, never that a driver is legally cleared", () => {
    // LogLoads is orchestration. The one sentence a host-facing surface may use
    // must not assert legal standing, and "verified" is the word that would.
    expect(CREDENTIAL_ASSURANCE_STATEMENT).not.toMatch(/verif/i)
    expect(CREDENTIAL_ASSURANCE_STATEMENT).toMatch(/does not certify/i)
    expect(CREDENTIAL_ASSURANCE_STATEMENT).toMatch(/submitted/i)
  })
})

describe("who may decide", () => {
  it("offers every status except pending as a decision", () => {
    expect([...credentialReviewDecisionSchema.options]).toEqual([
      "approved",
      "denied",
      "more_info_required"
    ])
    expect(credentialReviewDecisionSchema.safeParse("pending").success).toBe(false)
  })

  it("treats the machine as a first-class decider", () => {
    expect([...credentialReviewerSchema.options]).toEqual(["ai", "platform_admin"])
  })
})

// ── The stored rows ───────────────────────────────────────────────────────────

const STORED_DOCUMENT = {
  provider: "supabase" as const,
  publicId: "logloads/driver-credentials/test/uploads/one",
  version: 1,
  format: "jpg" as const,
  width: 1_240,
  height: 1_754,
  bytes: 100_000,
  uploadedAt: "2026-06-01T09:00:00.000Z"
}

const LEGACY_CLOUDINARY_DOCUMENT = {
  ...STORED_DOCUMENT,
  provider: "cloudinary" as const,
  publicId: "logloads/legacy/driver-credentials/test/uploads/one"
}

function storedCredential(overrides: Record<string, unknown> = {}) {
  return {
    id: "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c101",
    driverProfileId: "44444444-4444-4444-8444-444444444441",
    kind: "insurance" as CredentialKind,
    status: "approved" as CredentialStatus,
    documentMedia: STORED_DOCUMENT,
    issuer: "Cascade Mutual Insurance",
    identifier: "CM-4471-002",
    issuedOn: "2025-07-01T00:00:00.000Z",
    expiresOn: "2027-06-30T23:59:59.000Z",
    submittedAt: "2026-06-01T09:00:00.000Z",
    reviewedAt: "2026-06-01T09:04:00.000Z",
    reviewNotes: "Approved.",
    requestedEvidence: [] as string[],
    supersededByCredentialId: null,
    createdAt: "2026-06-01T09:00:00.000Z",
    updatedAt: "2026-06-01T09:04:00.000Z",
    ...overrides
  }
}

function storedReview(overrides: Record<string, unknown> = {}) {
  return {
    id: "c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c201",
    credentialId: "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c101",
    driverProfileId: "44444444-4444-4444-8444-444444444441",
    decision: "approved",
    decidedBy: "ai",
    model: "seed-synthetic-reviewer",
    confidence: null,
    findings: ["kind_matches_document"],
    rationale: "The certificate names the driver and has not expired.",
    requestedEvidence: [] as string[],
    extracted: { detectedKind: "insurance", issuer: "Cascade Mutual Insurance" },
    decidedAt: "2026-06-01T09:04:00.000Z",
    createdAt: "2026-06-01T09:04:00.000Z",
    updatedAt: "2026-06-01T09:04:00.000Z",
    ...overrides
  }
}

describe("the stored credential row", () => {
  it("accepts a complete approved credential", () => {
    expect(driverCredentialSchema.safeParse(storedCredential()).success).toBe(true)
  })

  it("keeps a legacy Cloudinary document readable as stored metadata", () => {
    const parsed = driverCredentialSchema.parse(
      storedCredential({ documentMedia: LEGACY_CLOUDINARY_DOCUMENT })
    )

    expect(parsed.documentMedia?.provider).toBe("cloudinary")
    expect(parsed.documentMedia?.publicId).toBe(LEGACY_CLOUDINARY_DOCUMENT.publicId)
  })

  it("reads an absent nullable field as null rather than undefined", () => {
    const { expiresOn, issuedOn, ...withoutDates } = storedCredential()
    const parsed = driverCredentialSchema.parse(withoutDates)

    expect([expiresOn, issuedOn].every(Boolean)).toBe(true)
    expect(parsed.expiresOn).toBeNull()
    expect(parsed.issuedOn).toBeNull()
  })

  it("refuses to store an approval with no document", () => {
    // Enforced in two places on purpose: the gate refuses to count one, and
    // storage refuses to hold one. This half stops the row from existing to be
    // misread by anything that forgot to ask the gate.
    expect(driverCredentialSchema.safeParse(storedCredential({ documentMedia: null })).success).toBe(false)
  })

  it("refuses a decision that does not say when it was made", () => {
    expect(driverCredentialSchema.safeParse(storedCredential({ reviewedAt: null })).success).toBe(false)
  })

  it("refuses a pending credential that claims a review time", () => {
    expect(
      driverCredentialSchema.safeParse(
        storedCredential({ reviewNotes: null, reviewedAt: "2026-06-01T09:04:00.000Z", status: "pending" })
      ).success
    ).toBe(false)
    expect(
      driverCredentialSchema.safeParse(
        storedCredential({ reviewNotes: null, reviewedAt: null, status: "pending" })
      ).success
    ).toBe(true)
  })

  it("refuses a request for more evidence that does not say what evidence", () => {
    expect(
      driverCredentialSchema.safeParse(storedCredential({ status: "more_info_required" })).success
    ).toBe(false)
    expect(
      driverCredentialSchema.safeParse(
        storedCredential({ requestedEvidence: ["The page showing the expiry date"], status: "more_info_required" })
      ).success
    ).toBe(true)
  })

  it("refuses an approval that still has something outstanding", () => {
    expect(
      driverCredentialSchema.safeParse(storedCredential({ requestedEvidence: ["Anything"] })).success
    ).toBe(false)
  })

  it("refuses a credential that lapses before it was issued", () => {
    expect(
      driverCredentialSchema.safeParse(
        storedCredential({ expiresOn: "2025-06-30T00:00:00.000Z", issuedOn: "2025-07-01T00:00:00.000Z" })
      ).success
    ).toBe(false)
  })

  it("refuses a credential that supersedes itself", () => {
    const row = storedCredential()

    expect(
      driverCredentialSchema.safeParse({ ...row, supersededByCredentialId: row.id }).success
    ).toBe(false)
  })
})

describe("the stored review row", () => {
  it("accepts a complete AI decision", () => {
    expect(credentialReviewSchema.safeParse(storedReview()).success).toBe(true)
  })

  it("refuses an AI decision that cannot name the model that made it", () => {
    expect(credentialReviewSchema.safeParse(storedReview({ model: null })).success).toBe(false)
  })

  it("refuses a human decision dressed up as a machine one", () => {
    expect(
      credentialReviewSchema.safeParse(storedReview({ decidedBy: "platform_admin" })).success
    ).toBe(false)
    expect(
      credentialReviewSchema.safeParse(
        storedReview({ confidence: null, decidedBy: "platform_admin", model: null })
      ).success
    ).toBe(true)
    expect(
      credentialReviewSchema.safeParse(
        storedReview({ confidence: 0.9, decidedBy: "platform_admin", model: null })
      ).success
    ).toBe(false)
  })

  it("refuses a rewritten review, because a changed decision is a new row", () => {
    // The append-only rule, at the storage boundary. Restating a decision in place
    // is what makes "why was I refused in January" unanswerable in June.
    expect(
      credentialReviewSchema.safeParse(storedReview({ updatedAt: "2026-06-02T09:04:00.000Z" })).success
    ).toBe(false)
    // The same instant spelled differently is still the same instant.
    expect(
      credentialReviewSchema.safeParse(storedReview({ updatedAt: "2026-06-01T09:04:00Z" })).success
    ).toBe(true)
  })

  it("refuses a decision the status set does not contain", () => {
    expect(credentialReviewSchema.safeParse(storedReview({ decision: "pending" })).success).toBe(false)
  })

  it("requires a plain-language reason, because the driver reads it", () => {
    expect(credentialReviewSchema.safeParse(storedReview({ rationale: "   " })).success).toBe(false)
  })

  it("keeps what was read off the page as printed, and defaults the rest to null", () => {
    const parsed = credentialReviewSchema.parse(
      storedReview({ extracted: { expiresOn: "06/30/2027" } })
    )

    expect(parsed.extracted.expiresOn).toBe("06/30/2027")
    expect(parsed.extracted.holderName).toBeNull()
    expect(parsed.extracted.detectedKind).toBeNull()
  })
})
