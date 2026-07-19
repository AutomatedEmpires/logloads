import { mediaReferenceSchema } from "@logloads/contracts"
import { createInMemoryDatabase } from "@logloads/db"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { ApiError } from "./api-actor"
import { mediaTarget, parseJsonObject, parseTripDocumentType, signedUpload, tripDocumentTarget } from "./media"
import type { SessionActor } from "./session"

function fixture() {
  const state = createInMemoryDatabase()
  const profile = state.profiles.find((candidate) => candidate.email === "hank@northpine.example")
  const driver = state.driverProfiles.find((candidate) => candidate.userId === profile?.id)
  const membership = state.organizationMemberships.find((candidate) =>
    candidate.userId === profile?.id && candidate.status === "active"
  )
  const organization = state.organizations.find((candidate) => candidate.id === membership?.organizationId)

  if (!profile || !driver || !membership || !organization) {
    throw new Error("The media authorization fixture is incomplete")
  }

  const actor: SessionActor = {
    activeMembership: membership,
    activeOrganization: organization,
    driverProfileId: driver.id,
    isPlatformAdmin: false,
    memberships: [{ membership, organization }],
    profile
  }

  return { actor, driver, organization, state }
}

describe("driver media authorization", () => {
  it("uses an organization-scoped target for the authenticated driver's profile and equipment", () => {
    const { actor, driver, organization, state } = fixture()
    const profile = mediaTarget(state, actor, organization.id, "profile")
    const truck = mediaTarget(state, actor, organization.id, "truck")
    const trailer = mediaTarget(state, actor, organization.id, "trailer")

    expect(profile.id).toBe(driver.id)
    expect(profile.publicIdPrefix).toBe(`logloads/${organization.id}/profile/${driver.id}`)
    expect(truck.publicIdPrefix).toMatch(new RegExp(`^logloads/${organization.id}/truck/`))
    expect(trailer.publicIdPrefix).toMatch(new RegExp(`^logloads/${organization.id}/trailer/`))
  })

  it("rejects media targets outside the actor's active memberships", () => {
    const { actor, state } = fixture()
    const otherOrganization = state.organizations.find((candidate) =>
      !actor.memberships.some((entry) => entry.organization.id === candidate.id)
    )

    expect(otherOrganization).toBeDefined()
    expect(() => mediaTarget(state, actor, otherOrganization!.id, "profile")).toThrow(ApiError)
  })
})

describe("request bodies", () => {
  it("refuses JSON that is valid but is not an object", () => {
    // `null` and `7` parse fine, so reading a field straight off request.json()
    // throws a TypeError and surfaces as a raw 400 instead of the route's 422.
    for (const body of [null, 7, "text", true, ["a"]]) {
      expect(() => parseJsonObject(body)).toThrow(ApiError)
    }
  })

  it("passes an object through", () => {
    expect(parseJsonObject({ tripId: "abc" })).toEqual({ tripId: "abc" })
  })
})

describe("trip document proof types", () => {
  it("accepts every type the domain defines", () => {
    for (const value of ["scale_ticket", "load_slip", "delivery_record", "photo", "other"]) {
      expect(parseTripDocumentType(value)).toBe(value)
    }
  })

  it("refuses anything else rather than passing it through", () => {
    // The type decides whether a document answers the completion evidence gate,
    // so an unknown value must fail closed instead of being cast.
    for (const value of ["scale_ticket ", "SCALE_TICKET", "", "__proto__", null, undefined, 7, {}]) {
      expect(() => parseTripDocumentType(value)).toThrow(ApiError)
    }
  })
})

describe("signed upload", () => {
  beforeEach(() => {
    vi.stubEnv("CLOUDINARY_CLOUD_NAME", "test-cloud")
    vi.stubEnv("CLOUDINARY_API_KEY", "test-key")
    vi.stubEnv("CLOUDINARY_API_SECRET", "test-secret")
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("permits at the edge only what the domain accepts on read-back", () => {
    // The two checks must agree. A format the signature permits but
    // `verifiedMediaReference` refuses would be stored and only then rejected —
    // the exact waste moving the check to the edge exists to end.
    const { parameters } = signedUpload({ publicIdPrefix: "logloads/trip-documents/t1" })

    for (const format of String(parameters.allowed_formats).split(",")) {
      expect(mediaReferenceSchema.shape.format.safeParse(format).success).toBe(true)
    }
  })

  it("does not sign a restriction the provider has no parameter for", () => {
    // Cloudinary drops parameters it does not know before computing its own
    // string-to-sign, so signing `max_file_size` — which reads like the obvious
    // companion to `allowed_formats` — desynchronises the signature and fails
    // every photo and proof upload with 401. The account ceiling and the
    // application's stricter read-back check remain separate size defenses.
    const { parameters } = signedUpload({ publicIdPrefix: "logloads/trip-documents/t1" })

    expect(parameters).not.toHaveProperty("max_file_size")
  })
})

describe("trip document authorization", () => {
  it("hands a participant the trip-keyed namespace", () => {
    const { actor, organization, state } = fixture()
    const trip = state.tripsV2.find((candidate) => {
      const assignment = state.assignments.find((entry) => entry.id === candidate.assignmentId)

      return Boolean(assignment) && candidate.driverProfileId === actor.driverProfileId
    })

    expect(trip).toBeDefined()

    const target = tripDocumentTarget(state, actor, organization.id, trip!.id, "write")

    // Keyed by trip, not by organization — both sides of the haul file here.
    expect(target.publicIdPrefix).toBe(`logloads/trip-documents/${trip!.id}`)
    expect(target.tripId).toBe(trip!.id)
  })

  it("answers 404 for a trip that does not exist", () => {
    const { actor, organization, state } = fixture()

    try {
      tripDocumentTarget(state, actor, organization.id, "11111111-2222-4333-8444-555555555555", "read")
      throw new Error("expected a refusal")
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError)
      expect((error as ApiError).status).toBe(404)
    }
  })
})
