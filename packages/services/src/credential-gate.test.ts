import {
  CREDENTIAL_ASSURANCE_STATEMENT,
  HOST_VISIBLE_CREDENTIAL_PHOTO_KINDS,
  MANDATORY_CREDENTIAL_KINDS,
  driverCredentialSchema,
  type CredentialKind,
  type DriverCredential
} from "@logloads/contracts"
import { createInMemoryDatabase } from "@logloads/db"
import { describe, expect, it } from "vitest"

import { createLogLoadsServices, type LogLoadsServices } from "./index"

/**
 * ── The credential gate on taking work ────────────────────────────────────────
 *
 * The founder made four records mandatory before a driver may accept ANY load,
 * and made the AI review decision BINDING. These tests are the negative controls
 * for that: each one removes or lapses something and proves the platform refuses,
 * refuses for a reason the driver can act on, and writes nothing while refusing.
 *
 * The seeded vault is the fixture. Hank (…441) is the one seeded driver whose
 * vault is complete and current, which is what makes him usable as both the
 * positive control and the subject every negative control breaks.
 *
 * Kinds are never hand-listed here. Every "did it name all four" assertion loops
 * `MANDATORY_CREDENTIAL_KINDS`, so a fifth mandatory kind fails these tests until
 * somebody teaches the gate about it.
 */

const HAULER_ORG = "33333333-3333-4333-8333-333333333331"
const HOST_ORG = "33333333-3333-4333-8333-333333333332"
const HAULER_ACTOR = "22222222-2222-4222-8222-222222222221"
const HOST_ACTOR = "22222222-2222-4222-8222-222222222224"
const DRIVER_PROFILE = "44444444-4444-4444-8444-444444444441"
const TRUCK_PROFILE = "77777777-7777-4777-8777-777777777771"
const TRAILER_PROFILE = "88888888-8888-4888-8888-888888888881"
const SEED_LOAD = "cccccccc-cccc-4ccc-8ccc-ccccccccccc3"
const SEED_SLOT = "dddddddd-dddd-4ddd-8ddd-ddddddddddd4"
const SEED_WINDOW = "2026-06-05T12:00:00.000Z"

/** Hank's own equipment combination and the offer sent to his organization. */
const DIRECT_OFFER = "29292929-2929-4929-8929-292929292911"
const DIRECT_OFFER_COMBINATION = "18181818-1818-4818-8818-181818181811"

/**
 * Before the June bench clock, so a credential moved to it has lapsed for the
 * request path, AND before any real clock this suite will run under, so it has
 * also lapsed for the acceptance path — which reads the wall clock rather than
 * the injected one.
 */
const LAPSED_AT = "2026-05-01T00:00:00.000Z"

interface HostVisibleEntry {
  expiresOn: string | null
  kind: CredentialKind
  photo: { publicId: string } | null
  status: string
}

interface AcceptanceSummary {
  assurance: string
  checkedAt: string
  credentials: HostVisibleEntry[]
}

function requestSeedLoad(services: LogLoadsServices) {
  return services.requestCapacityWithPolicy({
    actorUserId: HAULER_ACTOR,
    organizationId: HAULER_ORG,
    loadPostingId: SEED_LOAD,
    truckSlotId: SEED_SLOT,
    driverProfileId: DRIVER_PROFILE,
    truckProfileId: TRUCK_PROFILE,
    trailerProfileId: TRAILER_PROFILE
  }, { at: SEED_WINDOW })
}

function claimSeedDirectOffer(services: LogLoadsServices) {
  return services.claimDirectOffer({
    actorUserId: HOST_ACTOR,
    directOfferId: DIRECT_OFFER,
    equipmentCombinationId: DIRECT_OFFER_COMBINATION,
    organizationId: HAULER_ORG,
    truckSlotId: SEED_SLOT
  }, { at: SEED_WINDOW })
}

/**
 * Runs an action that must be refused and hands back the message.
 *
 * Throws when the action SUCCEEDS. Without that, every "the refusal says X"
 * assertion below would pass silently the day the gate stopped refusing at all.
 */
function refusalMessage(action: () => unknown): string {
  try {
    action()
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }

  throw new Error("Expected this to be refused, but it succeeded")
}

function vaultOf(services: LogLoadsServices): DriverCredential[] {
  return services.state.driverCredentials.filter(
    (credential) => credential.driverProfileId === DRIVER_PROFILE
  )
}

/**
 * Guards a fixture value before it is used as a "must not appear" needle.
 * `expect(text).not.toContain("")` passes against every string on earth, so an
 * empty seed value would silently turn a leak assertion into a no-op.
 */
function requireFixtureText(value: string | null | undefined, label: string): string {
  if (!value) {
    throw new Error(`The seeded vault has no ${label} to test against`)
  }

  return value
}

