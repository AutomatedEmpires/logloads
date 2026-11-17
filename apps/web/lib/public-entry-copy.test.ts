import { readFileSync } from "node:fs"

import { landingPlanCards } from "@logloads/contracts"
import { describe, expect, it } from "vitest"

import {
  pilotLaunchGates,
  pilotRoles,
  pilotSuccessCriteria
} from "./pilot-showroom"
import {
  forLandingsPlanAllowances,
  legalPages,
  pricingPageCopy,
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

// Retired fee language stays banned. A dollar amount is allowed only inside a
// segment that also says the plan is not for sale, names taxes, and carries the
// two legal-review caveats (#108 comment 6785833334, #293 §10 Q1).
const RETIRED_FEE_CLAIM =
  /\d\s?%|per completed load|completed-load (?:fee|agreement)|\bDispatch Pro\b|\bnationwide\b|launched state|\bfounding\b|\$\d+\s*\/\s*mo|Payment is not open|Choose plan|Continue to payment/i
const TYPED_PRICE = /\$\s?\d/
const PRICE_CHANGE = "Prices and plan features can change before plans go on sale."
const PLANNED_FEATURES = "Plan features are planned and are not all available yet."
const HAULER_PROMISE =
  "Free for haulers and fleets. Finding work, listing your trucks and messaging landings will not cost you anything."

function shownPrice(price: string): string {
  return `${price}, plus applicable taxes`
}

function priceIsDisclosed(segment: string): boolean {
  if (!TYPED_PRICE.test(segment)) {
    return true
  }

  return (
    /not for sale/i.test(segment) &&
    segment.includes("plus applicable taxes") &&
    segment.includes(PRICE_CHANGE) &&
    segment.includes(PLANNED_FEATURES)
  )
}

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

  it("keeps the hauler path on pricing and empty-board conversion", () => {
    expect(pricingPageCopy().freeCards[0]?.cta).toEqual({
      href: "/sign-up?path=driver",
      label: "Create hauler profile"
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
        RETIRED_FEE_CLAIM
      )
    }
  )

  it("keeps sign-up, story, and pilot copy free of retired fee claims", () => {
    const publicCopy = JSON.stringify({
      pilotLaunchGates,
      pilotRoles,
      pilotSuccessCriteria,
      signUp: [publicSignUpCopy(), publicSignUpCopy("driver"), publicSignUpCopy("fleet"), publicSignUpCopy("host")],
      storyPages
    })

    expect(publicCopy).not.toMatch(RETIRED_FEE_CLAIM)
    expect(publicCopy).not.toMatch(TYPED_PRICE)
  })

  it("uses the defined hauler promise instead of free forever", () => {
    expect(publicSignUpCopy("driver").body).toBe(
      `${HAULER_PROMISE} Add your operating area and main equipment, then finish the required records before requesting work.`
    )
    expect(publicPagesSource).toContain(HAULER_PROMISE)
    expect(publicPagesSource).not.toMatch(/free forever/i)
    expect(readFileSync(new URL("./v3-shared.ts", import.meta.url), "utf8")).not.toMatch(/free forever/i)
  })

  it("states the ruled public prices, each in the same band as not for sale", () => {
    const plans = landingPlanCards()
    const copy = pricingPageCopy()
    const [basic, pro, regional] = plans
    const sentencePrices = `${basic?.name} ${shownPrice(basic?.price ?? "")}, ${pro?.name} ${shownPrice(pro?.price ?? "")} and ${regional?.name} ${shownPrice(regional?.price ?? "")}`
    const bandPrices = `${basic?.name} ${shownPrice(basic?.price ?? "")}, ${pro?.name} ${shownPrice(pro?.price ?? "")}, ${regional?.name} ${shownPrice(regional?.price ?? "")}`

    expect(plans.map((plan) => plan.name)).toEqual(["Basic", "Pro", "Regional"])
    expect(copy).toMatchObject({
      eyebrow: "Pricing",
      title: "Haulers and fleets are free.",
      priceCaveats: `${PRICE_CHANGE} ${PLANNED_FEATURES}`,
      status:
        "Billing is not open. Nothing on this page charges you, and creating an account does not start a charge. Plan terms will be published before any plan is sold.",
      invitationNote:
        "Invitations you do not send expire at the reset. They do not roll over. Sponsored placement is not offered yet.",
      landingAction: { href: "/sign-up?path=host", label: "Create a landing profile" }
    })
    expect(copy.body).toBe(
      `Landing plans are ${sentencePrices}. They are not for sale yet. ${PRICE_CHANGE} ${PLANNED_FEATURES} LogLoads charges no per-load, percentage or transaction fees, and takes nothing from driver pay.`
    )
    expect(copy.homeBand).toBe(
      `Haulers and fleets are free. Landing plans, not for sale yet: ${bandPrices}. ${PRICE_CHANGE} ${PLANNED_FEATURES}`
    )
    expect(copy.description).toBe(
      `LogLoads is a timber-hauling load board. Haulers and fleets use it free. Landing plans are ${sentencePrices}. They are not for sale yet. ${PRICE_CHANGE} ${PLANNED_FEATURES}`
    )
    expect(copy.freeCards).toEqual([
      {
        name: "Hauler",
        price: "Free",
        summary: "Find hauling work, list your trucks and availability, and message landings. No card and no paywall.",
        cta: { href: "/sign-up?path=driver", label: "Create hauler profile" }
      },
      {
        name: "Fleet",
        price: "Free",
        summary: "The same tools for a hauling business with more than one truck. No subscription and no truck limit.",
        cta: { href: "/sign-up?path=fleet", label: "Create fleet profile" }
      }
    ])
    expect(copy.planCards.map((card) => card.name)).toEqual(plans.map((plan) => plan.name))
    copy.planCards.forEach((card, index) => {
      const plan = plans[index]
      expect(card).toMatchObject({
        activeLandings: plan?.activeLandings,
        invitations: plan?.invitations,
        name: plan?.name,
        positioning: plan?.positioning,
        caveats: `${PRICE_CHANGE} ${PLANNED_FEATURES}`,
        posts: "Unlimited job posts, inquiries and replies.",
        price: shownPrice(plan?.price ?? ""),
        tag: "Not for sale yet",
        teamMembers: plan?.teamMembers
      })
      expect(card).not.toHaveProperty("cta")
    })

    const priced = [
      copy.body,
      copy.homeBand,
      copy.description,
      ...copy.planCards.map((card) => `${card.name} ${card.positioning} ${card.price} ${card.tag} ${card.caveats}`)
    ]
    for (const segment of priced) {
      expect(priceIsDisclosed(segment)).toBe(true)
    }
    expect(priceIsDisclosed("Basic $149 per month")).toBe(false)
    expect(priceIsDisclosed("Basic $149 per month, plus applicable taxes")).toBe(false)
    expect(priceIsDisclosed("Basic $149 per month, plus applicable taxes. Not for sale yet.")).toBe(false)
    expect(
      priceIsDisclosed(
        "Basic $149 per month, plus applicable taxes. Not for sale yet. Prices and plan features can change before plans go on sale. Plan features are planned and are not all available yet."
      )
    ).toBe(true)
    expect(JSON.stringify(copy)).not.toMatch(RETIRED_FEE_CLAIM)
  })

  it("does not type a dollar amount into a public page", () => {
    for (const file of [
      "../components/v3/PublicPages.tsx",
      "../app/pricing/page.tsx",
      "../app/for-landings/page.tsx",
      "./v3-shared.ts"
    ]) {
      expect(readFileSync(new URL(file, import.meta.url), "utf8")).not.toMatch(TYPED_PRICE)
    }
    expect(publicPagesSource).not.toContain("has not been published")
    expect(publicPagesSource).not.toContain("Not yet published")
    expect(publicPagesSource).toContain("pricingPageCopy()")
    expect(publicPagesSource).toContain("forLandingsPlanAllowances()")
  })

  it("shows landing plan names and allowances on the landing page without prices", () => {
    const plans = landingPlanCards()
    const allowances = forLandingsPlanAllowances()

    expect(allowances.map((plan) => plan.name)).toEqual(plans.map((plan) => plan.name))
    allowances.forEach((plan, index) => {
      expect(plan).toEqual({
        activeLandings: plans[index]?.activeLandings,
        invitations: plans[index]?.invitations,
        name: plans[index]?.name,
        teamMembers: plans[index]?.teamMembers
      })
    })
    expect(JSON.stringify(allowances)).not.toMatch(TYPED_PRICE)
  })

  it("keeps the retired host fee sections out of the Terms of Service but links their archive", () => {
    const terms = legalPages["terms"]
    const sectionTitles = terms?.sections.map((section) => section.title)

    expect(sectionTitles).toContain("What LogLoads is")
    expect(sectionTitles).not.toContain("Host platform fee")
    expect(sectionTitles).not.toContain("Agreement and payment method")
    expect(JSON.stringify(terms)).not.toMatch(RETIRED_FEE_CLAIM)
    expect(JSON.stringify(terms)).not.toMatch(TYPED_PRICE)
    expect(JSON.stringify(terms)).not.toMatch(/monthly in arrears|percentage agreement/i)
    // The removed text stays readable for agreements accepted under it (LE-13).
    expect(terms?.changeNotice).toMatchObject({
      date: "November 2, 2026",
      dateTime: "2026-11-02",
      link: { href: "/terms/2026-08-03" }
    })
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
