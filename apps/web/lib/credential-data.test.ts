import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import {
  CREDENTIAL_ASSURANCE_STATEMENT,
  CREDENTIAL_EXPIRY_WARNING_DAYS,
  credentialGateFor,
  credentialKindSchema,
  driverCredentialSchema,
  HOST_VISIBLE_CREDENTIAL_PHOTO_KINDS,
  MANDATORY_CREDENTIAL_KINDS,
  type CredentialKind,
  type CredentialStatus,
  type DriverCredential
} from "@logloads/contracts"
import { createInMemoryDatabase } from "@logloads/db"
import { hostCredentialSummary } from "@logloads/services"

import {
  buildDriverCredentialVaultView,
  buildHostDriverCredentialSummary,
  credentialIntakeFor,
  CREDENTIAL_PRESENTATION_COVERAGE,
  type CredentialVaultView,
  type CredentialViewOptions,
  type HostDriverCredentialSummaryView
} from "./credential-data"

/**
 * The read model is tested against KNOWN vaults, never against the seeded bench.
 *
 * The bench deliberately clears exactly one driver, so a test that read it could
 * only ever assert what one fixture happens to say today. Every fixture below is
 * parsed through `driverCredentialSchema` first, so a row that could not survive a
 * read of the operating state cannot be used to prove anything about what a driver
 * or a host is shown.
 *
 * These are negative controls, not a tour of the happy path. The failures that
 * matter here are: a driver being blocked without being told; a chip reading
 * "Approved" over a record that does not let them work; an upload control that
 * pretends; and a licence or policy number reaching a host.
 */

const DRIVER = "44444444-4444-4444-8444-444444444441"
const OTHER_DRIVER = "44444444-4444-4444-8444-444444444442"

/** Mid-month and mid-day, so no boundary lands on the instant under test. */
const NOW = "2026-07-15T12:00:00.000Z"
const SUBMITTED = "2026-06-01T09:00:00.000Z"
const REVIEWED = "2026-06-01T09:04:00.000Z"

/** Media is OFF in this product today, so it is the default every test starts from. */
const OPTIONS: CredentialViewOptions = { at: NOW, mediaReady: false }

function daysFromNow(days: number): string {
  return new Date(Date.parse(NOW) + days * 86_400_000).toISOString()
}

let idCounter = 0

/** Deterministic v4-shaped ids, so a fixture's identity never depends on run order. */
function nextId(): string {
  idCounter += 1

  return `c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1${String(idCounter).padStart(4, "0")}`
}

function document(slug: string) {
  return {
    bytes: 486_000,
    format: "jpg" as const,
    height: 1_754,
    provider: "cloudinary" as const,
    publicId: `logloads/driver-credentials/${slug}`,
    uploadedAt: SUBMITTED,
    version: 1,
    width: 1_240
  }
}

interface CredentialFixture {
  documentMedia?: ReturnType<typeof document> | null
  driverProfileId?: string
  expiresOn?: string | null
  id?: string
  identifier?: string | null
  kind: CredentialKind
  requestedEvidence?: string[]
  reviewNotes?: string | null
  status: CredentialStatus
  submittedAt?: string
}

function credential(fixture: CredentialFixture): DriverCredential {
  const submittedAt = fixture.submittedAt ?? SUBMITTED
  const decided = fixture.status !== "pending"

  return driverCredentialSchema.parse({
    createdAt: submittedAt,
    documentMedia: fixture.documentMedia === undefined ? document(fixture.kind) : fixture.documentMedia,
    driverProfileId: fixture.driverProfileId ?? DRIVER,
    expiresOn: fixture.expiresOn ?? null,
    id: fixture.id ?? nextId(),
    identifier: fixture.identifier ?? null,
    issuedOn: null,
    kind: fixture.kind,
    requestedEvidence: fixture.requestedEvidence ?? [],
    reviewNotes: fixture.reviewNotes ?? null,
    // A decision must record when it was made, and a pending record must not
    // carry one. Both are row-contract rules, so the fixture obeys them.
    reviewedAt: decided ? REVIEWED : null,
    status: fixture.status,
    submittedAt,
    supersededByCredentialId: null,
    updatedAt: decided ? REVIEWED : submittedAt
  })
}

