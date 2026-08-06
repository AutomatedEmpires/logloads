import { expect, test, type Page } from "@playwright/test"

async function signIn(page: Page, email: string) {
  await page.goto("/sign-in")
  await page.waitForLoadState("domcontentloaded")
  await page.fill('input[name="email"]', email)
  await page.click('button[type="submit"]')
  await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"), { timeout: 30_000 })
}

async function openPublicMenuIfNeeded(page: Page) {
  const menuTrigger = page.getByRole("button", { name: "Open menu" })
  const viewport = page.viewportSize()

  if (viewport && viewport.width <= 1100) {
    await expect(menuTrigger).toBeVisible()
    await menuTrigger.click()
  }
}

function watchPageErrors(page: Page): string[] {
  const errors: string[] = []

  page.on("pageerror", (error) => errors.push(error.message))
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text())
  })

  return errors
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
  await expect(page.getByRole("heading", { name: "Keep every record current" })).toBeVisible()
  const credentialVault = page.getByRole("region", { name: "Driver credential vault" })
  await expect(credentialVault).toBeVisible()
  await expect(credentialVault.getByText("NP-101 with pole trailer")).toBeVisible()
  await expect(credentialVault.getByText("Cleared", { exact: true })).toBeVisible()
  await expect(credentialVault.getByText(/Document uploads are temporarily unavailable/)).toBeVisible()
  await expect(credentialVault.locator('input[type="file"][name="document"]')).toHaveCount(0)
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

test("public entry reflects the active account and preserves driver intent", async ({ page }) => {
  test.slow()
  await signIn(page, "cole@summit.example")

  await page.goto("/")
  await openPublicMenuIfNeeded(page)

  await expect(page.getByRole("link", { name: "Open workspace" }).last()).toBeVisible()
  await expect(page.getByRole("link", { name: "Sign in" })).toHaveCount(0)

  await page.goto("/sign-in")
  await expect(page.getByRole("heading", { name: "You’re already signed in." })).toBeVisible()
  await expect(page.getByText("cole@summit.example", { exact: true })).toBeVisible()
  await expect(page).toHaveURL(/\/sign-in$/)

  await page.goto("/sign-up")
  await expect(page.getByRole("heading", { name: "This account is already set up." })).toBeVisible()
  await expect(page).toHaveURL(/\/sign-up$/)

  await page.goto("/")
  await page.getByRole("link", { name: "Create a driver profile" }).first().click()
  await expect(page).toHaveURL(/\/sign-up\?path=driver/)
  await expect(page.getByRole("heading", { name: "Your driver profile is already active." })).toBeVisible()
  await page.getByRole("link", { name: "Open driver workspace" }).click()
  await page.waitForURL(/\/driver\/loads/, { timeout: 30_000 })
  await expect(page.getByRole("heading", { exact: true, name: "Loads" })).toBeVisible()
})

test("role-specific entry offers an explicit workspace switch", async ({ page }) => {
  test.slow()
  await signIn(page, "dispatch@northpine.example")

  await page.goto("/sign-up?path=host")
  await expect(page.getByRole("heading", { name: "Your host workspace is already active." })).toBeVisible()
  await expect(page.getByText(/Summit Ridge Timber/)).toBeVisible()

  await page.getByRole("button", { name: "Switch to host workspace" }).click()
  await page.waitForURL(/\/host\/command/, { timeout: 30_000 })
  await expect(page.getByRole("heading", { exact: true, name: "Command" })).toBeVisible()
})

test("public sign-out returns to anonymous driver onboarding", async ({ page }) => {
  test.slow()
  await signIn(page, "cole@summit.example")

  await page.goto("/")
  await openPublicMenuIfNeeded(page)
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded" }),
    page.getByRole("button", { name: "Sign out" }).last().click()
  ])
  await expect(page).toHaveURL(/\/$/)
  await openPublicMenuIfNeeded(page)
  await expect(page.getByRole("link", { name: "Sign in" }).last()).toBeVisible({ timeout: 15_000 })

  await page.getByRole("link", { name: "Create a driver profile" }).first().click()
  await expect(page).toHaveURL(/\/onboarding\/driver/)
  await expect(page.getByRole("heading", { name: "See work that fits your equipment." })).toBeVisible()
})

