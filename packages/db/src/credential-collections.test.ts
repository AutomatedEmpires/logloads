import {
  MANDATORY_CREDENTIAL_KINDS,
  credentialGateFor,
  credentialIsValidAt,
  hostVisibleCredential,
  type DriverCredential
} from "@logloads/contracts"
import { describe, expect, it } from "vitest"

import { auditStateSnapshot } from "./snapshot"
import { createInMemoryDatabase } from "./store"

const CREDENTIAL_COLLECTIONS = ["driverCredentials", "credentialReviews"] as const

/** The instant the seeded bench is written around. */
const BENCH_NOW = "2026-06-05T12:00:00.000Z"

/**
 * The seeded vault must still clear its driver on this date. When this test starts
 * failing, the fixture's insurance certificate has aged out and needs a later
 * expiry — not a change to the rule.
 */
const FIXTURE_MUST_OUTLIVE = "2027-01-01T00:00:00.000Z"

function driverProfileIdFor(state: ReturnType<typeof createInMemoryDatabase>, email: string): string {
  const user = state.profiles.find((candidate) => candidate.email === email)
  const profile = state.driverProfiles.find((candidate) => candidate.userId === user?.id)

  if (!profile) {
    throw new Error(`The seed no longer has a driver profile for ${email}`)
  }

  return profile.id
}

function vaultOf(
  state: ReturnType<typeof createInMemoryDatabase>,
  driverProfileId: string
): DriverCredential[] {
  return state.driverCredentials.filter((entry) => entry.driverProfileId === driverProfileId)
}