/** Every mandatory record approved, in date, and with bytes stored. */
function clearedVault(driverProfileId = DRIVER): DriverCredential[] {
  return MANDATORY_CREDENTIAL_KINDS.map((kind) =>
    credential({
      driverProfileId,
      expiresOn: kind === "truck" || kind === "trailer" ? null : daysFromNow(400),
      kind,
      status: "approved"
    })
  )
}

function vaultFor(
  credentials: readonly DriverCredential[],
  options: Partial<CredentialViewOptions> = {}
): CredentialVaultView {
  return buildDriverCredentialVaultView({ driverCredentials: credentials }, DRIVER, {
    ...OPTIONS,
    ...options
  })
}

/**
 * The host view is built on the SERVICE's projection, so the test drives the real
 * one. `hostCredentialSummary` is what the acceptance path uses, and running it here
 * means the disclosure assertions below cover the whole chain — rows, projection,
 * presentation — rather than a hand-built summary that could differ from it.
 *
 * The seeded bench supplies the driver rows the service needs (it looks a driver up
 * before it will project anything); the credential collection is replaced outright, so
 * no fixture depends on what the bench happens to have filed.
 */
function summaryFor(
  credentials: readonly DriverCredential[],
  options: { mediaReady?: boolean; at?: string } = {}
): HostDriverCredentialSummaryView {
  const state = createInMemoryDatabase()

  state.driverCredentials = [...credentials]

  return buildHostDriverCredentialSummary(
    hostCredentialSummary(state, DRIVER, options.at ?? NOW),
    { mediaReady: options.mediaReady ?? false }
  )
}

function slot(vault: CredentialVaultView, kind: CredentialKind) {
  const found = vault.slots.find((entry) => entry.kind === kind)

  if (!found) {
    throw new Error(`no slot for ${kind}`)
  }

  return found
}

function hostLine(summary: HostDriverCredentialSummaryView, kind: CredentialKind) {
  const found = summary.lines.find((entry) => entry.kind === kind)

  if (!found) {
    throw new Error(`no host line for ${kind}`)
  }

  return found
}

describe("the gate-satisfied vault", () => {
  it("clears the driver and says so, with nothing outstanding", () => {
    const vault = vaultFor(clearedVault())

    expect(vault.satisfied).toBe(true)
    expect(vault.blockedNotice).toBeNull()
    expect(vault.noActionAvailableNotice).toBeNull()
    expect(vault.outstanding).toEqual([])
    expect(vault.satisfiedCount).toBe(MANDATORY_CREDENTIAL_KINDS.length)
    expect(vault.headline).toContain("cleared to accept loads")
    expect(vault.slots.every((entry) => entry.blocksWork)).toBe(false)
  })

  it("lists every mandatory record, in the schema's own order", () => {
    const vault = vaultFor([])

    expect(vault.slots.map((entry) => entry.kind)).toEqual([...MANDATORY_CREDENTIAL_KINDS])
    expect(vault.requiredCount).toBe(MANDATORY_CREDENTIAL_KINDS.length)
  })
})

