import { mkdirSync } from "node:fs"
import { expect, test, type Page } from "@playwright/test"

/**
 * Proves the world-class rich posting flow: a host publishes a RECURRING load with
 * equipment requirements and a weekly cadence through the guided builder, and it
 * goes live. Captures a screenshot of the schedule step and the published board.
 * Run with --project=desktop-chrome.
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

test.describe.serial("rich load posting", () => {
  test("a host publishes a recurring load with equipment + cadence through the guided builder", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await signIn(page, "cole@summit.example")
  await page.goto("/host/opportunities")
  await page.waitForLoadState("domcontentloaded")

  // The builder is ready (not the "Publishing is not ready" gate).
  await expect(page.getByText("Publish timber movement")).toBeVisible()

  // Step 0 — Timber: title, product, and an equipment requirement chip.
  await page.getByLabel("Work title").fill("Ridge saw-log recurring block")
  await page.getByLabel("Timber product").selectOption("saw_logs")
  const firstEquipment = page.locator(".req-block").first().locator(".req-chip").first()
  if (await firstEquipment.isVisible().catch(() => false)) {
    await firstEquipment.click()
  }
  await page.getByRole("button", { name: "Next" }).click()

  // Step 1 — Movement: pick a real haul route.
  await page.getByLabel("Haul route").selectOption({ index: 1 })
  await page.getByRole("button", { name: "Next" }).click()

  // Step 2 — Capacity + schedule: recurring, weekly on set days.
  await page.getByLabel("Cadence").selectOption("recurring")
  await page.getByLabel("Starting").fill("2026-08-03")
  await page.getByLabel("Repeat until").fill("2026-08-28")
  // Day-of-week chips default to Mon/Wed/Fri; confirm they render.
  await expect(page.locator(".req-chip").filter({ hasText: "Mon" }).first()).toBeVisible()
  await page.screenshot({ path: `${SHOTS}/posting-schedule.png`, fullPage: true })
  await page.getByRole("button", { name: "Next" }).click()

  // Step 3 — Terms (rate pre-selected, driver pay is the fee basis).
  await page.getByLabel("What this work pays a driver, per truckload").fill("525.00")
  await page.getByRole("button", { name: "Next" }).click()
  // Step 4 — Visibility requires an explicit publish choice.
  await page.getByRole("radio", { name: /Publish now/ }).check()
  await page.getByRole("button", { name: "Next" }).click()

  // Step 5 — Review shows the cadence, then publish.
  await expect(page.getByText(/weekly on/i)).toBeVisible()
  await page.getByRole("button", { name: "Publish to the network" }).click()

  await expect(page.getByText(/is live on the network/)).toBeVisible({ timeout: 15_000 })
  await page.screenshot({ path: `${SHOTS}/posting-published.png`, fullPage: true })
  })

  test("the recurring load surfaces on the driver board with its weekly cadence", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await signIn(page, "hank@northpine.example")
    await page.goto("/driver/loads")
    await page.waitForLoadState("domcontentloaded")

    const card = page.locator(".load-card-v3").filter({ hasText: "Ridge saw-log recurring block" }).first()
    await expect(card).toBeVisible({ timeout: 15_000 })
    await expect(card.locator(".load-cadence")).toContainText("Weekly")
  })
})
