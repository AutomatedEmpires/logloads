import { describe, expect, it } from "vitest"

import { parseStatedCredentialExpiry } from "./credential-date"

describe("stated credential expiry", () => {
  it("accepts only real calendar dates and resolves them through the stated UTC day", () => {
    expect(parseStatedCredentialExpiry(null)).toBeNull()
    expect(parseStatedCredentialExpiry("")).toBeNull()
    expect(parseStatedCredentialExpiry("2028-02-29")).toBe("2028-02-29T23:59:59.000Z")

    expect(() => parseStatedCredentialExpiry("February 29, 2028"))
      .toThrow(/as it is printed/)
    expect(() => parseStatedCredentialExpiry("2026-02-29"))
      .toThrow(/not a real date/)
    expect(() => parseStatedCredentialExpiry("2026-02-31"))
      .toThrow(/not a real date/)
    expect(() => parseStatedCredentialExpiry("2026-04-31"))
      .toThrow(/not a real date/)
  })
})
