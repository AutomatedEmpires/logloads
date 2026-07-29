import { mediaReferenceSchema, type MediaReference } from "@logloads/contracts"
import { createInMemoryDatabase } from "@logloads/db"
import { DomainRefusalError } from "@logloads/services"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const cloudinaryAdapter = vi.hoisted(() => ({
  apiSignRequest: vi.fn(() => "test-signature"),
  config: vi.fn(),
  resource: vi.fn(),
  url: vi.fn(() => "https://media.example.test/signed")
}))
const supabaseAdapter = vi.hoisted(() => ({
  createSignedUploadUrl: vi.fn(),
  download: vi.fn(),
  getBucket: vi.fn(),
  list: vi.fn()
}))

vi.mock("cloudinary", () => ({
  v2: {
    api: { resource: cloudinaryAdapter.resource },
    config: cloudinaryAdapter.config,
    url: cloudinaryAdapter.url,
    utils: { api_sign_request: cloudinaryAdapter.apiSignRequest }
  }
}))
vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    storage: {
      from: vi.fn(() => ({
        createSignedUploadUrl: supabaseAdapter.createSignedUploadUrl,
        download: supabaseAdapter.download,
        list: supabaseAdapter.list
      })),
      getBucket: supabaseAdapter.getBucket
    }
  }))
}))
vi.mock("server-only", () => ({}))

import { ApiError } from "./api-actor"
import {
  mediaTarget,
  parseJsonObject,
  parseTripDocumentType,
  signedDeliveryUrl,
  signedDocumentUrl,
  signedUpload,
  tripDocumentTarget,
  verifiedMediaReference
} from "./media"
import type { SessionActor } from "./session"

const configuredMediaEnvironment = {
  LOGLOADS_CLOUDINARY_TENANCY: "dedicated",
  // The gate requires a separately declared expected cloud name that
  // CLOUDINARY_CLOUD_NAME must equal exactly, so a complete configuration states
  // the cloud twice. Omitting it here would make every case below fail closed for
  // that reason instead of the reason it names.
  LOGLOADS_CLOUDINARY_EXPECTED_CLOUD: "test-cloud",
  CLOUDINARY_CLOUD_NAME: "test-cloud",
  CLOUDINARY_API_KEY: "test-key",
  CLOUDINARY_API_SECRET: "test-secret"
} as const

type MediaEnvironmentOverride = Record<string, string | undefined>

const allowedCloudinaryEnvironmentNames = new Set([
  "CLOUDINARY_CLOUD_NAME",
  "CLOUDINARY_API_KEY",
  "CLOUDINARY_API_SECRET"
])

const storedMedia: MediaReference = {
  provider: "cloudinary",
  publicId: "logloads/trip-documents/trip-1/uploads/photo-1",
  version: 1,
  format: "jpg",
  width: 1200,
  height: 900,
  bytes: 500_000,
  uploadedAt: "2026-07-21T12:00:00.000Z"
}

function stubMediaEnvironment(overrides: MediaEnvironmentOverride = {}) {
  for (const name of Object.keys(process.env)) {
    if (name.startsWith("CLOUDINARY_") && !allowedCloudinaryEnvironmentNames.has(name)) {
      vi.stubEnv(name, undefined)
    }
  }

  for (const [name, value] of Object.entries({ ...configuredMediaEnvironment, ...overrides })) {
    vi.stubEnv(name, value)
  }
}

function stubSupabaseEnvironment() {
  vi.stubEnv("LOGLOADS_MEDIA_STORAGE", "supabase")
  vi.stubEnv("LOGLOADS_MEDIA_BUCKET", "logloads-private-media")
  vi.stubEnv("LOGLOADS_SUPABASE_EXPECTED_PROJECT_REF", "logloads-test")
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable-test-key")
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-test-key")
  vi.stubEnv("SUPABASE_URL", "https://logloads-test.supabase.co")
  supabaseAdapter.getBucket.mockResolvedValue({
    data: {
      allowed_mime_types: ["image/jpeg", "image/png", "image/webp"],
      file_size_limit: 10_000_000,
      public: false
    },
    error: null
  })
  supabaseAdapter.createSignedUploadUrl.mockResolvedValue({
    data: { token: "single-object-token" },
    error: null
  })
}

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
})

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
    expect(() => mediaTarget(state, actor, otherOrganization!.id, "profile")).toThrow(
      DomainRefusalError
    )
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
    stubMediaEnvironment()
  })

  it("permits at the edge only what the domain accepts on read-back", async () => {
    // The two checks must agree. A format the signature permits but
    // `verifiedMediaReference` refuses would be stored and only then rejected —
    // the exact waste moving the check to the edge exists to end.
    const upload = await signedUpload({ publicIdPrefix: "logloads/trip-documents/t1" })

    expect(upload.provider).toBe("cloudinary")
    if (upload.provider !== "cloudinary") {
      throw new Error("Expected the Cloudinary adapter")
    }

    const formats = String(upload.parameters.allowed_formats).split(",")

    expect(cloudinaryAdapter.config).toHaveBeenNthCalledWith(1, true)
    expect(cloudinaryAdapter.config).toHaveBeenNthCalledWith(2, {
      api_key: "test-key",
      api_secret: "test-secret",
      cloud_name: "test-cloud",
      secure: true
    })
    expect(cloudinaryAdapter.apiSignRequest).toHaveBeenCalledTimes(1)
    expect(new Set(formats)).toEqual(new Set(["jpg", "png", "webp"]))
    for (const format of formats) {
      expect(mediaReferenceSchema.shape.format.safeParse(format).success).toBe(true)
    }
  })

  it("does not sign a restriction the provider has no parameter for", async () => {
    // Cloudinary drops parameters it does not know before computing its own
    // string-to-sign, so signing `max_file_size` — which reads like the obvious
    // companion to `allowed_formats` — desynchronises the signature and fails
    // every photo and proof upload with 401. The account ceiling and the
    // application's stricter read-back check remain separate size defenses.
    const { parameters } = await signedUpload({ publicIdPrefix: "logloads/trip-documents/t1" })

    expect(parameters).not.toHaveProperty("max_file_size")
  })

  it("refuses to sign when the Supabase bucket does not enforce the app ceiling", async () => {
    stubSupabaseEnvironment()
    supabaseAdapter.getBucket.mockResolvedValue({
      data: {
        allowed_mime_types: ["image/jpeg", "image/png", "image/webp"],
        file_size_limit: 10_485_760,
        public: false
      },
      error: null
    })

    await expect(
      signedUpload({ publicIdPrefix: "logloads/trip-documents/t1" })
    ).rejects.toMatchObject({
      message: "File uploads are not activated for this environment",
      status: 503
    })
    expect(supabaseAdapter.createSignedUploadUrl).not.toHaveBeenCalled()
  })
})

