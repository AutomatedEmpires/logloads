import { expect, test, type Page } from "@playwright/test"

import { fillWhenReady, selectWhenReady } from "./builder-input"

/**
 * Proves the host's published-work lifecycle end to end: save a draft through
 * the guided builder, publish it to the network from the Work list (capacity
 * and slots are minted at that moment), watch it surface for a driver, then
 * close it — after which drivers can no longer request it.
 */

async function signIn(page: Page, email: string) {
  await page.goto("/sign-in")
  await page.waitForLoadState("networkidle")
  await page.fill('input[name="email"]', email)
  await page.click('button[type="submit"]')
  await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"), { timeout: 30_000 })
}

// Unique per run so persisted state from earlier runs can never collide.
const TITLE = `Draft lifecycle ${Date.now()}`

// Captured when the driver opens the load; used after the host closes it.
let detailUrl = ""

test.describe.serial("published-work lifecycle", () => {
  test("a host saves a draft and publishes it from the Work list", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await signIn(page, "cole@summit.example")
    await page.goto("/host/opportunities")
    await page.waitForLoadState("networkidle")

    await expect(page.getByText("Publish timber movement")).toBeVisible()

    await fillWhenReady(page, "Work title", TITLE)
    await page.getByRole("button", { name: "Next" }).click()
    await selectWhenReady(page, "Haul route", { index: 1 })
    await page.getByRole("button", { name: "Next" }).click()
    await fillWhenReady(page, "Truckloads needed per day", "1")
    await page.getByRole("button", { name: "Next" }).click()
    await fillWhenReady(page, "What this work pays a driver, per truckload", "525.00")
    await page.getByRole("button", { name: "Next" }).click()

    // Visibility step: hold the work as a team-only draft.
    await page.getByText("Draft — team only").click()
    await page.getByRole("button", { name: "Next" }).click()
    await page.getByRole("button", { name: "Save draft" }).click()
    await expect(page.getByText(/is saved as a draft/)).toBeVisible({ timeout: 15_000 })

    // Reload so the published-work list is a fresh server render — the
    // in-place refresh after the action can race this assertion.
    await page.reload()
    await page.waitForLoadState("networkidle")

    // The draft row offers Publish now; publishing flips it live.
    const row = page.locator(".host-load-row").filter({ hasText: TITLE }).first()
    await expect(row).toBeVisible({ timeout: 15_000 })
    await expect(row.getByText(/^draft$/i)).toBeVisible()
    await row.getByRole("button", { name: "Publish now" }).click()

    // Poll through reloads: the badge flip arrives with a server re-render.
    await expect(async () => {
      await page.reload()
      await expect(row.getByText(/^open$/i)).toBeVisible({ timeout: 2_000 })
    }).toPass({ timeout: 20_000 })
  })

  test("the published work reaches the driver board as requestable", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await signIn(page, "hank@northpine.example")
    await page.goto("/driver/loads")
    await page.waitForLoadState("networkidle")

    const card = page.locator(".load-card-v3").filter({ hasText: TITLE }).first()
    await expect(card).toBeVisible({ timeout: 15_000 })
    await card.click()
    await page.waitForURL(/\/driver\/loads\//)
    detailUrl = page.url()
    await expect(page.getByRole("button", { name: "Request haul" })).toBeVisible({ timeout: 15_000 })
  })

  test("the host closes the work from the Work list", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await signIn(page, "cole@summit.example")
    await page.goto("/host/opportunities")
    await page.waitForLoadState("networkidle")

    const row = page.locator(".host-load-row").filter({ hasText: TITLE }).first()
    await expect(row).toBeVisible({ timeout: 15_000 })
    await row.getByRole("button", { name: "Close work" }).click()
    await row.getByRole("button", { name: "Yes, close this work" }).click()

    // Poll through reloads: the badge flip arrives with a server re-render.
    await expect(async () => {
      await page.reload()
      await expect(row.getByText(/^cancelled$/i)).toBeVisible({ timeout: 2_000 })
    }).toPass({ timeout: 20_000 })
  })

  test("the driver can no longer request the closed work", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await signIn(page, "hank@northpine.example")

    expect(detailUrl).toBeTruthy()
    await page.goto(detailUrl)
    await page.waitForLoadState("networkidle")
    await expect(page.getByRole("button", { name: "Request haul" })).toHaveCount(0)
  })
})