describe("the blocked vault", () => {
  it("states plainly that loads cannot be accepted, and names what is outstanding", () => {
    const vault = vaultFor([])

    expect(vault.satisfied).toBe(false)
    expect(vault.headline).toBe("You can't accept loads yet.")
    // The single worst failure this feature can have is a driver inferring the
    // block from an empty load board. The notice has to exist and has to name
    // every outstanding record.
    expect(vault.blockedNotice).not.toBeNull()
    expect(vault.blockedNotice).toContain("cannot accept loads")

    for (const kind of MANDATORY_CREDENTIAL_KINDS) {
      expect(vault.blockedNotice).toContain(slot(vault, kind).kindLabel)
    }

    expect(vault.outstanding).toHaveLength(MANDATORY_CREDENTIAL_KINDS.length)
    expect(vault.satisfiedCount).toBe(0)
  })

  it("tells a driver who cannot do anything yet that nothing is being asked of them", () => {
    // Blocked, no upload, and nothing decided to appeal: this is what every seeded
    // driver but one is in today, and silence here would read as a broken screen.
    const vault = vaultFor([])

    expect(vault.noActionAvailableNotice).not.toBeNull()
    expect(vault.noActionAvailableNotice).toContain("nobody is waiting on you")
  })

  it("drops that notice as soon as there is something to act on", () => {
    const vault = vaultFor([
      credential({
        kind: "insurance",
        requestedEvidence: ["A photo of the page that shows the policy expiry date"],
        reviewNotes: "We can read your insurer but not the expiry date.",
        status: "more_info_required"
      })
    ])

    expect(vault.noActionAvailableNotice).toBeNull()
  })

  it("blocks exactly the kinds the contract's gate reports missing", () => {
    // THE invariant: the checklist's blocking flags and the acceptance gate's
    // missing list are the same claim. If they ever diverge, a driver is being
    // told something the guard will contradict.
    const credentials = [
      credential({ expiresOn: daysFromNow(-2), kind: "insurance", status: "approved" }),
      credential({ kind: "cdl", expiresOn: daysFromNow(300), status: "approved" }),
      credential({ kind: "truck", status: "pending" })
    ]
    const vault = vaultFor(credentials)

    expect(vault.slots.filter((entry) => entry.blocksWork).map((entry) => entry.kind)).toEqual(
      credentialGateFor(credentials, NOW).missing
    )
  })

  it("does not let another driver's cleared vault satisfy this driver", () => {
    const vault = vaultFor(clearedVault(OTHER_DRIVER))

    expect(vault.satisfied).toBe(false)
    expect(vault.outstanding).toHaveLength(MANDATORY_CREDENTIAL_KINDS.length)
  })
})

describe("a record that reads approved but does not count", () => {
  it("refuses an expired approval and does not label it Approved", () => {
    const vault = vaultFor([
      ...clearedVault().filter((entry) => entry.kind !== "insurance"),
      credential({ expiresOn: daysFromNow(-1), kind: "insurance", status: "approved" })
    ])
    const insurance = slot(vault, "insurance")

    expect(vault.satisfied).toBe(false)
    expect(insurance.state).toBe("expired")
    expect(insurance.stateLabel).toBe("Expired")
    expect(insurance.stateLabel).not.toBe("Approved")
    expect(insurance.blocksWork).toBe(true)
    expect(insurance.detail).toContain("stops counting the day it lapses")
  })

  it("refuses an approval with no stored document", () => {
    // The row contract already refuses this shape at the storage boundary, which
    // is why the fixture is assembled after parsing. This asserts the SURFACE fails
    // closed too: a self-certified approval must never read as clearance, whatever
    // path built the row.
    const approved = credential({ expiresOn: daysFromNow(300), kind: "insurance", status: "approved" })
    const documentless: DriverCredential = { ...approved, documentMedia: null }
    const vault = vaultFor([...clearedVault().filter((entry) => entry.kind !== "insurance"), documentless])

    expect(vault.satisfied).toBe(false)
    expect(slot(vault, "insurance").state).toBe("document_missing")
    expect(slot(vault, "insurance").stateLabel).toBe("Document not stored")
    expect(slot(vault, "insurance").detail).toContain("counts for nothing")
  })

  it("treats an unreadable expiry as lapsed, renders without throwing, and invents no date", () => {
    // The permissive reading would turn a corrupt date into a record that never
    // lapses. The careless reading throws inside the date formatter and takes the
    // whole page down — for the one driver who most needs to read it.
    const insurance = credential({ expiresOn: daysFromNow(300), kind: "insurance", status: "approved" })
    const corrupt: DriverCredential = { ...insurance, expiresOn: "not-a-date" }
    const vault = vaultFor([...clearedVault().filter((entry) => entry.kind !== "insurance"), corrupt])
    const line = slot(vault, "insurance")

    expect(vault.satisfied).toBe(false)
    expect(line.blocksWork).toBe(true)
    expect(line.expiresOnLabel).toBeNull()
    expect(line.lapsedOnLabel).toBeNull()
    expect(line.detail).toContain("a date we cannot read")
    expect(line.detail).not.toContain("Invalid Date")
  })
})

