import { expect, test, type Page } from "@playwright/test"

// #329: the pilot Terms, Privacy Policy, Posting Rules and SMS Terms from the #293 legal review.

function captureClientErrors(page: Page): string[] {
  const errors: string[] = []

  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`)
  })
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`))

  return errors
}

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)

  expect(overflow).toBeLessThanOrEqual(0)
}

test("/marketplace-rules moves permanently to the Posting Rules", async ({ page, request }) => {
  const response = await request.get("/marketplace-rules", { maxRedirects: 0 })

  expect(response.status()).toBe(308)
  expect(new URL(response.headers()["location"] ?? "", "http://127.0.0.1").pathname).toBe("/posting-rules")

  await page.goto("/marketplace-rules")
  await expect(page).toHaveURL(/\/posting-rules$/)
  await expect(page.getByRole("heading", { level: 1, name: "Posting Rules" })).toBeVisible()
  await expect(page.locator("main")).not.toContainText(/Commit through LogLoads|off the record/i)
})

test("each current legal page is a dated, versioned draft for counsel, reachable from the footer", async ({ page }) => {
  const clientErrors = captureClientErrors(page)

  for (const [label, path, title, version] of [
    ["Terms", "/terms", "Terms of Service", "terms-2026-11-18"],
    ["Privacy", "/privacy", "Privacy Policy", "privacy-2026-11-18"],
    ["Posting Rules", "/posting-rules", "Posting Rules", "posting-rules-2026-11-18"],
    ["Acceptable Use", "/acceptable-use", "Acceptable Use Policy", "acceptable-use-2026-11-18"],
    ["SMS Terms", "/sms-terms", "SMS Terms", "sms-terms-2026-11-18"]
  ] as const) {
    await page.goto("/about")
    await page.getByRole("navigation", { name: "Legal" }).getByRole("link", { exact: true, name: label }).click()
    await expect(page).toHaveURL(new RegExp(`${path}$`))
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible()
    await expect(page.locator(".legal-effective")).toContainText(`Version ${version}`)
    await expect(page.getByRole("complementary", { name: "Draft status" })).toContainText(
      "A licensed attorney has not reviewed it yet"
    )
    await expect(page.locator("main")).not.toContainText(/approved by (?:licensed )?(?:counsel|an attorney)/i)
    await expectNoHorizontalScroll(page)
  }

  expect(clientErrors).toEqual([])
})

test("the SMS Terms say how to stop and get help, and that nothing is texted yet", async ({ page }) => {
  await page.goto("/sms-terms")

  const main = page.locator("main")
  await expect(main).toContainText("LogLoads does not send text messages yet.")
  await expect(main).toContainText("Msg & data rates may apply.")
  await expect(main).toContainText("Reply STOP to any LogLoads text")
  await expect(main).toContainText("Reply HELP for help.")
  await expect(main).toContainText("Mobile carriers are not liable for delayed or undelivered messages.")
})

test("the Terms as changed on November 2, 2026 stay readable, unchanged, and out of search", async ({ page }) => {
  await page.goto("/terms/2026-11-02")

  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Terms of Service — archived version as changed on November 2, 2026"
    })
  ).toBeVisible()
  await expect(page.getByRole("heading", { exact: true, name: "What LogLoads is" })).toBeVisible()
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/)
  await expect(
    page.getByRole("link", { exact: true, name: "Read the current Terms of Service" })
  ).toHaveAttribute("href", "/terms")
})
