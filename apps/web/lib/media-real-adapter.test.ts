import type { MediaReference } from "@logloads/contracts"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { isDedicatedMediaConfigured } from "./media-config"
import {
  signedDeliveryUrl,
  signedDocumentUrl,
  signedUpload,
  verifiedMediaReference
} from "./media"

const allowedCloudinaryEnvironmentNames = new Set([
  "CLOUDINARY_CLOUD_NAME",
  "CLOUDINARY_API_KEY",
  "CLOUDINARY_API_SECRET"
])

const storedMedia: MediaReference = {
  provider: "cloudinary",
  publicId: "logloads/trip-documents/trip-1/uploads/photo-1",
  version: 7,
  format: "jpg",
  width: 1200,
  height: 900,
  bytes: 500_000,
  uploadedAt: "2026-07-21T12:00:00.000Z"
}

function stubDedicatedEnvironment() {
  for (const name of Object.keys(process.env)) {
    if (name.startsWith("CLOUDINARY_") && !allowedCloudinaryEnvironmentNames.has(name)) {
      vi.stubEnv(name, undefined)
    }
  }

  vi.stubEnv("LOGLOADS_CLOUDINARY_TENANCY", "dedicated")
  // The gate now requires an independently declared expected cloud name that the
  // configured one must equal, so a fully-configured dedicated tenant has to
  // state it here too. Without this line the two ambient-isolation cases below
  // would still pass — but for the wrong reason (no expected name) rather than
  // for the ambient contamination they exist to prove.
  vi.stubEnv("LOGLOADS_CLOUDINARY_EXPECTED_CLOUD", "dedicated-cloud")
  vi.stubEnv("CLOUDINARY_CLOUD_NAME", "dedicated-cloud")
  vi.stubEnv("CLOUDINARY_API_KEY", "dedicated-key")
  vi.stubEnv("CLOUDINARY_API_SECRET", "dedicated-secret")
}

async function resetRealAdapter() {
  for (const name of Object.keys(process.env)) {
    if (name.startsWith("CLOUDINARY_") && !allowedCloudinaryEnvironmentNames.has(name)) {
      vi.stubEnv(name, undefined)
    }
  }

  const { v2: cloudinary } = await import("cloudinary")

  cloudinary.config(true)
}

afterEach(async () => {
  vi.restoreAllMocks()
  await resetRealAdapter()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe("real Cloudinary adapter isolation", () => {
  it("returns the generic 503 for a malformed ambient URL without loading the SDK first", async () => {
    stubDedicatedEnvironment()
    vi.stubEnv("CLOUDINARY_URL", "not-a-cloudinary-url")

    expect(isDedicatedMediaConfigured(process.env)).toBe(false)
    await expect(signedUpload({ publicIdPrefix: "logloads/trip-documents/trip-1" })).rejects.toMatchObject({
      message: "File uploads are not activated for this environment",
      status: 503
    })
  })

  it("blocks every operation before a real adapter can use ambient tenant, host, token, or proxy state", async () => {
    stubDedicatedEnvironment()

    const ambientUrl = new URL("cloudinary://ambient-cloud")
    ambientUrl.username = "ambient-key"
    ambientUrl.password = "ambient-secret"
    ambientUrl.searchParams.set("secure_distribution", "ambient.example.test")
    ambientUrl.searchParams.set("private_cdn", "true")
    ambientUrl.searchParams.set("oauth_token", "ambient-token")

    vi.stubEnv("CLOUDINARY_URL", ambientUrl.toString())
    vi.stubEnv("CLOUDINARY_API_PROXY", "https://proxy.example.test")

    expect(isDedicatedMediaConfigured(process.env)).toBe(false)

    const { v2: cloudinary } = await import("cloudinary")

    // Reproduce the pinned SDK's merge behavior with synthetic values: an
    // explicit tenant/credential config does not remove URL-derived options.
    cloudinary.config(true)
    cloudinary.config({
      api_key: "dedicated-key",
      api_secret: "dedicated-secret",
      cloud_name: "dedicated-cloud",
      secure: true
    })
    expect(cloudinary.config("secure_distribution")).toBe("ambient.example.test")
    expect(cloudinary.config("oauth_token")).toBe("ambient-token")
    expect(cloudinary.config("api_proxy")).toBe("https://proxy.example.test")

    const configSpy = vi.spyOn(cloudinary, "config")
    const resourceSpy = vi.spyOn(cloudinary.api, "resource")
    const signSpy = vi.spyOn(cloudinary.utils, "api_sign_request")
    const urlSpy = vi.spyOn(cloudinary, "url")

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

    expect(configSpy).not.toHaveBeenCalled()
    expect(resourceSpy).not.toHaveBeenCalled()
    expect(signSpy).not.toHaveBeenCalled()
    expect(urlSpy).not.toHaveBeenCalled()
  })

  it("resets to the intended standard host and credentials for a clean exact configuration", async () => {
    stubDedicatedEnvironment()
    expect(isDedicatedMediaConfigured(process.env)).toBe(true)

    const { v2: cloudinary } = await import("cloudinary")
    const resourceSpy = vi.spyOn(cloudinary.api, "resource").mockImplementation(async () => {
      const configured = cloudinary.config()

      expect(configured.api_key).toBe("dedicated-key")
      expect(configured.api_secret).toBe("dedicated-secret")
      expect(configured.cloud_name).toBe("dedicated-cloud")
      expect(configured.api_proxy).toBeUndefined()
      expect(configured.oauth_token).toBeUndefined()
      expect(configured.private_cdn).toBeUndefined()
      expect(configured.secure_distribution).toBeUndefined()

      return {
        bytes: storedMedia.bytes,
        created_at: storedMedia.uploadedAt,
        format: storedMedia.format,
        height: storedMedia.height,
        public_id: storedMedia.publicId,
        version: storedMedia.version,
        width: storedMedia.width
      }
    })

    const upload = await signedUpload({ publicIdPrefix: "logloads/trip-documents/trip-1" })

    expect(upload.uploadUrl).toBe("https://api.cloudinary.com/v1_1/dedicated-cloud/image/upload")
    expect(upload.parameters.allowed_formats).toBe("jpg,png,webp")
    expect(upload.parameters).not.toHaveProperty("max_file_size")

    for (const deliveryUrl of [await signedDeliveryUrl(storedMedia), await signedDocumentUrl(storedMedia)]) {
      const parsed = new URL(deliveryUrl)

      expect(parsed.hostname).toBe("res.cloudinary.com")
      expect(parsed.pathname).toContain("/dedicated-cloud/")
      expect(deliveryUrl).not.toContain("ambient")
    }

    await expect(verifiedMediaReference(storedMedia.publicId)).resolves.toEqual(storedMedia)
    expect(resourceSpy).toHaveBeenCalledWith(storedMedia.publicId, {
      resource_type: "image",
      type: "authenticated"
    })
  })
})