describe("driver credential collections", () => {
  it("loads a canonical document written before the vault existed", () => {
    // A row validator puts a collection into REQUIRED_TABLES, and the document in
    // production predates both of these. Without the additive backfill the first
    // read after deploy refuses the WHOLE document and every request fails. This is
    // the deploy-safety test, not a formality.
    const { credentialReviews, driverCredentials, ...legacy } = createInMemoryDatabase()

    expect([driverCredentials, credentialReviews]).toHaveLength(2)

    const audit = auditStateSnapshot(legacy)

    expect(audit.missingCollections).toEqual([])
    expect(audit.state).not.toBeNull()

    for (const collection of CREDENTIAL_COLLECTIONS) {
      expect(audit.state?.[collection], collection).toEqual([])
    }
  })

  it("backfills an empty vault, never an approved one", () => {
    // The consequence is deliberate: after deploy every existing driver holds
    // nothing and is blocked until they submit. Backfilling approvals to keep the
    // platform moving would fabricate a claim about real people's insurance.
    const { driverCredentials, ...legacy } = createInMemoryDatabase()

    expect(driverCredentials.length).toBeGreaterThan(0)

    const restored = auditStateSnapshot(legacy).state?.driverCredentials ?? []

    expect(restored).toEqual([])
    expect(credentialGateFor(restored, BENCH_NOW)).toEqual({
      expiring: [],
      missing: [...MANDATORY_CREDENTIAL_KINDS],
      satisfied: false
    })
  })

  it("clears exactly one seeded driver, and it is the one the journeys sign in as", () => {
    const state = createInMemoryDatabase()
    const cleared = state.driverProfiles.filter(
      (profile) => credentialGateFor(vaultOf(state, profile.id), BENCH_NOW).satisfied
    )

    expect(cleared.map((profile) => profile.id)).toEqual([
      driverProfileIdFor(state, "hank@northpine.example")
    ])
  })

  it("keeps the cleared driver cleared today, not only on the bench clock", () => {
    // The e2e journeys run against a real clock. A fixture that lapses quietly
    // would fail every journey with an error that reads as a bug in acceptance.
    const state = createInMemoryDatabase()
    const vault = vaultOf(state, driverProfileIdFor(state, "hank@northpine.example"))

    expect(
      credentialGateFor(vault, new Date().toISOString()).satisfied,
      "the seeded vault has aged out; give its insurance certificate a later expiry"
    ).toBe(true)
    expect(credentialGateFor(vault, FIXTURE_MUST_OUTLIVE).satisfied).toBe(true)
  })

  it("leaves a driver with nothing submitted, so the blocked path is demonstrable", () => {
    const state = createInMemoryDatabase()
    const empty = state.driverProfiles.filter((profile) => vaultOf(state, profile.id).length === 0)

    expect(empty.length).toBeGreaterThan(0)

    for (const profile of empty) {
      expect(credentialGateFor([], BENCH_NOW).missing, profile.id).toEqual([
        ...MANDATORY_CREDENTIAL_KINDS
      ])
    }
  })

  it("blocks one driver by expiry rather than by absence", () => {
    // A different failure from an empty vault: the document was submitted, read
    // and approved, and then it lapsed. Dated before the bench clock AND before any
    // real clock this seed will be read under, so it stays demonstrable.
    const state = createInMemoryDatabase()
    const lapsed = state.driverCredentials.filter(
      (entry) => entry.status === "approved" && !credentialIsValidAt(entry, BENCH_NOW)
    )

    expect(lapsed.length).toBeGreaterThan(0)

    for (const entry of lapsed) {
      expect(entry.documentMedia, entry.id).not.toBeNull()
      expect(credentialIsValidAt(entry, new Date().toISOString()), entry.id).toBe(false)
      expect(credentialGateFor(vaultOf(state, entry.driverProfileId), BENCH_NOW).missing).toContain(
        entry.kind
      )
    }
  })

  it("keeps a decision trail for every decided credential and none for a pending one", () => {
    const state = createInMemoryDatabase()

    for (const credential of state.driverCredentials) {
      const reviews = state.credentialReviews.filter((entry) => entry.credentialId === credential.id)

      if (credential.status === "pending") {
        expect(reviews, credential.id).toEqual([])
        continue
      }

      expect(reviews.length, credential.id).toBeGreaterThan(0)

      for (const review of reviews) {
        expect(review.decision, review.id).toBe(credential.status)
        expect(review.driverProfileId).toBe(credential.driverProfileId)
        // Append-only: a seeded row that was "updated" would prove the trail is
        // being rewritten rather than added to.
        expect(Date.parse(review.updatedAt), review.id).toBe(Date.parse(review.createdAt))
      }
    }
  })

  it("validates a stored credential against the row contract, not against nothing", () => {
    // Proves the collection is wired to its validator: an approval with the
    // document taken away is held out of runtime state and reported, rather than
    // read as clearance to haul.
    const state = createInMemoryDatabase()
    const approved = state.driverCredentials.find((entry) => entry.status === "approved")

    if (!approved) {
      throw new Error("The seed no longer contains an approved credential")
    }

    state.driverCredentials = [{ ...approved, documentMedia: null }]

    const audit = auditStateSnapshot(state)

    expect(audit.state?.driverCredentials).toEqual([])
    expect(audit.withheldRows.driverCredentials).toHaveLength(1)
    expect(audit.defects.map((defect) => defect.kind)).toContain("invalid_row")
  })

  it("reports a review that names a credential the document does not have", () => {
    const state = createInMemoryDatabase()
    const review = state.credentialReviews[0]

    if (!review) {
      throw new Error("The seed no longer contains a credential review")
    }

    state.credentialReviews = [
      { ...review, credentialId: "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1cfff" }
    ]

    const audit = auditStateSnapshot(state)
    const dangling = audit.defects.filter((defect) => defect.kind === "missing_reference")

    expect(dangling.map((defect) => defect.detail).join(" ")).toContain("credentialId")
    // Reported, never withheld: dropping the row would delete the answer to "why
    // was I refused" instead of repairing the reference.
    expect(audit.state?.credentialReviews).toHaveLength(1)
  })

  it("hands a host equipment photos and nothing that identifies the driver", () => {
    const state = createInMemoryDatabase()
    const vault = vaultOf(state, driverProfileIdFor(state, "hank@northpine.example"))
    const summary = vault.map((entry) => hostVisibleCredential(entry))
    const serialized = JSON.stringify(summary)

    expect(summary.length).toBe(MANDATORY_CREDENTIAL_KINDS.length)

    for (const entry of summary) {
      const shared = entry.kind === "truck" || entry.kind === "trailer"

      expect(entry.photo === null, entry.kind).toBe(!shared)
    }

    for (const entry of vault) {
      if (entry.kind === "truck" || entry.kind === "trailer") {
        continue
      }

      // The licence and policy numbers, and the stored images that carry them,
      // must not appear anywhere in what a host is handed.
      expect(serialized, entry.kind).not.toContain(entry.identifier ?? "__absent__")
      expect(serialized, entry.kind).not.toContain(entry.documentMedia?.publicId ?? "__absent__")
    }
  })
})
