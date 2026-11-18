import { expect, test, type Locator, type Page } from "@playwright/test"

async function signIn(page: Page, email: string) {
  await page.goto("/sign-in")
  await page.waitForLoadState("domcontentloaded")
  await page.fill('input[name="email"]', email)
  await page.click('button[type="submit"]')
  await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"), {
    timeout: 30_000
  })
}

function pricingCard(page: Page, name: string): Locator {
  return page.locator(".pricing-card").filter({
    has: page.getByRole("heading", { exact: true, name })
  })
}

function captureClientErrors(page: Page): string[] {
  const errors: string[] = []

  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(`console: ${message.text()}`)
    }
  })
  page.on("pageerror", (error) => {
    errors.push(`pageerror: ${error.message}`)
  })

  return errors
}

async function expectHealthyPage(page: Page, clientErrors: string[]) {
  await expect(page.locator("body")).not.toHaveText("")
  await expect(
    page.locator(
      '[data-nextjs-dialog], .vite-error-overlay, #webpack-dev-server-client-overlay'
    )
  ).toHaveCount(0)
  expect(clientErrors, "the rendered page emitted browser errors").toEqual([])
}

// Retired fee language stays off public pages. A dollar amount is allowed only
// in the same card or band as a not-for-sale statement (#108 comment 6785833334).
const RETIRED_FEE_CLAIM =
  /\d\s?%|per completed load|completed-load fee|\bDispatch Pro\b|\bnationwide\b|launched state|\bfounding\b|\$\d+\s*\/\s*mo/i

test("public pricing shows landing plan prices as not for sale", async ({
  page
}) => {
  const clientErrors = captureClientErrors(page)

  await page.goto("/pricing")
  await page.waitForLoadState("domcontentloaded")

  await expect(
    page.getByRole("heading", { name: "Haulers and fleets are free." })
  ).toBeVisible()
  await expect(page.getByText("Billing is not open.", { exact: true })).toBeVisible()
  await expect(
    page.getByText(
      "Nothing on this page charges you, and creating an account does not start a charge. Plan terms will be published before any plan is sold.",
      { exact: true }
    )
  ).toBeVisible()
  await expect(
    page.getByText(
      "LogLoads charges no per-load, percentage or transaction fees, and takes nothing from driver pay.",
      { exact: false }
    )
  ).toBeVisible()
  await expect(page.locator(".page-intro")).toContainText("plus applicable taxes")
  await expect(page.locator(".page-intro")).toContainText(
    "Prices and plan features can change before plans go on sale."
  )
  await expect(page.locator(".page-intro")).toContainText(
    "Plan features are planned and are not all available yet."
  )
  await expect(page.locator(".pricing-availability")).toContainText(
    "Prices and plan features can change before plans go on sale."
  )
  await expect(page.locator(".pricing-availability")).toContainText(
    "Plan features are planned and are not all available yet."
  )
  await expect(
    page.getByText(
      "Invitations you do not send expire at the reset. They do not roll over. Sponsored placement is not offered yet.",
      { exact: true }
    )
  ).toBeVisible()

  const cards = page.locator(".pricing-card")
  await expect(cards).toHaveCount(5)

  const hauler = pricingCard(page, "Hauler")
  await expect(hauler).toContainText("Free")
  await expect(hauler).toContainText(
    "Find hauling work, list your trucks and availability, and message landings. No card and no paywall."
  )
  await expect(hauler).not.toContainText("free forever")
  await expect(
    hauler.getByRole("link", { name: "Create hauler profile" })
  ).toHaveAttribute("href", "/sign-up?path=driver")

  const fleet = pricingCard(page, "Fleet")
  await expect(fleet).toContainText("Free")
  await expect(fleet).toContainText(
    "The same tools for a hauling business with more than one truck. No subscription and no truck limit."
  )
  await expect(
    fleet.getByRole("link", { name: "Create fleet profile" })
  ).toHaveAttribute("href", "/sign-up?path=fleet")

  for (const plan of [
    { facts: ["1 active landing", "2 team members, including you", "3 targeted invitations per billing cycle"], name: "Basic", positioning: "Advertise your work." },
    { facts: ["3 active landings", "5 team members, including you", "10 targeted invitations per billing cycle"], name: "Pro", positioning: "Find trucks faster." },
    { facts: ["Unlimited active landings", "10 team members, including you", "30 targeted invitations per billing cycle"], name: "Regional", positioning: "Recruit across your operation." }
  ]) {
    const card = pricingCard(page, plan.name)
    await expect(card).toContainText(plan.positioning)
    await expect(card).toContainText("Not for sale yet")
    await expect(card).toContainText("per month, plus applicable taxes")
    await expect(card).toContainText("Prices and plan features can change before plans go on sale.")
    await expect(card).toContainText("Plan features are planned and are not all available yet.")
    await expect(card).toContainText("Unlimited job posts, inquiries and replies.")
    for (const fact of plan.facts) {
      await expect(card).toContainText(fact)
    }
    await expect(card.getByRole("link")).toHaveCount(0)
    await expect(card.getByRole("button")).toHaveCount(0)
    const text = await card.innerText()
    expect(text).toMatch(/\$\d/)
    expect(text.toLowerCase()).toContain("not for sale")
  }

  await expect(
    page.getByRole("link", { name: "Create a landing profile" })
  ).toHaveCount(1)
  await expect(
    page.getByRole("link", { name: "Create a landing profile" })
  ).toHaveAttribute("href", "/sign-up?path=host")
  await expect(page.getByRole("button", { name: /payment|choose plan|subscribe|checkout/i })).toHaveCount(0)
  await expect(page.locator("button:disabled")).toHaveCount(0)
  await expect(page.locator("body")).not.toContainText(/free forever/i)
  await expect(page.locator("body")).not.toContainText(RETIRED_FEE_CLAIM)
  await expect(page.locator("body")).not.toContainText(/\$99|\$199/)
  await expect(page.locator('a[href*="subscription-checkout"]')).toHaveCount(0)

  for (const retiredPlan of [
    "Dispatch Pro",
    "Network Pilot",
    "Network 25",
    "Network 50",
    "Network 100",
    "Enterprise custom"
  ]) {
    await expect(pricingCard(page, retiredPlan)).toHaveCount(0)
  }

  await expect(page).toHaveTitle(/Pricing.*Haulers and fleets are free.*LogLoads/)
  const description = await page.locator('meta[name="description"]').getAttribute("content")
  expect(description ?? "").toMatch(
    /Basic \$149 per month, plus applicable taxes, Pro \$299 per month, plus applicable taxes and Regional \$499 per month, plus applicable taxes/
  )
  expect(description?.toLowerCase()).toContain("not for sale yet")
  expect(description).toContain("Prices and plan features can change before plans go on sale.")
  expect(description).toContain("Plan features are planned and are not all available yet.")

  const intro = await page.locator(".page-intro").innerText()
  expect(intro).toMatch(/\$\d/)
  expect(intro.toLowerCase()).toContain("not for sale")

  await expectHealthyPage(page, clientErrors)
})

