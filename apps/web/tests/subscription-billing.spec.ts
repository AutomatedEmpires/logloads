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

test("public pricing states the single 5% completed-load model", async ({
  page
}) => {
  const clientErrors = captureClientErrors(page)

  await page.goto("/pricing")
  await page.waitForLoadState("domcontentloaded")

  await expect(
    page.getByRole("heading", {
      name: "Drivers and fleets stay free. Hosts pay 5% on top."
    })
  ).toBeVisible()
  await expect(
    page.getByRole("heading", {
      name: "No software subscription. No monthly minimum. No tiers."
    })
  ).toBeVisible()

  const cards = page.locator(".pricing-card")
  await expect(cards).toHaveCount(3)

  await expect(pricingCard(page, "Driver")).toContainText("Free forever")

  const fleet = pricingCard(page, "Fleet Free")
  await expect(fleet).toContainText("Free")
  await expect(fleet).toContainText("No subscription, trial clock, or LogLoads truck limit")
  await expect(fleet).toContainText("Private partner work")
  await expect(
    fleet.getByRole("link", { name: "Create fleet workspace" })
  ).toHaveAttribute("href", "/sign-up?path=fleet")

  const host = pricingCard(page, "Host")
  await expect(host).toContainText("5% per completed load")
  await expect(host).toContainText("No charge to post")
  await expect(host).toContainText("No subscription or monthly minimum")
  await expect(host).toContainText("$500 driver pay + $25 LogLoads fee = $525")

  await expect(
    page.getByText(
      "If the host states that one load pays the driver $500, the driver receives $500. The LogLoads fee is $25, so the host's total cost is $525.",
      { exact: false }
    )
  ).toBeVisible()
  await expect(
    page.getByText(
      "Drafts, postings, searches, requests, unaccepted offers, cancellations before completion, and duplicates do not.",
      { exact: false }
    )
  ).toBeVisible()

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
  await expect(
    page.locator('a[href*="subscription-checkout"]')
  ).toHaveCount(0)
  await expect(page).toHaveTitle(/Pricing.*Free for drivers and fleets.*LogLoads/)
  await expect(
    page.getByText(
      "Drivers and fleets use LogLoads without a subscription. Hosts pay a 5% platform fee on top of stated driver pay only when a load completes.",
      { exact: false }
    )
  ).toBeVisible()

  await expectHealthyPage(page, clientErrors)
})

test("public terms bind the 5% fee without changing driver pay", async ({
  page
}) => {
  const clientErrors = captureClientErrors(page)

  await page.goto("/terms")
  await page.waitForLoadState("domcontentloaded")

  await expect(
    page.getByText(
      "Hosts pay LogLoads a 5% platform fee on top of the driver pay stated for each completed load.",
      { exact: false }
    )
  ).toBeVisible()
  await expect(page.getByText("Effective August 3, 2026")).toBeVisible()
  await expect(page.getByText(/monthly in arrears/i).first()).toBeVisible()
  await expect(page.getByText(/never deducted from driver pay/i).first()).toBeVisible()

  await expectHealthyPage(page, clientErrors)
})

test("an active host sees percentage billing, direct driver pay, and no subscription checkout", async ({
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
      name: "5% of stated driver pay, added on top"
    })
  ).toBeVisible()
  await expect(
    page.getByText("Current percentage agreement active", { exact: false })
  ).toBeVisible()
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

test("admin billing is percentage-first and subscription writes stay closed", async ({
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
      "Current host revenue is the 5% platform fee added on top of stated driver pay for completed loads.",
      { exact: false }
    )
  ).toBeVisible()
  await expect(
    page.getByRole("heading", { name: "New subscription writes are closed" })
  ).toBeVisible()
  await expect(
    page.getByText("Read-only subscription operations", { exact: false })
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
