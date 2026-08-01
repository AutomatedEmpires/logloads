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

test("public pricing states the fixed catalog and completed-movement economics", async ({
  page
}) => {
  const clientErrors = captureClientErrors(page)

  await page.goto("/pricing")
  await page.waitForLoadState("domcontentloaded")

  await expect(
    page.getByRole("heading", {
      name: "Drivers stay free. Hosts pay for an operating Network."
    })
  ).toBeVisible()
  await expect(
    page.getByText(
      "There is no posting fee. Network plans include a defined number of completed Network-coordinated physical load movements, with automatic flat overage after the allowance. Driver or carrier compensation remains separate and is paid directly by the host.",
      { exact: true }
    )
  ).toBeVisible()

  const cards = page.locator(".pricing-card")
  await expect(cards).toHaveCount(6)

  const driver = pricingCard(page, "Driver")
  await expect(driver).toContainText("Free forever")

  const dispatch = pricingCard(page, "Dispatch Pro")
  await expect(dispatch).toContainText("$499/mo")
  await expect(dispatch).toContainText("No LogLoads Network units")
  await expect(dispatch).toContainText("No Network usage billing")

  const network25 = pricingCard(page, "Network 25")
  await expect(network25).toContainText("$3,000/mo")
  await expect(network25).toContainText("25 completed Network loads/month")
  await expect(network25).toContainText("$125 per additional completion")
  await expect(network25).toContainText(
    "12 months, billed monthly · $36,000 base commitment"
  )

  const network50 = pricingCard(page, "Network 50")
  await expect(network50).toContainText("$5,500/mo")
  await expect(network50).toContainText("50 completed Network loads/month")
  await expect(network50).toContainText("$110 per additional completion")
  await expect(network50).toContainText(
    "12 months, billed monthly · $66,000 base commitment"
  )

  const network100 = pricingCard(page, "Network 100")
  await expect(network100).toContainText("$10,000/mo")
  await expect(network100).toContainText("100 completed Network loads/month")
  await expect(network100).toContainText("$90 per additional completion")
  await expect(network100).toContainText(
    "12 months, billed monthly · $120,000 base commitment"
  )

  const enterprise = pricingCard(page, "Enterprise custom")
  await expect(enterprise).toContainText("250+ completed Network loads")
  await expect(enterprise).toContainText("never an unlimited-load promise")
  await expect(enterprise).toContainText("Negotiated annual commitment")

  await expect(
    page.getByText(
      "Network 25 at 30 completed movements is $3,000 + 5 × $125 = $3,625.",
      { exact: false }
    )
  ).toBeVisible()
  await expect(
    page.getByText(
      "Network 50 at 60 is $5,500 + 10 × $110 = $6,600.",
      { exact: false }
    )
  ).toBeVisible()
  await expect(
    page.getByText(
      "Network 100 at 110 is $10,000 + 10 × $90 = $10,900.",
      { exact: false }
    )
  ).toBeVisible()
  await expect(
    page.getByText(
      "Actual transportation compensation is separate, remains payable directly by the host, and is never reduced by a LogLoads charge.",
      { exact: false }
    )
  ).toBeVisible()

  await expectHealthyPage(page, clientErrors)
})

test("the paid Pilot is invitation-only and is not a public plan card", async ({
  page
}) => {
  const clientErrors = captureClientErrors(page)

  await page.goto("/pricing")
  await page.waitForLoadState("domcontentloaded")

  const cards = page.locator(".pricing-card")
  await expect(cards).toHaveCount(6)
  await expect(cards.filter({ hasText: "Network Pilot" })).toHaveCount(0)

  const pilot = page.locator(".legal-note").filter({
    has: page.getByRole("heading", {
      name: "The paid Pilot is invitation-only."
    })
  })
  await expect(pilot).toBeVisible()
  await expect(pilot).toContainText("$1,500 per month")
  await expect(pilot).toContainText("exact 90-day operating engagement")
  await expect(pilot).toContainText("$4,500 minimum base commitment")
  await expect(pilot).toContainText(
    "30 completed Network movements are pooled across the engagement"
  )
  await expect(pilot).toContainText(
    "additional completed movements are $150 each"
  )
  await expect(pilot).toContainText(
    "The Pilot is not available through public self-service checkout."
  )
  await expect(
    page.locator('.pricing-card a[href*="subscription-checkout"]')
  ).toHaveCount(0)

  await expectHealthyPage(page, clientErrors)
})

test("a grandfathered host sees legacy terms without a new subscription Checkout", async ({
  page
}) => {
  const clientErrors = captureClientErrors(page)

  await signIn(page, "cole@summit.example")
  await page.goto("/host/billing")
  await page.waitForLoadState("domcontentloaded")

  await expect(
    page.getByRole("heading", { exact: true, name: "Billing" })
  ).toBeVisible()

  const currentPlan = page.getByRole("region", { name: "Current plan" })
  await expect(currentPlan).toBeVisible()
  await expect(
    currentPlan.getByRole("heading", { name: "Legacy host terms" })
  ).toBeVisible()
  await expect(currentPlan).toContainText("Legacy 5%")
  await expect(currentPlan).toContainText(
    "Legacy percentage terms — no new enrollment"
  )
  await expect(currentPlan).toContainText(
    "This organization remains on an explicit grandfathered percentage agreement until an audited cutover."
  )
  await expect(currentPlan).toContainText(
    "driver compensation remains direct"
  )

  await expect(
    page.getByRole("button", {
      name: "Accept terms & continue to payment"
    })
  ).toHaveCount(0)
  await expect(
    page.getByRole("button", { name: "Complete approved enrollment" })
  ).toHaveCount(0)
  await expect(
    page.getByText("This opens the exact plan already accepted", {
      exact: false
    })
  ).toHaveCount(0)
  await expect(
    page.getByRole("heading", { name: /Network (Pilot|25|50|100)/ })
  ).toHaveCount(0)

  await expectHealthyPage(page, clientErrors)
})

