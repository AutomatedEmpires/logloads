import { expect, test, type Page } from "@playwright/test"

import { fillWhenReady, selectWhenReady } from "./builder-input"

/**
 * Proves a host can build the records publishing requires without leaving the
 * product. Until this existed, the Landings page told them to "contact LogLoads
 * support" for records onboarding never created, so a real host organization
 * could never post work at all.
 */

async function signIn(page: Page, email: string) {
  await page.goto("/sign-in")
  await page.waitForLoadState("networkidle")
  await page.fill('input[name="email"]', email)
  await page.click('button[type="submit"]')
  await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"), { timeout: 30_000 })
}

// Unique per run so records from earlier runs can never collide by name. It does
// NOT make the run repeatable: each one permanently spends one of Summit Ridge's
// three active landings, so a third run against an un-reset database correctly
// meets the at-limit notice and the add form is gone.
const STAMP = Date.now()
const LANDING = `Cedar Spur ${STAMP}`
const LANE = `Cedar to Cascade ${STAMP}`
const RATE_NOTE = `Cedar rate ${STAMP}`

test.describe.serial("host workspace setup", () => {
  // This journey consumes the seed host's plan capacity: it adds an active
  // landing, and Summit Ridge's plan covers three. Run against a database the
  // suite has already exercised without `pnpm db:assert` first and the add form
  // is correctly replaced by the at-limit notice — a real refusal, not a flake.
  // It also runs once rather than once per project, for the same reason.
  test.beforeEach(({ page }, testInfo) => {
    void page
    test.skip(
      testInfo.project.name === "desktop-chrome",
      "consumes an active landing from the host's plan; mobile-chrome covers it"
    )
  })

  test("the host adds a landing from the Landings page", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await signIn(page, "cole@summit.example")
    await page.goto("/host/landings")
    await page.waitForLoadState("networkidle")

    // The page used to say "contact LogLoads support to add your first landing".
    await expect(page.getByRole("heading", { name: "Add a landing" })).toBeVisible()

    // Every existing landing renders its own edit form with the same labels, so
    // the add form is addressed specifically rather than by first match.
    const addForm = page.locator(".workspace-section").filter({ hasText: "Add a landing" }).locator("form")

    await fillWhenReady(addForm, "Landing name", LANDING)
    await fillWhenReady(addForm, "Address", "42 Cedar Spur Road")
    await fillWhenReady(addForm, "City", "Sisters")
    await fillWhenReady(addForm, "State", "OR")
    await fillWhenReady(addForm, "Postal code", "97759")
    await fillWhenReady(addForm, "Entrance latitude", "44.29")
    await fillWhenReady(addForm, "Entrance longitude", "-121.55")
    await fillWhenReady(addForm, "Site contact", "Cole Cedar")
    await fillWhenReady(addForm, "Contact phone", "555-3001")

    await addForm.getByRole("button", { name: "Add landing" }).click()

    // The landing itself on the page is the durable proof, not a flash message.
    await expect(async () => {
      await page.reload()
      await page.waitForLoadState("networkidle")
      await expect(page.getByRole("heading", { name: LANDING })).toBeVisible()
    }).toPass({ timeout: 30_000 })
  })

  test("the host adds a lane from that landing", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await signIn(page, "cole@summit.example")
    await page.goto("/host/landings")
    await page.waitForLoadState("networkidle")

    const card = page.locator(".host-landing-card").filter({ hasText: LANDING }).first()
    await expect(card).toBeVisible({ timeout: 15_000 })
    await expect(card.getByText(/No lanes yet/)).toBeVisible()

    await card.getByLabel("Lane name").fill(LANE)
    await card.getByLabel("Distance (miles)").fill("38.4")
    await card.getByLabel("Run time (minutes)").fill("68")
    await card.getByRole("button", { name: "Add lane" }).click()

    await expect(async () => {
      await page.reload()
      await page.waitForLoadState("networkidle")
      const refreshed = page.locator(".host-landing-card").filter({ hasText: LANDING }).first()
      await expect(refreshed.getByText(LANE)).toBeVisible()
    }).toPass({ timeout: 30_000 })
  })

  test("the host adds a rate to pay at", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await signIn(page, "cole@summit.example")
    await page.goto("/host/landings")
    await page.waitForLoadState("networkidle")

    const rates = page.locator(".workspace-section").filter({ hasText: "Rates you pay" })
    await expect(rates).toBeVisible()

    await selectWhenReady(rates, "Pay basis", "per_ton")
    await rates.getByLabel("Amount (USD)").fill("44.25")
    await rates.getByLabel("Effective from").fill("2026-06-25")
    await rates.getByLabel("Note").fill(RATE_NOTE)
    await rates.getByRole("button", { name: "Add rate" }).click()

    await expect(async () => {
      await page.reload()
      await page.waitForLoadState("networkidle")
      await expect(page.getByText(RATE_NOTE)).toBeVisible()
    }).toPass({ timeout: 30_000 })
  })

  test("the builder offers the landing AND the lane the host just made", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await signIn(page, "cole@summit.example")
    await page.goto("/host/opportunities")
    await page.waitForLoadState("networkidle")

    await expect(page.getByText("Publish timber movement")).toBeVisible({ timeout: 15_000 })
    await fillWhenReady(page, "Work title", `Cedar haul ${STAMP}`)
    await page.getByRole("button", { name: "Next" }).click()

    // Asserted on the options rather than the selects: these selects sit inside
    // their labels, so an accessible name is the label text plus whatever is
    // currently chosen — "Landing" never matches on its own, and a substring
    // match lands on the neighbouring "Landing road" select instead.
    const landingOption = page.locator("option").filter({ hasText: LANDING })
    await expect(landingOption).toHaveCount(1)

    // The lane only appears once its landing is the chosen one — the builder
    // filters routes by landing — so this also proves the two records the host
    // made are linked, not merely both present.
    const landingValue = await landingOption.getAttribute("value")
    await page.locator("select").filter({ has: landingOption }).selectOption(landingValue as string)

    await expect(page.locator("option").filter({ hasText: LANE })).toHaveCount(1)
  })
})