test("platform admin reaches the admin console", async ({ page }) => {
  await signIn(page, "admin@logloads.example")

  await page.goto("/admin")
  await expect(page.getByRole("heading", { name: "Admin" })).toBeVisible()
})

test("onboarding provisions a truthful driver first run", async ({ page }, testInfo) => {
  const pageErrors = watchPageErrors(page)

  for (const rejectedNext of [
    "/host/command",
    "https://example.com/driver/loads"
  ]) {
    await page.goto(`/onboarding/driver?next=${encodeURIComponent(rejectedNext)}`)
    await expect(page.locator('input[name="next"]')).toHaveValue("")
  }

  await page.goto("/onboarding/driver?next=%2Fdriver%2Floads")
  await page.waitForLoadState("domcontentloaded")
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
  await expect(page.getByText("Your driver profile opens in setup.")).toBeVisible()
  await page.getByRole("button", { name: "Create profile and finish setup" }).click()
  await page.waitForURL(/\/driver\/profile\?welcome=1/, { timeout: 30_000 })
  expect(new URL(page.url()).searchParams.has("next")).toBe(false)
  await expect(page.getByRole("heading", { name: "Profile", exact: true })).toBeVisible()

  const firstRun = page.getByTestId("driver-first-run")
  await expect(firstRun.getByText("Account and profile created", { exact: true })).toBeVisible()
  await expect(firstRun.getByRole("heading", { name: "Your driver workspace is ready to finish." })).toBeVisible()
  await expect(firstRun.getByText("Load acceptance locked", { exact: true })).toBeVisible()
  await expect(firstRun.getByTestId("driver-first-run-equipment")).toHaveAttribute("data-state", "complete")
  await expect(firstRun.getByTestId("driver-first-run-equipment")).toContainText("Equipment record")
  await expect(firstRun.getByTestId("driver-first-run-availability")).toHaveAttribute("data-state", "complete")
  await expect(firstRun.getByRole("link", { name: "Review credential requirements" })).toBeVisible()
  await expect(firstRun.getByRole("button", { name: "Continue where you left off" })).toBeVisible()

  await page.reload()
  await expect(page.getByTestId("driver-first-run")).toBeVisible()
  await expect(page.getByText("Load acceptance locked", { exact: true })).toBeVisible()
  await page.evaluate(() => window.scrollTo(0, 0))

  if (testInfo.project.name !== "desktop-chrome") {
    const credentialState = page.getByTestId("driver-first-run-credential-state")
    const mobileNav = page.getByRole("navigation", { name: "driver mobile navigation" })

    await expect(mobileNav).toBeVisible()
    const stateBox = await credentialState.boundingBox()
    const navBox = await mobileNav.boundingBox()

    if (!stateBox || !navBox) throw new Error("Driver first-run or mobile navigation geometry is missing")
    expect(stateBox.y + stateBox.height).toBeLessThanOrEqual(navBox.y - 8)
  }

  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath(`driver-first-run-${testInfo.project.name}.png`)
  })
  expect(pageErrors).toEqual([])
  await expect(page.locator("[data-nextjs-dialog], .vite-error-overlay")).toHaveCount(0)

  await page.getByRole("button", { name: "Continue where you left off" }).click()
  await page.waitForURL(/\/driver\/loads$/, { timeout: 30_000 })
  await page.goto("/driver/profile?welcome=1")
  await expect(page.getByRole("button", { name: "Continue where you left off" })).toHaveCount(0)
})

