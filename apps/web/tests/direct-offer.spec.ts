import { expect, test, type Page } from "@playwright/test"

async function signIn(page: Page, email: string) {
  await page.goto("/sign-in")
  await page.waitForLoadState("domcontentloaded")
  await page.fill('input[name="email"]', email)
  await page.click('button[type="submit"]')
  await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"), { timeout: 30_000 })
}

test.describe("direct-offer commitment", () => {
  test.beforeEach(({ page }, testInfo) => {
    void page
    test.skip(testInfo.project.name === "mobile-chrome", "runs once at the end of the stateful suite")
  })

  test("a fleet dispatcher accepts one truck on mobile and the host sees the exact partial count", async ({ page }) => {
    const stamp = Date.now()
    const loadTitle = `Direct offer saw-log block ${stamp}`
    const loadDate = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

    await page.setViewportSize({ height: 844, width: 390 })
    // The seed opens with Hank on an active haul, and earlier full-suite
    // journeys can book another. Close every current booking through the same
    // two-step field control a real driver uses so his cleared rig is genuinely
    // free for this independent direct-offer journey.
    await signIn(page, "hank@northpine.example")
    await page.goto("/driver/schedule")
    await expect(page.getByRole("heading", { name: "Schedule" })).toBeVisible()

    for (let cancelled = 0; cancelled < 6; cancelled += 1) {
      const cancelButtons = page.getByRole("button", { name: "Cancel haul" })
      const before = await cancelButtons.count()

      if (before === 0) {
        break
      }

      await cancelButtons.first().click()
      await page.getByRole("button", { name: "Yes, cancel the haul" }).first().click()
      await expect.poll(
        () => page.getByRole("button", { name: "Cancel haul" }).count(),
        { timeout: 15_000 }
      ).toBeLessThan(before)
    }

    await expect(page.getByRole("button", { name: "Cancel haul" })).toHaveCount(0)

    await page.context().clearCookies()
    await page.setViewportSize({ height: 900, width: 1440 })
    await signIn(page, "cole@summit.example")
    await page.goto("/host/opportunities")
    await page.waitForLoadState("domcontentloaded")

    await page.getByLabel("Work title").fill(loadTitle)
    await page.getByRole("button", { name: "Next" }).click()
    await page.getByLabel("Haul route").selectOption({ index: 1 })
    await page.getByRole("button", { name: "Next" }).click()
    await page.getByLabel("Truckloads needed per day").fill("2")
    await page.getByLabel("Load date").fill(loadDate)
    await page.getByRole("button", { name: "Next" }).click()
    await page.getByLabel("What this work pays a driver, per truckload").fill("525.00")
    await page.getByRole("button", { name: "Next" }).click()
    await page.getByRole("radio", { name: /Publish now/ }).check()
    await page.getByRole("button", { name: "Next" }).click()
    await page.getByRole("button", { name: "Publish to the network" }).click()
    await expect(page.getByText(new RegExp(`${loadTitle}.*live on the network`))).toBeVisible({ timeout: 15_000 })

    await page.goto("/host/carriers")
    await page.waitForLoadState("domcontentloaded")
    const offerPanel = page.locator(".host-panel").filter({ hasText: "Send a direct offer" })
    const loadOption = offerPanel.locator("option").filter({ hasText: loadTitle })
    const loadPostingId = await loadOption.getAttribute("value")
    await offerPanel.locator("select").first().selectOption(loadPostingId as string)
    await offerPanel.locator("label").filter({ hasText: /^Partner/ }).locator("select").selectOption({
      label: "North Pine Logging"
    })
    await offerPanel.getByLabel("Truckloads to invite").fill("2")
    await offerPanel.getByRole("button", { name: "Send direct offer" }).click()
    await expect(offerPanel.getByText(/Direct offer sent to North Pine Logging for 2 truckloads/)).toBeVisible({ timeout: 15_000 })

    await page.context().clearCookies()
    await page.setViewportSize({ height: 915, width: 412 })
    await signIn(page, "dispatch@northpine.example")
    await page.goto("/fleet/opportunities")
    await page.waitForLoadState("domcontentloaded")

    const offer = page.locator("article").filter({ hasText: loadTitle }).filter({ hasText: "0 of 2 accepted" }).first()
    await expect(offer).toBeVisible({ timeout: 15_000 })
    const reviewLink = offer.getByRole("link", { name: "Review offer" })
    const reviewHref = await reviewLink.getAttribute("href")
    if (!reviewHref) {
      throw new Error("Direct offer review link is missing its destination")
    }
    await Promise.all([
      page.waitForURL((url) => url.pathname === reviewHref),
      reviewLink.click()
    ])
    await page.waitForLoadState("domcontentloaded")
    await expect(page.getByRole("heading", { name: "Accept with a truck" })).toBeVisible()
    await expect(page.getByText(/Capacity is committed only when each truck is accepted/)).toBeVisible()

    const acceptButton = page.getByRole("button", { name: "Accept and assign" }).first()
    const rig = acceptButton.locator("xpath=ancestor::article[contains(@class, 'fleet-dispatch-option')]")
    await expect(rig).toBeVisible()
    const rigLabel = await rig.locator("strong").innerText()
    const driverName = (await rig.locator(":scope > span").innerText()).split(" · ")[0] ?? ""
    const unitNumber = rigLabel.split(/\s+/)[0] ?? ""

    if (!driverName || !unitNumber) {
      throw new Error("The eligible rig is missing its driver or unit identity")
    }

    const selectedRig = page.locator(".fleet-dispatch-option").filter({ hasText: rigLabel }).first()
    await acceptButton.click()
    await expect(selectedRig.getByText(/immediately creates the assignment/)).toBeVisible()
    await selectedRig.getByRole("button", { name: "Confirm assignment" }).click()
    await expect(page.getByRole("heading", { name: "1 truckload still invited" })).toBeVisible({ timeout: 15_000 })
    const commitments = page
      .getByRole("heading", { name: "Assignments on this load" })
      .locator("xpath=ancestor::section")
    const commitment = commitments
      .getByRole("article")
      .filter({ hasText: driverName })
      .filter({ hasText: unitNumber })
    await expect(commitment.getByText("accepted", { exact: true })).toBeVisible()

    await page.goto("/fleet/trips")
    await page.waitForLoadState("domcontentloaded")
    await expect(page.locator(".fleet-trip-row").filter({ hasText: loadTitle })).toBeVisible()

    await page.context().clearCookies()
    await page.setViewportSize({ height: 900, width: 1440 })
    await signIn(page, "cole@summit.example")
    await page.goto("/host/carriers")
    await page.waitForLoadState("domcontentloaded")

    const hostOffer = page.locator("article").filter({ hasText: loadTitle }).filter({ hasText: "1 of 2 accepted" }).first()
    await expect(hostOffer).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/Capacity is committed only when each truck is accepted/)).toBeVisible()
    await expect(page.getByText(/truckloads.*held/i)).toHaveCount(0)
  })
})
