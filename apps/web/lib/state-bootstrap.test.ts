import { OperatingStateUnavailableError } from "@logloads/db"
import { describe, expect, it } from "vitest"

import { bootstrapState, resolveBootstrapData } from "./state-bootstrap"

describe("resolveBootstrapData", () => {
  it("defaults to the launch document everywhere", () => {
    expect(resolveBootstrapData({})).toBe("launch")
    expect(resolveBootstrapData({ LOGLOADS_STATE_BOOTSTRAP_DATA: "  " })).toBe("launch")
    expect(resolveBootstrapData({ VERCEL_ENV: "production" })).toBe("launch")
    expect(resolveBootstrapData({ VERCEL_ENV: "preview" })).toBe("launch")
  })

  it("writes the sample only where it was asked for and is not production", () => {
    expect(resolveBootstrapData({ LOGLOADS_STATE_BOOTSTRAP_DATA: "sample", VERCEL_ENV: "preview" })).toBe("sample")
    expect(resolveBootstrapData({ LOGLOADS_STATE_BOOTSTRAP_DATA: " sample " })).toBe("sample")
  })

  it("refuses the sample on a Vercel Production deployment", () => {
    expect(() =>
      resolveBootstrapData({ LOGLOADS_STATE_BOOTSTRAP_DATA: "sample", VERCEL_ENV: "production" })
    ).toThrow(OperatingStateUnavailableError)
    expect(() =>
      resolveBootstrapData({ LOGLOADS_STATE_BOOTSTRAP_DATA: "sample", VERCEL_ENV: "production" })
    ).toThrow(/never written to production/)
  })

  it("refuses a value it does not recognize rather than guessing", () => {
    for (const value of ["seed", "Sample", "true", "empty"]) {
      expect(() => resolveBootstrapData({ LOGLOADS_STATE_BOOTSTRAP_DATA: value })).toThrow(
        OperatingStateUnavailableError
      )
    }
  })
})

describe("bootstrapState", () => {
  it("writes the launch document by default: one admin, no operation", () => {
    const state = bootstrapState({ VERCEL_ENV: "production" })

    expect(state.profiles.map((profile) => profile.role)).toEqual(["admin"])
    expect(state.organizations).toEqual([])
    expect(state.loadPostings).toEqual([])
  })

  it("writes the fictional operation when the sample is requested off production", () => {
    const state = bootstrapState({ LOGLOADS_STATE_BOOTSTRAP_DATA: "sample", VERCEL_ENV: "preview" })

    expect(state.organizations.length).toBeGreaterThan(0)
    expect(state.loadPostings.length).toBeGreaterThan(0)
  })
})
