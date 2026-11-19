import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { type HaulerPublicProfileView, MARKETPLACE_VERIFICATION_LIMITS } from "@logloads/contracts"

import { PublicHaulerProfile } from "@/components/v2/profile/PublicHaulerProfile"

vi.stubGlobal("React", React)

const NOW = "2026-11-18T17:00:00.000Z"

function profile(overrides: Partial<HaulerPublicProfileView> = {}): HaulerPublicProfileView {
  return {
    about: "Two log trucks out of Sweet Home.",
    businessName: "Ridgeline Hauling",
    equipment: [{ label: "Log truck + Pole trailer", units: 2 }],
    homeBase: "Sweet Home, OR",
    organizationId: "11111111-1111-4111-8111-111111111111",
    serviceRadiusMiles: 100,
    verification: null,
    ...overrides
  }
}

const textOf = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()

describe("PublicHaulerProfile: the review mark a landing reads (#412)", () => {
  it("shows what LogLoads did not check as text under the mark, where a phone or a keyboard reaches it", () => {
    const html = renderToStaticMarkup(<PublicHaulerProfile now={NOW} profile={profile({ verification: { reviewedOn: "2026-10-14", scope: "business_identity" } })} />)

    expect(textOf(html)).toContain(`Business identity reviewed by LogLoads on Oct 14, 2026 ${MARKETPLACE_VERIFICATION_LIMITS}`)
    // Not only in a title attribute, which a phone or a keyboard cannot open.
    expect(html).not.toContain("title=")
  })

  it("keeps the limits with a review older than 12 months", () => {
    const html = renderToStaticMarkup(<PublicHaulerProfile now={NOW} profile={profile({ verification: { reviewedOn: "2025-10-14", scope: "business_identity" } })} />)

    expect(textOf(html)).toContain(`Business identity last reviewed by LogLoads on Oct 14, 2025 ${MARKETPLACE_VERIFICATION_LIMITS}`)
  })

  it("shows no mark and no limits line for a business with no current review", () => {
    const html = renderToStaticMarkup(<PublicHaulerProfile now={NOW} profile={profile()} />)

    expect(textOf(html)).not.toMatch(/reviewed by LogLoads/)
    expect(textOf(html)).not.toContain(MARKETPLACE_VERIFICATION_LIMITS)
  })
})
