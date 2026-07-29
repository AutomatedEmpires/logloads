import { expect, test, type Page } from "@playwright/test"

import { fillWhenReady, selectWhenReady } from "./builder-input"

/**
 * Proves the promise the product makes: a Route Pack unlocks after the host
 * accepts — for a load created at runtime, not just for seeded fixtures. The
 * pack is locked while the request is pending and opens with real operational
 * instructions once the haul is booked.
 */

async function signIn(page: Page, email: string) {
  await page.goto("/sign-in")
  await page.waitForLoadState("domcontentloaded")
  await page.fill('input[name="email"]', email)
  await page.click('button[type="submit"]')
  await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"), { timeout: 30_000 })
}

const TITLE = `Route pack haul ${Date.now()}`

let detailUrl = ""

test.describe.serial("route pack unlocks after acceptance", () => {
  test("a host publishes a runtime load", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await signIn(page, "cole@summit.example")
    await page.goto("/host/opportunities")
    await page.waitForLoadState("domcontentloaded")

    await expect(page.getByText("Publish timber movement")).toBeVisible()
    await fillWhenReady(page, "Work title", TITLE)
    await page.getByRole("button", { name: "Next" }).click()
    await selectWhenReady(page, "Haul route", { index: 1 })
    await page.getByRole("button", { name: "Next" }).click()
    await fillWhenReady(page, "Truckloads needed per day", "1")
    await page.getByRole("button", { name: "Next" }).click()
    await fillWhenReady(page, "What this work pays a driver, per truckload", "525.00")
    await page.getByRole("button", { name: "Next" }).click()
    await page.getByRole("radio", { name: /Publish now/ }).check()
    await page.getByRole("button", { name: "Next" }).click()
    await page.getByRole("button", { name: "Publish to the network" }).click()
    await expect(page.getByText(/is live on the network/)).toBeVisible({ timeout: 15_000 })
  })

  test("the pack stays locked while the request is pending", async ({ page }) => {
    // A phone at the landing is the real constraint for this surface.
    await page.setViewportSize({ width: 390, height: 844 })
    await signIn(page, "hank@northpine.example")
    await page.goto("/driver/loads")
    await page.waitForLoadState("domcontentloaded")

    const card = page.locator(".load-card-v3").filter({ hasText: TITLE }).first()
    await expect(card).toBeVisible({ timeout: 15_000 })
    await card.click()
    await page.waitForURL(/\/driver\/loads\//)
    detailUrl = page.url()

    await expect(page.getByText("Route Pack unlocks after assignment.")).toBeVisible()
    // The promise must not claim offline delivery, which does not work yet.
    await expect(page.getByText(/offline/i)).toHaveCount(0)

    await page.getByRole("button", { name: "Request haul" }).click()
    await expect(page.getByText("The host is deciding.")).toBeVisible({ timeout: 15_000 })

    // Still locked: a pending request is not an accepted haul.
    await page.reload()
    await page.waitForLoadState("domcontentloaded")
    await expect(page.getByText("Route Pack unlocks after assignment.")).toBeVisible()
  })

  test("the host approves the request", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await signIn(page, "cole@summit.example")
    await page.goto("/host/command")
    await page.waitForLoadState("domcontentloaded")

    const row = page.locator(".host-approval-row").filter({ hasText: TITLE }).first()
    await expect(row).toBeVisible({ timeout: 15_000 })
    await row.getByRole("button", { name: "Review approval" }).click()
    await row.getByRole("button", { name: "Confirm approval" }).click()

    await expect(async () => {
      await page.reload()
      await expect(page.locator(".host-approval-row").filter({ hasText: TITLE })).toHaveCount(0, { timeout: 2_000 })
    }).toPass({ timeout: 20_000 })
  })

  test("the assigned driver's Route Pack opens with real instructions", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await signIn(page, "hank@northpine.example")

    expect(detailUrl).toBeTruthy()
    await page.goto(detailUrl)
    await page.waitForLoadState("domcontentloaded")

    // The lie this slice exists to fix: for a runtime load this used to throw.
    await expect(page.getByText("Operational briefing for this move.")).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/Route Pack · version 1/)).toBeVisible()

    // Resolved from the landing and destination records, not invented.
    const pack = page.locator(".route-pack-preview")
    await expect(pack.getByText("Gate access")).toBeVisible()
    await expect(pack.getByText("Scale and ticket")).toBeVisible()
    await expect(pack.getByText("Safety and PPE").first()).toBeVisible()
    await expect(pack.getByText("Bring back")).toBeVisible()
    await expect(pack.getByRole("link", { name: "Open landing directions" })).toBeVisible()
    await expect(pack.getByRole("button", { name: "Copy coordinates" })).toBeVisible()
    await expect(pack.getByRole("link", { name: "Open mill directions" })).toBeVisible()
    // The instructions the driver must act on lead the pack.
    await expect(pack.locator(".route-pack-instructions--critical li").first()).toBeVisible()

    // Still no offline promise once unlocked.
    await expect(pack.getByText(/available offline/i)).toHaveCount(0)
  })
})
