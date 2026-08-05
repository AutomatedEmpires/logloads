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
  await page.waitForLoadState("domcontentloaded")
  await page.fill('input[name="email"]', email)
  await page.click('button[type="submit"]')
  await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"), { timeout: 30_000 })
}

// The account-menu trigger's accessible name is its aria-label, not the
// workspace label it displays — target it by that name and assert the active
// workspace via its text content (the label span is display:none on mobile,
// so textContent, not visible text, is the reliable signal).
function accountTrigger(page: Page) {
  return page.getByRole("button", { name: "Account and product feedback" })
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
    await page.waitForLoadState("domcontentloaded")

    // Serial-group retries reuse the same database, so a previous attempt may
    // already have recorded the invitation (pending row) or carried it all the
    // way through acceptance (Maya on the roster; re-inviting an active member
    // is refused — a real rule, not a flake). Submit only from the fresh state;
    // otherwise the durable row IS the proof.
    const pendingRow = page
      .getByRole("group", { name: "Waiting invitations" })
      .getByText("maya@northpine.example")
    const rosterRow = page.locator(".team-list").getByText("Maya Mills")

    if (await rosterRow.isVisible()) {
      return
    }

    if (!(await pendingRow.isVisible())) {
      await page.getByLabel("Email address").fill("maya@northpine.example")
      await page.getByLabel("Role", { exact: true }).selectOption({
        label: "Dispatcher"
      })
      await page.getByRole("button", { name: "Invite to workspace" }).click()

      await expect(page.getByText(/Invitation recorded/)).toBeVisible({ timeout: 15_000 })
      await expect(page.getByText(/does not send email/)).toBeVisible()
    }

    await expect(async () => {
      await page.reload()
      await page.waitForLoadState("domcontentloaded")
      await expect(pendingRow).toBeVisible({ timeout: 2_000 })
    }).toPass({ timeout: 20_000 })
  })

  test("an existing user accepts from the account menu and gains a second workspace", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await signIn(page, "maya@northpine.example")

    await accountTrigger(page).click()
    const menu = page.locator(".account-switcher__menu")
    await expect(menu).toBeVisible()

    // On a serial-group retry the invitation may already be consumed; the
    // switcher then lists Summit directly and there is nothing left to accept.
    const pendingInvite = menu.getByRole("group", { name: "Workspace invitations" })

    if (await pendingInvite.isVisible()) {
      await expect(pendingInvite.getByText(/Summit Ridge/)).toBeVisible()

      await menu.getByRole("button", { name: "Accept" }).click()

      // The menu awaits the server action that persists membership and switches
      // the signed session, then refreshes from that committed state.
      await expect(accountTrigger(page)).toContainText("Summit Ridge", { timeout: 25_000 })

      await accountTrigger(page).click()
    }

    // Either path ends the same way: Maya holds both workspaces.
    await expect(page.locator(".account-switcher__menu").getByText("Switch workspace")).toBeVisible()
    await expect(
      page.locator(".account-switcher__menu").getByRole("button", { name: /Summit Ridge/ })
    ).toBeVisible()
    await expect(
      page.locator(".account-switcher__menu").getByRole("button", { name: /North Pine/ })
    ).toBeVisible()
  })

  test("a brand-new person joins through the seeded invitation without creating an organization", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    // The credential-free bench previews onboarding for an invited address
    // via ?as= — production resolves the identity from Clerk instead.
    await page.goto("/onboarding?as=casey@summit.example")
    await page.waitForLoadState("domcontentloaded")

    const joinCard = page.locator(".invite-panel__join")

    // On a serial-group retry Casey may already have joined (the invitation
    // is consumed, so no join card renders). Demo-mode sign-in only covers
    // seeded personas — Casey's account was minted mid-run — so the joined
    // state is proven from the inviter's side: a seat on Summit's roster.
    if (await joinCard.isVisible()) {
      await expect(joinCard.locator("strong", { hasText: "Summit Ridge" })).toBeVisible()
      await expect(joinCard.getByText(/no new operation is created/)).toBeVisible()

      await joinCard.getByLabel("Full name").fill("Casey Crew")
      await joinCard.getByLabel("Phone").fill("555-7007")
      await joinCard.getByRole("button", { name: /Join Summit Ridge/ }).click()

      // A landing manager lands in the host cockpit of the outfit they joined.
      await page.waitForURL((url) => url.pathname.startsWith("/host"), { timeout: 30_000 })
      await expect(accountTrigger(page)).toContainText("Summit Ridge", { timeout: 15_000 })
    } else {
      await signIn(page, "cole@summit.example")
      await page.goto("/host/settings")
      await page.waitForLoadState("domcontentloaded")
      await expect(page.locator(".team-list").getByText("Casey Crew")).toBeVisible()
    }
  })
})
