import { describe, expect, it } from "vitest"

import {
  EMPTY_HAULER_PROFILE_FORM,
  HAULER_PUBLIC_PROFILE_KEYS,
  haulerProfileInputSchema,
  parseHaulerHomeBase,
  validateHaulerProfileForm
} from "./marketplace-hauler"

describe("parseHaulerHomeBase (a town or ZIP, never an address)", () => {
  it.each([
    ["Sweet Home, OR", "Sweet Home, OR", "town"],
    ["  sweet   home ,  or ", "Sweet Home, OR", "town"],
    ["St. Helens", "St. Helens", "town"],
    ["Coeur d'Alene, ID", "Coeur d'Alene, ID", "town"],
    ["97386", "97386", "zip"],
    ["97386-1234", "97386", "zip"]
  ])("accepts %j as %j", (input, label, kind) => {
    expect(parseHaulerHomeBase(input)).toEqual({ kind, label, ok: true })
  })

  it.each(["123 Main St", "4417 Spur Road, Sweet Home", "PO Box 12", "9738", "Sweet Home, Oregon", "x", "<b>town</b>", "44.40, -122.73"])(
    "refuses %j",
    (input) => {
      expect(parseHaulerHomeBase(input)).toMatchObject({ ok: false })
    }
  )
})

describe("validateHaulerProfileForm", () => {
  const valid = {
    ...EMPTY_HAULER_PROFILE_FORM,
    about: "  Two trucks out of Sweet Home.  ",
    businessName: "  Ridgeline   Hauling ",
    homeBase: "sweet home, or",
    serviceRadiusMiles: "100"
  }

  it("normalizes a valid form and treats blank optional fields as not stated", () => {
    const result = validateHaulerProfileForm(valid)

    expect(result).toEqual({
      input: {
        about: "Two trucks out of Sweet Home.",
        acceptsInvitations: false,
        businessName: "Ridgeline Hauling",
        homeBase: "Sweet Home, OR",
        homeBasePoint: null,
        legalName: null,
        listed: false,
        serviceRadiusMiles: 100
      },
      ok: true
    })
    expect(validateHaulerProfileForm({ ...valid, homeBase: " ", serviceRadiusMiles: "" })).toMatchObject({
      input: { homeBase: null, serviceRadiusMiles: null },
      ok: true
    })
  })

  it("names each field that fails, in screen order, with a message for the person", () => {
    const result = validateHaulerProfileForm({ ...valid, about: "x".repeat(2001), businessName: " ", homeBase: "12 Gate Rd", serviceRadiusMiles: "far" })

    expect(result.ok).toBe(false)
    expect(result.ok ? [] : result.issues.map((issue) => issue.field)).toEqual(["businessName", "homeBase", "serviceRadiusMiles", "about"])
    expect(result.ok ? "" : result.issues[1]?.message).toMatch(/town .* or a 5-digit ZIP code/)
    expect(result.ok ? "" : result.issues[2]?.message).toBe("Choose how far you travel for work")
  })

  it("refuses a radius outside the store's 5–500 miles", () => {
    expect(validateHaulerProfileForm({ ...valid, serviceRadiusMiles: "501" }).ok).toBe(false)
    expect(validateHaulerProfileForm({ ...valid, serviceRadiusMiles: "4" }).ok).toBe(false)
  })

  it("re-parses at the store boundary, so a caller cannot skip the home base rule", () => {
    expect(haulerProfileInputSchema.safeParse({ ...valid, acceptsInvitations: false, homeBase: "12 Gate Rd", listed: false, serviceRadiusMiles: 100 }).success).toBe(false)
  })
})

describe("the public profile's fields", () => {
  it("never include the private ones", () => {
    expect(HAULER_PUBLIC_PROFILE_KEYS).not.toEqual(expect.arrayContaining(["legalName"]))
    for (const key of ["legalName", "listed", "acceptsInvitations", "canEditProfile", "canEditIdentity", "updatedAt"]) {
      expect(HAULER_PUBLIC_PROFILE_KEYS as readonly string[]).not.toContain(key)
    }
  })
})
