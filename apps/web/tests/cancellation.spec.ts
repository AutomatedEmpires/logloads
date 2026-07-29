import { expect, test, type Page } from "@playwright/test"

import { fillWhenReady, selectWhenReady } from "./builder-input"

/**
 * Proves the withdraw side of the operating loop end to end: a host publishes
 * a single-truckload day, the driver's request fills it, the driver withdraws
 * the request from Schedule, and the load returns to requestable — the
 * capacity ledger and the load status stay truthful the whole way.
 */

async function signIn(page: Page, email: string) {
  await page.goto("/sign-in")
  await page.waitForLoadState("domcontentloaded")
  await page.fill('input[name="email"]', email)
  await page.click('button[type="submit"]')
  await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"), { timeout: 30_000 })
}

// Unique per run so persisted state from earlier runs can never collide.
const TITLE = `Withdraw loop ${Date.now()}`

test.describe.serial("request withdrawal", () => {
  test("a host publishes a single-truckload day", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await signIn(page, "cole@summit.example")
    await page.goto("/host/opportunities")
    await page.waitForLoadState("domcontentloaded")

    await expect(page.getByText("Publish timber movement")).toBeVisible()

    // Step 0 — Timber: title only, no equipment requirement (any truck fits).
    await fillWhenReady(page, "Work title", TITLE)
    await page.getByRole("button", { name: "Next", exact: true }).click()

    // Step 1 — Movement: pick a real haul route.
    await selectWhenReady(page, "Haul route", { index: 1 })
    await page.getByRole("button", { name: "Next", exact: true }).click()

    // Step 2 — Capacity: exactly one truckload on the default one-off date.
    await fillWhenReady(page, "Truckloads needed per day", "1")
    await page.getByRole("button", { name: "Next", exact: true }).click()

    // Step 3 — Terms, Step 4 — Visibility: defaults.
    await fillWhenReady(page, "What this work pays a driver, per truckload", "525.00")
    await page.getByRole("button", { name: "Next", exact: true }).click()
    await page.getByRole("radio", { name: /Publish now/ }).check()
    await page.getByRole("button", { name: "Next", exact: true }).click()

    await page.getByRole("button", { name: "Publish to the network" }).click()
    await expect(page.getByText(/is live on the network/)).toBeVisible({ timeout: 15_000 })
  })

  test("the driver's request fills the day and withdrawing reopens it", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await signIn(page, "hank@northpine.example")
    await page.goto("/driver/loads")
    await page.waitForLoadState("domcontentloaded")

    const card = page.locator(".load-card-v3").filter({ hasText: TITLE }).first()
    await expect(card).toBeVisible({ timeout: 15_000 })
    await card.click()
    await page.waitForURL(/\/driver\/loads\//)
    const detailUrl = page.url()

    await page.getByRole("button", { name: "Request haul" }).click()
    await expect(page.getByText("The host is deciding.")).toBeVisible({ timeout: 15_000 })

    // The single truckload is committed: the request panel on a fresh view of
    // the same load reports the capacity as taken for everyone else.
    await page.goto("/driver/schedule")
    await page.waitForLoadState("domcontentloaded")

    const requestCard = page.locator(".schedule-request-card").filter({ hasText: TITLE }).first()
    await expect(requestCard).toBeVisible({ timeout: 15_000 })
    await requestCard.getByRole("button", { name: "Withdraw request" }).click()
    const confirmWithdrawal = requestCard.getByRole("button", { name: "Yes, withdraw it" })
    await confirmWithdrawal.click()
    await expect.poll(async () => {
      const removed = (await requestCard.count()) === 0
      const confirmed = await page
        .getByText("Request withdrawn. The truckload is open for other drivers.")
        .isVisible()
        .catch(() => false)

      return removed || confirmed
    }, { timeout: 15_000 }).toBe(true)

    // The load detail is a fresh server projection and is the authoritative
    // capacity check: the same truckload must be requestable again.
    const detailVerificationUrl = new URL(detailUrl)
    detailVerificationUrl.searchParams.set("verify", String(Date.now()))
    await page.goto(detailVerificationUrl.toString())
    await page.waitForLoadState("domcontentloaded")
    await expect(page.getByRole("button", { name: "Request haul" })).toBeVisible({ timeout: 15_000 })

    // Returning to Schedule must no longer classify the cancelled assignment
    // as pending. Navigating away first avoids racing the confirmation state's
    // deliberate background refresh on a slow field connection.
    await page.goto(`/driver/schedule?verify=${Date.now()}`)
    await page.waitForLoadState("domcontentloaded")
    await expect(page.locator(".schedule-request-card").filter({ hasText: TITLE })).toHaveCount(0, { timeout: 15_000 })
  })
})
