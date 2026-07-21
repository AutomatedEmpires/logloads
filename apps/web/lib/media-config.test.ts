import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import {
  DEDICATED_CLOUDINARY_TENANCY,
  dedicatedCloudinaryConfiguration,
  isDedicatedMediaConfigured
} from "./media-config"

const configuredEnvironment: Record<string, string | undefined> = {
  LOGLOADS_CLOUDINARY_TENANCY: DEDICATED_CLOUDINARY_TENANCY,
  CLOUDINARY_CLOUD_NAME: "test-cloud",
  CLOUDINARY_API_KEY: "test-key",
  CLOUDINARY_API_SECRET: "test-secret"
}

describe("dedicated Cloudinary configuration", () => {
  it("accepts only the exact marker with all trimmed nonblank credentials", () => {
    const environment = {
      ...configuredEnvironment,
      CLOUDINARY_CLOUD_NAME: "  test-cloud  ",
      CLOUDINARY_API_KEY: "\ttest-key\n",
      CLOUDINARY_API_SECRET: " test-secret "
    }

    expect(dedicatedCloudinaryConfiguration(environment)).toEqual({
      apiKey: "test-key",
      apiSecret: "test-secret",
      cloudName: "test-cloud"
    })
    expect(isDedicatedMediaConfigured(environment)).toBe(true)
  })

  it.each([undefined, "", "shared", "Dedicated", "DEDICATED", " dedicated "])(
    "rejects an absent or non-exact tenancy marker (%s)",
    (marker) => {
      const environment = { ...configuredEnvironment, LOGLOADS_CLOUDINARY_TENANCY: marker }

      expect(dedicatedCloudinaryConfiguration(environment)).toBeNull()
      expect(isDedicatedMediaConfigured(environment)).toBe(false)
    }
  )

  it.each(["CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"] as const)(
    "rejects missing or blank %s",
    (name) => {
      for (const value of [undefined, "", " ", "\t\n"]) {
        const environment = { ...configuredEnvironment, [name]: value }

        expect(dedicatedCloudinaryConfiguration(environment)).toBeNull()
        expect(isDedicatedMediaConfigured(environment)).toBe(false)
      }
    }
  )
})
