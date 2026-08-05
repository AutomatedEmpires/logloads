import { expect, test, type Page } from "@playwright/test"

import { fillWhenReady, selectWhenReady } from "./builder-input"

/**
 * Proves a host can build the records publishing requires without leaving the
 * product. Until this existed, the Landings page told them to "contact LogLoads
 * support" for records onboarding never created, so a real host organization
 * could never post work at all.
 */

async function signIn(page: Page, email: string) {
  await page.goto("/sign-in", { waitUntil: "domcontentloaded" })
  await page.fill('input[name="email"]', email)
  await page.click('button[type="submit"]')
  await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"), {
    timeout: 90_000,
    waitUntil: "domcontentloaded"
  })
}

// Unique per run so records from earlier runs can never collide by name. The
// current 5% agreement has no landing tier or allowance; the stamp is identity,
// not a workaround for scarce subscription capacity.
const STAMP = process.env.LOGLOADS_E2E_STAMP?.trim() || String(Date.now())
const LANDING = `Cedar Spur ${STAMP}`
const DESTINATION = `Juniper Mill ${STAMP}`
const LANE = `Cedar to Cascade ${STAMP}`
const RATE_NOTE = `Cedar rate ${STAMP}`
const GATE_NOTE = `Call dispatch for cedar gate ${STAMP}`

test.describe.serial("host workspace setup", () => {
  // This is one stateful journey over a shared durable fixture. It runs on one
  // browser project so the same logical setup is not written twice; responsive
  // coverage belongs to the read-only surface checks.
  test.beforeEach(({ page }, testInfo) => {
    void page
    // Not a claim of mobile coverage: the host workspace is a desktop surface
    // and every test here sets a desktop viewport, as the repo's other host
    // journeys do.
    test.skip(
      testInfo.project.name !== "mobile-chrome",
      "stateful setup journey runs once, on the mobile-chrome project"
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
    await selectWhenReady(addDestination, "Current road condition", "wet")
    await addDestination.getByRole("button", { name: "Add destination" }).click()
    await expect(addDestination.getByRole("status")).toHaveText("Saved.", { timeout: 30_000 })

    await expect(async () => {
      await page.reload()
      await page.waitForLoadState("domcontentloaded")
      const refreshed = page.locator(".host-landing-card").filter({ hasText: LANDING }).first()
      await expect(refreshed.locator('select[name="millId"] option').filter({ hasText: DESTINATION })).toHaveCount(1)
    }).toPass({ timeout: 30_000 })

    const destinationRecord = page.locator(".workspace-section").filter({ hasText: "Destinations" })
      .locator("li").filter({ hasText: DESTINATION }).first()
    const editDestination = destinationRecord.locator("details").filter({ hasText: "Edit destination" })
    await editDestination.getByText("Edit destination", { exact: true }).click()
    await fillWhenReady(editDestination, "Scale house or site contact", "Juniper Check-in")
    await editDestination.getByRole("button", { name: "Save destination" }).click()
    await expect(editDestination.getByRole("status")).toContainText("Saved", { timeout: 30_000 })

    await page.reload()
    await page.waitForLoadState("domcontentloaded")
    const persistedDestination = page.locator(".workspace-section").filter({ hasText: "Destinations" })
      .locator("li").filter({ hasText: DESTINATION }).first()
    const persistedEditor = persistedDestination.locator("details").filter({ hasText: "Edit destination" })
    await persistedEditor.getByText("Edit destination", { exact: true }).click()
    await expect(persistedEditor.getByLabel("Scale house or site contact"))
      .toHaveValue("Juniper Check-in")
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
    await card.locator("form.workspace-form--inline").getByLabel("Road condition").selectOption("good")
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

  test("the host can retire that destination from future lane setup", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await signIn(page, "cole@summit.example")
    await page.goto("/host/landings")
    await page.waitForLoadState("domcontentloaded")

    const destinationRecord = page.locator(".workspace-section").filter({ hasText: "Destinations" })
      .locator("li").filter({ hasText: DESTINATION }).first()
    const editDestination = destinationRecord.locator("details").filter({ hasText: "Edit destination" })
    await editDestination.getByText("Edit destination", { exact: true }).click()
    await editDestination.getByRole("button", { name: "Retire destination" }).click()

    await expect(async () => {
      await page.reload()
      await page.waitForLoadState("domcontentloaded")
      const refreshedRecord = page.locator(".workspace-section").filter({ hasText: "Destinations" })
        .locator("li").filter({ hasText: DESTINATION }).first()
      await expect(refreshedRecord.getByText(/Retired from new lanes/)).toBeVisible()
      await expect(page.locator('select[name="millId"] option').filter({ hasText: DESTINATION })).toHaveCount(0)
    }).toPass({ timeout: 30_000 })
  })
})
