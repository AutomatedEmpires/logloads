import type { MediaReference } from "@logloads/contracts"
import { createInMemoryDatabase } from "@logloads/db"
import { DomainRefusalError } from "@logloads/services"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const supabaseAdapter = vi.hoisted(() => ({
  createClient: vi.fn(),
  createSignedUploadUrl: vi.fn(),
  createSignedUrl: vi.fn(),
  download: vi.fn(),
  from: vi.fn(),
  getBucket: vi.fn(),
  list: vi.fn()
}))

vi.mock("@supabase/supabase-js", () => ({
  createClient: supabaseAdapter.createClient
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
  LOGLOADS_MEDIA_BUCKET: "logloads-private-media",
  LOGLOADS_MEDIA_STORAGE: "supabase",
  LOGLOADS_SUPABASE_EXPECTED_PROJECT_REF: "logloads-test",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-test-key",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-test-key",
  SUPABASE_URL: "https://logloads-test.supabase.co"
} as const

const supabaseMedia: MediaReference = {
  bytes: 68,
  format: "png",
  height: 1,
  provider: "supabase",
  publicId: "logloads/trip-documents/trip-1/uploads/photo-1",
  uploadedAt: "2026-07-21T12:00:00.000Z",
  version: 1,
  width: 1
}

const legacyCloudinaryMedia: MediaReference = {
  ...supabaseMedia,
  provider: "cloudinary"
}

const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
)

function stubMediaEnvironment(
  overrides: Record<string, string | undefined> = {}
) {
  for (const name of Object.keys(process.env)) {
    if (
      name.startsWith("CLOUDINARY_") ||
      name.startsWith("LOGLOADS_CLOUDINARY_")
    ) {
      vi.stubEnv(name, undefined)
    }
  }

  for (const [name, value] of Object.entries({
    ...configuredMediaEnvironment,
    ...overrides
  })) {
    vi.stubEnv(name, value)
  }
}

function prepareSupabaseAdapter() {
  supabaseAdapter.from.mockReturnValue({
    createSignedUploadUrl: supabaseAdapter.createSignedUploadUrl,
    createSignedUrl: supabaseAdapter.createSignedUrl,
    download: supabaseAdapter.download,
    list: supabaseAdapter.list
  })
  supabaseAdapter.createClient.mockReturnValue({
    storage: {
      from: supabaseAdapter.from,
      getBucket: supabaseAdapter.getBucket
    }
  })
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
  supabaseAdapter.createSignedUrl.mockResolvedValue({
    data: { signedUrl: "https://logloads-test.supabase.co/storage/signed" },
    error: null
  })
  supabaseAdapter.list.mockResolvedValue({
    data: [
      {
        created_at: "2026-07-21T12:00:00.000Z",
        metadata: { size: PNG_BYTES.byteLength },
        name: "photo-1"
      }
    ],
    error: null
  })
  supabaseAdapter.download.mockResolvedValue({
    data: new Blob([PNG_BYTES], { type: "image/png" }),
    error: null
  })
}

beforeEach(() => {
  stubMediaEnvironment()
  prepareSupabaseAdapter()
})

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
})

function fixture() {
  const state = createInMemoryDatabase()
  const profile = state.profiles.find(
    (candidate) => candidate.email === "hank@northpine.example"
  )
  const driver = state.driverProfiles.find(
    (candidate) => candidate.userId === profile?.id
  )
  const membership = state.organizationMemberships.find(
    (candidate) =>
      candidate.userId === profile?.id && candidate.status === "active"
  )
  const organization = state.organizations.find(
    (candidate) => candidate.id === membership?.organizationId
  )

  if (!profile || !driver || !membership || !organization) {
    throw new Error("The media authorization fixture is incomplete")
  }

  const actor: SessionActor = {
    activeMembership: membership,
    activeOrganization: organization,
    driverProfileId: driver.id,
    isPlatformAdmin: false,
    memberships: [{ membership, organization }],
    profile,
    workspaceSelectionInvalid: false
  }

  return { actor, driver, organization, state }
}

