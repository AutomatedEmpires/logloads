import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import {
  dedicatedSupabaseMediaConfiguration,
  isDedicatedMediaConfigured
} from "./media-config"

const activeEnvironment = {
  LOGLOADS_MEDIA_BUCKET: "logloads-private-media",
  LOGLOADS_MEDIA_STORAGE: "supabase",
  LOGLOADS_SUPABASE_EXPECTED_PROJECT_REF: "logloads-test",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-test-key",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-test-key",
  SUPABASE_URL: "https://logloads-test.supabase.co"
} as const

describe("Supabase media configuration", () => {
  it("accepts one exact private-project configuration and trims its values", () => {
    expect(
      dedicatedSupabaseMediaConfiguration({
        ...activeEnvironment,
        LOGLOADS_MEDIA_BUCKET: " logloads-private-media ",
        LOGLOADS_SUPABASE_EXPECTED_PROJECT_REF: " logloads-test ",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: " publishable-test-key ",
        SUPABASE_SERVICE_ROLE_KEY: " service-role-test-key ",
        SUPABASE_URL: " https://logloads-test.supabase.co/ "
      })
    ).toEqual({
      anonKey: "publishable-test-key",
      bucket: "logloads-private-media",
      serviceRoleKey: "service-role-test-key",
      url: "https://logloads-test.supabase.co"
    })
  })

  it("accepts the legacy anon-key name as a compatibility alias", () => {
    expect(
      dedicatedSupabaseMediaConfiguration({
        ...activeEnvironment,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-test-key",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: undefined
      })?.anonKey
    ).toBe("anon-test-key")
  })

  it.each([
    ["storage selector", "LOGLOADS_MEDIA_STORAGE"],
    ["bucket", "LOGLOADS_MEDIA_BUCKET"],
    ["expected project", "LOGLOADS_SUPABASE_EXPECTED_PROJECT_REF"],
    ["publishable key", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"],
    ["service role key", "SUPABASE_SERVICE_ROLE_KEY"],
    ["project URL", "SUPABASE_URL"]
  ] as const)("fails closed without the %s", (_label, name) => {
    expect(
      dedicatedSupabaseMediaConfiguration({
        ...activeEnvironment,
        [name]: undefined
      })
    ).toBeNull()
  })

  it.each([
    "http://logloads-test.supabase.co",
    "https://other-project.supabase.co",
    "https://logloads-test.example.com",
    "not-a-url"
  ])("refuses a nonmatching HTTPS Supabase project (%s)", (url) => {
    expect(
      dedicatedSupabaseMediaConfiguration({
        ...activeEnvironment,
        SUPABASE_URL: url
      })
    ).toBeNull()
  })

  it.each([
    "x",
    "../media",
    "media/photos",
    "with spaces",
    "_starts-wrong"
  ])("refuses an unsafe bucket name (%s)", (bucket) => {
    expect(
      dedicatedSupabaseMediaConfiguration({
        ...activeEnvironment,
        LOGLOADS_MEDIA_BUCKET: bucket
      })
    ).toBeNull()
  })

  it.each([
    "CLOUDINARY_CLOUD_NAME",
    "CLOUDINARY_API_KEY",
    "CLOUDINARY_API_SECRET",
    "CLOUDINARY_URL",
    "LOGLOADS_CLOUDINARY_TENANCY",
    "LOGLOADS_CLOUDINARY_EXPECTED_CLOUD"
  ])("refuses stale retired-provider configuration in %s", (name) => {
    expect(
      dedicatedSupabaseMediaConfiguration({
        ...activeEnvironment,
        [name]: "stale-value"
      })
    ).toBeNull()
  })

  it("ignores blank retired-provider values", () => {
    expect(
      dedicatedSupabaseMediaConfiguration({
        ...activeEnvironment,
        CLOUDINARY_URL: "  ",
        LOGLOADS_CLOUDINARY_TENANCY: "\t"
      })
    ).not.toBeNull()
  })

  it("reports activation only for the complete uncontaminated configuration", () => {
    expect(isDedicatedMediaConfigured(activeEnvironment)).toBe(true)
    expect(
      isDedicatedMediaConfigured({
        ...activeEnvironment,
        CLOUDINARY_CLOUD_NAME: "retired-provider"
      })
    ).toBe(false)
  })
})
