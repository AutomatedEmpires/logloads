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
  await page.waitForLoadState("domcontentloaded")
  await page.fill('input[name="email"]', email)
  await page.click('button[type="submit"]')
  await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"), { timeout: 30_000 })
}

// Unique per run so records from earlier runs can never collide by name. It does
// NOT make the run repeatable: each one permanently spends one of Summit Ridge's
// three active landings, so a third run against an un-reset database correctly
// meets the at-limit notice and the add form is gone.
const STAMP = process.env.LOGLOADS_E2E_STAMP?.trim() || String(Date.now())
const LANDING = `Cedar Spur ${STAMP}`
const DESTINATION = `Juniper Mill ${STAMP}`
const LANE = `Cedar to Cascade ${STAMP}`
const RATE_NOTE = `Cedar rate ${STAMP}`
const GATE_NOTE = `Call dispatch for cedar gate ${STAMP}`

test.describe.serial("host workspace setup", () => {
  // This journey consumes the seed host's plan capacity: it adds an active
  // landing, and Summit Ridge's plan covers three. Run against a database the
  // suite has already exercised without `pnpm db:assert` first and the add form
  // is correctly replaced by the at-limit notice — a real refusal, not a flake.
  // It also runs once rather than once per project, for the same reason.
  test.beforeEach(({ page }, testInfo) => {
    void page
    // Not a claim of mobile coverage: the host workspace is a desktop surface
    // and every test here sets a desktop viewport, as the repo's other host
    // journeys do. It runs on one project because it consumes an active landing
    // from the host's plan and must not spend two.
    test.skip(
      testInfo.project.name === "desktop-chrome",
      "consumes plan capacity; runs once, on the mobile-chrome project"
    )
  })

  test("the host adds a landing from the Landings page", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await signIn(page, "cole@summit.example")
    await page.goto("/host/landings")
    await page.waitForLoadState("domcontentloaded")

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
    await fillWhenReady(addForm, "Landing map latitude", "44.29")
    await fillWhenReady(addForm, "Landing map longitude", "-121.55")
    await fillWhenReady(addForm, "Site contact", "Cole Cedar")
    await fillWhenReady(addForm, "Contact phone", "555-3001")

    // A road condition the form offers but the schema refuses fails every
    // submission a host tries. This spec passed while three of the five options
    // were invented, because it never touched the field — so it picks a real
    // one the default would not have covered.
    await selectWhenReady(addForm, "Road condition", "muddy")

    await addForm.getByRole("button", { name: "Add landing" }).click()
    await expect(addForm.getByText("Saved.")).toBeVisible({ timeout: 30_000 })

    // The landing itself on the page is the durable proof, not a flash message.
    await expect(async () => {
      await page.reload()
      await page.waitForLoadState("domcontentloaded")
      await expect(page.getByRole("heading", { name: LANDING })).toBeVisible()
    }).toPass({ timeout: 30_000 })
  })

  test("the host adds an unlisted destination without leaving the lane builder", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await signIn(page, "cole@summit.example")
    await page.goto("/host/landings")
    await page.waitForLoadState("domcontentloaded")

    const card = page.locator(".host-landing-card").filter({ hasText: LANDING }).first()
    const addDestination = card.locator("details").filter({ hasText: "Haul somewhere not listed?" })
    await addDestination.getByText("Haul somewhere not listed? Add a destination", { exact: true }).click()

    await fillWhenReady(addDestination, "Destination name", DESTINATION)
    await fillWhenReady(addDestination, "Street address", "800 Mill Yard Road")
    await fillWhenReady(addDestination, "City", "La Pine")
    await fillWhenReady(addDestination, "State", "OR")
    await fillWhenReady(addDestination, "Postal code", "97739")
    await fillWhenReady(addDestination, "Map latitude", "43.67")
    await fillWhenReady(addDestination, "Map longitude", "-121.50")
    await fillWhenReady(addDestination, "Scale house or site contact", "Juniper Scale House")
    await fillWhenReady(addDestination, "Contact phone", "555-4001")
    await addDestination.getByRole("button", { name: "Add destination" }).click()
    await expect(addDestination.getByText("Saved. It is available in your lanes now.")).toBeVisible({ timeout: 30_000 })

    await expect(async () => {
      await page.reload()
      await page.waitForLoadState("domcontentloaded")
      const refreshed = page.locator(".host-landing-card").filter({ hasText: LANDING }).first()
      await expect(refreshed.locator('select[name="millId"] option').filter({ hasText: DESTINATION })).toHaveCount(1)
    }).toPass({ timeout: 30_000 })
  })

  test("the host adds a lane from that landing", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await signIn(page, "cole@summit.example")
    await page.goto("/host/landings")
    await page.waitForLoadState("domcontentloaded")

    const card = page.locator(".host-landing-card").filter({ hasText: LANDING }).first()
    await expect(card).toBeVisible({ timeout: 15_000 })

    // The condition chosen when it was added survived the round trip, rather
    // than being silently rewritten by a form whose options did not match the
    // values the record can hold.
    await expect(card.getByText("Road Muddy")).toBeVisible()
    await expect(card.getByText(/No lanes yet/)).toBeVisible()

    await card.getByLabel("Lane name").fill(LANE)
    await card.locator('select[name="millId"]').selectOption({ label: `${DESTINATION} — La Pine, OR` })
    await card.getByLabel("Distance (miles)").fill("38.4")
    await card.getByLabel("Run time (minutes)").fill("68")
    await card.getByRole("button", { name: "Add lane" }).click()
    await expect(card.getByText("Lane added.")).toBeVisible({ timeout: 30_000 })

    await expect(async () => {
      await page.reload()
      await page.waitForLoadState("domcontentloaded")
      const refreshed = page.locator(".host-landing-card").filter({ hasText: LANDING }).first()
      await expect(refreshed.getByText(LANE)).toBeVisible()
    }).toPass({ timeout: 30_000 })
  })

  test("the host verifies the private driver briefing for that landing", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await signIn(page, "cole@summit.example")
    await page.goto("/host/landings")
    await page.waitForLoadState("domcontentloaded")

    const card = page.locator(".host-landing-card").filter({ hasText: LANDING }).first()
    const briefing = card.locator("details").filter({ hasText: "Driver briefing" })
    await briefing.getByText("Driver briefing", { exact: true }).click()

    await fillWhenReady(briefing, "Public approximate area", "Sisters, OR — cedar district")
    await fillWhenReady(briefing, "Exact entrance latitude", "44.291")
    await fillWhenReady(briefing, "Exact entrance longitude", "-121.551")
    await fillWhenReady(briefing, "Gate instructions", GATE_NOTE)
    await fillWhenReady(briefing, "Loading equipment (one per line)", "heel-boom loader\nlanding radio channel 6")
    await fillWhenReady(briefing, "Turnaround constraints (one per line)", "No chip vans above the bridge")
    await fillWhenReady(briefing, "Safety and PPE requirements (one per line)", "Hard hat and hi-vis outside the cab")
    await briefing.getByRole("button", { name: "Save and verify briefing" }).click()

    await expect(async () => {
      await page.reload()
      await page.waitForLoadState("domcontentloaded")
      const refreshed = page.locator(".host-landing-card").filter({ hasText: LANDING }).first()
      await expect(refreshed.locator("dd").filter({ hasText: "heel-boom loader" })).toBeVisible()
      await expect(refreshed.getByText(/Details verified/)).toBeVisible()
    }).toPass({ timeout: 30_000 })

    const refreshed = page.locator(".host-landing-card").filter({ hasText: LANDING }).first()
    const refreshedBriefing = refreshed.locator("details").filter({ hasText: "Driver briefing" })
    await refreshedBriefing.getByText("Driver briefing", { exact: true }).click()
    await expect(refreshedBriefing.getByLabel("Gate instructions")).toHaveValue(GATE_NOTE)
  })

  test("the host adds a rate to pay at", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await signIn(page, "cole@summit.example")
    await page.goto("/host/landings")
    await page.waitForLoadState("domcontentloaded")

    const rates = page.locator(".workspace-section").filter({ hasText: "Rates you pay" })
    await expect(rates).toBeVisible()

    await selectWhenReady(rates, "Pay basis", "per_ton")
    await rates.getByLabel("Amount (USD)").fill("44.25")
    await rates.getByLabel("Effective from").fill("2026-06-25")
    await rates.getByLabel("Note").fill(RATE_NOTE)
    await rates.getByRole("button", { name: "Add rate" }).click()
    await expect(rates.getByText("Rate added.")).toBeVisible({ timeout: 30_000 })

    await expect(async () => {
      await page.reload()
      await page.waitForLoadState("domcontentloaded")
      await expect(page.getByText(RATE_NOTE)).toBeVisible()
    }).toPass({ timeout: 30_000 })
  })

  test("the builder offers the landing AND the lane the host just made", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await signIn(page, "cole@summit.example")
    await page.goto("/host/opportunities")
    await page.waitForLoadState("domcontentloaded")

    await expect(page.getByText("Publish timber movement")).toBeVisible({ timeout: 15_000 })
    await fillWhenReady(page, "Work title", `Cedar haul ${STAMP}`)
    await page.getByRole("button", { name: "Next", exact: true }).click()

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
