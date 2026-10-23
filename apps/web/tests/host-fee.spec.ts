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

test("public pricing states the one 2% host fee, with drivers and fleets free", async ({
  page
}) => {
  const clientErrors = captureClientErrors(page)

  await page.goto("/pricing")
  await page.waitForLoadState("domcontentloaded")

  await expect(
    page.getByRole("heading", {
      name: "Drivers and fleets stay free. Hosts pay 2% on top."
    })
  ).toBeVisible()
  await expect(
    page.getByRole("heading", {
      name: "One fee, paid by the host. No monthly fee. No minimum."
    })
  ).toBeVisible()

  const cards = page.locator(".pricing-card")
  await expect(cards).toHaveCount(3)

  await expect(pricingCard(page, "Driver")).toContainText("Free")

  const fleet = pricingCard(page, "Fleet")
  await expect(fleet).toContainText("Free")
  await expect(fleet).toContainText("whoever's trucks haul it")
  await expect(
    fleet.getByRole("link", { name: "Create fleet workspace" })
  ).toHaveAttribute("href", "/sign-up?path=fleet")

  const host = pricingCard(page, "Host")
  await expect(host).toContainText("2% per completed load")
  await expect(host).toContainText("No charge to post")
  await expect(host).toContainText("No monthly fee or minimum")
  await expect(host).toContainText("$500 driver pay + $10 LogLoads fee = $510")

  await expect(
    page.getByText(
      "If the host states that one load pays the driver $500, the driver receives $500. The LogLoads fee is $10, so the host's total cost is $510.",
      { exact: false }
    )
  ).toBeVisible()
  await expect(
    page.getByText(
      "Drafts, postings, searches, requests, unaccepted offers, cancellations before completion, and duplicates do not.",
      { exact: false }
    )
  ).toBeVisible()
  await expect(page).toHaveTitle(/Pricing.*Free for drivers and fleets.*LogLoads/)

  await expectHealthyPage(page, clientErrors)
})

test("public terms bind the 2% fee without changing driver pay", async ({
  page
}) => {
  const clientErrors = captureClientErrors(page)

  await page.goto("/terms")
  await page.waitForLoadState("domcontentloaded")

  await expect(
    page.getByText(
      "Hosts pay LogLoads a 2% platform fee on top of the driver pay stated for each completed load",
      { exact: false }
    )
  ).toBeVisible()
  await expect(page.getByText("Effective October 14, 2026")).toBeVisible()
  await expect(page.getByText(/monthly in arrears/i).first()).toBeVisible()
  await expect(page.getByText(/never deducted from driver pay/i).first()).toBeVisible()
  await expect(page.getByText(/Drivers and fleets pay LogLoads nothing/).first()).toBeVisible()

  await expectHealthyPage(page, clientErrors)
})

test("a host with accepted fee terms sees the 2% fee on top of direct driver pay", async ({
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
      name: "2% of stated driver pay, added on top"
    })
  ).toBeVisible()
  await expect(page.getByText("Fee terms accepted", { exact: false })).toBeVisible()
  await expect(page.getByText("You state the driver is paid", { exact: true })).toBeVisible()
  await expect(page.getByText("LogLoads fee, on top")).toBeVisible()
  await expect(page.getByText("Your total cost")).toBeVisible()
  await expect(
    page.getByText("The driver receives exactly this")
  ).toBeVisible()
  await expect(
    page.getByText(/Drivers and fleets pay nothing to use LogLoads/)
  ).toBeVisible()

  // Already accepted: there is nothing left to accept.
  await expect(
    page.getByRole("button", { name: "Accept the 2% host fee" })
  ).toHaveCount(0)

  await expectHealthyPage(page, clientErrors)
})

test("a fleet has no billing surface, because fleets pay nothing", async ({
  page
}) => {
  await signIn(page, "dispatch@northpine.example")

  const response = await page.goto("/fleet/billing")

  expect(response?.status()).toBe(404)
})

test("admin billing shows the host fee ledger and reads without writing", async ({
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
    page.getByRole("heading", { name: "Host fee ledger" })
  ).toBeVisible()
  await expect(page.getByText("Hosts with accepted fee terms").first()).toBeVisible()
  await expect(
    page.getByText(
      "LogLoads bills each host 2% of the driver pay it stated on every completed load",
      { exact: false }
    )
  ).toBeVisible()
  await expect(
    page.getByRole("heading", { exact: true, name: "Fee attention" })
  ).toBeVisible()
  await expect(
    page.getByRole("link", { name: "Export fees and invoices (CSV)" })
  ).toHaveAttribute("href", "/api/admin/billing/export")
  expect(
    billingWrites,
    "reading admin billing must not mutate billing state"
  ).toEqual([])

  await expectHealthyPage(page, clientErrors)
})
