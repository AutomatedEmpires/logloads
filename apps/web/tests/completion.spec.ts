import { expect, test, type Page } from "@playwright/test"

import { fillWhenReady, selectWhenReady } from "./builder-input"

/**
 * Proves the settlement loop on a runtime load: the driver records what came
 * off the truck at the destination, the host confirms it, and the delivered
 * record survives on the completed haul.
 *
 * One sign-in per test: each test gets a fresh browser context, and signing in
 * twice on one context lands on the cockpit instead of the sign-in form.
 */

async function signIn(page: Page, email: string) {
  await page.goto("/sign-in")
  await page.waitForLoadState("networkidle")
  await page.fill('input[name="email"]', email)
  await page.click('button[type="submit"]')
  await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"), { timeout: 30_000 })
}

/**
 * Advances the driver's trip one step and waits for the NEXT step's button to
 * appear. The wait is deliberately a positive assertion: checking that the old
 * button is gone passes vacuously in the instant after a reload, before the
 * card has rendered — which would report a step as taken when the click never
 * registered.
 */
async function advance(page: Page, label: string, nextLabel: string) {
  await page.goto("/driver/schedule")
  await page.waitForLoadState("networkidle")

  const card = () => page.locator(".trip-card").filter({ hasText: TITLE }).first()
  await expect(card()).toBeVisible({ timeout: 15_000 })
  const committed = page.waitForResponse((response) => {
    const request = response.request()
    return request.method() === "POST" && new URL(response.url()).pathname === "/driver/schedule"
  }, { timeout: 45_000 })

  await card().getByRole("button", { name: label }).click()
  await committed

  // The action commits through a server action. Wait for that response before
  // reloading so a slow mobile connection cannot cancel the in-flight write.
  await page.reload()
  await page.waitForLoadState("networkidle")
  await expect(card().getByRole("button", { name: nextLabel })).toBeVisible({ timeout: 15_000 })
}

const TITLE = `Delivery record ${Date.now()}`

