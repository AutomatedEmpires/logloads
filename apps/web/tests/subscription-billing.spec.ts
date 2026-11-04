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

// The retired percentage fee stays off public pages. The only dollar amounts
// allowed there are the locked landing memberships, which are not for sale.
const RETIRED_COMMERCIAL_CLAIM =
  /\d\s?%|per completed load|completed-load fee/i

test("public pricing shows the locked landing prices and nothing for sale", async ({
  page
}) => {
  const clientErrors = captureClientErrors(page)

  await page.goto("/pricing")
  await page.waitForLoadState("domcontentloaded")

  await expect(
    page.getByRole("heading", {
      name: "Pricing for landing organizations is not published yet."
    })
  ).toBeVisible()
  await expect(
    page.getByRole("heading", {
      name: "Three ways to use the load board."
    })
  ).toBeVisible()
  await expect(page.getByText("Nothing is for sale yet.")).toBeVisible()

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
  await expect(host).toContainText("$149 / $299 / $499")
  await expect(host).toContainText("not available for purchase yet")
  await expect(
    host.getByRole("link", { name: "Create host workspace" })
  ).toHaveAttribute("href", "/sign-up?path=host")

  await expect(
    page.getByText("they are not available for purchase yet", { exact: false })
  ).toBeVisible()
  await expect(page.locator("body")).not.toContainText(RETIRED_COMMERCIAL_CLAIM)
  await expect(page.locator("body")).not.toContainText(/platform fee/i)

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
      "LogLoads is a timber-hauling load board that connects businesses needing log trucks with hauling businesses.",
      { exact: false }
    )
  ).toBeVisible()

  await expectHealthyPage(page, clientErrors)
})

test("public terms no longer describe the retired 5% host fee", async ({
  page
}) => {
  const clientErrors = captureClientErrors(page)

  await page.goto("/terms")
  await page.waitForLoadState("domcontentloaded")

  await expect(
    page.getByRole("heading", { exact: true, name: "What LogLoads is" })
  ).toBeVisible()
  await expect(
    page.getByText(
      "LogLoads does not carry freight or receive, escrow, deduct from, or distribute transportation compensation.",
      { exact: false }
    ).first()
  ).toBeVisible()
  await expect(page.locator(".legal-effective")).toHaveText("Effective August 3, 2026")
  for (const retiredSection of ["Host platform fee", "Agreement and payment method"]) {
    await expect(
      page.getByRole("heading", { exact: true, name: retiredSection })
    ).toHaveCount(0)
  }
  await expect(page.locator("body")).not.toContainText(
    RETIRED_COMMERCIAL_CLAIM
  )
  await expect(page.locator("body")).not.toContainText(/monthly in arrears/i)

  // LE-13: the removal is announced, and the removed text stays one click away.
  const changeNotice = page.locator(".legal-notice")
  await expect(changeNotice).toContainText("Change notice · November 2, 2026")
  await expect(changeNotice).toContainText(
    "sections were removed from these Terms because the per-load fee model was retired."
  )
  await expect(
    changeNotice.getByRole("link", {
      exact: true,
      name: "archived Terms of Service effective August 3, 2026"
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

test("an active host sees locked membership prices and no percentage offer", async ({
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
      name: "Basic $149, Pro $299, or Regional $499 per month"
    })
  ).toBeVisible()
  await expect(
    page.getByText("The completed-load percentage fee is retired", { exact: false })
  ).toBeVisible()
  await expect(page.getByText("You state the driver is paid", { exact: true })).toHaveCount(0)
  await expect(page.getByText("LogLoads fee, on top")).toHaveCount(0)

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
    page.getByRole("heading", { name: "Retired fee ledger" })
  ).toBeVisible()
  await expect(page.getByText("Current percentage organizations").first()).toBeVisible()
  await expect(
    page.getByText("The completed-load percentage fee is retired", { exact: false })
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
