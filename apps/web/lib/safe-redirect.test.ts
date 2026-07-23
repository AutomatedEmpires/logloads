import { describe, expect, it } from "vitest"

import { safeInternalPath } from "./safe-redirect"

describe("safeInternalPath", () => {
  it.each([
    ["/support", "/support"],
    ["/driver/loads/load-123?from=map#terms", "/driver/loads/load-123?from=map#terms"],
    [undefined, "/workspace"],
    ["//evil.example", "/workspace"],
    ["https://evil.example/driver", "/workspace"],
    ["/%5C%5Cevil.example", "/workspace"],
    ["/\\evil.example", "/workspace"]
  ])("normalizes %s", (input, expected) => {
    expect(safeInternalPath(input)).toBe(expected)
  })

  it("supports an explicit fallback", () => {
    expect(safeInternalPath("not-a-path", "/loads")).toBe("/loads")
  })
})
