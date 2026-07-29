import { expect, test, type Page } from "@playwright/test"

async function signIn(page: Page, email: string) {
  await page.goto("/sign-in")
  await page.waitForLoadState("domcontentloaded")
  await page.fill('input[name="email"]', email)
  await page.click('button[type="submit"]')
  await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"), { timeout: 30_000 })
}

test("visitor understands the public product and can inspect public loads", async ({ page }) => {
  await page.goto("/")

  await expect(page.getByRole("heading", { name: "Move more loads. Make fewer calls." })).toBeVisible()
  await expect(page.getByRole("link", { name: "Find a load" }).first()).toBeVisible()
  await expect(page.locator('img[src*="logloads-hero"]')).toBeVisible()
  await expect(page.locator('img[src*="logloads-logo"]').first()).toBeVisible()

  await page.goto("/loads")
  await expect(page.getByText("Exact access unlocks after assignment.").first()).toBeVisible()
  await expect(page.getByRole("button", { name: "Strong fit" })).toHaveCount(0)
})

test("cockpits are protected: unauthenticated visitors are sent to sign-in", async ({ page }) => {
  for (const route of ["/driver/map", "/fleet/command", "/host/command", "/admin", "/support"]) {
    await page.goto(route)
    await expect(page).toHaveURL(/\/sign-in/)
  }
})

test("driver signs in and reaches the map", async ({ page }) => {
  await signIn(page, "hank@northpine.example")

  await expect(page).toHaveURL(/\/driver\/map/)
  await expect(page.getByRole("heading", { name: "Map" })).toBeVisible()

  await page.goto("/driver/profile")
  await expect(page.getByText("Photo uploads are currently unavailable.").first()).toBeVisible()
  await expect(page.locator('input[type="file"][name="photo"]')).toHaveCount(0)
})

test("driver cannot open the admin console", async ({ page }) => {
  await signIn(page, "hank@northpine.example")
  await page.goto("/admin")
  await page.waitForURL((url) => !url.pathname.startsWith("/admin"), { timeout: 15_000 })
  await expect(page).not.toHaveURL(/\/admin/)
})

test("host signs in and reaches command with capacity view", async ({ page }) => {
  await signIn(page, "cole@summit.example")

  await page.goto("/host/command")
  await expect(page.getByRole("heading", { name: "Command" })).toBeVisible()
})

test("platform admin reaches the admin console", async ({ page }) => {
  await signIn(page, "admin@logloads.example")

  await page.goto("/admin")
  await expect(page.getByRole("heading", { name: "Admin" })).toBeVisible()
})

test("onboarding provisions a working driver account", async ({ page }) => {
  await page.goto("/onboarding")
  await page.waitForLoadState("domcontentloaded")
  await page.click("text=I haul timber")
  await expect(page.getByRole("radio", { name: /Owner-operator/ })).toBeChecked()
  await page.getByRole("button", { name: "Choose a different role" }).click()
  await page.getByRole("button", { name: /I have timber to move/ }).click()
  await expect(page.getByRole("radio", { name: /Logging contractor/ })).toBeChecked()
  await page.getByRole("button", { name: "Choose a different role" }).click()
  await page.getByRole("button", { name: /I haul timber/ }).click()
  await expect(page.getByRole("radio", { name: /Owner-operator/ })).toBeChecked()
  await page.waitForSelector('input[name="fullName"]')
  await page.fill('input[name="fullName"]', "Smoke Test Driver")
  await page.fill('input[name="email"]', `driver-${Date.now()}@smoke.example`)
  await page.fill('input[name="phone"]', "555-0142")
  await page.getByRole("button", { name: "Continue" }).click()
  await page.fill('input[name="region"]', "Test Valley")
  await page.getByRole("button", { name: "Continue" }).click()
  await expect(page.getByRole("radio", { name: /Available today/ })).toBeChecked()
  await page.getByRole("button", { name: "Show me matching loads" }).click()
  await page.waitForURL(/\/driver\/loads/, { timeout: 30_000 })
  await expect(page.getByRole("heading", { name: "Loads" })).toBeVisible()
})

test("host onboarding opens a mobile first-movement launchpad", async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name === "desktop-chrome",
    "this path sets and verifies the exact 390px host onboarding viewport"
  )

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/onboarding/host")
  await page.waitForLoadState("domcontentloaded")

  await expect(page.getByRole("radio", { name: /Logging contractor/ })).toBeChecked()
  await page.getByLabel("Full name").fill("Mobile Pilot Host")
  await page.getByLabel("Email").fill(`host-${Date.now()}@smoke.example`)
  await page.getByLabel("Phone").fill("555-0168")
  await page.getByRole("button", { name: "Continue" }).click()

  await page.getByLabel("Company or operation name").fill("Mobile Pilot Timber")
  await page.getByLabel("Operating region").fill("Test Valley")
  await page.getByRole("button", { name: "Continue" }).click()

  await expect(
    page.getByRole("group", { name: "Your workspace is ready to create" })
  ).toBeVisible()
  await page.getByRole("button", { name: "Create workspace and continue" }).click()
  await page.waitForURL(/\/host\/landings\?welcome=1/, { timeout: 30_000 })

  await expect(page.getByRole("heading", { name: "Landings", exact: true })).toBeVisible()
  await expect(page.getByRole("heading", { name: "Prepare your first timber movement" })).toBeVisible()
  const readiness = page.locator(".host-readiness")
  await expect(readiness.getByText("Add a landing", { exact: true })).toBeVisible()
  await expect(readiness.getByText("Add a lane", { exact: true })).toBeVisible()
  await expect(readiness.getByText("Add a pay rate", { exact: true })).toBeVisible()
  await expect(readiness.getByText("Prepare a draft", { exact: true })).toBeVisible()
  await expect(readiness.getByText("Assisted activation", { exact: true })).toBeVisible()
  await expect(readiness.getByText(/does not enroll or charge you/i)).toBeVisible()

  const primaryAction = readiness.getByRole("link", { name: "Add first landing" })
  const actionBox = await primaryAction.boundingBox()
  expect(actionBox?.height ?? 0).toBeGreaterThanOrEqual(44)
  expect(actionBox?.y ?? Number.POSITIVE_INFINITY).toBeLessThan(844)
  const viewportWidth = await page.evaluate(() => document.documentElement.clientWidth)
  const contentWidth = await page.evaluate(() => document.documentElement.scrollWidth)
  expect(contentWidth).toBeLessThanOrEqual(viewportWidth + 1)

  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath("host-first-movement-mobile.png")
  })

  await page.goto("/host/command")
  await expect(page.getByRole("heading", { name: "Finish workspace setup" })).toBeVisible()
  await expect(page.getByText("No truckloads scheduled")).toHaveCount(0)
  await expect(page.getByText("Every planned truckload is committed")).toHaveCount(0)
})

test("driver mobile navigation follows the directed flow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await signIn(page, "hank@northpine.example")

  const nav = page.getByRole("navigation", { name: "driver mobile navigation" })
  await expect(nav.getByRole("link")).toHaveText(["Map", "Loads", "Schedule", "Profile"])
  await expect(nav.getByRole("link", { name: "Map" })).toHaveAttribute("aria-current", "page")
  await page.getByRole("button", { name: "Open more tools" }).click()
  await expect(page.getByRole("navigation", { name: "More tools" }).getByRole("link", { name: "Assistant" })).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page.getByRole("button", { name: "Open more tools" })).toBeFocused()
})
