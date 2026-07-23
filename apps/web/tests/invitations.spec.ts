import { expect, test, type Page } from "@playwright/test"

/**
 * Proves the whole team loop the settings page now claims: a member manager
 * records an invitation, an existing user accepts it from the account menu and
 * gains a second workspace, and a brand-new person joins THROUGH the seeded
 * invitation at onboarding without creating an organization of their own.
 *
 * One sign-in per test (fresh context per test), and the flow is stateful, so
 * mobile is the single project that runs it — the house idiom.
 */

async function signIn(page: Page, email: string) {
  await page.goto("/sign-in")
  await page.waitForLoadState("networkidle")
  await page.fill('input[name="email"]', email)
  await page.click('button[type="submit"]')
  await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"), { timeout: 30_000 })
}

test.describe.serial("workspace invitations", () => {
  test.beforeEach(({ page }, testInfo) => {
    void page
    test.skip(
      testInfo.project.name === "desktop-chrome",
      "stateful invitation flow runs once; the loop already ran on mobile"
    )
  })

  test("a member manager records an invitation — and no surface claims it was emailed", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await signIn(page, "cole@summit.example")
    await page.goto("/host/settings")
    await page.waitForLoadState("networkidle")

    await page.getByLabel("Email address").fill("maya@northpine.example")
    await page.getByLabel("Role").selectOption({ label: "Dispatcher" })
    await page.getByRole("button", { name: "Invite to workspace" }).click()

    await expect(page.getByText(/Invitation recorded/)).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/does not send email/)).toBeVisible()

    await expect(async () => {
      await page.reload()
      await page.waitForLoadState("networkidle")
      await expect(page.getByText("maya@northpine.example")).toBeVisible({ timeout: 2_000 })
    }).toPass({ timeout: 20_000 })
  })

  test("an existing user accepts from the account menu and gains a second workspace", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await signIn(page, "maya@northpine.example")

    await page.getByRole("button", { name: /North Pine/ }).click()
    const menu = page.locator(".account-switcher__menu")
    await expect(menu.getByText("Invitations")).toBeVisible({ timeout: 10_000 })
    await expect(menu.getByText(/Summit Ridge/)).toBeVisible()

    await menu.getByRole("button", { name: "Accept" }).click()

    // Accepting moves the session to the joined workspace; the trigger now
    // names Summit and the switcher lists both outfits.
    await expect(async () => {
      await page.reload()
      await page.waitForLoadState("networkidle")
      await expect(page.getByRole("button", { name: /Summit Ridge/ })).toBeVisible({ timeout: 2_000 })
    }).toPass({ timeout: 25_000 })

    await page.getByRole("button", { name: /Summit Ridge/ }).click()
    await expect(page.locator(".account-switcher__menu").getByText("Switch workspace")).toBeVisible()
    await expect(
      page.locator(".account-switcher__menu").getByRole("button", { name: /North Pine/ })
    ).toBeVisible()
  })

  test("a brand-new person joins through the seeded invitation without creating an organization", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    // The credential-free bench previews onboarding for an invited address
    // via ?as= — production resolves the identity from Clerk instead.
    await page.goto("/onboarding?as=casey@summit.example")
    await page.waitForLoadState("networkidle")

    const joinCard = page.locator(".invite-panel__join")
    await expect(joinCard.getByText(/Summit Ridge/)).toBeVisible({ timeout: 15_000 })
    await expect(joinCard.getByText(/no new operation is created/)).toBeVisible()

    await joinCard.getByLabel("Full name").fill("Casey Crew")
    await joinCard.getByLabel("Phone").fill("555-7007")
    await joinCard.getByRole("button", { name: /Join Summit Ridge/ }).click()

    // A landing manager lands in the host cockpit of the outfit they joined.
    await page.waitForURL((url) => url.pathname.startsWith("/host"), { timeout: 30_000 })
    await expect(page.getByRole("button", { name: /Summit Ridge/ })).toBeVisible({ timeout: 15_000 })
  })
})
