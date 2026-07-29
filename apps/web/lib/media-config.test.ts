import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import {
  DEDICATED_CLOUDINARY_TENANCY,
  DENIED_CLOUDINARY_CLOUD_NAMES,
  dedicatedCloudinaryConfiguration,
  dedicatedSupabaseMediaConfiguration,
  isDedicatedMediaConfigured,
  mediaConfigurationDecision,
  type MediaConfigurationRefusalReason
} from "./media-config"

/**
 * Explore & Earn's Cloudinary account. Written out here rather than read from the
 * export so this file states the value the founder actually named — a test that
 * reads the deny-list to build its own input would still pass if the deny-list
 * were emptied.
 */
const EXPLORE_AND_EARN_CLOUD = "dwiwyt9vi"

const LOGLOADS_CLOUD = "logloads-media"

/** The only shape that may activate media: two agreeing names, three credentials, exact marker. */
const activeEnvironment: Record<string, string | undefined> = {
  LOGLOADS_CLOUDINARY_TENANCY: DEDICATED_CLOUDINARY_TENANCY,
  LOGLOADS_CLOUDINARY_EXPECTED_CLOUD: LOGLOADS_CLOUD,
  CLOUDINARY_CLOUD_NAME: LOGLOADS_CLOUD,
  CLOUDINARY_API_KEY: "test-key",
  CLOUDINARY_API_SECRET: "test-secret"
}

const activeSupabaseEnvironment: Record<string, string | undefined> = {
  LOGLOADS_MEDIA_STORAGE: "supabase",
  LOGLOADS_MEDIA_BUCKET: "logloads-private-media",
  LOGLOADS_SUPABASE_EXPECTED_PROJECT_REF: "fdzohbiiyzgvjzfsjyxo",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-role",
  SUPABASE_URL: "https://fdzohbiiyzgvjzfsjyxo.supabase.co"
}

/**
 * Asserts refusal through all three exports at once. A check that only
 * `mediaConfigurationDecision` enforced would let `dedicatedCloudinaryConfiguration`
 * — the function every provider call site actually uses — keep returning a live
 * configuration, which is the only failure that would matter.
 */
function expectRefused(
  environment: Record<string, string | undefined>,
  reason: MediaConfigurationRefusalReason
): string {
  const decision = mediaConfigurationDecision(environment)

  expect(decision.active).toBe(false)
  expect(decision.active === false && decision.reason).toBe(reason)
  expect(dedicatedCloudinaryConfiguration(environment)).toBeNull()
  expect(isDedicatedMediaConfigured(environment)).toBe(false)

  return decision.active === false ? decision.message : ""
}