describe("expiry warnings", () => {
  it("warns inside the window without blocking the driver", () => {
    const vault = vaultFor([
      ...clearedVault().filter((entry) => entry.kind !== "insurance"),
      credential({ expiresOn: daysFromNow(12), kind: "insurance", status: "approved" })
    ])
    const insurance = slot(vault, "insurance")

    expect(vault.satisfied).toBe(true)
    expect(insurance.expiringSoon).toBe(true)
    expect(insurance.blocksWork).toBe(false)
    expect(insurance.stateLabel).toBe("Expires soon")
    expect(insurance.detail).toContain("in 12 days")
    expect(vault.expiryNotice).toContain(insurance.kindLabel)
    expect(vault.expiryNotice).toContain(String(CREDENTIAL_EXPIRY_WARNING_DAYS))
  })

  it("warns on the last day of the window and stays quiet one day beyond it", () => {
    const inside = vaultFor([
      ...clearedVault().filter((entry) => entry.kind !== "cdl"),
      credential({ expiresOn: daysFromNow(CREDENTIAL_EXPIRY_WARNING_DAYS), kind: "cdl", status: "approved" })
    ])
    const outside = vaultFor([
      ...clearedVault().filter((entry) => entry.kind !== "cdl"),
      credential({
        expiresOn: daysFromNow(CREDENTIAL_EXPIRY_WARNING_DAYS + 1),
        kind: "cdl",
        status: "approved"
      })
    ])

    expect(slot(inside, "cdl").expiringSoon).toBe(true)
    expect(slot(outside, "cdl").expiringSoon).toBe(false)
    expect(outside.expiryNotice).toBeNull()
  })

  it("does not nag about a certificate a renewal already replaced", () => {
    // Warnings are per KIND, on the furthest expiry the driver holds. A
    // per-credential warning would keep chasing a certificate they already
    // renewed, and a warning that cries wolf is one drivers learn to ignore.
    const vault = vaultFor([
      ...clearedVault().filter((entry) => entry.kind !== "insurance"),
      credential({ expiresOn: daysFromNow(9), kind: "insurance", status: "approved" }),
      credential({ expiresOn: daysFromNow(380), kind: "insurance", status: "approved" })
    ])
    const insurance = slot(vault, "insurance")

    expect(insurance.expiringSoon).toBe(false)
    expect(insurance.stateLabel).toBe("Approved")
    expect(insurance.expiresOnLabel).toBe("Jul 30, 2027")
    expect(vault.expiryNotice).toBeNull()
  })

  it("counts a renewal already on file as cover, even under a lapsed record", () => {
    const vault = vaultFor([
      ...clearedVault().filter((entry) => entry.kind !== "insurance"),
      credential({ expiresOn: daysFromNow(-30), kind: "insurance", status: "approved" }),
      credential({ expiresOn: daysFromNow(300), kind: "insurance", status: "approved" })
    ])

    expect(vault.satisfied).toBe(true)
    expect(slot(vault, "insurance").blocksWork).toBe(false)
    // The lapse is history once cover exists, and history is not what a working
    // driver needs read back to them.
    expect(slot(vault, "insurance").lapsedOnLabel).toBeNull()
  })
})