test("home and for-landings follow the pricing ruling", async ({ page }) => {
  const clientErrors = captureClientErrors(page)

  await page.goto("/")
  await page.waitForLoadState("domcontentloaded")
  await expect(page.getByText("Free for haulers and fleets.", { exact: true }).first()).toBeVisible()
  await expect(
    page.getByText(
      "Finding work, listing your trucks and messaging landings will not cost you anything.",
      { exact: false }
    ).first()
  ).toBeVisible()
  await expect(page.locator("body")).not.toContainText(/free forever/i)
  const homeBand = page.getByText(
    /Haulers and fleets are free\. Landing plans, not for sale yet: Basic \$149 per month, plus applicable taxes, Pro \$299 per month, plus applicable taxes, Regional \$499 per month, plus applicable taxes\./
  )
  await expect(homeBand).toBeVisible()
  await expect(homeBand).toContainText("Prices and plan features can change before plans go on sale.")
  await expect(homeBand).toContainText("Plan features are planned and are not all available yet.")
  await expect(page.locator("body")).not.toContainText(/has not been published|Not yet published|nationwide|launched state/i)

  await page.goto("/for-landings")
  await page.waitForLoadState("domcontentloaded")
  await expect(page.getByRole("heading", { exact: true, name: "Basic" })).toBeVisible()
  await expect(page.getByRole("heading", { exact: true, name: "Pro" })).toBeVisible()
  await expect(page.getByRole("heading", { exact: true, name: "Regional" })).toBeVisible()
  await expect(page.getByText("1 active landing")).toBeVisible()
  await expect(page.getByText("Unlimited active landings")).toBeVisible()
  await expect(page.getByRole("link", { name: "See pricing" })).toHaveAttribute("href", "/pricing")
  await expect(page.locator("body")).not.toContainText(/\$\s?\d/)
  await expect(page.getByText("separate pilot approval", { exact: false })).toBeVisible()

  await expectHealthyPage(page, clientErrors)
})