describe("dedicated Cloudinary configuration", () => {
  it("accepts only the exact marker with agreeing cloud names and all trimmed nonblank credentials", () => {
    const environment = {
      ...activeEnvironment,
      CLOUDINARY_CLOUD_NAME: `  ${LOGLOADS_CLOUD}  `,
      LOGLOADS_CLOUDINARY_EXPECTED_CLOUD: `\t${LOGLOADS_CLOUD}\n`,
      CLOUDINARY_API_KEY: "\ttest-key\n",
      CLOUDINARY_API_SECRET: " test-secret "
    }

    expect(dedicatedCloudinaryConfiguration(environment)).toEqual({
      apiKey: "test-key",
      apiSecret: "test-secret",
      cloudName: LOGLOADS_CLOUD
    })
    expect(isDedicatedMediaConfigured(environment)).toBe(true)
    expect(mediaConfigurationDecision(environment).active).toBe(true)
  })

  it.each([undefined, "", "shared", "Dedicated", "DEDICATED", " dedicated "])(
    "rejects an absent or non-exact tenancy marker (%s)",
    (marker) => {
      expectRefused(
        { ...activeEnvironment, LOGLOADS_CLOUDINARY_TENANCY: marker },
        "tenancy_not_attested"
      )
    }
  )

  it.each(["CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"] as const)(
    "rejects missing or blank %s",
    (name) => {
      for (const value of [undefined, "", " ", "\t\n"]) {
        expectRefused({ ...activeEnvironment, [name]: value }, "incomplete_credentials")
      }
    }
  )

  it.each([undefined, "", " ", "\t\n"])(
    "rejects a missing or blank CLOUDINARY_CLOUD_NAME (%j)",
    (value) => {
      // Reported as incomplete rather than as a mismatch: nothing was configured
      // to disagree with the expectation, so "supply the value" is the fix.
      expectRefused({ ...activeEnvironment, CLOUDINARY_CLOUD_NAME: value }, "incomplete_credentials")
    }
  )

  it.each([
    "CLOUDINARY_URL",
    "CLOUDINARY_ACCOUNT_URL",
    "CLOUDINARY_API_PROXY",
    "CLOUDINARY_OAUTH_TOKEN",
    "CLOUDINARY_PRIVATE_CDN",
    "CLOUDINARY_SECURE_DISTRIBUTION",
    "CLOUDINARY_FUTURE_SDK_OPTION"
  ])("rejects nonblank ambient SDK configuration through %s", (name) => {
    const message = expectRefused(
      { ...activeEnvironment, [name]: "ambient-value" },
      "ambient_sdk_configuration"
    )

    expect(message).toContain(name)
  })

  it.each(["", " ", "\t\n"])(
    "ignores an unknown Cloudinary variable that is blank after trimming (%j)",
    (value) => {
      const environment = { ...activeEnvironment, CLOUDINARY_FUTURE_SDK_OPTION: value }

      expect(isDedicatedMediaConfigured(environment)).toBe(true)
    }
  )
})

describe("dedicated Supabase media configuration", () => {
  it("activates only when the explicit provider marker and independent project ref agree", () => {
    expect(dedicatedSupabaseMediaConfiguration(activeSupabaseEnvironment)).toEqual({
      anonKey: "test-anon-key",
      bucket: "logloads-private-media",
      serviceRoleKey: "test-service-role",
      url: "https://fdzohbiiyzgvjzfsjyxo.supabase.co"
    })
    expect(isDedicatedMediaConfigured(activeSupabaseEnvironment)).toBe(true)
  })

  it.each([
    "LOGLOADS_MEDIA_STORAGE",
    "LOGLOADS_MEDIA_BUCKET",
    "LOGLOADS_SUPABASE_EXPECTED_PROJECT_REF",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_URL"
  ] as const)("refuses when %s is absent", (name) => {
    expect(
      dedicatedSupabaseMediaConfiguration({
        ...activeSupabaseEnvironment,
        [name]: undefined
      })
    ).toBeNull()
  })

  it.each([
    "https://another-project.supabase.co",
    "http://fdzohbiiyzgvjzfsjyxo.supabase.co",
    "https://fdzohbiiyzgvjzfsjyxo.example.com",
    "not-a-url"
  ])("refuses a URL outside the expected HTTPS Supabase project (%s)", (url) => {
    expect(
      dedicatedSupabaseMediaConfiguration({
        ...activeSupabaseEnvironment,
        SUPABASE_URL: url
      })
    ).toBeNull()
  })

  it.each(["x", "../media", "media/photos", "with spaces", "_starts-wrong"])(
    "refuses an unsafe bucket name (%s)",
    (bucket) => {
      expect(
        dedicatedSupabaseMediaConfiguration({
          ...activeSupabaseEnvironment,
          LOGLOADS_MEDIA_BUCKET: bucket
        })
      ).toBeNull()
    }
  )

  it("accepts the publishable-key alias", () => {
    expect(
      dedicatedSupabaseMediaConfiguration({
        ...activeSupabaseEnvironment,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: undefined,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "test-publishable-key"
      })?.anonKey
    ).toBe("test-publishable-key")
  })
})

