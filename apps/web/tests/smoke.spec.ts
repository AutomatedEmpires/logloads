import { expect, test, type Page } from "@playwright/test"

async function signIn(page: Page, email: string) {
  await page.goto("/sign-in")
  await page.waitForLoadState("networkidle")
  await page.fill('input[name="email"]', email)
  await page.click('button[type="submit"]')
  await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"), { timeout: 30_000 })
}

test("visitor understands the public product and can inspect public loads", async ({ page }) => {
  await page.goto("/")

  await expect(page.getByRole("heading", { name: "TIMBER MOVES HERE." })).toBeVisible()
  await expect(page.getByRole("link", { name: "Find loads" }).first()).toBeVisible()

  await page.goto("/loads")
  await expect(page.getByText("Exact access unlocks after assignment.").first()).toBeVisible()
})

test("cockpits are protected: unauthenticated visitors are sent to sign-in", async ({ page }) => {
  for (const route of ["/driver/today", "/fleet/command", "/host/command", "/admin"]) {
    await page.goto(route)
    await expect(page).toHaveURL(/\/sign-in/)
  }
})

test("driver signs in and reaches Today", async ({ page }) => {
  await signIn(page, "hank@northpine.example")

  await expect(page).toHaveURL(/\/driver\/today/)
  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible()
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
  await page.waitForLoadState("networkidle")
  await page.click("text=I haul timber")
  await page.waitForSelector('input[name="fullName"]')
  await page.fill('input[name="fullName"]', "Smoke Test Driver")
  await page.fill('input[name="email"]', `driver-${Date.now()}@smoke.example`)
  await page.fill('input[name="phone"]', "555-0142")
  await page.fill('input[name="region"]', "Test Valley")
  await page.click('button[type="submit"]')
  await page.waitForURL(/\/driver\/today/, { timeout: 30_000 })
  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible()
})
