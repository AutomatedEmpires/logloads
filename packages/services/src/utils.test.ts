import { describe, expect, it } from "vitest"

import { assertFound } from "./utils"

describe("assertFound", () => {
  it("accepts defined falsy values", () => {
    expect(assertFound(0, "missing")).toBe(0)
    expect(assertFound(false, "missing")).toBe(false)
    expect(assertFound("", "missing")).toBe("")
  })

  it("rejects only undefined", () => {
    expect(() => assertFound(undefined, "missing")).toThrow("missing")
  })
})