describe("the expected cloud name", () => {
  it.each([undefined, "", " ", "\t\n"])(
    "keeps media off when LOGLOADS_CLOUDINARY_EXPECTED_CLOUD is absent or blank (%j)",
    (value) => {
      // The whole point of the variable: an unrecorded expectation must never
      // degrade into trusting whatever cloud happens to be configured. Everything
      // else here is perfectly set, so absence is the only reason media is off.
      const message = expectRefused(
        { ...activeEnvironment, LOGLOADS_CLOUDINARY_EXPECTED_CLOUD: value },
        "expected_cloud_absent"
      )

      expect(message).toContain("LOGLOADS_CLOUDINARY_EXPECTED_CLOUD")
    }
  )

  it.each([
    ["a different account entirely", "some-other-cloud"],
    ["a single transposed character", "logloads-mdeia"],
    ["a trailing character", `${LOGLOADS_CLOUD}2`],
    ["a case-only difference", "LogLoads-Media"]
  ])("refuses when the configured cloud differs by %s", (_case, configured) => {
    const message = expectRefused(
      { ...activeEnvironment, CLOUDINARY_CLOUD_NAME: configured },
      "expected_cloud_mismatch"
    )

    expect(message).toContain(configured)
    expect(message).toContain(LOGLOADS_CLOUD)
  })

  it("is not mistaken for ambient SDK configuration", () => {
    // The variable is named LOGLOADS_CLOUDINARY_*, not CLOUDINARY_*, precisely so
    // the ambient scan does not treat the safety check as contamination. Rename it
    // and this test fails while media silently stops being activatable at all.
    const decision = mediaConfigurationDecision(activeEnvironment)

    expect(decision.active).toBe(true)
    expect(
      Object.keys(activeEnvironment).some(
        (name) => name.startsWith("CLOUDINARY_") && name.includes("EXPECTED")
      )
    ).toBe(false)
  })
})

