import { mkdirSync } from "node:fs"
import { expect, test, type Page } from "@playwright/test"

/**
 * Proves the intelligence surfaces added in this pass render against seeded
 * state: ranked "Recommended for you" cards on Driver Today, and the topbar
 * notification bell (hank carries one unread seed notification). Captures
 * desktop + mobile screenshots as artifacts. The group runs once because it
 * consumes seeded notification/recommendation state; the general smoke suite
 * independently covers both configured browser projects.
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

test.describe.serial("intelligence surfaces", () => {
  test.beforeEach((_fixtures, testInfo) => {
    test.skip(
      testInfo.project.name === "desktop-chrome",
      "stateful intelligence flow already exercises desktop and mobile viewports"
    )
  })

  test("driver Loads ranks recommendations with human reasons", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await signIn(page, "hank@northpine.example")
    await page.goto("/driver/loads")
    await page.waitForLoadState("networkidle")

    await expect(page.getByText("Recommended for you")).toBeVisible()

    const cards = page.locator(".recommend-card")
    await expect(cards.first()).toBeVisible({ timeout: 15_000 })

    // Every card carries a band label (ui-badge) and at least one plain-language
    // reason — and never a raw numeric score, which must stay server-side.
    await expect(cards.first().locator(".ui-badge").first()).toBeVisible()
    await expect(cards.first().locator(".recommend-reasons li").first()).toBeVisible()
    await expect(page.locator(".recommend-card")).not.toContainText("/100")

    const count = await cards.count()
    console.log(`RECOMMEND_CARDS=${count}`)

    await page.screenshot({ path: `${SHOTS}/driver-loads-desktop.png`, fullPage: true })

    await page.setViewportSize({ width: 390, height: 844 })
    await page.reload()
    await page.waitForLoadState("networkidle")
    await page.screenshot({ path: `${SHOTS}/driver-loads-mobile.png`, fullPage: true })

    // The Driver Today cockpit for a driver mid-haul (active trip surface).
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto("/driver/today")
    await page.waitForLoadState("networkidle")
    await page.screenshot({ path: `${SHOTS}/driver-today-desktop.png`, fullPage: true })
  })

  test("notification bell shows the unread inbox and marks read", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await signIn(page, "hank@northpine.example")
    await page.goto("/driver/today")
    await page.waitForLoadState("networkidle")

    const trigger = page.locator(".notif-bell__trigger")
    await expect(trigger).toBeVisible()

    // Seeded unread notification renders a count badge.
    await expect(page.locator(".notif-bell__count")).toBeVisible()

    await trigger.click()
    const menu = page.locator(".notif-bell__menu")
    await expect(menu).toBeVisible()
    await expect(menu.locator(".notif-item").first()).toBeVisible()
    await page.screenshot({ path: `${SHOTS}/notification-bell.png` })

    // Marking all read clears the count (server round-trip + revalidate).
    await menu.getByRole("button", { name: "Mark all read" }).click()
    await expect(page.locator(".notif-bell__count")).toHaveCount(0, { timeout: 15_000 })
  })
})
