import { mkdirSync } from "node:fs"
import { expect, test, type Page } from "@playwright/test"

/**
 * Proves the two self-service features shipped in this pass work end-to-end
 * against seeded state: a driver submits verification evidence that persists and
 * reaches the admin review queue, and the operator assistant answers grounded
 * questions. Each test gets a fresh browser context (like journey.spec.ts) so a
 * new sign-in is not blocked by a prior session; server state persists across the
 * serial tests. Run with --project=desktop-chrome.
 */

const SHOTS = ".artifacts"
mkdirSync(SHOTS, { recursive: true })

// Fixed so the admin test can assert exactly what the driver test submitted;
// re-runs upsert the same (person, identity) record rather than duplicating it.
const EVIDENCE = "Oregon Class A CDL available for review; valid through 2028."

async function signIn(page: Page, email: string) {
  await page.goto("/sign-in")
  await page.waitForLoadState("domcontentloaded")
  await page.fill('input[name="email"]', email)
  await page.click('button[type="submit"]')
  await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"), { timeout: 30_000 })
}

test.describe.serial("verification + assistant", () => {
  test("driver submits verification evidence and it persists as pending", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await signIn(page, "hank@northpine.example")
    await page.goto("/driver/profile")
    await page.waitForLoadState("domcontentloaded")

    await expect(page.getByText("Get verified")).toBeVisible()
    await page.locator(".verify-form select[name=verificationType]").selectOption("identity")
    await page.locator(".verify-form textarea[name=evidenceSummary]").fill(EVIDENCE)
    await page.locator(".verify-form button[type=submit]").click()
    await expect(
      page.locator(".verify-form").getByText(/Submitted for review|couldn't confirm the submission/)
    ).toBeVisible({ timeout: 20_000 })
    await page.screenshot({ path: `${SHOTS}/verification-driver.png`, fullPage: true })

    await expect(async () => {
      await page.reload()
      await page.waitForLoadState("domcontentloaded")
      await expect(page.locator(".verify-record").filter({ hasText: "Identity" }).first()).toBeVisible({ timeout: 2_000 })
      await expect(page.locator(".verify-record").filter({ hasText: "In review" }).first()).toBeVisible({ timeout: 2_000 })
    }).toPass({ timeout: 30_000 })
  })

  test("the submission reaches the admin review queue attributed to the driver", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await signIn(page, "admin@logloads.example")
    await page.goto("/admin/verification")
    await page.waitForLoadState("domcontentloaded")

    await expect(page.getByText(EVIDENCE).first()).toBeVisible({ timeout: 15_000 })
  })

  test("driver assistant answers grounded questions with citations", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await signIn(page, "hank@northpine.example")
    await page.goto("/driver/assistant")
    await page.waitForLoadState("domcontentloaded")

    await expect(page.locator(".assistant-chip").first()).toBeVisible()
    await page.getByRole("button", { name: "What should I haul next?" }).click()
    await expect(page.locator(".assistant-msg--bot .assistant-answer").first()).toBeVisible({ timeout: 15_000 })

    await page.locator(".assistant-composer input").fill("any alerts I should know about?")
    await page.locator(".assistant-composer button[type=submit]").click()
    await expect(page.locator(".assistant-msg--bot .assistant-answer").nth(1)).toBeVisible({ timeout: 15_000 })
    await page.screenshot({ path: `${SHOTS}/assistant-driver.png`, fullPage: true })
  })
})