test("fleet onboarding opens a Fleet Free activation handoff", async ({ page }, testInfo) => {
  const pageErrors = watchPageErrors(page)

  await page.goto("/onboarding/fleet")
  await page.waitForLoadState("domcontentloaded")

  await expect(page.getByRole("radio", { name: /Small fleet/ })).toBeChecked()
  await page.getByLabel("Full name").fill("First Run Fleet Manager")
  await page.getByLabel("Email").fill(`fleet-${Date.now()}@smoke.example`)
  await page.getByLabel("Phone").fill("555-0172")
  await page.getByRole("button", { name: "Continue" }).click()

  await page.getByLabel("Fleet name").fill("First Run Timber Fleet")
  await page.getByLabel("Operating region").fill("Test Valley")
  await page.getByRole("button", { name: "Continue" }).click()

  await expect(page.getByText("Fleet Free opens with your first unit on file.")).toBeVisible()
  await page.getByRole("button", { name: "Create Fleet Free workspace" }).click()
  await page.waitForURL(/\/fleet\/command\?welcome=1/, { timeout: 30_000 })
  await expect(page.getByRole("heading", { name: "Command", exact: true })).toBeVisible()

  const firstRun = page.getByTestId("fleet-first-run")
  await expect(firstRun.getByText("Fleet Free is active", { exact: true })).toBeVisible()
  await expect(
    firstRun.getByRole("heading", { name: "Build the operating picture before you put a truck on work." })
  ).toBeVisible()
  await expect(firstRun.getByText(/no checkout/i)).toBeVisible()
  await expect(firstRun.getByTestId("fleet-readiness-unit")).toHaveAttribute("data-status", "complete")
  await expect(firstRun.getByTestId("fleet-readiness-driver")).toHaveAttribute("data-status", "waiting")
  await expect(firstRun.getByTestId("fleet-readiness-credentials")).toHaveAttribute("data-status", "waiting")
  await expect(firstRun.getByRole("link", { name: "Add or assign a driver" })).toBeVisible()

  await page.reload()
  await expect(page.getByTestId("fleet-first-run")).toBeVisible()
  await expect(page.getByText(/no checkout/i)).toBeVisible()
  await page.evaluate(() => window.scrollTo(0, 0))

  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath(`fleet-first-run-${testInfo.project.name}.png`)
  })
  expect(pageErrors).toEqual([])
  await expect(page.locator("[data-nextjs-dialog], .vite-error-overlay")).toHaveCount(0)
})

test("host onboarding opens a mobile first-movement launchpad", async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name === "desktop-chrome",
    "this path sets and verifies the exact 390px host onboarding viewport"
  )
  const pageErrors = watchPageErrors(page)

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
  await page.getByRole("button", { name: "Create host workspace" }).click()
  await page.waitForURL(/\/host\/landings\?welcome=1/, { timeout: 30_000 })

  await expect(page.getByRole("heading", { name: "Landings", exact: true })).toBeVisible()
  const firstRun = page.getByTestId("host-first-run")
  await expect(firstRun.getByText("Workspace created", { exact: true })).toBeVisible()
  await expect(
    firstRun.getByRole("heading", { name: "Prepare your first timber movement" })
  ).toBeVisible()
  await expect(firstRun.getByText(/your host workspace is created/i)).toBeVisible()
  await expect(firstRun.getByText(/live publication stays off/i)).toBeVisible()
  const readiness = firstRun
  await expect(readiness.getByText("Add a landing", { exact: true })).toBeVisible()
  await expect(readiness.getByText("Add a lane", { exact: true })).toBeVisible()
  await expect(readiness.getByText("Add a pay rate", { exact: true })).toBeVisible()
  await expect(readiness.getByText("Prepare a draft", { exact: true })).toBeVisible()
  await expect(readiness.getByText("Host billing activation", { exact: true })).toBeVisible()
  await expect(readiness.getByText(/accept the current 5% agreement and attach a card/i)).toBeVisible()
  await expect(readiness.getByText(/workspace setup itself does not charge you/i)).toBeVisible()

  await page.evaluate(() => window.scrollTo(0, 0))
  const primaryAction = readiness.getByRole("link", { name: "Add first landing" })
  const actionBox = await primaryAction.boundingBox()
  const mobileNavBox = await page
    .getByRole("navigation", { name: "host mobile navigation" })
    .boundingBox()
  await expect(page.getByRole("navigation", { name: "host mobile navigation" })).toBeVisible()
  if (!actionBox || !mobileNavBox) throw new Error("Host first-run or mobile navigation geometry is missing")
  expect(actionBox.height).toBeGreaterThanOrEqual(44)
  expect(actionBox.y + actionBox.height).toBeLessThanOrEqual(mobileNavBox.y - 8)
  const viewportWidth = await page.evaluate(() => document.documentElement.clientWidth)
  const contentWidth = await page.evaluate(() => document.documentElement.scrollWidth)
  expect(contentWidth).toBeLessThanOrEqual(viewportWidth + 1)

  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath("host-first-movement-mobile.png")
  })
  expect(pageErrors).toEqual([])
  await expect(page.locator("[data-nextjs-dialog], .vite-error-overlay")).toHaveCount(0)

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
