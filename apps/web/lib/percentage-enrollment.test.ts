import { describe, expect, it } from "vitest"

import {
  percentageEnrollmentAllowed,
  percentageEnrollmentStatus
} from "./percentage-enrollment"

const ORGANIZATION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const ORGANIZATION_SCOPE_SHA256 =
  "303617b9730210ef3c86c52dc2aecc4dce54aaca6af8c8b0f4ceec9ecc54e57e"

describe("percentage enrollment boundary", () => {
  it("is cleanly dark only when both the gate and scope are dark", () => {
    expect(percentageEnrollmentStatus({})).toEqual({
      allowedOrganizationCount: 0,
      allowedOrganizationScopeSha256: null,
      enrollment: "disabled",
      invalidEntryCount: 0,
      scopeVerified: true
    })

    expect(percentageEnrollmentStatus({
      LOGLOADS_PERCENTAGE_ALLOWED_ORGANIZATION_IDS: ORGANIZATION_ID,
      LOGLOADS_PERCENTAGE_ENROLLMENT: "disabled"
    })).toMatchObject({
      allowedOrganizationCount: 1,
      enrollment: "disabled_stale_scope",
      scopeVerified: false
    })
  })

  it("enables only when the valid exact scope matches its private expected fingerprint", () => {
    const env = {
      LOGLOADS_PERCENTAGE_ALLOWED_ORGANIZATION_IDS: ORGANIZATION_ID,
      LOGLOADS_PERCENTAGE_ENROLLMENT: "enabled",
      LOGLOADS_PERCENTAGE_EXPECTED_ORGANIZATION_SCOPE_SHA256:
        ORGANIZATION_SCOPE_SHA256
    }

    expect(percentageEnrollmentStatus(env)).toEqual({
      allowedOrganizationCount: 1,
      allowedOrganizationScopeSha256: ORGANIZATION_SCOPE_SHA256,
      enrollment: "enabled",
      invalidEntryCount: 0,
      scopeVerified: true
    })
    expect(percentageEnrollmentAllowed(ORGANIZATION_ID, env)).toBe(true)
    expect(
      percentageEnrollmentAllowed(
        "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        env
      )
    ).toBe(false)
  })

  it("fails closed when the enabled scope fingerprint is absent or mismatched", () => {
    for (const expectedScope of [undefined, "0".repeat(64)]) {
      const env = {
        LOGLOADS_PERCENTAGE_ALLOWED_ORGANIZATION_IDS: ORGANIZATION_ID,
        LOGLOADS_PERCENTAGE_ENROLLMENT: "enabled",
        LOGLOADS_PERCENTAGE_EXPECTED_ORGANIZATION_SCOPE_SHA256:
          expectedScope
      }

      expect(percentageEnrollmentStatus(env)).toMatchObject({
        enrollment: "misconfigured",
        scopeVerified: false
      })
      expect(percentageEnrollmentAllowed(ORGANIZATION_ID, env)).toBe(false)
    }
  })

  it("rejects wildcard, malformed gate, and malformed scope values", () => {
    for (const env of [
      {
        LOGLOADS_PERCENTAGE_ALLOWED_ORGANIZATION_IDS: "*",
        LOGLOADS_PERCENTAGE_ENROLLMENT: "enabled"
      },
      {
        LOGLOADS_PERCENTAGE_ALLOWED_ORGANIZATION_IDS: ORGANIZATION_ID,
        LOGLOADS_PERCENTAGE_ENROLLMENT: "true",
        LOGLOADS_PERCENTAGE_EXPECTED_ORGANIZATION_SCOPE_SHA256:
          ORGANIZATION_SCOPE_SHA256
      }
    ]) {
      expect(percentageEnrollmentStatus(env).enrollment).toBe("misconfigured")
      expect(percentageEnrollmentAllowed(ORGANIZATION_ID, env)).toBe(false)
    }
  })
})
