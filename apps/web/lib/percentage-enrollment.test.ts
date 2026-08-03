import { describe, expect, it } from "vitest"

import {
  percentageEnrollmentAllowed,
  percentageEnrollmentStatus
} from "./percentage-enrollment"

const ORGANIZATION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"

describe("percentage enrollment boundary", () => {
  it("is cleanly dark only when both the gate and scope are dark", () => {
    expect(percentageEnrollmentStatus({})).toEqual({
      allowedOrganizationCount: 0,
      allowedOrganizationScopeSha256: null,
      enrollment: "disabled",
      invalidEntryCount: 0
    })

    expect(percentageEnrollmentStatus({
      LOGLOADS_PERCENTAGE_ALLOWED_ORGANIZATION_IDS: ORGANIZATION_ID,
      LOGLOADS_PERCENTAGE_ENROLLMENT: "disabled"
    })).toMatchObject({
      allowedOrganizationCount: 1,
      enrollment: "disabled_stale_scope"
    })
  })

  it("enables only a valid exact scope and reports a non-reversible fingerprint", () => {
    const env = {
      LOGLOADS_PERCENTAGE_ALLOWED_ORGANIZATION_IDS: ORGANIZATION_ID,
      LOGLOADS_PERCENTAGE_ENROLLMENT: "enabled"
    }

    expect(percentageEnrollmentStatus(env)).toEqual({
      allowedOrganizationCount: 1,
      allowedOrganizationScopeSha256:
        "303617b9730210ef3c86c52dc2aecc4dce54aaca6af8c8b0f4ceec9ecc54e57e",
      enrollment: "enabled",
      invalidEntryCount: 0
    })
    expect(percentageEnrollmentAllowed(ORGANIZATION_ID, env)).toBe(true)
    expect(
      percentageEnrollmentAllowed(
        "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        env
      )
    ).toBe(false)
  })

  it("rejects wildcard, malformed gate, and malformed scope values", () => {
    for (const env of [
      {
        LOGLOADS_PERCENTAGE_ALLOWED_ORGANIZATION_IDS: "*",
        LOGLOADS_PERCENTAGE_ENROLLMENT: "enabled"
      },
      {
        LOGLOADS_PERCENTAGE_ALLOWED_ORGANIZATION_IDS: ORGANIZATION_ID,
        LOGLOADS_PERCENTAGE_ENROLLMENT: "true"
      }
    ]) {
      expect(percentageEnrollmentStatus(env).enrollment).toBe("misconfigured")
      expect(percentageEnrollmentAllowed(ORGANIZATION_ID, env)).toBe(false)
    }
  })
})
