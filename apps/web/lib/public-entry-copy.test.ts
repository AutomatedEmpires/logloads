import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

import {
  pricingPlans,
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
    expect(pricingPlans.find((plan) => plan.name === "Driver")?.cta).toEqual({
      href: "/sign-up?path=driver",
      label: "Create driver profile"
    })
    expect(publicPagesSource).toContain('actionHref="/sign-up?path=driver"')
    expect(signUpPageSource).toContain("intent={intent}")
  })

  it("keeps host enrollment visibly gated instead of promising immediate publication", () => {
    const hostStory = storyPages["for-landings"]
    const publicCopy = `${JSON.stringify(hostStory)} ${publicPagesSource}`

    expect(hostStory?.cta).toEqual({
      href: "/sign-up?path=host",
      label: "Create a host workspace"
    })
    expect(publicCopy).toContain("separate pilot approval")
    expect(publicCopy).not.toContain("publish work in minutes")
    expect(publicCopy).not.toContain("Publish your first load")
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

  it("keeps Clerk's changing form-step title visible", () => {
    expect(authCssSource).not.toMatch(
      /\.cl-headerTitle[^{}]*\{[^}]*display\s*:\s*none\s*;/
    )
  })
})
