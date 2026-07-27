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
  await page.waitForLoadState("domcontentloaded")
  await page.fill('input[name="email"]', email)
  await page.click('button[type="submit"]')
  await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"), { timeout: 30_000 })
}

test.describe.serial("reputation + reliability", () => {
  test.beforeEach(({ page }, testInfo) => {
    void page
    test.skip(
      testInfo.project.name === "desktop-chrome",
      "stateful reputation flow already ran at an explicit desktop viewport"
    )
  })

  test("a driver reviews a completed cross-org haul (stars + tags)", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await signIn(page, "maya@northpine.example")
    await page.goto("/driver/schedule")
    await page.waitForLoadState("domcontentloaded")

    const form = page.locator(".review-form").first()
    await expect(form).toBeVisible({ timeout: 15_000 })
    const tripId = await form
      .locator("xpath=ancestor::article[contains(@class, 'trip-card')]")
      .getAttribute("data-trip-id")

    if (!tripId) {
      throw new Error("The reviewable trip is missing its identity")
    }

    const submittedTrip = page.locator(`.trip-card[data-trip-id="${tripId}"]`)
    await expect(submittedTrip).toHaveCount(1)

    await form.locator(".review-star").nth(4).click() // 5 stars
    await form.locator(".review-tag").first().click()
    await page.screenshot({ path: `${SHOTS}/reputation-review.png`, fullPage: true })

    await form.getByRole("button", { name: "Submit review" }).click()
    // Another completed haul may remain reviewable. Wait for this trip's durable
    // success marker instead of assuming every review form should disappear.
    await expect(submittedTrip.locator(".review-done")).toContainText(
      /(?:Thanks — your review of|You reviewed)/,
      { timeout: 15_000 }
    )
    await expect(submittedTrip.locator(".review-form")).toHaveCount(0)
  })

  test("reputation surfaces on the driver profile and load cards", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await signIn(page, "hank@northpine.example")

    await page.goto("/driver/profile")
    await page.waitForLoadState("domcontentloaded")
    await expect(page.locator(".reputation-chip").first()).toBeVisible({ timeout: 15_000 })
    await page.screenshot({ path: `${SHOTS}/reputation-profile.png`, fullPage: true })

    await page.goto("/driver/loads")
    await page.waitForLoadState("domcontentloaded")
    await expect(page.locator(".reputation-chip").first()).toBeVisible({ timeout: 15_000 })
  })

  test("the reliability dashboard ranks organizations", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await signIn(page, "admin@logloads.example")
    await page.goto("/admin/reliability")
    await page.waitForLoadState("domcontentloaded")

    await expect(page.getByText("Network reliability")).toBeVisible()
    await expect(page.locator(".perf-row").first()).toBeVisible({ timeout: 15_000 })
    await page.screenshot({ path: `${SHOTS}/reputation-dashboard.png`, fullPage: true })
  })
})