describe("what a refused driver is told", () => {
  it("names the evidence to send and offers another look on the exact record", () => {
    const asked = credential({
      kind: "insurance",
      requestedEvidence: [
        "A photo of the page that shows the policy expiry date",
        "The full page, with all four corners in frame"
      ],
      reviewNotes: "We can read your insurer's name but not the expiry date.",
      status: "more_info_required"
    })
    const insurance = slot(vaultFor([asked]), "insurance")

    expect(insurance.stateLabel).toBe("More needed")
    expect(insurance.requestedEvidence).toHaveLength(2)
    expect(insurance.reviewNote).toBe("We can read your insurer's name but not the expiry date.")
    expect(insurance.canRequestReview).toBe(true)
    expect(insurance.reviewCredentialId).toBe(asked.id)
    // While no photo can be added, saying "ask again" without this caveat would
    // send a driver round a loop that cannot resolve.
    expect(insurance.reviewLimitation).toContain("does not add a photo")
  })

  it("drops that caveat once private credential intake is available", () => {
    const asked = credential({
      kind: "insurance",
      requestedEvidence: ["A photo of the expiry date"],
      status: "more_info_required"
    })

    expect(slot(vaultFor([asked], { mediaReady: true }), "insurance").reviewLimitation).toBeNull()
  })

  it("admits when a refusal carried no reason instead of inventing one", () => {
    const cdl = slot(vaultFor([credential({ kind: "cdl", reviewNotes: null, status: "denied" })]), "cdl")

    expect(cdl.stateLabel).toBe("Not approved")
    expect(cdl.reviewNote).toBeNull()
    expect(cdl.detail).toContain("no reason was recorded")
  })

  it("explains a lapse sitting behind a renewal that is still being checked", () => {
    const vault = vaultFor([
      credential({ expiresOn: "2026-01-31T23:59:59.000Z", kind: "insurance", status: "approved" }),
      credential({ kind: "insurance", status: "pending", submittedAt: "2026-06-02T15:20:00.000Z" })
    ])
    const insurance = slot(vault, "insurance")

    expect(insurance.state).toBe("in_review")
    expect(insurance.blocksWork).toBe(true)
    expect(insurance.detail).toContain("Jan 31, 2026")
    expect(insurance.detail).toContain("Nobody has decided yet")
    expect(insurance.lapsedOnLabel).toBe("Jan 31, 2026")
    // Nothing to appeal: it is already in the queue.
    expect(insurance.canRequestReview).toBe(false)
  })

  it("has a blocking presentation for every status the schema allows", () => {
    // A runtime proof that nothing falls through to a friendly default. The
    // compiler checks the Record; it cannot check a union widened elsewhere.
    for (const status of CREDENTIAL_PRESENTATION_COVERAGE.statuses) {
      if (status === "approved") {
        continue
      }

      const vault = vaultFor([
        credential({
          kind: "cdl",
          requestedEvidence: status === "more_info_required" ? ["Another photo"] : [],
          status
        })
      ])
      const cdl = slot(vault, "cdl")

      expect(cdl.blocksWork).toBe(true)
      expect(cdl.stateLabel.length).toBeGreaterThan(0)
      expect(cdl.detail.length).toBeGreaterThan(0)
    }
  })

  it("covers every kind the schema allows with a requirement a driver can act on", () => {
    const vault = vaultFor([])

    expect(vault.slots.map((entry) => entry.kind).sort()).toEqual(
      [...CREDENTIAL_PRESENTATION_COVERAGE.kinds].sort()
    )

    for (const entry of vault.slots) {
      expect(entry.requirement.length).toBeGreaterThan(0)
      expect(entry.kindLabel.length).toBeGreaterThan(0)
      expect(entry.detail).toContain(entry.requirement)
    }
  })
})

describe("document intake", () => {
  it("refuses and explains, rather than showing a control that pretends", () => {
    const intake = credentialIntakeFor(false)

    expect(intake.available).toBe(false)
    expect(intake.signatureEndpoint).toBeNull()
    expect(intake.notice).not.toBeNull()
    expect(intake.notice).toContain("temporarily unavailable")
  })

  it("activates the real credential route once dedicated media is configured", () => {
    const intake = credentialIntakeFor(true)

    expect(intake.available).toBe(true)
    expect(intake.signatureEndpoint).toBe("/api/credentials/signature")
    expect(intake.notice).toBeNull()
  })

  it("carries readiness and refusal into the vault a driver actually reads", () => {
    expect(vaultFor(clearedVault(), { mediaReady: true }).intake.available).toBe(true)
    expect(vaultFor(clearedVault()).intake.notice).not.toBeNull()
  })
})

