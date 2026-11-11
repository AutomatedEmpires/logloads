import { describe, expect, it } from "vitest"

import { findPersonalData } from "./privacy"

describe("findPersonalData", () => {
  it("allows enums, counts, booleans, null, public ids, pseudonymous ids, flow letters and state codes", () => {
    expect(
      findPersonalData({
        contact_route: "in_app",
        days_since_confirmed: null,
        elapsed_ms: 3_600_000,
        flows: ["A", "C"],
        interest: `i_${"0".repeat(32)}`,
        job: "6f1c2a7e-3b4d-4c5e-8f60-718293a4b5c6",
        renewed: false,
        state: "ID",
        trucks_offered: 12
      })
    ).toEqual([])
  })

  it("names email addresses, phone numbers and free text by key and problem, never by value", () => {
    const findings = findPersonalData({
      a: "jo.hauler@example.com",
      b: "+1 509 555 0142",
      c: "Granite Creek Hauling",
      d: "call me",
      e: "Saw logs"
    })

    expect(findings).toEqual([
      { key: "a", problem: "email" },
      { key: "b", problem: "phone" },
      { key: "c", problem: "free_text" },
      { key: "d", problem: "free_text" },
      { key: "e", problem: "free_text" }
    ])
    expect(JSON.stringify(findings)).not.toMatch(/example\.com|555|Granite|call me/)
  })

  it.each([
    "name",
    "posterName",
    "business_name",
    "email",
    "phone",
    "message",
    "body",
    "reply_text",
    "title",
    "description",
    "address",
    "zip",
    "lat",
    "lng",
    "ip",
    "current_url",
    "$referrer",
    "gate",
    "legal_name",
    "contact_email"
  ])("refuses the key %s whatever its value", (key) => {
    expect(findPersonalData({ [key]: true })).toEqual([{ key, problem: "forbidden_key" }])
  })

  it("does not mistake a contact route enum for a contact detail", () => {
    expect(findPersonalData({ contact_route: "phone" })).toEqual([])
  })

  it("refuses long numbers that could be phone numbers or raw ids, and non-finite numbers", () => {
    expect(findPersonalData({ a: 5_095_550_142, b: Number.NaN, c: Number.POSITIVE_INFINITY, d: 999_999_999 })).toEqual([
      { key: "a", problem: "long_number" },
      { key: "b", problem: "not_finite" },
      { key: "c", problem: "not_finite" }
    ])
  })

  it("refuses nested objects and checks every array item", () => {
    expect(findPersonalData({ a: { name: "Jo" }, b: ["A", "jo@example.com"], c: [["A"]] })).toEqual([
      { key: "a", problem: "nested" },
      { key: "b", problem: "email" },
      { key: "c", problem: "nested" }
    ])
  })

  it("ignores undefined values", () => {
    expect(findPersonalData({ a: undefined })).toEqual([])
  })
})