function documentPublicId(services: LogLoadsServices, kind: CredentialKind): string {
  const credential = vaultOf(services).find((candidate) => candidate.kind === kind)

  if (!credential?.documentMedia) {
    throw new Error(`The seeded vault has no stored ${kind} document to test against`)
  }

  return credential.documentMedia.publicId
}

function emptyTheVault(services: LogLoadsServices): void {
  services.state.driverCredentials = services.state.driverCredentials.filter(
    (credential) => credential.driverProfileId !== DRIVER_PROFILE
  )
}

function removeKind(services: LogLoadsServices, kind: CredentialKind): void {
  services.state.driverCredentials = services.state.driverCredentials.filter(
    (credential) => credential.driverProfileId !== DRIVER_PROFILE || credential.kind !== kind
  )
}

/**
 * Lapses a kind by rewriting its expiry through the row contract, not around it.
 * A fixture built by mutating a field directly could hold a row production would
 * refuse to read, and then this suite would be testing a state that cannot exist.
 */
function lapseKind(services: LogLoadsServices, kind: CredentialKind, expiresOn = LAPSED_AT): void {
  let rewritten = 0

  services.state.driverCredentials = services.state.driverCredentials.map((credential) => {
    if (credential.driverProfileId !== DRIVER_PROFILE || credential.kind !== kind) {
      return credential
    }

    rewritten += 1

    return driverCredentialSchema.parse({ ...credential, expiresOn })
  })

  expect(rewritten).toBeGreaterThan(0)
}

/** A renewal the driver has sent and nobody has decided on yet. */
function addPendingRenewal(services: LogLoadsServices, kind: CredentialKind): void {
  services.state.driverCredentials.push(driverCredentialSchema.parse({
    id: "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c901",
    driverProfileId: DRIVER_PROFILE,
    kind,
    status: "pending",
    documentMedia: {
      bytes: 486_000,
      format: "jpg",
      height: 1_754,
      provider: "cloudinary",
      publicId: "logloads/driver-credentials/gate-test-renewal",
      uploadedAt: "2026-06-02T15:20:00.000Z",
      version: 1,
      width: 1_240
    },
    issuer: null,
    identifier: null,
    issuedOn: null,
    expiresOn: null,
    submittedAt: "2026-06-02T15:20:00.000Z",
    reviewedAt: null,
    reviewNotes: null,
    requestedEvidence: [],
    supersededByCredentialId: null,
    createdAt: "2026-06-02T15:20:00.000Z",
    updatedAt: "2026-06-02T15:20:00.000Z"
  }))
}

function writeFootprint(services: LogLoadsServices) {
  const capacity = services.state.opportunityCapacities.find(
    (candidate) => candidate.loadPostingId === SEED_LOAD
  )
  const slot = services.state.truckSlots.find((candidate) => candidate.id === SEED_SLOT)

  return {
    assignments: services.state.assignments.length,
    capacityCommitted: capacity?.committedTruckloads ?? null,
    capacityRemaining: capacity?.remainingTruckloads ?? null,
    loadStatus: services.state.loadPostings.find((candidate) => candidate.id === SEED_LOAD)?.status ?? null,
    offerStatus: services.state.directOffers.find((candidate) => candidate.id === DIRECT_OFFER)?.status ?? null,
    slotReserved: slot?.reservedCount ?? null,
    slotStatus: slot?.status ?? null,
    trips: services.state.tripsV2.length
  }
}

function acceptanceSummaryOf(termsSnapshot: Record<string, unknown>): AcceptanceSummary {
  const summary = termsSnapshot.driverCredentials

  if (!summary || typeof summary !== "object") {
    throw new Error("The accepted terms snapshot carries no driver credential summary")
  }

  return summary as AcceptanceSummary
}