describe("Supabase read-back", () => {
  it("rejects oversized metadata before downloading or buffering the object", async () => {
    stubSupabaseEnvironment()
    supabaseAdapter.list.mockResolvedValue({
      data: [{
        created_at: "2026-07-27T12:00:00.000Z",
        metadata: { size: 10_000_001 },
        name: "photo-1"
      }],
      error: null
    })

    await expect(
      verifiedMediaReference("logloads/trip-documents/t1/uploads/photo-1")
    ).rejects.toMatchObject({
      message: "Photos must be 10 MB or smaller",
      status: 422
    })
    expect(supabaseAdapter.download).not.toHaveBeenCalled()
  })
})

describe("dedicated media tenancy gate", () => {
  const invalidEnvironments: Array<[string, MediaEnvironmentOverride]> = [
    ["missing marker", { LOGLOADS_CLOUDINARY_TENANCY: undefined }],
    ["wrong marker", { LOGLOADS_CLOUDINARY_TENANCY: "shared" }],
    ["case-varied marker", { LOGLOADS_CLOUDINARY_TENANCY: "Dedicated" }],
    ["missing cloud name", { CLOUDINARY_CLOUD_NAME: undefined }],
    ["blank cloud name", { CLOUDINARY_CLOUD_NAME: "  " }],
    ["missing API key", { CLOUDINARY_API_KEY: undefined }],
    ["blank API key", { CLOUDINARY_API_KEY: "\t" }],
    ["missing API secret", { CLOUDINARY_API_SECRET: undefined }],
    ["blank API secret", { CLOUDINARY_API_SECRET: "\n" }],
    ["ambient Cloudinary URL", { CLOUDINARY_URL: "not-a-provider-url" }],
    ["ambient proxy", { CLOUDINARY_API_PROXY: "https://proxy.example.test" }],
    ["ambient OAuth token", { CLOUDINARY_OAUTH_TOKEN: "ambient-token" }],
    ["ambient private CDN", { CLOUDINARY_PRIVATE_CDN: "true" }],
    ["ambient delivery host", { CLOUDINARY_SECURE_DISTRIBUTION: "media.example.test" }],
    ["future ambient option", { CLOUDINARY_FUTURE_SDK_OPTION: "enabled" }],
    // Tenancy identity, checked rather than attested. These carry a valid marker
    // and complete credentials — the only thing wrong is which account the values
    // point at, which is exactly the failure that used to sail through and write
    // a driver's licence into another product's Cloudinary account.
    ["missing expected cloud name", { LOGLOADS_CLOUDINARY_EXPECTED_CLOUD: undefined }],
    ["blank expected cloud name", { LOGLOADS_CLOUDINARY_EXPECTED_CLOUD: "  " }],
    ["cloud name disagreeing with the expected one", { CLOUDINARY_CLOUD_NAME: "other-cloud" }],
    [
      "Explore & Earn's cloud declared as the expected one",
      {
        CLOUDINARY_CLOUD_NAME: "dwiwyt9vi",
        LOGLOADS_CLOUDINARY_EXPECTED_CLOUD: "dwiwyt9vi"
      }
    ]
  ]

  it.each(invalidEnvironments)("fails closed before every provider adapter call when %s", async (_name, overrides) => {
    stubMediaEnvironment(overrides)

    const operations: Array<() => unknown | Promise<unknown>> = [
      () => signedUpload({ publicIdPrefix: "logloads/trip-documents/trip-1" }),
      () => verifiedMediaReference(storedMedia.publicId),
      () => signedDeliveryUrl(storedMedia),
      () => signedDocumentUrl(storedMedia)
    ]

    for (const operation of operations) {
      await expect(Promise.resolve().then(() => operation())).rejects.toMatchObject({
        message: "File uploads are not activated for this environment",
        status: 503
      })
    }

    expect(cloudinaryAdapter.config).not.toHaveBeenCalled()
    expect(cloudinaryAdapter.apiSignRequest).not.toHaveBeenCalled()
    expect(cloudinaryAdapter.resource).not.toHaveBeenCalled()
    expect(cloudinaryAdapter.url).not.toHaveBeenCalled()
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

  it("preserves a typed refusal for a trip that does not exist", () => {
    const { actor, organization, state } = fixture()

    try {
      tripDocumentTarget(state, actor, organization.id, "11111111-2222-4333-8444-555555555555", "read")
      throw new Error("expected a refusal")
    } catch (error) {
      expect(error).toBeInstanceOf(DomainRefusalError)
    }
  })
})
