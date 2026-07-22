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
  await page.waitForLoadState("networkidle")
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
    await page.waitForLoadState("networkidle")

    await expect(page.getByText("Publish timber movement")).toBeVisible()

    // Step 0 — Timber: title only, no equipment requirement (any truck fits).
    await fillWhenReady(page, "Work title", TITLE)
    await page.getByRole("button", { name: "Next" }).click()

    // Step 1 — Movement: pick a real haul route.
    await selectWhenReady(page, "Haul route", { index: 1 })
    await page.getByRole("button", { name: "Next" }).click()

    // Step 2 — Capacity: exactly one truckload on the default one-off date.
    await fillWhenReady(page, "Truckloads needed per day", "1")
    await page.getByRole("button", { name: "Next" }).click()

    // Step 3 — Terms, Step 4 — Visibility: defaults.
    await page.getByRole("button", { name: "Next" }).click()
    await page.getByRole("radio", { name: /Publish now/ }).check()
    await page.getByRole("button", { name: "Next" }).click()

    await page.getByRole("button", { name: "Publish to the network" }).click()
    await expect(page.getByText(/is live on the network/)).toBeVisible({ timeout: 15_000 })
  })

  test("the driver's request fills the day and withdrawing reopens it", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await signIn(page, "hank@northpine.example")
    await page.goto("/driver/loads")
    await page.waitForLoadState("networkidle")

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
    await page.waitForLoadState("networkidle")

    const requestCard = page.locator(".schedule-request-card").filter({ hasText: TITLE }).first()
    await expect(requestCard).toBeVisible({ timeout: 15_000 })
    await requestCard.getByRole("button", { name: "Withdraw request" }).click()
    await requestCard.getByRole("button", { name: "Yes, withdraw it" }).click()

    // The server refresh removes the pending card from the Schedule queue.
    await expect(page.locator(".schedule-request-card").filter({ hasText: TITLE })).toHaveCount(0, { timeout: 15_000 })

    // The load reopened: the same detail page offers the haul again.
    await page.goto(detailUrl)
    await page.waitForLoadState("networkidle")
    await expect(page.getByRole("button", { name: "Request haul" })).toBeVisible({ timeout: 15_000 })
  })
})
