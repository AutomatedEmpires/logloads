import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

import { BUSINESS_IDENTITY_REVIEW_HINT, formatDateTime, landingDetailsSavedLabel, storyPages, userPlanFeatures } from "./v3-shared"

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8")

// #448 (review pass 3 of PR 445): three strings said more than the code does.
describe("#448: copy that claimed a verification nobody made", () => {
  it("the how-it-works page names the identity review, not verified carriers", () => {
    const points = storyPages["how-it-works"]!.sections.flatMap((section) => section.points)

    expect(points).toContain("Open it to identity-reviewed carriers in the region")
    expect(points.join(" ")).not.toMatch(/\bverified carriers\b/i)
  })

  it("no story page says verified, vetted or certified in front of a business", () => {
    const text = JSON.stringify(storyPages)

    expect(text).not.toMatch(/\b(?:verified|vetted|certified)\s+(?:local\s+)?(?:carriers?|haulers?|fleets?|drivers?|landings?|business(?:es)?)\b/i)
  })

  it("a landing card says when its details were saved, because the stored time is only the save time", () => {
    const savedAt = "2026-11-19T17:05:00.000Z"

    expect(landingDetailsSavedLabel(savedAt)).toBe(`Details saved ${formatDateTime(savedAt)}`)
    expect(landingDetailsSavedLabel(savedAt)).toMatch(/^Details saved Nov 19, /)
    expect(landingDetailsSavedLabel(null)).toBe("No briefing saved yet")
    expect(landingDetailsSavedLabel(savedAt)).not.toMatch(/verified/i)
    expect(landingDetailsSavedLabel(null)).not.toMatch(/verified/i)
  })

  it("the host landing card uses that label", () => {
    const hostPages = source("../components/v3/HostPages.tsx")

    expect(hostPages).toContain("landingDetailsSavedLabel(landing.lastVerifiedAt)")
    expect(hostPages).not.toMatch(/Details (?:not yet )?verified/)
  })

  it("the identity hint limits the review, not LogLoads", () => {
    expect(BUSINESS_IDENTITY_REVIEW_HINT).toBe(
      "LogLoads reviews the business identity details you send and records the date. This identity review does not cover insurance, authority or safety."
    )
    // "It does not check insurance, authority or safety" read as LogLoads, beside options whose records LogLoads reviews.
    expect(BUSINESS_IDENTITY_REVIEW_HINT).not.toMatch(/\bdoes not check\b/)
  })

  it("the fleet and the host settings both show that hint under Business identity", () => {
    const billingSettings = source("../components/v3/BillingSettings.tsx")

    expect(billingSettings.match(/label: "Business identity", hint: BUSINESS_IDENTITY_REVIEW_HINT \}/g)).toHaveLength(2)
    expect(billingSettings).not.toContain("It does not check insurance, authority or safety")
  })

  it("the fallback plan features do not promise verified access", () => {
    expect(userPlanFeatures("unknown")).toEqual(["Workspace access", "Team seats", "Support"])
  })
})
