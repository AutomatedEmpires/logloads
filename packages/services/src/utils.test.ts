import { describe, expect, it } from "vitest"

import {
  assertDomainCondition,
  assertDomainFound,
  assertFound,
  DomainRefusalError
} from "./utils"

describe("assertFound", () => {
  it("accepts defined falsy values", () => {
    expect(assertFound(0, "missing")).toBe(0)
    expect(assertFound(false, "missing")).toBe(false)
    expect(assertFound("", "missing")).toBe("")
  })

  it("rejects only undefined", () => {
    expect(() => assertFound(undefined, "missing")).toThrow("missing")
  })

  it("keeps internal assertions distinct from caller-correctable domain refusals", () => {
    let invariantError: unknown

    try {
      assertFound(undefined, "broken state")
    } catch (error) {
      invariantError = error
    }

    expect(invariantError).toBeInstanceOf(Error)
    expect(invariantError).not.toBeInstanceOf(DomainRefusalError)
    expect(() => assertDomainFound(undefined, "missing record")).toThrow(DomainRefusalError)
    expect(() => assertDomainCondition(false, "policy conflict")).toThrow(DomainRefusalError)
  })
})