describe("driver media authorization", () => {
  it("uses an organization-scoped target for the authenticated driver", () => {
    const { actor, driver, organization, state } = fixture()
    const profile = mediaTarget(state, actor, organization.id, "profile")
    const truck = mediaTarget(state, actor, organization.id, "truck")
    const trailer = mediaTarget(state, actor, organization.id, "trailer")

    expect(profile.id).toBe(driver.id)
    expect(profile.publicIdPrefix).toBe(
      `logloads/${organization.id}/profile/${driver.id}`
    )
    expect(truck.publicIdPrefix).toMatch(
      new RegExp(`^logloads/${organization.id}/truck/`)
    )
    expect(trailer.publicIdPrefix).toMatch(
      new RegExp(`^logloads/${organization.id}/trailer/`)
    )
  })

  it("rejects targets outside the actor's active memberships", () => {
    const { actor, state } = fixture()
    const otherOrganization = state.organizations.find(
      (candidate) =>
        !actor.memberships.some(
          (entry) => entry.organization.id === candidate.id
        )
    )

    expect(otherOrganization).toBeDefined()
    expect(() =>
      mediaTarget(state, actor, otherOrganization!.id, "profile")
    ).toThrow(DomainRefusalError)
  })
})

describe("request parsing", () => {
  it("refuses valid JSON that is not an object", () => {
    for (const body of [null, 7, "text", true, ["a"]]) {
      expect(() => parseJsonObject(body)).toThrow(ApiError)
    }
  })

  it("accepts every trip-document proof type and refuses unknown values", () => {
    for (const value of [
      "scale_ticket",
      "load_slip",
      "delivery_record",
      "photo",
      "other"
    ]) {
      expect(parseTripDocumentType(value)).toBe(value)
    }

    for (const value of ["SCALE_TICKET", "", null, undefined, 7, {}]) {
      expect(() => parseTripDocumentType(value)).toThrow(ApiError)
    }
  })
})

describe("Supabase signed uploads", () => {
  it("checks the private bucket policy before issuing one object token", async () => {
    const upload = await signedUpload({
      publicIdPrefix: "logloads/trip-documents/t1"
    })

    expect(upload).toMatchObject({
      anonKey: "publishable-test-key",
      bucket: "logloads-private-media",
      path: upload.publicId,
      provider: "supabase",
      supabaseUrl: "https://logloads-test.supabase.co",
      token: "single-object-token"
    })
    expect(upload.publicId).toMatch(
      /^logloads\/trip-documents\/t1\/uploads\//
    )
    expect(supabaseAdapter.getBucket).toHaveBeenCalledWith(
      "logloads-private-media"
    )
    expect(supabaseAdapter.createSignedUploadUrl).toHaveBeenCalledWith(
      upload.publicId,
      { upsert: false }
    )
  })

  it.each([
    [
      "public bucket",
      {
        allowed_mime_types: ["image/jpeg", "image/png", "image/webp"],
        file_size_limit: 10_000_000,
        public: true
      }
    ],
    [
      "oversized bucket ceiling",
      {
        allowed_mime_types: ["image/jpeg", "image/png", "image/webp"],
        file_size_limit: 10_000_001,
        public: false
      }
    ],
    [
      "broadened MIME allowlist",
      {
        allowed_mime_types: [
          "application/pdf",
          "image/jpeg",
          "image/png",
          "image/webp"
        ],
        file_size_limit: 10_000_000,
        public: false
      }
    ],
    [
      "incomplete MIME allowlist",
      {
        allowed_mime_types: ["image/jpeg", "image/png"],
        file_size_limit: 10_000_000,
        public: false
      }
    ]
  ])("refuses a %s", async (_label, data) => {
    supabaseAdapter.getBucket.mockResolvedValue({ data, error: null })

    await expect(
      signedUpload({ publicIdPrefix: "logloads/trip-documents/t1" })
    ).rejects.toMatchObject({
      message: "File uploads are not activated for this environment",
      status: 503
    })
    expect(supabaseAdapter.createSignedUploadUrl).not.toHaveBeenCalled()
  })

  it("fails before provider access when retired Cloudinary configuration exists", async () => {
    vi.stubEnv("CLOUDINARY_URL", "cloudinary://retired")

    await expect(
      signedUpload({ publicIdPrefix: "logloads/trip-documents/t1" })
    ).rejects.toMatchObject({
      message: "File uploads are not activated for this environment",
      status: 503
    })
    expect(supabaseAdapter.createClient).not.toHaveBeenCalled()
  })
})