test("public terms no longer describe the retired 5% host fee", async ({
  page
}) => {
  const clientErrors = captureClientErrors(page)

  await page.goto("/terms")
  await page.waitForLoadState("domcontentloaded")

  await expect(
    page.getByRole("heading", { exact: true, name: "2. What LogLoads is not" })
  ).toBeVisible()
  await expect(
    page.getByText(
      "LogLoads does not arrange transportation, select carriers, negotiate for either side, set rates, handle freight money or become a party to any hauling agreement.",
      { exact: false }
    ).first()
  ).toBeVisible()
  await expect(page.locator(".legal-effective")).toHaveText(
    "Effective November 18, 2026 · Version terms-2026-11-18"
  )
  for (const retiredSection of ["Host platform fee", "Agreement and payment method"]) {
    await expect(
      page.getByRole("heading", { exact: true, name: retiredSection })
    ).toHaveCount(0)
  }
  await expect(page.locator("main")).not.toContainText(
    /\d\s?%|per completed load|completed-load fee|monthly in arrears/i
  )

  // #329: a draft for counsel, never presented as approved.
  await expect(
    page.getByRole("complementary", { name: "Draft status" })
  ).toContainText("A licensed attorney has not reviewed it yet")

  // LE-13: the rewrite is announced, and both earlier texts stay one click away.
  const changeNotice = page.getByRole("complementary", { name: "Change notice" })
  await expect(changeNotice).toContainText("Change notice · November 18, 2026")
  await expect(
    changeNotice.getByRole("link", {
      exact: true,
      name: "Terms of Service as changed on November 2, 2026"
    })
  ).toHaveAttribute("href", "/terms/2026-11-02")
  await expect(
    page.getByRole("link", {
      exact: true,
      name: "Terms of Service effective August 3, 2026"
    })
  ).toHaveAttribute("href", "/terms/2026-08-03")

  await expectHealthyPage(page, clientErrors)
})

test("the August 3, 2026 Terms stay readable, unchanged, for agreements accepted under them", async ({
  page
}) => {
  const clientErrors = captureClientErrors(page)

  await page.goto("/terms/2026-08-03")
  await page.waitForLoadState("domcontentloaded")

  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Terms of Service — archived version effective August 3, 2026"
    })
  ).toBeVisible()
  await expect(page.locator(".legal-notice")).toContainText(
    "Superseded — kept for agreements accepted under this version"
  )
  await expect(page.locator(".legal-effective")).toHaveText("Effective August 3, 2026")
  for (const section of [
    "What LogLoads is",
    "Host platform fee",
    "Agreement and payment method",
    "Independent businesses and limits on liability"
  ]) {
    await expect(
      page.getByRole("heading", { exact: true, name: section })
    ).toBeVisible()
  }
  await expect(
    page.getByText(
      "For each completed load, the host owes LogLoads a platform fee equal to 5% of the driver pay the host stated for that load.",
      { exact: false }
    ).first()
  ).toBeVisible()
  await expect(
    page.getByText(
      "A $500 load means $500 paid directly to the driver plus a $25 LogLoads fee",
      { exact: true }
    )
  ).toBeVisible()
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    /noindex/
  )
  await expect(
    page.getByRole("link", { exact: true, name: "Read the current Terms of Service" })
  ).toHaveAttribute("href", "/terms")

  await expectHealthyPage(page, clientErrors)
})