describe("the credential gate on requesting capacity", () => {
  it("refuses a driver with an empty vault and names every mandatory credential", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    emptyTheVault(services)

    const message = refusalMessage(() => requestSeedLoad(services))

    // Every mandatory kind, named, with something the driver can act on. A bare
    // "not eligible" is useless to somebody sitting in a truck.
    for (const kind of MANDATORY_CREDENTIAL_KINDS) {
      expect(message).toContain(`${kind} (not submitted)`)
    }
  })

  it("names only the credential that is missing when the rest of the vault is current", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    removeKind(services, "insurance")

    const message = refusalMessage(() => requestSeedLoad(services))

    expect(message).toContain("insurance (not submitted)")

    // The kinds the driver DOES hold must not appear. A refusal that lists all
    // four regardless is the same useless message with more words.
    for (const kind of MANDATORY_CREDENTIAL_KINDS.filter((candidate) => candidate !== "insurance")) {
      expect(message).not.toContain(`${kind} (`)
    }
  })

  it("blocks an expired CDL and names the lapsed instant rather than reporting it as missing", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    lapseKind(services, "cdl")

    const message = refusalMessage(() => requestSeedLoad(services))

    expect(message).toContain(`cdl (expired ${LAPSED_AT})`)
    // The licence IS on file. Telling the driver it was never submitted would
    // send them to upload a document the platform already holds and approved.
    expect(message).not.toContain("not submitted")
  })

  it("reports a lapsed certificate and its unreviewed renewal together", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    lapseKind(services, "insurance")
    addPendingRenewal(services, "insurance")

    const message = refusalMessage(() => requestSeedLoad(services))

    // Both halves matter and neither is sufficient. "Expired" alone would send a
    // driver to resend a certificate already in the queue; "awaiting review"
    // alone would hide that their cover has actually lapsed.
    expect(message).toContain(`insurance (expired ${LAPSED_AT}; awaiting review)`)
  })

  it("blocks a credential the review is still deciding, because the decision binds", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    removeKind(services, "trailer")
    addPendingRenewal(services, "trailer")

    const message = refusalMessage(() => requestSeedLoad(services))

    // Submitted is not approved. Anything short of an approved record blocks.
    expect(message).toContain("trailer (awaiting review)")
  })

  it("clears a driver whose vault is complete and current", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())

    const assignment = requestSeedLoad(services)

    // The positive control. Without it every refusal above could be passing
    // because the seeded request path is broken for some unrelated reason.
    expect(assignment.status).toBe("requested")
    expect(assignment.driverProfileId).toBe(DRIVER_PROFILE)
  })

  it("consumes no capacity, reserves no slot and creates no assignment when it refuses", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    emptyTheVault(services)
    const before = writeFootprint(services)

    refusalMessage(() => requestSeedLoad(services))

    // The whole document is read and written as one row under a version
    // compare-and-swap, so a check that ran after any part of the write would be
    // a check against a state somebody else may already have replaced.
    expect(writeFootprint(services)).toEqual(before)
  })

  it("leaves the equipment and haul-window refusals unchanged for a driver with no vault", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    emptyTheVault(services)

    const message = refusalMessage(() => services.requestCapacityWithPolicy({
      actorUserId: HAULER_ACTOR,
      organizationId: HAULER_ORG,
      loadPostingId: SEED_LOAD,
      truckSlotId: SEED_SLOT,
      driverProfileId: DRIVER_PROFILE,
      truckProfileId: TRUCK_PROFILE,
      trailerProfileId: TRAILER_PROFILE
    }, { at: "2026-07-13T12:00:00.000Z" }))

    // The gate sits AFTER the window and equipment assertions on purpose: a
    // request that fails both must still report the failure existing callers
    // already handle, not be re-diagnosed as a credential problem.
    expect(message).toContain("haul window has already passed")
  })
})

describe("the credential gate on the direct-offer claim path", () => {
  it("refuses an invited driver with an empty vault and mutates nothing", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    emptyTheVault(services)
    const before = writeFootprint(services)

    const message = refusalMessage(() => claimSeedDirectOffer(services))

    // An invitation is not a waiver. Without this the direct-offer path would be
    // a complete bypass of the founder's rule for exactly the drivers a host
    // already trusts enough to invite.
    expect(message).toContain("credential vault is complete and current")
    expect(writeFootprint(services)).toEqual(before)
  })

  it("names the lapsed credential on the claim path too", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    lapseKind(services, "insurance")

    const message = refusalMessage(() => claimSeedDirectOffer(services))

    expect(message).toContain(`insurance (expired ${LAPSED_AT})`)
  })

  it("lets a fully credentialed invited driver claim the offer", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())

    const claimed = claimSeedDirectOffer(services)

    expect(claimed.assignment.status).toBe("accepted")
    expect(acceptanceSummaryOf(claimed.assignment.termsSnapshot).credentials.map((entry) => entry.kind))
      .toEqual([...MANDATORY_CREDENTIAL_KINDS])
  })
})

