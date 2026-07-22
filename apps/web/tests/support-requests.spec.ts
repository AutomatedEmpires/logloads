import { expect, test, type Browser, type Page } from "@playwright/test"

import { fillWhenReady, selectWhenReady } from "./builder-input"

async function signIn(page: Page, email: string): Promise<void> {
  await page.goto("/sign-in")
  await page.waitForLoadState("networkidle")
  await page.fill('input[name="email"]', email)
  await page.click('button[type="submit"]')
  await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"), { timeout: 30_000 })
}

async function authenticatedPage(browser: Browser, email: string): Promise<{ close: () => Promise<void>; page: Page }> {
  const context = await browser.newContext()
  const page = await context.newPage()
  await signIn(page, email)

  return { close: () => context.close(), page }
}

test.describe.configure({ mode: "serial" })

test("driver feedback is triaged and resolved without losing retry state", async ({ browser }, testInfo) => {
  const unique = `${testInfo.project.name}-${Date.now()}`
  const title = `Reconnect feedback ${unique}`
  const details = `The save control stays disabled after reconnecting in ${unique}.`
  const preEditTitle = `Edit retry draft ${unique}`
  const preEditDetails = `The retry draft before editing is ${unique}.`
  const editedTitle = `Edited retry draft ${unique}`
  const editedDetails = `The retry draft was changed after the failed response in ${unique}.`
  const resolutionNote = `The expected reconnect behavior was clarified for ${unique}.`

  const reporter = await authenticatedPage(browser, "hank@northpine.example")
  await reporter.page.goto("/driver/map")
  const accountButton = reporter.page.getByRole("button", { name: "Account and product feedback" })
  await accountButton.focus()
  await expect(accountButton).toBeFocused()
  await accountButton.press("Enter")
  const supportLink = reporter.page.getByRole("link", { name: "Report a problem or request a feature" })
  await expect(supportLink).toBeVisible()
  await supportLink.focus()
  await expect(supportLink).toBeFocused()
  await supportLink.press("Enter")
  await expect(reporter.page).toHaveURL((url) =>
    url.pathname === "/support" && url.searchParams.get("from") === "/driver/map"
  )
  await expect(reporter.page.getByRole("heading", { name: "Product feedback" })).toBeVisible()
  await expect(reporter.page.getByText("This is not an emergency or dispatch channel.")).toBeVisible()
  await reporter.page.getByRole("radio", { name: /Report a problem/ }).check()
  await reporter.page.getByRole("radio", { name: /Slowed down/ }).check()
  await fillWhenReady(reporter.page, "Short summary", title)
  await fillWhenReady(reporter.page, "Details", details)

  let obscureFirstResponse = true
  const samePayloadSubmissionIds: string[] = []
  await reporter.page.route("**/api/support-requests", async (route) => {
    const body = route.request().postDataJSON() as { submissionId: string }
    samePayloadSubmissionIds.push(body.submissionId)
    const response = await route.fetch()

    if (obscureFirstResponse) {
      obscureFirstResponse = false
      await route.fulfill({
        body: JSON.stringify({ error: "The connection dropped after the save." }),
        contentType: "application/json",
        status: 503
      })
      return
    }

    await route.fulfill({ response })
  })

  await reporter.page.getByRole("button", { name: "Send product feedback" }).click()
  await expect(reporter.page.locator(".support-form__error")).toContainText("connection dropped")
  await expect(reporter.page.getByLabel("Short summary")).toHaveValue(title)
  await expect(reporter.page.getByLabel("Details")).toHaveValue(details)
  await reporter.page.getByRole("button", { name: "Send product feedback" }).click()
  await expect(reporter.page.getByText(/feedback was already saved|feedback was saved/)).toBeVisible()
  await reporter.page.unroute("**/api/support-requests")
  expect(samePayloadSubmissionIds).toHaveLength(2)
  expect(samePayloadSubmissionIds[1]).toBe(samePayloadSubmissionIds[0])
  const reporterCard = reporter.page.locator("article").filter({ has: reporter.page.getByRole("heading", { name: title }) })
  await expect(reporterCard).toHaveCount(1)
  await expect(reporterCard.getByText("Open", { exact: true })).toBeVisible()

  await fillWhenReady(reporter.page, "Short summary", preEditTitle)
  await fillWhenReady(reporter.page, "Details", preEditDetails)
  let obscureEditedResponse = true
  const editedPayloadSubmissionIds: string[] = []
  await reporter.page.route("**/api/support-requests", async (route) => {
    const body = route.request().postDataJSON() as { submissionId: string }
    editedPayloadSubmissionIds.push(body.submissionId)
    const response = await route.fetch()

    if (obscureEditedResponse) {
      obscureEditedResponse = false
      await route.fulfill({
        body: JSON.stringify({ error: "The connection dropped after the edited draft save." }),
        contentType: "application/json",
        status: 503
      })
      return
    }

    await route.fulfill({ response })
  })
  await reporter.page.getByRole("button", { name: "Send product feedback" }).click()
  await expect(reporter.page.locator(".support-form__error")).toContainText("edited draft save")
  await expect(reporter.page.getByLabel("Short summary")).toHaveValue(preEditTitle)
  await expect(reporter.page.getByLabel("Details")).toHaveValue(preEditDetails)
  await fillWhenReady(reporter.page, "Short summary", editedTitle)
  await fillWhenReady(reporter.page, "Details", editedDetails)
  await reporter.page.getByRole("button", { name: "Send product feedback" }).click()
  await expect(reporter.page.getByText("Your feedback was saved for the LogLoads product team.")).toBeVisible()
  await reporter.page.unroute("**/api/support-requests")
  expect(editedPayloadSubmissionIds).toHaveLength(2)
  expect(editedPayloadSubmissionIds[1]).not.toBe(editedPayloadSubmissionIds[0])
  await reporter.page.reload()
  const preEditCard = reporter.page.locator("article").filter({
    has: reporter.page.getByRole("heading", { name: preEditTitle })
  })
  const editedCard = reporter.page.locator("article").filter({
    has: reporter.page.getByRole("heading", { name: editedTitle })
  })
  await expect(preEditCard).toHaveCount(1)
  await expect(editedCard).toHaveCount(1)
  await expect(editedCard).toContainText(editedDetails)
  await expect.poll(() => reporter.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  const submitBox = await reporter.page.getByRole("button", { name: "Send product feedback" }).boundingBox()
  expect(submitBox?.height ?? 0).toBeGreaterThanOrEqual(48)
  await testInfo.attach(`reporter-support-${testInfo.project.name}`, {
    body: await reporter.page.screenshot({ fullPage: true }),
    contentType: "image/png"
  })
  await reporter.close()

  const reviewer = await authenticatedPage(browser, "admin@logloads.example")
  await reviewer.page.goto("/admin/reports")
  await selectWhenReady(reviewer.page, "Request status", "all")
  let adminCard = reviewer.page.locator("article").filter({ has: reviewer.page.getByRole("heading", { name: title }) }).first()
  await expect(adminCard).toBeVisible()
  await adminCard.getByRole("button", { name: "Start review" }).click()
  await expect(adminCard.getByText("In review", { exact: true })).toBeVisible()
  adminCard = reviewer.page.locator("article").filter({ has: reviewer.page.getByRole("heading", { name: title }) }).first()
  await selectWhenReady(adminCard, "Outcome", "answered")
  await fillWhenReady(adminCard, "Resolution note the reporter will see", resolutionNote)

  let failReviewOnce = true
  await reviewer.page.route("**/api/admin/support-requests/*", async (route) => {
    if (failReviewOnce) {
      failReviewOnce = false
      await route.fulfill({
        body: JSON.stringify({ error: "The review service is temporarily unavailable." }),
        contentType: "application/json",
        status: 503
      })
      return
    }

    await route.continue()
  })
  await adminCard.getByRole("button", { name: "Resolve request" }).click()
  await expect(adminCard.getByRole("alert")).toContainText("temporarily unavailable")
  await expect(adminCard.getByLabel("Resolution note the reporter will see")).toHaveValue(resolutionNote)
  await reviewer.page.unroute("**/api/admin/support-requests/*")
  await adminCard.getByRole("button", { name: "Resolve request" }).click()
  await expect(adminCard.getByText("Resolved", { exact: true })).toBeVisible()
  await expect(adminCard.getByText(resolutionNote)).toBeVisible()
  await expect(reviewer.page.getByRole("heading", { name: "System flags" })).toBeVisible()
  await expect.poll(() => reviewer.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await testInfo.attach(`admin-resolution-${testInfo.project.name}`, {
    body: await reviewer.page.screenshot({ fullPage: true }),
    contentType: "image/png"
  })
  await reviewer.close()

  const resolvedReporter = await authenticatedPage(browser, "hank@northpine.example")
  await resolvedReporter.page.goto("/support")
  const resolvedCard = resolvedReporter.page.locator("article").filter({
    has: resolvedReporter.page.getByRole("heading", { name: title })
  }).first()
  await expect(resolvedCard.getByText("Resolved", { exact: true })).toBeVisible()
  await expect(resolvedCard.getByText(resolutionNote)).toBeVisible()
  await resolvedReporter.page.getByRole("button", { name: /Notifications/ }).click()
  const updateLink = resolvedReporter.page.getByRole("link", { name: /Product feedback updated/ }).first()
  await expect(updateLink).toHaveAttribute("href", /\/support#support-request-/)
  await updateLink.click()
  await expect(resolvedCard).toBeVisible()
  await resolvedReporter.close()
})
