import { mkdirSync } from "node:fs"
import { expect, test, type Page } from "@playwright/test"

/**
 * Proves the reputation + reliability flywheel end-to-end on seeded state: a
 * driver reviews a completed cross-org haul, reputation surfaces on profiles and
 * load cards, and the reliability dashboard ranks organizations. maya is the
 * driver on the seeded cross-org hauls (so hank's recommendation flows stay
 * untouched). The group runs once because submitting a review consumes its seed
 * opportunity; every test sets its own desktop viewport.
 */

const SHOTS = ".artifacts"
mkdirSync(SHOTS, { recursive: true })

async function signIn(page: Page, email: string) {
  await page.goto("/sign-in")
  await page.waitForLoadState("networkidle")
  await page.fill('input[name="email"]', email)
  await page.click('button[type="submit"]')
  await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"), { timeout: 30_000 })
}

test.describe.serial("reputation + reliability", () => {
  test.beforeEach((_fixtures, testInfo) => {
    test.skip(
      testInfo.project.name === "desktop-chrome",
      "stateful reputation flow already ran at an explicit desktop viewport"
    )
  })

  test("a driver reviews a completed cross-org haul (stars + tags)", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await signIn(page, "maya@northpine.example")
    await page.goto("/driver/trips")
    await page.waitForLoadState("networkidle")

    const form = page.locator(".review-form").first()
    await expect(form).toBeVisible({ timeout: 15_000 })

    await form.locator(".review-star").nth(4).click() // 5 stars
    await form.locator(".review-tag").first().click()
    await page.screenshot({ path: `${SHOTS}/reputation-review.png`, fullPage: true })

    await form.getByRole("button", { name: "Submit review" }).click()
    // After submit, the action revalidates and the trip re-renders as reviewed, so
    // the open review form disappears and a "You reviewed …" mark takes its place.
    await expect(page.locator(".review-form")).toHaveCount(0, { timeout: 15_000 })
    await expect(page.getByText(/You reviewed/).first()).toBeVisible()
  })

  test("reputation surfaces on the driver profile and load cards", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await signIn(page, "hank@northpine.example")

    await page.goto("/driver/profile")
    await page.waitForLoadState("networkidle")
    await expect(page.locator(".reputation-chip").first()).toBeVisible({ timeout: 15_000 })
    await page.screenshot({ path: `${SHOTS}/reputation-profile.png`, fullPage: true })

    await page.goto("/driver/loads")
    await page.waitForLoadState("networkidle")
    await expect(page.locator(".reputation-chip").first()).toBeVisible({ timeout: 15_000 })
  })

  test("the reliability dashboard ranks organizations", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await signIn(page, "admin@logloads.example")
    await page.goto("/admin/reliability")
    await page.waitForLoadState("networkidle")

    await expect(page.getByText("Network reliability")).toBeVisible()
    await expect(page.locator(".perf-row").first()).toBeVisible({ timeout: 15_000 })
    await page.screenshot({ path: `${SHOTS}/reputation-dashboard.png`, fullPage: true })
  })
})
