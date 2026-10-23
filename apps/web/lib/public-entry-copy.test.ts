import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

import { HOST_FEE_TERMS_VERSION } from "@logloads/contracts"

import {
  HOST_FEE_EXAMPLE,
  HOST_FEE_PERCENT,
  HOST_FEE_TERMS_EFFECTIVE_DATE,
  legalPages,
  pricingAudiences,
  publicSignUpCopy,
  storyPages
} from "./v3-shared"

const publicPagesSource = readFileSync(
  new URL("../components/v3/PublicPages.tsx", import.meta.url),
  "utf8"
)
const signUpPageSource = readFileSync(
  new URL("../app/sign-up/page.tsx", import.meta.url),
  "utf8"
)
const publicCssSource = readFileSync(
  new URL("../app/styles/public.css", import.meta.url),
  "utf8"
)
const authCssSource = readFileSync(
  new URL("../app/styles/auth.css", import.meta.url),
  "utf8"
)

describe("public role entry copy", () => {
  it.each([
    ["driver", "Create your driver profile.", "Driver profile"],
    ["fleet", "Set up dispatch for your fleet.", "Fleet workspace"],
    ["host", "Prepare your timber operation.", "Host workspace"]
  ] as const)("renders a visible %s setup intent", (intent, title, intentLabel) => {
    expect(publicSignUpCopy(intent)).toMatchObject({
      intentLabel,
      title
    })
  })

  it("keeps the driver path on pricing and empty-board conversion", () => {
    expect(pricingAudiences.find((audience) => audience.name === "Driver")?.cta).toEqual({
      href: "/sign-up?path=driver",
      label: "Create driver profile"
    })
    expect(publicPagesSource).toContain('actionHref="/sign-up?path=driver"')
    expect(signUpPageSource).toContain("intent={intent}")
  })

  it("keeps host publication visibly gated on the fee terms and a card", () => {
    const hostStory = storyPages["for-landings"]
    const hostCopy = `${JSON.stringify(hostStory)} ${publicSignUpCopy("host").body}`

    expect(hostStory?.cta).toEqual({
      href: "/sign-up?path=host",
      label: "Create a host workspace"
    })
    expect(hostCopy).toContain("accepting the 2% host fee terms")
    expect(hostCopy).toContain("attach a card in Billing")
    expect(`${hostCopy} ${publicPagesSource}`).not.toContain("publish work in minutes")
    expect(`${hostCopy} ${publicPagesSource}`).not.toContain("Publish your first load")
  })

  it("quotes one host fee: 2% on top of driver pay, with drivers and fleets free", () => {
    expect(HOST_FEE_PERCENT).toBe("2%")
    expect(HOST_FEE_EXAMPLE).toEqual({ driverPay: "$500", fee: "$10", hostTotal: "$510" })
    expect(pricingAudiences.map((audience) => [audience.name, audience.price])).toEqual([
      ["Driver", "Free"],
      ["Fleet", "Free"],
      ["Host", "2% per completed load"]
    ])
    expect(pricingAudiences.find((audience) => audience.name === "Host")?.note).toContain(
      "$500 driver pay + $10 LogLoads fee = $510 total host cost"
    )
  })

  it("dates the Terms on the fee terms version a host accepts", () => {
    expect(HOST_FEE_TERMS_VERSION).toBe("2026-10-14")
    expect(HOST_FEE_TERMS_EFFECTIVE_DATE).toBe("October 14, 2026")
    expect(legalPages.terms?.effectiveDate).toBe(HOST_FEE_TERMS_EFFECTIVE_DATE)

    const feeSection = legalPages.terms?.sections.find(
      (section) => section.title === "Host platform fee"
    )

    expect(feeSection?.body).toContain("2% of the driver pay")
    expect(feeSection?.body).toContain("Drivers and fleets pay LogLoads nothing")
  })

  it("limits live trip visibility to assigned participants", () => {
    const processCopy = JSON.stringify(storyPages["how-it-works"])

    expect(processCopy).toContain("Live trip status shared with assigned participants")
    expect(processCopy).not.toContain("Live trip status everyone can see")
  })

  it("keeps the plain public auth link hidden beside the mobile menu", () => {
    expect(publicCssSource).toMatch(
      /@media \(max-width: 760px\) \{[\s\S]*?\.public-actions > a:not\(\.action-link\) \{ display: none; \}/
    )
  })

  it("keeps the mobile primary action legible over its pine background", () => {
    expect(publicCssSource).toContain(
      ".public-header .public-mobile-menu a.action-link { color: #fff; }"
    )
    expect(publicCssSource).toContain(
      ".public-header .public-mobile-menu a.action-link--secondary { color: var(--pine); }"
    )
  })

  it("keeps Clerk's changing form-step title visible", () => {
    expect(authCssSource).not.toMatch(
      /\.cl-headerTitle[^{}]*\{[^}]*display\s*:\s*none\s*;/
    )
  })
})