describe("Supabase read-back and delivery", () => {
  it("verifies stored bytes and image dimensions before returning a reference", async () => {
    await expect(
      verifiedMediaReference(
        "logloads/trip-documents/trip-1/uploads/photo-1"
      )
    ).resolves.toMatchObject({
      bytes: PNG_BYTES.byteLength,
      format: "png",
      height: 1,
      provider: "supabase",
      publicId: "logloads/trip-documents/trip-1/uploads/photo-1",
      uploadedAt: "2026-07-21T12:00:00.000Z",
      width: 1
    })
  })

  it("rejects oversized metadata before downloading the object", async () => {
    supabaseAdapter.list.mockResolvedValue({
      data: [
        {
          created_at: "2026-07-21T12:00:00.000Z",
          metadata: { size: 10_000_001 },
          name: "photo-1"
        }
      ],
      error: null
    })

    await expect(
      verifiedMediaReference(
        "logloads/trip-documents/trip-1/uploads/photo-1"
      )
    ).rejects.toMatchObject({
      message: "Photos must be 10 MB or smaller",
      status: 422
    })
    expect(supabaseAdapter.download).not.toHaveBeenCalled()
  })

  it("signs current Supabase photos and documents for five minutes", async () => {
    await expect(signedDeliveryUrl(supabaseMedia)).resolves.toContain(
      "/storage/signed"
    )
    await expect(signedDocumentUrl(supabaseMedia)).resolves.toContain(
      "/storage/signed"
    )

    expect(supabaseAdapter.createSignedUrl).toHaveBeenNthCalledWith(
      1,
      supabaseMedia.publicId,
      300
    )
    expect(supabaseAdapter.createSignedUrl).toHaveBeenNthCalledWith(
      2,
      supabaseMedia.publicId,
      300
    )
  })

  it("keeps legacy Cloudinary records parseable but never calls a provider", async () => {
    await expect(
      signedDeliveryUrl(legacyCloudinaryMedia)
    ).rejects.toMatchObject({
      message: "This legacy file is not available",
      status: 404
    })
    await expect(
      signedDocumentUrl(legacyCloudinaryMedia)
    ).rejects.toMatchObject({
      message: "This legacy file is not available",
      status: 404
    })
    expect(supabaseAdapter.createClient).not.toHaveBeenCalled()
  })
})

describe("trip document authorization", () => {
  it("hands a participant the trip-keyed namespace", () => {
    const { actor, organization, state } = fixture()
    const trip = state.tripsV2.find((candidate) => {
      const assignment = state.assignments.find(
        (entry) => entry.id === candidate.assignmentId
      )

      return Boolean(assignment) &&
        candidate.driverProfileId === actor.driverProfileId
    })

    expect(trip).toBeDefined()

    const target = tripDocumentTarget(
      state,
      actor,
      organization.id,
      trip!.id,
      "write"
    )

    expect(target.publicIdPrefix).toBe(
      `logloads/trip-documents/${trip!.id}`
    )
    expect(target.tripId).toBe(trip!.id)
  })

  it("preserves a typed refusal for a trip that does not exist", () => {
    const { actor, organization, state } = fixture()

    expect(() =>
      tripDocumentTarget(
        state,
        actor,
        organization.id,
        "11111111-2222-4333-8444-555555555555",
        "read"
      )
    ).toThrow(DomainRefusalError)
  })
})