describe("the foreign-tenant deny-list", () => {
  it("refuses Explore & Earn's cloud with tenancy attested and every credential present", () => {
    const message = expectRefused(
      {
        ...activeEnvironment,
        CLOUDINARY_CLOUD_NAME: EXPLORE_AND_EARN_CLOUD,
        LOGLOADS_CLOUDINARY_EXPECTED_CLOUD: LOGLOADS_CLOUD
      },
      "foreign_tenant_denied"
    )

    expect(message).toContain(EXPLORE_AND_EARN_CLOUD)
    expect(message).toContain("Explore & Earn")
    expect(message).toContain("CLOUDINARY_CLOUD_NAME")
  })

  it("refuses Explore & Earn's cloud even when the expected name matches it exactly", () => {
    // Belt and braces. Two agreeing values are still two wrong values, and an
    // operator who declares the foreign account as the expected one has satisfied
    // the agreement rule with the exact mistake this layer exists to catch.
    const message = expectRefused(
      {
        ...activeEnvironment,
        CLOUDINARY_CLOUD_NAME: EXPLORE_AND_EARN_CLOUD,
        LOGLOADS_CLOUDINARY_EXPECTED_CLOUD: EXPLORE_AND_EARN_CLOUD
      },
      "foreign_tenant_denied"
    )

    expect(message).toContain("Explore & Earn")
  })

  it("refuses a foreign expected name even when the configured cloud is LogLoads' own", () => {
    const message = expectRefused(
      { ...activeEnvironment, LOGLOADS_CLOUDINARY_EXPECTED_CLOUD: EXPLORE_AND_EARN_CLOUD },
      "foreign_tenant_denied"
    )

    expect(message).toContain("LOGLOADS_CLOUDINARY_EXPECTED_CLOUD")
    expect(message).toContain("Explore & Earn")
  })

  it("reports the foreign tenant, not the missing attestation, for the environment as it stands today", () => {
    // The shape a misconfigured local environment has: a foreign cloud name with
    // credentials beside it and no tenancy marker. Both faults are real, but only
    // one of them is what an operator needs to hear, so the deny-list runs first.
    //
    // The credential values here are placeholders and must stay that way. A real
    // key belongs in no test fixture: the deny-list refuses on the cloud name
    // before credentials are inspected at all, so nothing about this test needs a
    // genuine one.
    const message = expectRefused(
      {
        CLOUDINARY_CLOUD_NAME: EXPLORE_AND_EARN_CLOUD,
        CLOUDINARY_API_KEY: "placeholder-not-a-real-key",
        CLOUDINARY_API_SECRET: "placeholder-not-a-real-secret"
      },
      "foreign_tenant_denied"
    )

    expect(message).toContain("Explore & Earn")
  })

  it.each(["DWIWYT9VI", "Dwiwyt9vi", ` ${EXPLORE_AND_EARN_CLOUD} `, `\t${EXPLORE_AND_EARN_CLOUD}\n`])(
    "refuses the foreign cloud written as %j",
    (written) => {
      // Strict about what activates media, permissive about what refuses it.
      expectRefused(
        {
          ...activeEnvironment,
          CLOUDINARY_CLOUD_NAME: written,
          LOGLOADS_CLOUDINARY_EXPECTED_CLOUD: written
        },
        "foreign_tenant_denied"
      )
    }
  )

  it("refuses every name on the published deny-list", () => {
    // Looped from the export, so a name added to the deny-list is covered without
    // a test edit, and an emptied deny-list fails here rather than passing vacuously.
    expect(DENIED_CLOUDINARY_CLOUD_NAMES.length).toBeGreaterThan(0)
    expect(DENIED_CLOUDINARY_CLOUD_NAMES).toContain(EXPLORE_AND_EARN_CLOUD)

    for (const denied of DENIED_CLOUDINARY_CLOUD_NAMES) {
      expectRefused(
        {
          ...activeEnvironment,
          CLOUDINARY_CLOUD_NAME: denied,
          LOGLOADS_CLOUDINARY_EXPECTED_CLOUD: denied
        },
        "foreign_tenant_denied"
      )
    }
  })

  it.each(["constructor", "toString", "hasOwnProperty", "__proto__"])(
    "does not misreport the legitimate cloud name %j as a foreign tenant",
    (cloudName) => {
      // The deny-list is a Map, so a lookup cannot reach Object.prototype. Were it
      // an object literal, these names would resolve to inherited members and be
      // refused as foreign with a nonsense owner in the message.
      const environment = {
        ...activeEnvironment,
        CLOUDINARY_CLOUD_NAME: cloudName,
        LOGLOADS_CLOUDINARY_EXPECTED_CLOUD: cloudName
      }

      expect(isDedicatedMediaConfigured(environment)).toBe(true)
    }
  )

  it("never puts credential values in an operator-facing message", () => {
    const message = expectRefused(
      {
        ...activeEnvironment,
        CLOUDINARY_CLOUD_NAME: EXPLORE_AND_EARN_CLOUD,
        CLOUDINARY_API_KEY: "unmistakable-key-value",
        CLOUDINARY_API_SECRET: "unmistakable-secret-value"
      },
      "foreign_tenant_denied"
    )

    expect(message).not.toContain("unmistakable-key-value")
    expect(message).not.toContain("unmistakable-secret-value")
  })
})

describe("no dedicated LogLoads Cloudinary account exists yet", () => {
  it("is the reason media must be off in every environment the repo can describe", () => {
    // Each row removes exactly one thing from a fully correct configuration. All
    // of them must refuse: reverting any single check turns one of these green.
    const deviations: Array<[MediaConfigurationRefusalReason, Record<string, string | undefined>]> = [
      ["tenancy_not_attested", { LOGLOADS_CLOUDINARY_TENANCY: undefined }],
      ["expected_cloud_absent", { LOGLOADS_CLOUDINARY_EXPECTED_CLOUD: undefined }],
      ["expected_cloud_mismatch", { CLOUDINARY_CLOUD_NAME: "not-the-expected-cloud" }],
      ["incomplete_credentials", { CLOUDINARY_API_SECRET: undefined }],
      ["ambient_sdk_configuration", { CLOUDINARY_URL: "cloudinary://k:s@ambient" }],
      [
        "foreign_tenant_denied",
        {
          CLOUDINARY_CLOUD_NAME: EXPLORE_AND_EARN_CLOUD,
          LOGLOADS_CLOUDINARY_EXPECTED_CLOUD: EXPLORE_AND_EARN_CLOUD
        }
      ]
    ]

    for (const [reason, deviation] of deviations) {
      expectRefused({ ...activeEnvironment, ...deviation }, reason)
    }
  })
})
