import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

import {
  pilotLaunchGates,
  pilotRoles,
  pilotSuccessCriteria
} from "./pilot-showroom"
import {
  legalPages,
  pricingPlans,
  publicSignUpCopy,
  storyPages
} from "./v3-shared"

const publicPagesSource = readFileSync(
  new URL("../components/v3/PublicPages.tsx", import.meta.url),
  "utf8"
)
const publicSourceFiles = [
  "../components/v3/PublicPages.tsx",
  "../components/v3/Shells.tsx",
  "../components/v3/AuthForms.tsx",
  "../app/pricing/page.tsx",
  "../app/terms/page.tsx",
  "../app/contact/page.tsx"
] as const

// The retired 5% completed-load host fee, Dispatch Pro, and any price figure
// stay off public surfaces until new pricing and terms are approved (#108).
const RETIRED_OR_UNAPPROVED_PRICE_CLAIM =
  /\d\s?%|per completed load|completed-load (?:fee|agreement)|\$\s?\d|\bDispatch Pro\b/i

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

  it.each(publicSourceFiles)(
    "keeps %s free of the retired host fee and unapproved prices",
    (file) => {
      expect(readFileSync(new URL(file, import.meta.url), "utf8")).not.toMatch(
        RETIRED_OR_UNAPPROVED_PRICE_CLAIM
      )
    }
  )

  it("keeps public pricing, sign-up, story, and pilot copy free of retired or unapproved prices", () => {
    const publicCopy = JSON.stringify({
      pilotLaunchGates,
      pilotRoles,
      pilotSuccessCriteria,
      pricingPlans,
      signUp: [publicSignUpCopy(), publicSignUpCopy("driver"), publicSignUpCopy("fleet"), publicSignUpCopy("host")],
      storyPages
    })

    expect(publicCopy).not.toMatch(RETIRED_OR_UNAPPROVED_PRICE_CLAIM)
  })

  it("shows the host pricing card as unpublished instead of a rate", () => {
    const hostPlan = pricingPlans.find((plan) => plan.name === "Host")

    expect(pricingPlans.map((plan) => plan.name)).toEqual(["Driver", "Fleet Free", "Host"])
    expect(hostPlan).toMatchObject({
      cta: { href: "/sign-up?path=host", label: "Create host workspace" },
      price: "Not yet published"
    })
    expect(hostPlan?.summary).toContain(
      "Pricing for landing organizations will be published before any paid feature is offered."
    )
  })

  it("keeps the retired host fee sections out of the Terms of Service", () => {
    const terms = legalPages["terms"]
    const sectionTitles = terms?.sections.map((section) => section.title)

    expect(sectionTitles).toContain("What LogLoads is")
    expect(sectionTitles).not.toContain("Host platform fee")
    expect(sectionTitles).not.toContain("Agreement and payment method")
    expect(JSON.stringify(terms)).not.toMatch(RETIRED_OR_UNAPPROVED_PRICE_CLAIM)
    expect(JSON.stringify(terms)).not.toMatch(/monthly in arrears|percentage agreement/i)
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