describe("what the driver is told a host will see", () => {
  it("names the shared photos and the withheld documents from the contract's own list", () => {
    const disclosure = vaultFor(clearedVault()).hostDisclosure

    for (const kind of HOST_VISIBLE_CREDENTIAL_PHOTO_KINDS) {
      expect(disclosure).toContain(kind === "truck" ? "truck photo" : "trailer photo")
    }

    expect(disclosure).toContain("commercial driver's licence")
    expect(disclosure).toContain("insurance certificate")
    expect(disclosure).toContain("stays in this vault")
  })

  it("marks only the equipment records as host-visible", () => {
    const vault = vaultFor(clearedVault())

    expect(vault.slots.filter((entry) => entry.hostSeesPhoto).map((entry) => entry.kind)).toEqual([
      ...HOST_VISIBLE_CREDENTIAL_PHOTO_KINDS
    ])
    expect(slot(vault, "cdl").hostSeesPhoto).toBe(false)
    expect(slot(vault, "insurance").hostSeesPhoto).toBe(false)
  })
})

describe("the summary a host receives", () => {
  const POLICY_NUMBER = "CM-4471-002"
  const REVIEW_NOTE = "Approved. The licence class and the expiry date both read clearly."

  function sensitiveVault(): DriverCredential[] {
    return MANDATORY_CREDENTIAL_KINDS.map((kind) =>
      credential({
        expiresOn: kind === "truck" || kind === "trailer" ? null : daysFromNow(400),
        identifier: POLICY_NUMBER,
        kind,
        reviewNotes: REVIEW_NOTE,
        status: "approved"
      })
    )
  }

  it("carries no CDL or insurance image, no policy number and no review note", () => {
    const serialized = JSON.stringify(summaryFor(sensitiveVault()))

    // The whole response, scanned. A field added to the stored row must not be
    // able to appear here by being spread through some new code path.
    expect(serialized).not.toContain(POLICY_NUMBER)
    expect(serialized).not.toContain(REVIEW_NOTE)
    expect(serialized).not.toContain("logloads/driver-credentials")
    expect(serialized).not.toContain("publicId")
  })

  it("reports a photo on file for equipment only, and never for identity documents", () => {
    const summary = summaryFor(sensitiveVault())

    expect(summary.lines.filter((line) => line.photoOnFile).map((line) => line.kind)).toEqual([
      ...HOST_VISIBLE_CREDENTIAL_PHOTO_KINDS
    ])
    // Both identity documents ARE stored in this fixture. The host is told nothing
    // about them beyond status and expiry.
    expect(hostLine(summary, "cdl").photoOnFile).toBe(false)
    expect(hostLine(summary, "insurance").photoOnFile).toBe(false)
  })

  it("says the equipment photos cannot be shown while media is off, and links nothing", () => {
    const summary = summaryFor(sensitiveVault())

    expect(hostLine(summary, "truck").photoOnFile).toBe(true)
    expect(hostLine(summary, "truck").photoSrc).toBeNull()
    expect(summary.photoNotice).not.toBeNull()
    expect(summary.photoNotice).toContain("cannot be displayed yet")
  })

  it("still links nothing when media alone is configured", () => {
    // The same negative control as intake, on the delivery side: no host-facing
    // photo route exists. If a src appears on media configuration alone, the host
    // surface will render a broken image — or, worse, `/api/media/asset`, which
    // would hand the host a picture of their own truck.
    const summary = summaryFor(sensitiveVault(), { mediaReady: true })

    expect(hostLine(summary, "truck").photoSrc).toBeNull()
    expect(hostLine(summary, "cdl").photoSrc).toBeNull()
    expect(summary.photoNotice).not.toBeNull()
  })

  it("claims only what LogLoads did, in the contract's own words", () => {
    const summary = summaryFor(clearedVault())

    expect(summary.complete).toBe(true)
    expect(summary.assurance).toBe(CREDENTIAL_ASSURANCE_STATEMENT)
    expect(summary.headline).toContain("checked for consistency and expiry")

    // Nothing LogLoads generates may claim it verified a person, certified them, or
    // stands behind their legal standing. The assurance statement is excluded
    // because it is the contract's own sentence, and it says the opposite.
    const generated = [
      summary.headline,
      summary.withheldNote,
      summary.attentionNotice ?? "",
      summary.photoNotice ?? "",
      ...summary.lines.map((line) => `${line.stateLabel} ${line.note ?? ""}`)
    ].join(" ")

    expect(generated).not.toMatch(/\bverif/i)
    expect(generated).not.toMatch(/guarantee/i)
    expect(generated).not.toMatch(/\bcertifie[sd]\b/i)
    expect(generated).not.toMatch(/legal(ly)? (right|entitled)/i)
  })

  it("tells the host a lapsed record is not current, and nothing about its history", () => {
    const summary = summaryFor([
      ...clearedVault().filter((entry) => entry.kind !== "insurance"),
      credential({
        expiresOn: "2026-01-31T23:59:59.000Z",
        kind: "insurance",
        reviewNotes: REVIEW_NOTE,
        status: "approved"
      })
    ])
    const insurance = hostLine(summary, "insurance")

    expect(summary.complete).toBe(false)
    expect(summary.attentionNotice).toContain(insurance.kindLabel)
    expect(insurance.current).toBe(false)
    expect(insurance.state).toBe("not_current")
    expect(insurance.note).toBe("LogLoads has no current approved record for this.")
    expect(insurance.note).not.toContain(REVIEW_NOTE)
  })

  it("does not tell the host which kind of refusal a record met", () => {
    // A host is entitled to status and expiry. Whether the driver submitted nothing,
    // is waiting on a decision, was asked for a clearer photo, or was refused are the
    // same fact to a host — this record is not clearing the driver — and the
    // difference is the driver's business.
    const refusals: DriverCredential[][] = [
      [],
      [credential({ kind: "insurance", status: "pending" })],
      [
        credential({
          kind: "insurance",
          requestedEvidence: ["A photo showing the expiry date"],
          reviewNotes: REVIEW_NOTE,
          status: "more_info_required"
        })
      ],
      [credential({ kind: "insurance", reviewNotes: REVIEW_NOTE, status: "denied" })]
    ]

    for (const rows of refusals) {
      const line = hostLine(summaryFor(rows), "insurance")

      expect(line.state).toBe("not_current")
      expect(line.stateLabel).toBe("Not current")
      expect(line.note).toBe("LogLoads has no current approved record for this.")
      expect(line.photoOnFile).toBe(false)
      expect(line.expiresOnLabel).toBeNull()
    }
  })

  it("names the withheld documents so a host is not left guessing what was hidden", () => {
    const summary = summaryFor(clearedVault())

    expect(summary.withheldNote).toContain("commercial driver's licence")
    expect(summary.withheldNote).toContain("insurance certificate")
    expect(summary.withheldNote).toContain("personal identifiers")
  })

  it("agrees with the driver's vault about who is cleared, kind for kind", () => {
    // The two surfaces say different amounts, deliberately, but they must never
    // disagree about the fact underneath: if these diverge, one of the two screens is
    // wrong about a safety record and neither of them knows which.
    const credentials = [
      credential({ expiresOn: daysFromNow(-2), kind: "insurance", status: "approved" }),
      credential({ expiresOn: daysFromNow(300), kind: "cdl", status: "approved" }),
      credential({ kind: "truck", status: "pending" }),
      credential({ kind: "trailer", status: "approved" })
    ]
    const vault = vaultFor(credentials)
    const summary = summaryFor(credentials)

    for (const kind of MANDATORY_CREDENTIAL_KINDS) {
      expect(hostLine(summary, kind).current).toBe(!slot(vault, kind).blocksWork)
    }

    expect(summary.complete).toBe(vault.satisfied)
  })

  it("shows nothing current for a driver whose vault is somebody else's", () => {
    const summary = summaryFor(clearedVault(OTHER_DRIVER))

    expect(summary.complete).toBe(false)
    expect(summary.lines.every((line) => line.state === "not_current")).toBe(true)
    expect(summary.lines.every((line) => !line.photoOnFile)).toBe(true)
  })
})

describe("presentation coverage", () => {
  it("covers exactly the kinds and statuses the schemas declare", () => {
    expect([...CREDENTIAL_PRESENTATION_COVERAGE.kinds].sort()).toEqual([...credentialKindSchema.options].sort())
    expect(CREDENTIAL_PRESENTATION_COVERAGE.slotStates).toContain("satisfied")
    expect(CREDENTIAL_PRESENTATION_COVERAGE.slotStates).toContain("document_missing")
  })
})
