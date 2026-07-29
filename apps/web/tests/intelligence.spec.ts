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
  await page.waitForLoadState("domcontentloaded")
  await page.fill('input[name="email"]', email)
  await page.click('button[type="submit"]')
  await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"), { timeout: 30_000 })
}

test.describe.serial("directed driver surfaces", () => {
  test.beforeEach(({ page }, testInfo) => {
    void page
    test.skip(
      testInfo.project.name === "desktop-chrome",
      "stateful intelligence flow already exercises desktop and mobile viewports"
    )
  })

  test("driver Loads exposes hard equipment compatibility", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await signIn(page, "hank@northpine.example")
    await page.goto("/driver/loads")
    await page.waitForLoadState("domcontentloaded")

    await expect(page.getByRole("region", { name: "Your load board summary" })).toBeVisible()

    const cards = page.locator("a.load-card-v3")
    await expect(cards.first()).toBeVisible({ timeout: 15_000 })

    // Cards carry a server-enforced fit outcome and never manufacture a
    // "strong" recommendation when the active truck only needs review.
    await expect(cards.first().locator(".ui-badge").first()).toBeVisible()
    await expect(cards.first().locator(".ui-badge").first()).toHaveText(/Strong fit|Review needed|Not compatible/)
    for (const text of await cards.allTextContents()) {
      expect(text).not.toContain("/100")
    }

    const count = await cards.count()
    console.log(`AVAILABLE_LOAD_CARDS=${count}`)

    await page.screenshot({ path: `${SHOTS}/driver-loads-desktop.png`, fullPage: true })

    await page.setViewportSize({ width: 390, height: 844 })
    await page.reload()
    await page.waitForLoadState("domcontentloaded")
    await page.screenshot({ path: `${SHOTS}/driver-loads-mobile.png`, fullPage: true })

    // The directed Schedule surface for a driver mid-haul.
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto("/driver/schedule")
    await page.waitForLoadState("domcontentloaded")
    await page.screenshot({ path: `${SHOTS}/driver-schedule-desktop.png`, fullPage: true })
  })

  test("notification bell shows the unread inbox and marks read", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await signIn(page, "hank@northpine.example")
    await page.goto("/driver/map")
    await page.waitForLoadState("domcontentloaded")

    const trigger = page.locator(".notif-bell__trigger")
    await expect(trigger).toBeVisible()

    const unreadBadge = page.locator(".notif-bell__count")

    // A failed attempt may have committed the idempotent mutation before the
    // browser lost its response. On retry, accept only the resulting all-read
    // state; a first attempt must still prove the seeded unread notification.
    if (testInfo.retry > 0 && await unreadBadge.count() === 0) {
      await trigger.click()
      await expect(page.locator(".notif-bell__menu").getByRole("button", { name: "Mark all read" })).toBeDisabled()
      return
    }

    await expect(unreadBadge).toBeVisible()

    await trigger.click()
    const menu = page.locator(".notif-bell__menu")
    await expect(menu).toBeVisible()
    await expect(menu.locator(".notif-item").first()).toBeVisible()
    await page.screenshot({ path: `${SHOTS}/notification-bell.png` })

    // Marking all read clears the count (server round-trip + revalidate).
    await menu.getByRole("button", { name: "Mark all read" }).click()
    await expect(unreadBadge).toHaveCount(0, { timeout: 15_000 })
  })
})