test("tablet billing and public story layouts keep their hierarchy without overlap", async ({
  page
}, testInfo) => {
  test.skip(
    testInfo.project.name === "mobile-chrome",
    "this path verifies the exact 768px app-shell and public-page layouts"
  )

  await page.setViewportSize({ height: 1024, width: 768 })
  await signIn(page, "cole@summit.example")
  await page.goto("/host/billing")
  await page.waitForLoadState("domcontentloaded")

  const enrollment = page.locator(".subscription-overview")
  await expect(
    page.getByRole("heading", { exact: true, name: "Billing" })
  ).toBeVisible()
  await expect(enrollment).toBeVisible()
  const facts = enrollment.locator(".subscription-overview__facts")
  const balance = enrollment.locator(".subscription-overview__balance")
  const factsBox = await facts.boundingBox()
  const balanceBox = await balance.boundingBox()

  expect(factsBox).not.toBeNull()
  expect(balanceBox).not.toBeNull()
  expect(balanceBox!.y).toBeGreaterThanOrEqual(
    factsBox!.y + factsBox!.height - 1
  )
  const billingViewportWidth = await page.evaluate(
    () => document.documentElement.clientWidth
  )
  const billingContentWidth = await page.evaluate(
    () => document.documentElement.scrollWidth
  )
  expect(billingContentWidth).toBeLessThanOrEqual(billingViewportWidth + 1)
  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath("host-billing-tablet.png")
  })

  await page.goto("/for-landings")
  await page.waitForLoadState("domcontentloaded")
  const storyAction = page
    .locator(".story-hero")
    .getByRole("link", { name: "Publish your first load" })
  const storyActionBox = await storyAction.boundingBox()
  expect(storyActionBox).not.toBeNull()
  expect(storyActionBox!.y + storyActionBox!.height).toBeLessThanOrEqual(1024)
  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath("for-landings-tablet.png")
  })

  await page.goto("/how-it-works")
  const timelineItems = page.locator(".story-grid--timeline > li")
  const firstItemBox = await timelineItems.nth(0).boundingBox()
  const lastItemBox = await timelineItems.nth(2).boundingBox()
  expect(firstItemBox).not.toBeNull()
  expect(lastItemBox).not.toBeNull()
  expect(lastItemBox!.width).toBeGreaterThan(firstItemBox!.width * 1.5)
})

test("admin billing exposes every configurable tier without overstating revenue or enrollment", async ({
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
    page.getByRole("heading", { name: "Commercial position" })
  ).toBeVisible()

  const activeSubscriptions = page.locator(".metric-tile").filter({
    hasText: "Active subscriptions"
  })
  await expect(activeSubscriptions.locator("strong")).toHaveText("0")

  const activeMrr = page.locator(".metric-tile").filter({
    hasText: "Active MRR"
  })
  await expect(activeMrr.locator("strong")).toHaveText("$0.00")

  const activeArr = page.locator(".metric-tile").filter({
    hasText: "Active ARR"
  })
  await expect(activeArr.locator("strong")).toHaveText("$0.00")

  await expect(
    page.getByRole("heading", {
      name: "No commercial subscriptions recorded."
    })
  ).toBeVisible()
  await expect(
    page.getByText(
      "The plan catalog does not prove enrollment. Plan mix begins only when an organization has an accepted canonical subscription record.",
      { exact: true }
    )
  ).toBeVisible()
  await expect(
    page.getByRole("heading", { name: "No subscriptions to review." })
  ).toBeVisible()

  await page
    .locator("summary")
    .filter({ hasText: "Record accepted subscription plan" })
    .click()
  const acceptedPlan = page.getByLabel("Accepted plan")
  await expect(acceptedPlan).toBeVisible()
  await expect(acceptedPlan.locator("option")).toHaveText([
    "Dispatch Pro",
    "Network Pilot",
    "Network 25",
    "Network 50",
    "Network 100",
    "Enterprise 250+"
  ])
  await expect(
    page.getByText(
      "Records a customer-accepted plan in configured-dark state; it does not activate billing.",
      { exact: true }
    )
  ).toBeVisible()
  await expect(
    page.getByText(
      "These controls call canonical domain services only. They do not create provider prices, charge Stripe, cancel a provider subscription, or rewrite accepted work.",
      { exact: false }
    )
  ).toBeVisible()
  await expect(
    page.getByText(
      "They do not call Stripe and do not claim that local state matches live provider state.",
      { exact: false }
    )
  ).toBeVisible()

  expect(
    billingWrites,
    "reading or expanding admin billing controls must not mutate billing state"
  ).toEqual([])
  await expectHealthyPage(page, clientErrors)
})