test.describe.serial("delivered record", () => {
  // Both projects share one canonical state row and this module's TITLE, so a
  // second project would publish a second load of the same name and book a
  // second haul for the same driver — leaving two trip cards the selectors
  // cannot tell apart. The driver's half of this loop is a phone surface, so
  // mobile is the run that matters.
  test.beforeEach(({ page }, testInfo) => {
    void page
    test.skip(
      testInfo.project.name === "desktop-chrome",
      "stateful delivery flow already ran; host steps set an explicit desktop viewport"
    )
  })

  test("a host publishes a runtime load", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await signIn(page, "cole@summit.example")
    await page.goto("/host/opportunities")
    await page.waitForLoadState("networkidle")

    await fillWhenReady(page, "Work title", TITLE)
    await page.getByRole("button", { name: "Next" }).click()
    await selectWhenReady(page, "Haul route", { index: 1 })
    await page.getByRole("button", { name: "Next" }).click()
    await fillWhenReady(page, "Truckloads needed per day", "1")
    await page.getByRole("button", { name: "Next" }).click()
    await page.getByRole("button", { name: "Next" }).click()
    await page.getByRole("radio", { name: /Publish now/ }).check()
    await page.getByRole("button", { name: "Next" }).click()
    await page.getByRole("button", { name: "Publish to the network" }).click()
    await expect(page.getByText(/is live on the network/)).toBeVisible({ timeout: 15_000 })
  })

  test("the driver requests the haul", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await signIn(page, "hank@northpine.example")
    await page.goto("/driver/loads")
    await page.waitForLoadState("networkidle")

    const card = page.locator(".load-card-v3").filter({ hasText: TITLE }).first()
    await expect(card).toBeVisible({ timeout: 15_000 })
    await card.click()
    await page.waitForURL(/\/driver\/loads\//)
    await page.getByRole("button", { name: "Request haul" }).click()
    await expect(page.getByText("The host is deciding.")).toBeVisible({ timeout: 15_000 })
  })

  test("the host approves it", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await signIn(page, "cole@summit.example")
    await page.goto("/host/command")
    await page.waitForLoadState("networkidle")

    const row = page.locator(".host-approval-row").filter({ hasText: TITLE }).first()
    await expect(row).toBeVisible({ timeout: 15_000 })
    await row.getByRole("button", { name: "Review approval" }).click()
    await row.getByRole("button", { name: "Confirm approval" }).click()

    await expect(async () => {
      await page.reload()
      await expect(page.locator(".host-approval-row").filter({ hasText: TITLE })).toHaveCount(0, { timeout: 2_000 })
    }).toPass({ timeout: 20_000 })
  })

  test("the driver records the delivery at the destination", async ({ page }) => {
    test.setTimeout(180_000)
    // The scale is a phone-in-hand moment.
    await page.setViewportSize({ width: 390, height: 844 })
    await signIn(page, "hank@northpine.example")

    await advance(page, "Head to landing", "Arrived at landing")
    await advance(page, "Arrived at landing", "Start loading")
    await advance(page, "Start loading", "Confirm loaded")
    await advance(page, "Confirm loaded", "Head to mill")
    await advance(page, "Head to mill", "Arrived at mill")
    await advance(page, "Arrived at mill", "Start unloading")

    // At the destination the delivery form appears, naming the proof owed.
    const card = page.locator(".trip-card").filter({ hasText: TITLE }).first()
    const form = card.locator(".completion-form")
    await expect(form).toBeVisible({ timeout: 15_000 })
    await expect(form.getByText(/This haul needs:/)).toBeVisible()

    // The provider-free E2E lane cannot upload the Route Pack's scale ticket.
    // Exercise the legitimate no-ticket path instead: a rejected load records
    // zero delivered plus the exception that explains why no proof exists.
    await form.getByLabel("Delivered").fill("0")
    await form.getByLabel("Exception").selectOption("rejected_at_scale")
    await form.getByLabel("What happened").fill("Receiving rejected the load before a ticket was issued.")
    await form.getByRole("button", { name: "Record delivery" }).click()
    await expect(form.getByText("Delivery recorded. The host will confirm it.")).toBeVisible({ timeout: 15_000 })

    await advance(page, "Start unloading", "Finish trip")
    const unloadingCard = page.locator(".trip-card").filter({ hasText: TITLE }).first()
    const committed = page.waitForResponse((response) => {
      const request = response.request()
      return request.method() === "POST" && new URL(response.url()).pathname === "/driver/schedule"
    }, { timeout: 45_000 })
    await unloadingCard.getByRole("button", { name: "Finish trip" }).click()
    await committed
    await expect(async () => {
      await page.reload()
      await page.waitForLoadState("networkidle")
      await expect(
        page.locator(".trip-card").filter({ hasText: TITLE }).first().locator("header .ui-badge").getByText("Delivered", { exact: true })
      ).toBeVisible({ timeout: 2_000 })
    }).toPass({ timeout: 25_000 })
  })

  test("the host confirms the delivered record", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await signIn(page, "cole@summit.example")
    await page.goto("/host/live-board")
    await page.waitForLoadState("networkidle")

    const card = page.locator(".live-card").filter({ hasText: TITLE }).first()
    await expect(card).toBeVisible({ timeout: 15_000 })
    await expect(card.getByText(/0 tons delivered/)).toBeVisible()
    await expect(card.getByText(/rejected at scale: Receiving rejected the load/i)).toBeVisible()

    await card.getByRole("button", { name: "Review confirmation" }).click()
    await card.getByRole("button", { name: "Yes, confirm delivery" }).click()

    // Confirming unmounts the settle control, so the settled state on the card
    // is the durable proof — assert that rather than a transient message.
    await expect(async () => {
      await page.reload()
      await page.waitForLoadState("networkidle")
      await expect(
        page.locator(".live-card").filter({ hasText: TITLE }).first().getByText(/0 tons confirmed/)
      ).toBeVisible({ timeout: 2_000 })
    }).toPass({ timeout: 25_000 })
  })
})