describe("the credential summary sent to the host with an acceptance", () => {
  function acceptSeedLoad(services: LogLoadsServices) {
    const requested = requestSeedLoad(services)

    return services.approveCapacityRequest({
      actorUserId: HOST_ACTOR,
      assignmentId: requested.id,
      organizationId: HOST_ORG
    })
  }

  it("carries status, expiry and every mandatory kind in schema order", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())

    const summary = acceptanceSummaryOf(acceptSeedLoad(services).assignment.termsSnapshot)

    expect(summary.credentials.map((entry) => entry.kind)).toEqual([...MANDATORY_CREDENTIAL_KINDS])
    expect(summary.credentials.every((entry) => entry.status === "approved")).toBe(true)
    expect(Number.isNaN(Date.parse(summary.checkedAt))).toBe(false)
  })

  it("shows the truck and trailer photos and withholds the CDL and insurance images", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())

    const summary = acceptanceSummaryOf(acceptSeedLoad(services).assignment.termsSnapshot)

    for (const entry of summary.credentials) {
      // The host is entitled to see the equipment that will arrive at their
      // landing, and to nothing else. Asserted as an equivalence rather than two
      // spot checks so an added kind cannot default into being shared.
      expect(entry.photo !== null).toBe(HOST_VISIBLE_CREDENTIAL_PHOTO_KINDS.includes(entry.kind))
    }
  })

  it("hands the host exactly four fields per credential", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())

    const summary = acceptanceSummaryOf(acceptSeedLoad(services).assignment.termsSnapshot)

    for (const entry of summary.credentials) {
      // A field added to the stored row must not appear here by default. This
      // fails the moment somebody builds the summary by spreading the row.
      expect(Object.keys(entry).sort()).toEqual(["expiresOn", "kind", "photo", "status"])
    }
  })

  it("routes no CDL image, insurance certificate, policy number or review note into the terms snapshot", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const cdlDocument = documentPublicId(services, "cdl")
    const insuranceDocument = documentPublicId(services, "insurance")
    const truckDocument = documentPublicId(services, "truck")
    const trailerDocument = documentPublicId(services, "trailer")
    const insurance = vaultOf(services).find((credential) => credential.kind === "insurance")
    const cdl = vaultOf(services).find((credential) => credential.kind === "cdl")
    const policyNumber = requireFixtureText(insurance?.identifier, "insurance policy number")
    const licenceNumber = requireFixtureText(cdl?.identifier, "licence number")
    const reviewNote = requireFixtureText(insurance?.reviewNotes, "insurance review note")

    const serialized = JSON.stringify(acceptSeedLoad(services).assignment.termsSnapshot)

    expect(serialized).not.toContain(cdlDocument)
    expect(serialized).not.toContain(insuranceDocument)
    expect(serialized).not.toContain(policyNumber)
    expect(serialized).not.toContain(licenceNumber)
    expect(serialized).not.toContain(reviewNote)

    // The negative controls above would also pass on an empty summary. These two
    // prove the snapshot really did carry the equipment photos it is supposed to.
    expect(serialized).toContain(truckDocument)
    expect(serialized).toContain(trailerDocument)
  })

  it("states what LogLoads actually did, in the contract's own words", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())

    const summary = acceptanceSummaryOf(acceptSeedLoad(services).assignment.termsSnapshot)

    // LogLoads is orchestration. It checked consistency and expiry and approved;
    // it did not certify anyone's legal right to operate. Compared against the
    // contract constant so a stronger sentence cannot be written in locally.
    expect(summary.assurance).toBe(CREDENTIAL_ASSURANCE_STATEMENT)
    expect(summary.assurance.toLowerCase()).not.toContain("verified")
  })

  it("keeps the snapshot as it was at acceptance when the vault changes afterwards", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const accepted = acceptSeedLoad(services)
    const before = structuredClone(
      acceptanceSummaryOf(accepted.assignment.termsSnapshot)
    )

    lapseKind(services, "insurance")
    services.state.driverCredentials = services.state.driverCredentials.filter(
      (credential) => credential.driverProfileId !== DRIVER_PROFILE || credential.kind !== "truck"
    )

    const stored = services.state.assignments.find((candidate) => candidate.id === accepted.assignment.id)

    // A live lookup would rewrite the host's record every time a credential
    // lapsed or was renewed. The host is owed what was true when they accepted.
    expect(acceptanceSummaryOf(stored?.termsSnapshot ?? {})).toEqual(before)
  })
})

describe("the credential gate at the moment of acceptance", () => {
  it("blocks an approval when the vault lapsed between the request and the host's decision", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const requested = requestSeedLoad(services)

    // Valid when they asked, lapsed by the time the host answered. An expired
    // credential must stop being valid, not stay valid because it once was.
    lapseKind(services, "insurance")
    const before = {
      assignments: services.state.assignments.map((candidate) => candidate.status),
      routePacks: services.state.routePacks.length,
      trips: services.state.tripsV2.length
    }

    const message = refusalMessage(() => services.approveCapacityRequest({
      actorUserId: HOST_ACTOR,
      assignmentId: requested.id,
      organizationId: HOST_ORG
    }))

    expect(message).toContain(`insurance (expired ${LAPSED_AT})`)
    // Nothing reached accepted, and no trip, route pack or slot reservation was
    // minted on the way to being refused.
    expect({
      assignments: services.state.assignments.map((candidate) => candidate.status),
      routePacks: services.state.routePacks.length,
      trips: services.state.tripsV2.length
    }).toEqual(before)
  })
})