test("an active host sees the retired percentage record, direct driver pay, and no subscription checkout", async ({
  page
}) => {
  const clientErrors = captureClientErrors(page)

  await signIn(page, "cole@summit.example")
  await page.goto("/host/billing")
  await page.waitForLoadState("domcontentloaded")

  await expect(
    page.getByRole("heading", { exact: true, name: "Billing" })
  ).toBeVisible()
  await expect(
    page.getByRole("heading", {
      name: "Not charged on new loads"
    })
  ).toBeVisible()
  await expect(
    page.getByRole("heading", { name: "5% of stated driver pay, added on top" })
  ).toHaveCount(0)
  await expect(page.getByText("This fee is retired.", { exact: false })).toBeVisible()
  await expect(
    page.getByText("Historical percentage agreement on record", { exact: false })
  ).toBeVisible()
  await expect(page.getByText("Current percentage agreement active")).toHaveCount(0)
  await expect(page.getByText("You state the driver is paid", { exact: true })).toBeVisible()
  await expect(page.getByText("LogLoads fee, on top")).toBeVisible()
  await expect(page.getByText("Your total cost")).toBeVisible()
  await expect(
    page.getByText("The driver receives exactly this")
  ).toBeVisible()

  await expect(
    page.getByRole("button", { name: "Accept 5% host agreement" })
  ).toHaveCount(0)
  await expect(
    page.locator('a[href*="subscription-checkout"]')
  ).toHaveCount(0)
  await expect(
    page.getByRole("button", { name: /subscription|enrollment|plan change/i })
  ).toHaveCount(0)
  await expect(page.getByText("Network enrollment", { exact: true })).toHaveCount(0)
  await expect(page.getByText("Not enrolled", { exact: true })).toHaveCount(0)
  await expect(page.getByText("Base subscription", { exact: true })).toHaveCount(0)
  await expect(
    page.getByRole("heading", { exact: true, name: "Workspace capacity" })
  ).toBeVisible()
  await expect(
    page.getByText(
      "This tracks landing locations configured in your workspace. It is separate from completed-load platform fees.",
      { exact: true }
    )
  ).toBeVisible()

  await expectHealthyPage(page, clientErrors)
})

test("a fleet sees included Fleet Free access with no paid-plan residue", async ({
  page
}) => {
  const clientErrors = captureClientErrors(page)

  await signIn(page, "dispatch@northpine.example")
  await page.goto("/fleet/billing")
  await page.waitForLoadState("domcontentloaded")

  const currentAccess = page.locator(".plan-card").filter({
    has: page.getByRole("heading", { exact: true, name: "Fleet Free" })
  })

  await expect(currentAccess).toBeVisible()
  await expect(currentAccess).toContainText("Current access")
  await expect(currentAccess).toContainText("Free")
  await expect(currentAccess).toContainText("Included")
  await expect(currentAccess).toContainText("no LogLoads truck limit")

  for (const retiredCopy of [
    "Dispatch Pro",
    "$499",
    "Trial",
    "Start subscription",
    "Restart subscription",
    "checkout is temporarily unavailable"
  ]) {
    await expect(page.getByText(retiredCopy, { exact: false })).toHaveCount(0)
  }

  await page.goto("/fleet/settings")
  await page.waitForLoadState("domcontentloaded")
  await expect(
    page.getByRole("heading", { name: "Access & billing history" })
  ).toBeVisible()
  await expect(page.getByText("Fleet Free", { exact: true })).toBeVisible()
  await expect(page.getByText("Free", { exact: true })).toBeVisible()
  await expect(page.getByText("Included", { exact: true })).toBeVisible()
  await expect(page.getByText("$499", { exact: false })).toHaveCount(0)
  await expect(page.getByText("Trial", { exact: false })).toHaveCount(0)

  await expectHealthyPage(page, clientErrors)
})

test("admin billing shows the retired percentage fee and subscription writes stay closed", async ({
  page
}) => {
  const clientErrors = captureClientErrors(page)

  await signIn(page, "admin@logloads.example")

  const billingWrites: string[] = []
  page.on("request", (request) => {
    if (
      request.method() !== "GET" &&
      request.url().includes("/api/admin/billing")
    ) {
      billingWrites.push(`${request.method()} ${request.url()}`)
    }
  })

  await page.goto("/admin/billing")
  await page.waitForLoadState("domcontentloaded")

  await expect(
    page.getByRole("heading", { exact: true, name: "Billing" })
  ).toBeVisible()
  await expect(
    page.getByRole("heading", { name: "Current host billing position" })
  ).toBeVisible()
  await expect(page.getByText("Percentage organizations").first()).toBeVisible()
  await expect(
    page.getByText(
      "The 5% platform fee is retired and is not current host revenue.",
      { exact: false }
    )
  ).toBeVisible()
  await expect(
    page.getByRole("heading", { name: "New subscription writes are closed" })
  ).toBeVisible()
  await expect(
    page.getByRole("heading", {
      exact: true,
      name: "Historical subscription operations"
    })
  ).toBeVisible()

  await expect(
    page.locator("summary").filter({ hasText: "Record accepted subscription plan" })
  ).not.toBeVisible()
  await expect(
    page.getByRole("button", { name: "Authorize paid activation" })
  ).not.toBeVisible()
  expect(
    billingWrites,
    "reading admin billing must not mutate billing state"
  ).toEqual([])

  await expectHealthyPage(page, clientErrors)
})
